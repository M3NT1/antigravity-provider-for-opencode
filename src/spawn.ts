// Dependency-injection seam for the subprocess layer. The fetch wrapper
// accepts an `options.spawn` parameter that defaults to this default
// spawn. In tests we pass a stub that returns a fake ReadableStream
// of NDJSON events without ever touching the real `agy` binary.
//
// The default implementation uses node:child_process.spawn directly.
// We intentionally do NOT use cross-spawn here because opencode uses
// cross-spawn only for shell-friendly tooling (LSP, MCP, etc.) and
// the agy binary will be invoked with a fixed argv list, so the
// pty-less spawn is sufficient and keeps the contract minimal.

import { spawn as nodeSpawn } from "node:child_process"
import type { Readable } from "node:stream"

export type SpawnOptions = {
  cwd?: string
  env?: NodeJS.ProcessEnv | null
  signal?: AbortSignal
  timeout?: number
  stdio?: [unknown, "pipe" | "inherit" | "ignore", "pipe" | "inherit" | "ignore"]
  windowsHide?: boolean
}

export type SpawnedProcess = {
  stdout: Readable | null
  stderr: Readable | null
  exited: Promise<number | null>
  kill: (signal?: NodeJS.Signals) => boolean
}

export type SpawnFn = (cmd: string, args: readonly string[], options: SpawnOptions) => SpawnedProcess

export const defaultSpawn: SpawnFn = (cmd, args, options) => {
  const [stdin, stdout, stderr] = options.stdio ?? ["ignore", "pipe", "pipe"]
  const child = nodeSpawn(cmd, [...args], {
    cwd: options.cwd,
    env: options.env === null ? undefined : options.env ? options.env : undefined,
    signal: options.signal,
    timeout: options.timeout,
    windowsHide: options.windowsHide ?? process.platform === "win32",
    stdio: [stdin, stdout, stderr] as never,
  }) as unknown as {
    stdout: Readable | null
    stderr: Readable | null
    once: (event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void) => unknown
    kill: (signal?: NodeJS.Signals) => boolean
  }
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    exited: new Promise<number | null>((resolve) => {
      child.once("exit", (code) => resolve(code))
    }),
    kill: (signal) => child.kill(signal ?? "SIGTERM"),
  }
}
