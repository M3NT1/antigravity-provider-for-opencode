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
// SSE-formatted HTTP response that the AI SDK can consume. The
// caller (auth.ts) is responsible for assembling the rest of the
// wrapper (URL parsing, prompt extraction, etc.) so that this module
// stays a pure function of stdin / stdout.

import { defaultSpawn, type SpawnFn } from "./spawn.js"
import { subscriptionOnlyEnv } from "./env.js"
import { AgyParseError, AgySpawnError } from "./errors.js"
import { MODEL_BY_SLUG } from "./models.js"
import type { ModelSlug } from "./types.js"

// Extracted SSE chunk builder for the result event. The same chunk
// shape is emitted both in the normal loop (line-buffered parse) and
// in the tail-flush path (after stream end without trailing newline).
function buildResultChunk(parsed: Extract<AgyEvent, { event: "result" }>, modelId: string): Uint8Array {
  if (parsed.result.status === "SUCCESS") {
    const fullText = parsed.result.response ?? ""
    // Emit a single text chunk with the complete response
    // and finishReason: STOP, followed by a second chunk
    // that carries usageMetadata (the @ai-sdk/google parser
    // reads both).
    return new TextEncoder().encode(
      `data: ${JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: fullText }], role: "model" },
            finishReason: "STOP",
            index: 0,
          },
        ],
        modelVersion: modelId,
        usageMetadata: {
          promptTokenCount: parsed.result.usage?.input_tokens ?? 0,
          candidatesTokenCount: parsed.result.usage?.output_tokens ?? 0,
          thoughtsTokenCount: parsed.result.usage?.thinking_tokens ?? 0,
          totalTokenCount:
            (parsed.result.usage?.input_tokens ?? 0) +
            (parsed.result.usage?.output_tokens ?? 0),
        },
      })}\n\n`,
    )
  }
  return sseError(parsed.result.error ?? `agy status: ${parsed.result.status}`)
}

// The Google Generative Language API streaming response format (used by
// the @ai-sdk/google provider). Each SSE event is a JSON object:
//
//   data: {"candidates":[{"content":{"parts":[{"text":"..."}],"role":"model"}}]}\n\n
//
// We emit exactly one chunk: the full text from result.response, with
// finishReason: "STOP" and usageMetadata embedded. Live streaming from
// step_update text_delta is intentionally skipped — thinking models
// split their output across a thinking step and an answer step, and
// the DONE-state text_delta of the answer step is not always the
// authoritative full text.
function sseError(message: string): Uint8Array {
  return new TextEncoder().encode(
    `data: ${JSON.stringify({
      error: { code: 500, message, status: "INTERNAL" },
    })}\n\n`,
  )
}

export type AgyEvent =
  | { event: "init"; conversation_id: string }
  | { event: "step_update"; step_update: { state: string; text_delta?: string; usage?: { input_tokens?: number; output_tokens?: number; thinking_tokens?: number } } }
  | { event: "result"; result: { status: string; response?: string; error?: string; usage?: { input_tokens?: number; output_tokens?: number; thinking_tokens?: number; cache_read_tokens?: number } } }

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
  // When the AI SDK caller aborts the request, the signal is forwarded
  // into the spawn so `agy` is killed via SIGTERM (escalating to SIGKILL
  // after a grace period — see `controller.error` wiring below). Without
  // this, the child keeps running until the 5-min timeout.
  signal?: AbortSignal
}

export function spawnAgyStream(opts: SpawnAgyOptions): Response {
  const slug = opts.slug
  const modelId = slug

  const child = (opts.spawnFn ?? defaultSpawn)(
    opts.binary,
    ["-p", opts.prompt, "--model", slug, "--output-format", "stream-json"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: subscriptionOnlyEnv(),
      timeout: 5 * 60 * 1000,
      // TIMEOUT-001: escalate to SIGKILL if agy traps SIGTERM so the
      // 5-min timeout actually fires instead of waiting for the
      // child to voluntarily exit. Per Node docs, killSignal defaults
      // to "SIGTERM"; the timeout sends that signal at the deadline.
      killSignal: "SIGKILL",
      signal: opts.signal,
    },
  )

  const stderrPromise = drain(child.stderr)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = ""
      const decoder = new TextDecoder()
      let finished = false

      const emit = (chunk: Uint8Array) => {
        if (finished) return
        controller.enqueue(chunk)
      }

      // ABORT-001: the `signal` option on spawn is the documented Node
      // way to abort a child — Node sends SIGTERM and the AbortError is
      // delivered to the parent's await. We only add a `cancel()`
      // handler on the stream to surface a real error to the SDK
      // (otherwise vercel/ai#15430 hangs silently on mid-stream abort).
      // We deliberately do NOT use `controller.error()` from an abort
      // listener — per Node PR #62450, mixing `controller.error()` with
      // a manual kill prevents the source's `cancel()` cleanup from
      // running. The `cancel()` handler below is the correct path.
      if (opts.signal?.aborted) {
        child.kill("SIGTERM")
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
              // We intentionally do NOT emit step_update text_delta as
              // live chunks. Thinking models (e.g. Gemini 3.6 Flash with
              // reasoning enabled) split the response across a thinking
              // step and an answer step; the DONE-state text_delta of
              // the answer step can be partial or out-of-order. The
              // authoritative full text is in result.response. We wait
              // for the result event and emit the complete text there.
              continue
            }

            if (parsed.event === "result") {
              emit(buildResultChunk(parsed, modelId))
              finished = true
              controller.close()
              return
            }
          }
        }

        // Stream ended. Flush the trailing partial line if agy emitted
        // a final result event without a trailing newline — per the
        // NDJSON spec a trailing newline is recommended but not
        // required, and `agy` has been observed to omit it. Without
        // this flush the response event is silently dropped and the
        // user sees "no result event" instead of the actual content.
        if (!finished && buffer.trim().length > 0) {
          const tail = buffer.trim()
          try {
            const parsed = JSON.parse(tail)
            if (isAgyEvent(parsed) && parsed.event === "result") {
              emit(buildResultChunk(parsed, modelId))
              finished = true
              controller.close()
              return
            }
          } catch {
            // fall through to stderr/exit-code error below
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
    // ABORT-001: when the consumer (AI SDK) cancels the stream, kill
    // the child so it doesn't linger until the 5-min timeout. The
    // Node `spawn({ signal })` option also kills on `opts.signal`
    // abort, but consumer-driven cancellation (via `response.body.cancel()`)
    // is independent of `opts.signal` and must be handled here.
    cancel() {
      try {
        child.kill("SIGTERM")
      } catch {
        /* already gone */
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

// Drain stderr with bounded memory:
//  - tee each chunk to process.stderr so the operator can see live progress
//  - keep only the last `STDERR_CAPTURE_LIMIT` bytes for the error message
//  - return the captured tail as a UTF-8 string
const STDERR_CAPTURE_LIMIT = 4 * 1024

async function drain(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (!stream) return ""
  const chunks: Buffer[] = []
  let captured = 0
  for await (const chunk of stream) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk
    process.stderr.write(buf)
    if (captured < STDERR_CAPTURE_LIMIT) {
      const remaining = STDERR_CAPTURE_LIMIT - captured
      chunks.push(buf.length > remaining ? buf.subarray(0, remaining) : buf)
      captured += buf.length
    }
  }
  return Buffer.concat(chunks).toString("utf8")
}

// Re-export for slug-mismatch errors
export { AgyParseError, AgySpawnError }
export { MODEL_BY_SLUG }
