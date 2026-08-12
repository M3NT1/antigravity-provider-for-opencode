import fs from "node:fs"
import os from "node:os"
import path from "path"

import { AGY_DEFAULT_PATH, installInstructionsForPlatform } from "./constants.js"
import type { SpawnFn } from "./spawn.js"
import { AgyNotInstalledError } from "./errors.js"

// Locate the agy binary. Strategy:
//   1. Try the platform-specific default path (fast path, no shell).
//   2. Fall back to PATH (which / where) — this is what covers
//      homebrew-global installs or shell-configured installs.
export function locateBinary(
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const defaultPath =
    platform === "win32"
      ? path.join(env["LOCALAPPDATA"] ?? path.join(home, "AppData", "Local"), "agy", "bin", "agy.exe")
      : path.join(home, ".local", "bin", "agy")

  if (isExecutable(defaultPath)) return defaultPath

  const fromPath = which("agy", platform, env)
  if (fromPath && isExecutable(fromPath)) return fromPath

  return null
}

function isExecutable(p: string): boolean {
  try {
    const st = fs.statSync(p)
    if (!st.isFile()) return false
    if (process.platform === "win32") return true
    // POSIX: any execute bit set
    return (st.mode & 0o111) !== 0
  } catch {
    return false
  }
}

function which(bin: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | null {
  const pathVar = env["PATH"]
  if (!pathVar) return null
  const dirs = pathVar.split(path.delimiter)
  const exts = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext)
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}

// Run `agy --version` and parse the leading number. We tolerate:
//   "agy 1.1.12"
//   "Antigravity CLI 1.1.12"
//   "v1.1.12"
//   anything with a version-looking token at the front
export async function verifyVersion(
  binary: string,
  spawnFn: SpawnFn = defaultSpawn,
): Promise<string> {
  const child = spawnFn(binary, ["--version"], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5_000,
  })
  const stdout = await drain(child.stdout)
  const stderr = await drain(child.stderr)
  const code = await child.exited

  if (code !== 0) {
    throw new AgyNotInstalledError(
      process.platform,
      `Antigravity CLI at ${binary} failed --version (exit ${code}).\nstderr: ${stderr.trim() || "<empty>"}\n${installInstructionsForPlatform()}`,
    )
  }
  const text = (stdout + stderr).trim()
  const match = text.match(/(\d+\.\d+\.\d+)/)
  if (!match) {
    throw new AgyNotInstalledError(
      process.platform,
      `Antigravity CLI at ${binary} returned an unparseable version: ${JSON.stringify(text)}\n${installInstructionsForPlatform()}`,
    )
  }
  return match[1]
}

async function drain(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (!stream) return ""
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  return Buffer.concat(chunks).toString("utf8")
}

// Combined "is agy installed and runnable?" check. Throws
// AgyNotInstalledError with the install command when the binary is
// missing or unresponsive. Returns { binary, version } on success.
export async function preflight(
  spawnFn: SpawnFn = defaultSpawn,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ binary: string; version: string }> {
  const binary = locateBinary(platform, home, env)
  if (!binary) {
    throw new AgyNotInstalledError(platform, installInstructionsForPlatform(platform))
  }
  const version = await verifyVersion(binary, spawnFn)
  return { binary, version }
}

export { AGY_DEFAULT_PATH }
