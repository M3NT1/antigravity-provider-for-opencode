// ANTIGRAVITY-SPECIFIC NDJSON PROTOCOL
// (verified against the headless mode docs at antigravity.google/docs/cli/headless)
//
// The `agy -p <prompt> --model <slug> --output-format stream-json` invocation
// emits newline-delimited JSON events on stdout. The three event types the
// plugin must consume are:
//
//   init        — once at stream start; carries tools, model, permission_mode
//   step_update — once per step transition or text delta; carries text_delta
//                 on agent_response steps; carries tool_info on tool steps
//   result      — once at the end; carries status, response, usage
//
// Unknown event types are tolerated (skipped) so future agy versions can
// add new fields without breaking the plugin.

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider"

import { subscriptionOnlyEnv } from "./env.js"
import { defaultSpawn, type SpawnFn } from "./spawn.js"
import {
  AgyParseError,
  AgySpawnError,
  AgyUnsupportedModelError,
} from "./errors.js"
import { PROVIDER_ID } from "./constants.js"
import { MODEL_BY_SLUG } from "./models.js"
import type { ModelSlug } from "./types.js"

// ===== Agy event types (subset of /docs/cli/headless stream-json schema) =====

type AgyInit = {
  event: "init"
  conversation_id: string
  init: {
    cwd: string
    tools: string[]
    permission_mode: string
    model?: string
    agent?: string
  }
}

type AgyStepUpdate = {
  event: "step_update"
  step_update: {
    conversation_id: string
    step_index: number
    state: "ACTIVE" | "DONE"
    step_type: "user_input" | "agent_response" | "tool" | "checkpoint"
    text_delta?: string
    duration_seconds?: number
    usage?: AgyUsage
  }
}

type AgyUsage = {
  input_tokens?: number
  output_tokens?: number
  thinking_tokens?: number
  cache_read_tokens?: number
  total_tokens?: number
}

type AgyResult = {
  event: "result"
  result: {
    conversation_id: string
    status: "SUCCESS" | "ERROR" | "CANCELED" | "INTERRUPTED" | "INVALID" | "WAITING" | "RUNNING"
    response?: string
    error?: string
    duration_seconds?: number
    num_turns?: number
    usage?: AgyUsage
  }
}

type AgyEvent = AgyInit | AgyStepUpdate | AgyResult

function isAgyEvent(value: unknown): value is AgyEvent {
  if (!value || typeof value !== "object") return false
  const e = value as { event?: unknown }
  return e.event === "init" || e.event === "step_update" || e.event === "result"
}

// ===== Prompt serialisation =====

function promptToString(prompt: LanguageModelV3CallOptions["prompt"]): string {
  // The Antigravity CLI's --print mode takes a single string, not a
  // multi-message prompt. We concatenate the messages into one
  // user-visible prompt, marking the assistant turns with a prefix
  // so the model can recover the conversation shape.
  const parts: string[] = []
  for (const msg of prompt) {
    if (msg.role === "system") continue // agy --print ignores system anyway
    const text = msg.content
      .map((part) => {
        if (part.type === "text") return part.text
        return "" // attachments/tools/reasoning are dropped at this layer
      })
      .join("")
    if (!text) continue
    if (msg.role === "user") parts.push(text)
    else if (msg.role === "assistant") parts.push(`[assistant]: ${text}`)
  }
  return parts.join("\n\n")
}

// ===== Build the LanguageModelV3 =====

export function buildLanguageModel(opts: {
  binary: string
  spawnFn?: SpawnFn
  modelId: string
}): LanguageModelV3 {
  const slug = opts.modelId as ModelSlug
  if (!MODEL_BY_SLUG[slug]) {
    throw new AgyUnsupportedModelError(opts.modelId)
  }
  const spawnFn = opts.spawnFn ?? defaultSpawn

  return {
    specificationVersion: "v3",
    provider: PROVIDER_ID,
    modelId: opts.modelId,
    supportedUrls: {},
    async doStream(options: LanguageModelV3CallOptions): Promise<{
      stream: ReadableStream<LanguageModelV3StreamPart>
    }> {
      const stream = createStream({ spawnFn, binary: opts.binary, slug, options })
      return { stream }
    },
  }
}

function createStream(args: {
  spawnFn: SpawnFn
  binary: string
  slug: ModelSlug
  options: LanguageModelV3CallOptions
}): ReadableStream<LanguageModelV3StreamPart> {
  const { spawnFn, binary, slug, options } = args
  const prompt = promptToString(options.prompt)
  const controller = new AbortController()
  const combinedSignal = mergeAbortSignals(options.abortSignal, controller.signal)

  const child = spawnFn(
    binary,
    ["-p", prompt, "--model", slug, "--output-format", "stream-json"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: subscriptionOnlyEnv(),
      signal: combinedSignal,
      timeout: 5 * 60 * 1000,
    },
  )

  // Propagate upstream abort into the subprocess kill.
  options.abortSignal?.addEventListener("abort", () => {
    try {
      child.kill("SIGTERM")
    } catch {
      /* ignore */
    }
  })

  // Drain stderr in parallel — we read it lazily for the error path.
  const stderrPromise = drain(child.stderr)

  return ndjsonStream({
    stdout: child.stdout,
    exited: child.exited,
    onSpawnError: async (err: AgySpawnError) => {
      const stderr = await stderrPromise
      throw new AgySpawnError(err.exitCode, stderr || err.stderr)
    },
  })
}

// ===== NDJSON streaming parser =====

function ndjsonStream(args: {
  stdout: NodeJS.ReadableStream | null
  exited: Promise<number | null>
  onSpawnError: (err: AgySpawnError) => Promise<never>
}): ReadableStream<LanguageModelV3StreamPart> {
  const { stdout: stream, exited, onSpawnError } = args
  if (!stream) {
    throw new AgyParseError("", "agy produced no stdout stream")
  }

  const decoder = new TextDecoder()
  const TEXT_ID = "txt-1"

  return new ReadableStream<LanguageModelV3StreamPart>({
    async start(controller) {
      let buffer = ""
      let started = false
      let finished = false
      let textEmitted = false

      const emit = (part: LanguageModelV3StreamPart) => {
        if (finished) return
        controller.enqueue(part)
      }

      const finish = (part: LanguageModelV3StreamPart) => {
        if (finished) return
        finished = true
        controller.enqueue(part)
        controller.close()
      }

      try {
        for await (const chunk of stream) {
          const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true })
          buffer += text

          let nl: number
          while ((nl = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, nl).trim()
            buffer = buffer.slice(nl + 1)
            if (!line) continue

            let parsed: unknown
            try {
              parsed = JSON.parse(line)
            } catch {
              throw new AgyParseError(line, `agy emitted non-JSON line: ${line.slice(0, 120)}`)
            }
            if (!isAgyEvent(parsed)) {
              // unknown event type — skip silently, future-proof
              continue
            }

            if (!started) {
              emit({ type: "stream-start", warnings: [] })
              emit({ type: "text-start", id: TEXT_ID })
              started = true
            }

            if (parsed.event === "step_update") {
              const chunk = parsed.step_update.text_delta
              if (chunk && parsed.step_update.state === "DONE") {
                emit({ type: "text-delta", id: TEXT_ID, delta: chunk })
                textEmitted = true
              }
              continue
            }

            if (parsed.event === "result") {
              const { status, response, usage, error } = parsed.result
              if (status === "SUCCESS") {
                if (response && !textEmitted) {
                  emit({ type: "text-delta", id: TEXT_ID, delta: response })
                  textEmitted = true
                }
                emit({ type: "text-end", id: TEXT_ID })
                finish({
                  type: "finish",
                  finishReason: { unified: "stop", raw: undefined },
                  usage: toAiSdkUsage(usage),
                })
              } else {
                finish({
                  type: "error",
                  error: new AgySpawnError(
                    statusCodeToExit(status),
                    error ?? `agy status: ${status}`,
                  ),
                })
              }
            }
          }
        }

        // Stream closed. Was it a clean SUCCESS (we got a result
        // event) or a failure? If no result event yet, surface the
        // subprocess exit code (if available) and stderr.
        if (!finished) {
          const exitCode = await exited
          const err = await onSpawnError(
            new AgySpawnError(
              exitCode,
              exitCode !== 0 ? "agy stream ended without a result event" : "agy stream ended without a result event",
            ),
          )
          void err
        }
      } catch (err) {
        if (finished) return
        finished = true
        if (err instanceof AgySpawnError) {
          controller.enqueue({ type: "error", error: err })
          controller.close()
          return
        }
        if (err instanceof AgyParseError) {
          controller.enqueue({ type: "error", error: err })
          controller.close()
          return
        }
        controller.enqueue({
          type: "error",
          error: err instanceof Error ? err : new Error(String(err)),
        })
        controller.close()
      }
    },
  })
}

function statusCodeToExit(status: string): number {
  switch (status) {
    case "SUCCESS":
      return 0
    case "ERROR":
      return 1
    case "CANCELED":
    case "INTERRUPTED":
      return 130
    case "INVALID":
      return 2
    case "WAITING":
      return 3
    case "RUNNING":
      return 124
    default:
      return 1
  }
}

function toAiSdkUsage(usage: AgyUsage | undefined): NonNullable<LanguageModelV3StreamPart> extends infer P
  ? P extends { type: "finish"; usage: infer U }
    ? U
    : never
  : never {
  const u = usage ?? {}
  return {
    inputTokens: {
      total: u.input_tokens ?? 0,
      noCache: u.input_tokens ?? 0,
      cacheRead: u.cache_read_tokens,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: u.output_tokens ?? 0,
      text: u.output_tokens ?? 0,
      reasoning: u.thinking_tokens,
    },
  }
}

async function drain(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (!stream) return ""
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString("utf8")
}

function mergeAbortSignals(
  a: AbortSignal | undefined,
  b: AbortSignal,
): AbortSignal {
  if (!a) return b
  const ctrl = new AbortController()
  const onA = () => ctrl.abort((a as AbortSignal).reason)
  const onB = () => ctrl.abort(b.reason)
  if (a.aborted) ctrl.abort((a as AbortSignal).reason)
  else if (b.aborted) ctrl.abort(b.reason)
  else {
    a.addEventListener("abort", onA, { once: true })
    b.addEventListener("abort", onB, { once: true })
  }
  return ctrl.signal
}
