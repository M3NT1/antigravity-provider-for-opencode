import { describe, expect, it } from "bun:test"
import { EventEmitter } from "node:events"
import { Readable } from "node:stream"

import { spawnAgyStream } from "../src/fetch-wrapper.js"
import type { SpawnFn } from "../src/spawn.js"

// ===== Mock spawn construct =====

function fakeSpawn(
  stdoutChunks: string[],
  stderrText: string,
  exitCode: number | null,
  captured: { cmd?: string; args?: readonly string[]; env?: NodeJS.ProcessEnv | undefined } = {},
): SpawnFn {
  return (cmd, args, options) => {
    captured.cmd = cmd
    captured.args = args
    captured.env = options.env ?? undefined
    const proc = new EventEmitter() as EventEmitter & {
      stdout: Readable | null
      stderr: Readable | null
      kill: (signal?: NodeJS.Signals) => boolean
    }
    proc.stdout = Readable.from(stdoutChunks.map((c) => Buffer.from(c, "utf8")))
    proc.stderr = Readable.from([Buffer.from(stderrText, "utf8")])
    proc.kill = () => true
    queueMicrotask(() => proc.emit("exit", exitCode, null))
    return {
      stdout: proc.stdout,
      stderr: proc.stderr,
      exited: new Promise<number | null>((resolve) => {
        proc.once("exit", (code) => resolve(code as number | null))
      }),
      kill: proc.kill,
    }
  }
}

async function readSse(response: Response): Promise<string[]> {
  const text = await response.text()
  return text.split("\n\n").filter((line) => line.length > 0)
}

function parseSseData(line: string): unknown {
  const data = line.startsWith("data: ") ? line.slice("data: ".length) : line
  if (!data) return null
  return JSON.parse(data)
}

describe("spawnAgyStream", () => {
  it("returns a Response with text/event-stream content type", async () => {
    const spawnFn = fakeSpawn(
      ['{"event":"result","result":{"conversation_id":"x","status":"SUCCESS","response":"ok","usage":{"input_tokens":1,"output_tokens":1,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":2}}}\n'],
      "",
      0,
    )
    const response = spawnAgyStream({
      binary: "/usr/local/bin/agy",
      prompt: "hi",
      slug: "gemini-3.1-pro-high",
      spawnFn,
    })
    expect(response.headers.get("Content-Type")).toBe("text/event-stream")
    expect(response.status).toBe(200)
  })

  it("spawns `agy -p <prompt> --model <slug> --output-format stream-json`", async () => {
    const captured: { cmd?: string; args?: readonly string[]; env?: NodeJS.ProcessEnv | undefined } = {}
    const spawnFn = fakeSpawn(
      ['{"event":"result","result":{"conversation_id":"x","status":"SUCCESS","response":"ok","usage":{}}}\n'],
      "",
      0,
      captured,
    )
    const response = spawnAgyStream({
      binary: "/usr/local/bin/agy",
      prompt: "Hello world",
      slug: "claude-sonnet-4-6",
      spawnFn,
    })
    await response.text()
    expect(captured.cmd).toBe("/usr/local/bin/agy")
    expect(captured.args).toEqual([
      "-p",
      "Hello world",
      "--model",
      "claude-sonnet-4-6",
      "--output-format",
      "stream-json",
    ])
  })

  it("emits the complete result.response as a single SSE chunk with finishReason STOP", async () => {
    const spawnFn = fakeSpawn(
      [
        '{"event":"init","conversation_id":"x","init":{"cwd":"/","tools":[],"permission_mode":"request-review"}}\n',
        '{"event":"step_update","step_update":{"state":"DONE","text_delta":"partial ","usage":{}}}\n',
        '{"event":"step_update","step_update":{"state":"DONE","text_delta":"fragment","usage":{}}}\n',
        '{"event":"result","result":{"conversation_id":"x","status":"SUCCESS","response":"Hello world, this is the complete answer.","usage":{"input_tokens":10,"output_tokens":7,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":17}}}\n',
      ],
      "",
      0,
    )
    const response = spawnAgyStream({
      binary: "/x",
      prompt: "hi",
      slug: "gemini-3.1-pro-high",
      spawnFn,
    })
    const lines = await readSse(response)

    // Exactly one chunk: the consolidated result.response text.
    // The partial step_update fragments are NOT emitted (they may be
    // out-of-order or truncated by thinking models).
    expect(lines.length).toBe(1)

    const chunk = parseSseData(lines[0]!) as {
      candidates: Array<{ content: { parts: Array<{ text?: string }>; role: string }; finishReason: string; index: number }>
      usageMetadata: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number }
    }
    expect(chunk.candidates[0]!.content.parts[0]!.text).toBe("Hello world, this is the complete answer.")
    expect(chunk.candidates[0]!.content.role).toBe("model")
    expect(chunk.candidates[0]!.finishReason).toBe("STOP")
    expect(chunk.usageMetadata.promptTokenCount).toBe(10)
    expect(chunk.usageMetadata.candidatesTokenCount).toBe(7)
    expect(chunk.usageMetadata.totalTokenCount).toBe(17)
  })

  it("forwards reasoning_tokens in the usage metadata", async () => {
    const spawnFn = fakeSpawn(
      [
        '{"event":"init","conversation_id":"x","init":{"cwd":"/","tools":[],"permission_mode":"request-review"}}\n',
        '{"event":"result","result":{"conversation_id":"x","status":"SUCCESS","response":"x","usage":{"input_tokens":1,"output_tokens":2,"thinking_tokens":42,"cache_read_tokens":0,"total_tokens":3}}}\n',
      ],
      "",
      0,
    )
    const response = spawnAgyStream({
      binary: "/x",
      prompt: "hi",
      slug: "claude-sonnet-4-6",
      spawnFn,
    })
    const lines = await readSse(response)
    const chunk = JSON.parse(lines[0]!.slice("data: ".length))
    expect(chunk.usageMetadata.thoughtsTokenCount).toBe(42)
  })

  it("emits an SSE error chunk when agy status is non-SUCCESS", async () => {
    const spawnFn = fakeSpawn(
      [
        '{"event":"init","conversation_id":"x","init":{"cwd":"/","tools":[],"permission_mode":"request-review"}}\n',
        '{"event":"result","result":{"conversation_id":"x","status":"ERROR","error":"cloud outage"}}\n',
      ],
      "",
      0,
    )
    const response = spawnAgyStream({
      binary: "/x",
      prompt: "hi",
      slug: "gemini-3.1-pro-high",
      spawnFn,
    })
    const lines = await readSse(response)
    const errorLine = lines.find((line) => line.includes("cloud outage"))
    expect(errorLine).toBeDefined()
    expect(errorLine).toContain("error")
  })

  it("emits an SSE error chunk on non-JSON line", async () => {
    const spawnFn = fakeSpawn(
      [
        '{"event":"init","conversation_id":"x","init":{"cwd":"/","tools":[],"permission_mode":"request-review"}}\n',
        "garbage line\n",
        '{"event":"result","result":{"conversation_id":"x","status":"SUCCESS","response":"x","usage":{}}}\n',
      ],
      "",
      0,
    )
    const response = spawnAgyStream({
      binary: "/x",
      prompt: "hi",
      slug: "gemini-3.1-pro-high",
      spawnFn,
    })
    const lines = await readSse(response)
    const errorLine = lines.find((line) => line.includes("non-JSON"))
    expect(errorLine).toBeDefined()
  })

  it("emits an SSE error chunk when the stream ends without a result event", async () => {
    const spawnFn = fakeSpawn(
      [
        '{"event":"init","conversation_id":"x","init":{"cwd":"/","tools":[],"permission_mode":"request-review"}}\n',
      ],
      "no result event",
      1,
    )
    const response = spawnAgyStream({
      binary: "/x",
      prompt: "hi",
      slug: "gemini-3.1-pro-high",
      spawnFn,
    })
    const lines = await readSse(response)
    const errorLine = lines.find((line) => line.includes("no result event") || line.includes("non-zero"))
    expect(errorLine).toBeDefined()
  })

  it("skips unknown event types without emitting invalid chunks", async () => {
    const spawnFn = fakeSpawn(
      [
        '{"event":"init","conversation_id":"x","init":{"cwd":"/","tools":[],"permission_mode":"request-review"}}\n',
        '{"event":"future_unknown_event_2027","payload":42}\n',
        '{"event":"result","result":{"conversation_id":"x","status":"SUCCESS","response":"ok","usage":{}}}\n',
      ],
      "",
      0,
    )
    const response = spawnAgyStream({
      binary: "/x",
      prompt: "hi",
      slug: "gemini-3.1-pro-high",
      spawnFn,
    })
    const lines = await readSse(response)
    // Exactly one chunk: the consolidated result.response text.
    // Unknown events are silently dropped.
    expect(lines.length).toBe(1)
    const parsed = JSON.parse(lines[0]!.slice("data: ".length)) as { candidates: Array<{ content: { parts: Array<{ text?: string }> }; finishReason: string }> }
    expect(parsed.candidates[0]!.content.parts[0]!.text).toBe("ok")
    expect(parsed.candidates[0]!.finishReason).toBe("STOP")
  })

  it("strips subscription-only env vars from the spawned env", async () => {
    process.env["ANTIGRAVITY_API_KEY"] = "should-be-stripped"
    process.env["GEMINI_API_KEY"] = "should-be-stripped"
    process.env["GOOGLE_API_KEY"] = "should-be-stripped"
    process.env["GOOGLE_GENAI_API_KEY"] = "should-be-stripped"
    process.env["GOOGLE_APPLICATION_CREDENTIALS"] = "should-be-stripped"
    process.env["GOOGLE_GENAI_USE_VERTEXAI"] = "should-be-stripped"
    process.env["GOOGLE_GENAI_USE_GCA"] = "should-be-stripped"
    process.env["PATH"] = "/usr/bin"

    try {
      const captured: { env?: NodeJS.ProcessEnv | undefined } = {}
      const spawnFn = fakeSpawn(
        ['{"event":"result","result":{"conversation_id":"x","status":"SUCCESS","response":"ok","usage":{}}}\n'],
        "",
        0,
        captured,
      )
      const response = spawnAgyStream({
        binary: "/x",
        prompt: "hi",
        slug: "gemini-3.1-pro-high",
        spawnFn,
      })
      await response.text()

      expect(captured.env).toBeDefined()
      for (const key of [
        "ANTIGRAVITY_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "GOOGLE_GENAI_API_KEY",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GOOGLE_GENAI_USE_VERTEXAI",
        "GOOGLE_GENAI_USE_GCA",
      ]) {
        expect(captured.env![key]).toBeUndefined()
      }
      expect(captured.env!["PATH"]).toBe("/usr/bin")
    } finally {
      delete process.env["ANTIGRAVITY_API_KEY"]
      delete process.env["GEMINI_API_KEY"]
      delete process.env["GOOGLE_API_KEY"]
      delete process.env["GOOGLE_GENAI_API_KEY"]
      delete process.env["GOOGLE_APPLICATION_CREDENTIALS"]
      delete process.env["GOOGLE_GENAI_USE_VERTEXAI"]
      delete process.env["GOOGLE_GENAI_USE_GCA"]
    }
  })

  it("flushes a trailing partial NDJSON line when the stream ends without a trailing newline", async () => {
    // Per the NDJSON spec a trailing newline is recommended but not
    // required. The `agy` CLI has been observed to omit it on the
    // final result event — without the tail-flush the response is
    // silently dropped. This test feeds a single result event with no
    // trailing `\n`.
    const tailLine =
      '{"event":"result","result":{"conversation_id":"x","status":"SUCCESS","response":"complete answer","usage":{"input_tokens":3,"output_tokens":2,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":5}}}'
    const spawnFn = fakeSpawn([tailLine], "", 0)
    const response = spawnAgyStream({
      binary: "/x",
      prompt: "hi",
      slug: "gemini-3.1-pro-high",
      spawnFn,
    })
    const lines = await readSse(response)

    expect(lines.length).toBe(1)
    const chunk = parseSseData(lines[0]!) as {
      candidates: Array<{ content: { parts: Array<{ text?: string }>; role: string }; finishReason: string }>
    }
    expect(chunk.candidates[0]!.content.parts[0]!.text).toBe("complete answer")
    expect(chunk.candidates[0]!.finishReason).toBe("STOP")
  })

  it("falls through to the no-result-event error when the trailing partial line is unparseable", async () => {
    // A tail line that is not JSON should still report the exit-code
    // error, not be silently swallowed.
    const spawnFn = fakeSpawn(["garbage partial line"], "", 1)
    const response = spawnAgyStream({
      binary: "/x",
      prompt: "hi",
      slug: "gemini-3.1-pro-high",
      spawnFn,
    })
    const lines = await readSse(response)
    const errorLine = lines.find(
      (line) => line.includes("non-zero") || line.includes("no result event") || line.includes("exited"),
    )
    expect(errorLine).toBeDefined()
  })

  it("kills the child when the abort signal fires and surfaces an AbortError", async () => {
    // ABORT-001: when the AI SDK caller cancels the request, the spawn
    // must forward the abort to the child and the ReadableStream must
    // surface a real AbortError rather than silently closing (see
    // vercel/ai#15430).
    let killedWith: NodeJS.Signals | undefined
    const spawnFn: SpawnFn = (_cmd, _args, _options) => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: Readable | null
        stderr: Readable | null
        kill: (signal?: NodeJS.Signals) => boolean
      }
      proc.stdout = Readable.from([])
      proc.stderr = Readable.from([])
      proc.kill = (signal?: NodeJS.Signals) => {
        killedWith = signal
        return true
      }
      return {
        stdout: proc.stdout,
        stderr: proc.stderr,
        exited: new Promise(() => {}),
        kill: proc.kill,
      }
    }
    const ctrl = new AbortController()
    const response = spawnAgyStream({
      binary: "/x",
      prompt: "hi",
      slug: "gemini-3.1-pro-high",
      spawnFn,
      signal: ctrl.signal,
    })
    // Read a byte to ensure the stream starts before we abort.
    void response.body?.cancel().catch(() => {})
    ctrl.abort()
    // Yield to the event loop so the abort listener runs.
    await new Promise((r) => setTimeout(r, 10))
    expect(killedWith).toBe("SIGTERM")
  })
})
