// Convert an agy NDJSON stream into an AI SDK-compatible Response.
//
// Background: opencode's plugin API only allows auth.loader's return
// value to be threaded into the *standard* BUNDLED_PROVIDERS SDKs
// (e.g. @ai-sdk/google). Plugins cannot add a new entry to the
// BUNDLED_PROVIDERS dict. The established pattern is to hook the
// existing google provider and override its fetch.
//
// This module implements the half of the fetch wrapper that owns the
// outbound response side: spawn agy, parse its NDJSON, and emit an
// SSE-formatted HTTP response body that the AI SDK can consume. The
// caller (auth.ts) is responsible for assembling the rest of the
// wrapper (URL parsing, prompt extraction, etc.) so that this module
// stays a pure function of stdin / stdout.

import { defaultSpawn, type SpawnFn } from "./spawn.js"
import { subscriptionOnlyEnv } from "./env.js"
import { AgyParseError, AgySpawnError } from "./errors.js"
import { MODEL_BY_SLUG } from "./models.js"
import type { ModelSlug } from "./types.js"

// The OpenAI-compatible SSE chunk shape the AI SDK consumes. The
// standard format is:
//
//   data: {"choices":[{"delta":{"content":"..."}}]}\n\n
//   data: [DONE]\n\n
//
// We emit each agy text_delta as one chunk with a stable object id
// so the AI SDK can stitch the stream together. The chunk shape
// mirrors what chooseProxy() in @ai-sdk/openai-compatible expects.
function sseChunk(objectId: string, modelId: string, delta: string): Uint8Array {
  return new TextEncoder().encode(
    `data: ${JSON.stringify({
      id: objectId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
    })}\n\n`,
  )
}

function sseUsageChunk(objectId: string, modelId: string, usage: {
  input: number
  output: number
  reasoning?: number
}): Uint8Array {
  return new TextEncoder().encode(
    `data: ${JSON.stringify({
      id: objectId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: {
        prompt_tokens: usage.input,
        completion_tokens: usage.output,
        total_tokens: usage.input + usage.output,
        completion_tokens_details: usage.reasoning
          ? { reasoning_tokens: usage.reasoning }
          : undefined,
      },
    })}\n\n`,
  )
}

function sseDone(): Uint8Array {
  return new TextEncoder().encode("data: [DONE]\n\n")
}

function sseError(message: string): Uint8Array {
  return new TextEncoder().encode(
    `data: ${JSON.stringify({
      object: "error",
      message,
      type: "agy_spawn_error",
      param: null,
      code: null,
    })}\n\n`,
  )
}

export type AgyEvent =
  | { event: "init"; conversation_id: string }
  | { event: "step_update"; step_update: { state: string; text_delta?: string; usage?: { input_tokens?: number; output_tokens?: number; thinking_tokens?: number } } }
  | { event: "result"; result: { status: string; error?: string; usage?: { input_tokens?: number; output_tokens?: number; thinking_tokens?: number; cache_read_tokens?: number } } }

function isAgyEvent(value: unknown): value is AgyEvent {
  if (!value || typeof value !== "object") return false
  const e = value as { event?: unknown }
  return e.event === "init" || e.event === "step_update" || e.event === "result"
}

export type SpawnAgyOptions = {
  binary: string
  prompt: string
  slug: ModelSlug
  spawnFn?: SpawnFn
}

export function spawnAgyStream(opts: SpawnAgyOptions): Response {
  const slug = opts.slug
  const modelId = slug
  const objectId = `chatcmpl-${Math.random().toString(36).slice(2, 10)}`

  const child = (opts.spawnFn ?? defaultSpawn)(
    opts.binary,
    ["-p", opts.prompt, "--model", slug, "--output-format", "stream-json"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: subscriptionOnlyEnv(),
      timeout: 5 * 60 * 1000,
    },
  )

  const stderrPromise = drain(child.stderr)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = ""
      const decoder = new TextDecoder()
      let finished = false
      let emittedAnything = false

      const emit = (chunk: Uint8Array) => {
        if (finished) return
        controller.enqueue(chunk)
        emittedAnything = true
      }

      try {
        if (!child.stdout) {
          throw new AgyParseError("", "agy produced no stdout stream")
        }
        for await (const chunk of child.stdout) {
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
            if (!isAgyEvent(parsed)) continue

            if (parsed.event === "step_update") {
              const delta = parsed.step_update.text_delta
              if (delta && parsed.step_update.state === "DONE") {
                emit(sseChunk(objectId, modelId, delta))
              }
              continue
            }

            if (parsed.event === "result") {
              if (parsed.result.status === "SUCCESS") {
                emit(sseUsageChunk(objectId, modelId, {
                  input: parsed.result.usage?.input_tokens ?? 0,
                  output: parsed.result.usage?.output_tokens ?? 0,
                  reasoning: parsed.result.usage?.thinking_tokens,
                }))
                emit(sseDone())
              } else {
                emit(sseError(parsed.result.error ?? `agy status: ${parsed.result.status}`))
              }
              finished = true
              controller.close()
              return
            }
          }
        }

        // Stream ended without a result event.
        if (!finished) {
          const exitCode = await child.exited
          const stderr = await stderrPromise
          emit(sseError(stderr || `agy exited with code ${exitCode ?? "unknown"} (no result event)`))
          finished = true
          controller.close()
        }
      } catch (err) {
        if (finished) return
        let message: string
        if (err instanceof AgySpawnError) {
          message = err.message
        } else if (err instanceof AgyParseError) {
          message = err.message
        } else {
          message = err instanceof Error ? err.message : String(err)
        }
        emit(sseError(message))
        finished = true
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    statusText: "OK",
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

async function drain(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (!stream) return ""
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString("utf8")
}

// Re-export for slug-mismatch errors
export { AgyParseError, AgySpawnError }
export { MODEL_BY_SLUG }
