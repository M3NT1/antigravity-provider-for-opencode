import { describe, expect, it, beforeEach } from "bun:test"
import { EventEmitter } from "node:events"
import { Readable } from "node:stream"
import fs from "node:fs"
import path from "path"

import { buildLanguageModel } from "../src/fetch.js"
import { AgyParseError, AgySpawnError, AgyUnsupportedModelError } from "../src/errors.js"
import type { SpawnFn, SpawnedProcess } from "../src/spawn.js"

// ===== Minimal LanguageModelV3 prompt shape for the test =====

function promptOf(...texts: string[]) {
  return texts.map((text) => ({
    role: "user",
    content: [{ type: "text", text }],
  }))
}

// ===== Mock spawn =====

function fakeSpawnFromStrings(stdoutChunks: string[], stderrText: string, exitCode: number | null): SpawnFn {
  return () => {
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

function readNdjsonFixture(): string[] {
  const file = path.join(import.meta.dir, "fixtures", "agy-stream-sample.ndjson")
  const text = fs.readFileSync(file, "utf8")
  // Simulate the chunked arrival that an NDJSON stream actually
  // produces: split into per-event chunks with an extra newline
  // at the end of each, to exercise the buffer flushing.
  return text.split("\n").filter((line) => line.length > 0).map((line) => line + "\n")
}

async function drain(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  const reader = stream.getReader()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    out.push(value)
  }
  return out
}

// ===== Tests =====

const FIXTURE_MODEL = {
  prompt: promptOf("Explain git rebase."),
  abortSignal: undefined,
}

describe("buildLanguageModel", () => {
  it("returns a v3 LanguageModel with the correct provider/id", () => {
    const model = buildLanguageModel({ binary: "/usr/local/bin/agy", modelId: "gemini-3.1-pro-high" })
    expect(model.specificationVersion).toBe("v3")
    expect(model.provider).toBe("antigravity")
    expect(model.modelId).toBe("gemini-3.1-pro-high")
  })

  it("throws AgyUnsupportedModelError for an unknown slug", () => {
    expect(() => buildLanguageModel({ binary: "/x", modelId: "no-such-model" })).toThrow(
      AgyUnsupportedModelError,
    )
  })

  it("exposes an empty supportedUrls map (no native URL handling)", () => {
    const model = buildLanguageModel({ binary: "/x", modelId: "gemini-3.1-pro-high" })
    expect(model.supportedUrls).toEqual({})
  })
})

describe("doStream — happy path (real NDJSON fixture)", () => {
  let captured: { cmd: string; args: readonly string[]; env: NodeJS.ProcessEnv | undefined } | null = null

  beforeEach(() => {
    captured = null
  })

  it("converts init → step_update text_delta → result to the AI SDK stream parts", async () => {
    const chunks = readNdjsonFixture()
    const spawnFn: SpawnFn = (cmd, args, options) => {
      captured = { cmd, args, env: options.env }
      const proc = new EventEmitter() as EventEmitter & {
        stdout: Readable | null
        stderr: Readable | null
        kill: (signal?: NodeJS.Signals) => boolean
      }
      proc.stdout = Readable.from(chunks.map((c) => Buffer.from(c, "utf8")))
      proc.stderr = Readable.from([])
      proc.kill = () => true
      queueMicrotask(() => proc.emit("exit", 0, null))
      return {
        stdout: proc.stdout,
        stderr: proc.stderr,
        exited: new Promise<number | null>((resolve) => {
          proc.once("exit", (code) => resolve(code as number | null))
        }),
        kill: proc.kill,
      }
    }

    const model = buildLanguageModel({
      binary: "/usr/local/bin/agy",
      modelId: "gemini-3.1-pro-high",
      spawnFn,
    })
    const { stream } = await model.doStream(FIXTURE_MODEL)
    const parts = (await drain(stream)) as Array<{ type: string }>

    // Sequence: stream-start, text-start, text-delta (x2), text-end, finish
    expect(parts.map((p) => p.type)).toEqual([
      "stream-start",
      "text-start",
      "text-delta",
      "text-delta",
      "text-end",
      "finish",
    ])

    // Subprocess invocation is correct
    expect(captured?.cmd).toBe("/usr/local/bin/agy")
    expect(captured?.args).toEqual([
      "-p",
      "Explain git rebase.",
      "--model",
      "gemini-3.1-pro-high",
      "--output-format",
      "stream-json",
    ])

    // Text content is the concatenation of the two step_update text_deltas
    const textDelta = parts.find((p) => p.type === "text-delta" && (p as { delta?: string }).delta?.endsWith("new base."))
    expect(textDelta).toBeDefined()

    // Usage is forwarded from the result event
    const finish = parts.find((p) => p.type === "finish") as {
      type: "finish"
      usage: { inputTokens: { total: number }; outputTokens: { total: number; reasoning?: number } }
    }
    expect(finish.usage.inputTokens.total).toBe(10418)
    expect(finish.usage.outputTokens.total).toBe(589)
    expect(finish.usage.outputTokens.reasoning).toBe(551)
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
      let capturedEnv: NodeJS.ProcessEnv | undefined
      const spawnFn: SpawnFn = (cmd, args, options) => {
        capturedEnv = options.env
        return fakeSpawnFromStrings(['{"event":"init","conversation_id":"x","init":{"cwd":"/x","tools":[],"permission_mode":"request-review"}}\n','{"event":"result","result":{"conversation_id":"x","status":"SUCCESS","response":"ok\\n","usage":{"input_tokens":1,"output_tokens":1,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":2}}}\n'], "", 0)()
      }

      const model = buildLanguageModel({
        binary: "/x",
        modelId: "gemini-3.1-pro-high",
        spawnFn,
      })
      await drain((await model.doStream(FIXTURE_MODEL)).stream)

      expect(capturedEnv).toBeDefined()
      for (const key of [
        "ANTIGRAVITY_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "GOOGLE_GENAI_API_KEY",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GOOGLE_GENAI_USE_VERTEXAI",
        "GOOGLE_GENAI_USE_GCA",
      ]) {
        expect(capturedEnv![key]).toBeUndefined()
      }
      // PATH is preserved
      expect(capturedEnv!["PATH"]).toBe("/usr/bin")
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

describe("doStream — error paths", () => {
  it("emits an error chunk when the subprocess exits non-zero", async () => {
    const spawnFn = fakeSpawnFromStrings(
      ['{"event":"init","conversation_id":"x","init":{"cwd":"/x","tools":[],"permission_mode":"request-review"}}\n'],
      "permission denied\n",
      1,
    )
    const model = buildLanguageModel({
      binary: "/x",
      modelId: "gemini-3.1-pro-high",
      spawnFn,
    })
    const { stream } = await model.doStream(FIXTURE_MODEL)
    const parts = (await drain(stream)) as Array<{ type: string; error?: Error }>
    const errorChunk = parts.find((p) => p.type === "error")
    expect(errorChunk).toBeDefined()
    expect(errorChunk?.error).toBeInstanceOf(AgySpawnError)
    expect((errorChunk?.error as AgySpawnError).exitCode).toBe(1)
    expect((errorChunk?.error as AgySpawnError).stderr).toContain("permission denied")
  })

  it("emits an error chunk when agy emits non-JSON on stdout", async () => {
    const spawnFn = fakeSpawnFromStrings(
      ["this is not json\n", '{"event":"result","result":{"conversation_id":"x","status":"SUCCESS","response":"ok","usage":{}}}\n'],
      "",
      0,
    )
    const model = buildLanguageModel({
      binary: "/x",
      modelId: "gemini-3.1-pro-high",
      spawnFn,
    })
    const { stream } = await model.doStream(FIXTURE_MODEL)
    const parts = (await drain(stream)) as Array<{ type: string; error?: Error }>
    const errorChunk = parts.find((p) => p.type === "error")
    expect(errorChunk).toBeDefined()
    expect(errorChunk?.error).toBeInstanceOf(AgyParseError)
  })

  it("emits an error chunk when the stream ends without a result event", async () => {
    // Stream yields init only, then closes; no result event.
    const spawnFn = fakeSpawnFromStrings(
      ['{"event":"init","conversation_id":"x","init":{"cwd":"/x","tools":[],"permission_mode":"request-review"}}\n'],
      "",
      0,
    )
    const model = buildLanguageModel({
      binary: "/x",
      modelId: "gemini-3.1-pro-high",
      spawnFn,
    })
    const { stream } = await model.doStream(FIXTURE_MODEL)
    const parts = (await drain(stream)) as Array<{ type: string; error?: Error }>
    const errorChunk = parts.find((p) => p.type === "error")
    expect(errorChunk).toBeDefined()
    expect((errorChunk?.error as Error).message).toContain("result event")
  })

  it("skips unknown event types without throwing", async () => {
    const spawnFn = fakeSpawnFromStrings(
      [
        '{"event":"init","conversation_id":"x","init":{"cwd":"/x","tools":[],"permission_mode":"request-review"}}\n',
        '{"event":"future_unknown_event_2027","payload":42}\n',
        '{"event":"result","result":{"conversation_id":"x","status":"SUCCESS","response":"ok\\n","usage":{"input_tokens":1,"output_tokens":1,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":2}}}\n',
      ],
      "",
      0,
    )
    const model = buildLanguageModel({
      binary: "/x",
      modelId: "gemini-3.1-pro-high",
      spawnFn,
    })
    const { stream } = await model.doStream(FIXTURE_MODEL)
    const parts = (await drain(stream)) as Array<{ type: string }>
    expect(parts.map((p) => p.type)).toEqual([
      "stream-start",
      "text-start",
      "text-delta",
      "text-end",
      "finish",
    ])
  })

  it("propagates upstream abortSignal to SIGTERM", async () => {
    let killed = false
    const spawnFn: SpawnFn = () => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: Readable | null
        stderr: Readable | null
        kill: (signal?: NodeJS.Signals) => boolean
      }
      // stdout that closes when killed, so the stream parser can finish.
      const stdout = new Readable({
        read() {
          /* push via push() on kill */
        },
      })
      const stderr = new Readable({ read() {} })
      proc.stdout = stdout
      proc.stderr = stderr
      let resolveExited: (code: number | null) => void = () => {}
      proc.kill = (signal) => {
        killed = signal === "SIGTERM" || true
        stdout.push(null)
        stderr.push(null)
        resolveExited(null)
        return true
      }
      // never emits exit until kill
      return {
        stdout: proc.stdout,
        stderr: proc.stderr,
        exited: new Promise<number | null>((resolve) => {
          resolveExited = resolve
        }),
        kill: proc.kill,
      }
    }
    const ac = new AbortController()
    const model = buildLanguageModel({
      binary: "/x",
      modelId: "gemini-3.1-pro-high",
      spawnFn,
    })
    const { stream } = await model.doStream({ ...FIXTURE_MODEL, abortSignal: ac.signal })
    ac.abort()
    await drain(stream)
    expect(killed).toBe(true)
  })
})

describe("promptToString", () => {
  it("concatenates user messages with double newlines", async () => {
    // The simplest way to assert this is via a mock spawn that
    // captures the args and reports them back through the test.
    let capturedArgs: readonly string[] = []
    const spawnFn: SpawnFn = (cmd, args) => {
      capturedArgs = args
      return fakeSpawnFromStrings(
        ['{"event":"result","result":{"conversation_id":"x","status":"SUCCESS","response":"ok","usage":{}}}\n'],
        "",
        0,
      )()
    }
    const model = buildLanguageModel({ binary: "/x", modelId: "gemini-3.1-pro-high", spawnFn })
    await drain(
      (await model.doStream({
        prompt: [
          { role: "user", content: [{ type: "text", text: "hello" }] },
          { role: "user", content: [{ type: "text", text: "world" }] },
        ],
      })).stream,
    )
    expect(capturedArgs[1]).toBe("hello\n\nworld")
  })

  it("drops system messages (agy --print ignores them)", async () => {
    let capturedArgs: readonly string[] = []
    const spawnFn: SpawnFn = (cmd, args) => {
      capturedArgs = args
      return fakeSpawnFromStrings(
        ['{"event":"result","result":{"conversation_id":"x","status":"SUCCESS","response":"ok","usage":{}}}\n'],
        "",
        0,
      )()
    }
    const model = buildLanguageModel({ binary: "/x", modelId: "gemini-3.1-pro-high", spawnFn })
    await drain(
      (await model.doStream({
        prompt: [
          { role: "system", content: [{ type: "text", text: "you are a chef" }] },
          { role: "user", content: [{ type: "text", text: "recipe?" }] },
        ],
      })).stream,
    )
    expect(capturedArgs[1]).toBe("recipe?")
  })

  it("prefixes assistant turns with [assistant]:", async () => {
    let capturedArgs: readonly string[] = []
    const spawnFn: SpawnFn = (cmd, args) => {
      capturedArgs = args
      return fakeSpawnFromStrings(
        ['{"event":"result","result":{"conversation_id":"x","status":"SUCCESS","response":"ok","usage":{}}}\n'],
        "",
        0,
      )()
    }
    const model = buildLanguageModel({ binary: "/x", modelId: "gemini-3.1-pro-high", spawnFn })
    await drain(
      (await model.doStream({
        prompt: [
          { role: "user", content: [{ type: "text", text: "hi" }] },
          { role: "assistant", content: [{ type: "text", text: "hello there" }] },
          { role: "user", content: [{ type: "text", text: "again" }] },
        ],
      })).stream,
    )
    expect(capturedArgs[1]).toBe("hi\n\n[assistant]: hello there\n\nagain")
  })
})
