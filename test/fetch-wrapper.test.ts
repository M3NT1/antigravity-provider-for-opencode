import { describe, expect, it } from "bun:test"
import { EventEmitter } from "node:events"
import { Readable } from "node:stream"

import { spawnAgyStream } from "../src/fetch-wrapper.js"
import { AgyParseError, AgySpawnError } from "../src/errors.js"
import type { SpawnFn, SpawnedProcess } from "../src/spawn.js"

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

  it("translates step_update text_delta to Google-style SSE chunks", async () => {
    const spawnFn = fakeSpawn(
      [
        '{"event":"init","conversation_id":"x","init":{"cwd":"/","tools":[],"permission_mode":"request-review"}}\n',
        '{"event":"step_update","step_update":{"state":"DONE","text_delta":"Hello ","usage":{}}}\n',
        '{"event":"step_update","step_update":{"state":"DONE","text_delta":"world","usage":{}}}\n',
        '{"event":"result","result":{"conversation_id":"x","status":"SUCCESS","response":"Hello world","usage":{"input_tokens":10,"output_tokens":2,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":12}}}\n',
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

    // Two text-chunks + one final usage-chunk
    expect(lines.length).toBe(3)

    const chunks = lines.map(parseSseData)
    const candidateText = (chunk: unknown) => {
      const c = chunk as { candidates: Array<{ content: { parts: Array<{ text?: string }> } }> }
      return c.candidates[0].content.parts[0].text
    }
    expect(candidateText(chunks[0])).toBe("Hello ")
    expect(candidateText(chunks[1])).toBe("world")

    // Final chunk has finishReason=STOP and usageMetadata
    const final = chunks[2] as { candidates: Array<{ finishReason: string }>; usageMetadata: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number } }
    expect(final.candidates[0].finishReason).toBe("STOP")
    expect(final.usageMetadata.promptTokenCount).toBe(10)
    expect(final.usageMetadata.candidatesTokenCount).toBe(2)
    expect(final.usageMetadata.totalTokenCount).toBe(12)
  })

  it("forwards reasoning_tokens in the usage chunk", async () => {
    const spawnFn = fakeSpawn(
      [
        '{"event":"init","conversation_id":"x","init":{"cwd":"/","tools":[],"permission_mode":"request-review"}}\n',
        '{"event":"step_update","step_update":{"state":"DONE","text_delta":"x","usage":{}}}\n',
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
    const final = JSON.parse(lines[lines.length - 1].slice("data: ".length))
    expect(final.usageMetadata.thoughtsTokenCount).toBe(42)
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
    // Exactly one chunk: the final usage chunk (unknown events are silently dropped)
    expect(lines.length).toBe(1)
    const parsed = JSON.parse(lines[0].slice("data: ".length)) as { candidates: Array<{ finishReason: string }> }
    expect(parsed.candidates[0].finishReason).toBe("STOP")
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
})
