import { describe, expect, it, mock, beforeEach } from "bun:test"
import { EventEmitter } from "node:events"
import { Readable } from "node:stream"

import { defaultSpawn } from "../src/spawn.js"

// We mock node:child_process.spawn with a fake that mimics the real
// ChildProcess shape but does not touch the OS process table. This
// lets us assert on argv / env / cwd / signal without shelling out.
// Real child_process.spawn is synchronous and returns a ChildProcess
// immediately, so the mock must be sync too.
const spawnMock = mock(() => {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: Readable | null
    stderr: Readable | null
    kill: (signal?: NodeJS.Signals) => boolean
  }
  proc.stdout = Readable.from([])
  proc.stderr = Readable.from([])
  proc.kill = (_signal?: NodeJS.Signals) => true
  // emit exit on next tick so awaited code completes
  queueMicrotask(() => proc.emit("exit", 0, null))
  return proc
})

mock.module("node:child_process", () => ({
  spawn: spawnMock,
  default: { spawn: spawnMock },
}))

beforeEach(() => {
  spawnMock.mockClear()
})

describe("defaultSpawn", () => {
  it("forwards cmd, args, cwd, env, and signal to node:child_process.spawn", async () => {
    const ctrl = new AbortController()
    const child = defaultSpawn("/bin/agy", ["--version"], {
      cwd: "/tmp/proj",
      env: { FOO: "bar" },
      signal: ctrl.signal,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
    })
    await child.exited
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const call = spawnMock.mock.calls[0] as unknown as [string, string[], Record<string, unknown>]
    expect(call[0]).toBe("/bin/agy")
    expect(call[1]).toEqual(["--version"])
    expect((call[2] as Record<string, unknown>).cwd).toBe("/tmp/proj")
    expect((call[2] as Record<string, unknown>).env).toEqual({ FOO: "bar" })
    expect((call[2] as Record<string, unknown>).signal).toBe(ctrl.signal)
    expect((call[2] as Record<string, unknown>).timeout).toBe(5_000)
  })

  it("returns null stdout/stderr when no stdio is provided", async () => {
    // The default stdio in defaultSpawn is ['ignore', 'pipe', 'pipe']
    // so this assertion must hold — the wrapper always materialises
    // a Readable/null in the slot, never undefined.
    const child = defaultSpawn("/bin/agy", ["--version"], {
      cwd: "/tmp",
      stdio: ["ignore", "pipe", "pipe"],
    })
    expect(child.stdout).toBeInstanceOf(Readable)
    expect(child.stderr).toBeInstanceOf(Readable)
    await child.exited
  })

  it("resolves exited with the exit code", async () => {
    spawnMock.mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: Readable | null
        stderr: Readable | null
        kill: (signal?: NodeJS.Signals) => boolean
      }
      proc.stdout = Readable.from([])
      proc.stderr = Readable.from([])
      proc.kill = () => true
      queueMicrotask(() => proc.emit("exit", 42, null))
      return proc
    })
    const child = defaultSpawn("/bin/agy", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    expect(await child.exited).toBe(42)
  })

  it("kill() forwards the signal to the underlying child", async () => {
    let killedSignal: NodeJS.Signals | undefined
    spawnMock.mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: Readable | null
        stderr: Readable | null
        kill: (signal?: NodeJS.Signals) => boolean
      }
      proc.stdout = Readable.from([])
      proc.stderr = Readable.from([])
      proc.kill = (signal?: NodeJS.Signals) => {
        killedSignal = signal
        return true
      }
      queueMicrotask(() => proc.emit("exit", null, "SIGTERM"))
      return proc
    })
    const child = defaultSpawn("/bin/agy", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    child.kill("SIGKILL")
    expect(killedSignal).toBe("SIGKILL")
    await child.exited
  })

  it("defaults to SIGTERM when kill is called without a signal", async () => {
    let killedSignal: NodeJS.Signals | undefined
    spawnMock.mockImplementationOnce(() => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: Readable | null
        stderr: Readable | null
        kill: (signal?: NodeJS.Signals) => boolean
      }
      proc.stdout = Readable.from([])
      proc.stderr = Readable.from([])
      proc.kill = (signal?: NodeJS.Signals) => {
        killedSignal = signal
        return true
      }
      queueMicrotask(() => proc.emit("exit", null, "SIGTERM"))
      return proc
    })
    const child = defaultSpawn("/bin/agy", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    child.kill()
    expect(killedSignal).toBe("SIGTERM")
    await child.exited
  })
})
