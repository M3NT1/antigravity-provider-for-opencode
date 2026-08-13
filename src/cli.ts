import fs from "node:fs"
import os from "node:os"
import path from "path"

import { AGY_DEFAULT_PATH, installInstructionsForPlatform } from "./constants.js"
import { defaultSpawn, type SpawnFn } from "./spawn.js"
import { AgyNotInstalledError } from "./errors.js"
import { subscriptionOnlyEnv } from "./env.js"

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
  if (!fs.existsSync(p)) return false
  const st = fs.statSync(p)
  if (!st.isFile()) return false
  if (process.platform === "win32") return true
  // POSIX: any execute bit set
  return (st.mode & 0o111) !== 0
}

function which(bin: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | null {
  const pathVar = env["PATH"]
  if (!pathVar) return null
  const dirs = pathVar.split(path.delimiter)
  // PATHEXT-001: read PATHEXT on Windows (defaults to common executable
  // extensions if unset). Empty string first to prefer exact match.
  const exts =
    platform === "win32"
      ? ["", ...(env["PATHEXT"]?.split(";").filter(Boolean) ?? [".exe", ".cmd", ".bat"])]
      : [""]
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
  env: NodeJS.ProcessEnv = subscriptionOnlyEnv(),
): Promise<string> {
  const child = spawnFn(binary, ["--version"], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5_000,
    // PREFLIGHT-001: strip subscription-only keys from the env so the
    // preflight does not see the user's paid-API-key env vars (see
    // SECURITY.md:23-37 for the invariant).
    env,
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
  return match[1]!
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

  // HEADLESS-001: detect the antigravity-cli#53 silent failure mode
  // (SSH/CI + non-UTC + locked keyring → infinite auth loop). Surface
  // the upstream workaround in the error message so users self-diagnose
  // before opencode stalls. We do not block the preflight — a normal
  // headed run with TZ=Asia/Tokyo will still work because agy handles
  // timezone-aware timestamps fine; the warning is informational only.
  if (isHeadless(env) && isNonUTC()) {
    return verifyVersion(binary, spawnFn, subscriptionOnlyEnv(env)).then(
      (version) => ({ binary, version }),
      (err) => {
        if (err instanceof AgyNotInstalledError) throw err
        throw new AgyNotInstalledError(
          platform,
          `Detected headless + non-UTC environment (SSH/CI or container). ` +
            `The Antigravity CLI keyring has known issues in this setup (antigravity-cli#53): ` +
            `infinite "Authentication required" loops are likely.\n\n` +
            `Workaround: set both env vars before running agy:\n` +
            `  GEMINI_FORCE_FILE_STORAGE=true TZ=UTC agy -p "test"\n\n` +
            `Underlying error: ${err instanceof Error ? err.message : String(err)}\n\n` +
            installInstructionsForPlatform(platform),
        )
      },
    )
  }

  // PREFLIGHT-001: strip subscription-only keys before the verifyVersion
  // spawn. SECURITY.md:23-37 documents the invariant — applies at every
  // spawn boundary, not just the model-call spawn.
  const version = await verifyVersion(binary, spawnFn, subscriptionOnlyEnv(env))

  // DOC-001: verify the `agy` binary supports `--output-format stream-json`
  // (introduced in 1.1.8). Older versions emit progress logs mixed with
  // NDJSON events on stdout, corrupting the parser. Probe via `--help`.
  await verifyStreamJsonFlag(binary, spawnFn)

  return { binary, version }
}

async function verifyStreamJsonFlag(binary: string, spawnFn: SpawnFn): Promise<void> {
  const child = spawnFn(binary, ["--output-format", "stream-json", "--help"], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5_000,
    env: subscriptionOnlyEnv(),
  })
  await drain(child.stderr)
  const code = await child.exited
  if (code !== 0) {
    throw new AgyNotInstalledError(
      process.platform,
      `Antigravity CLI at ${binary} does not support --output-format stream-json (exit ${code}). ` +
        `Please upgrade agy to >= 1.1.8.\n\n${installInstructionsForPlatform()}`,
    )
  }
}

function isHeadless(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env["SSH_CLIENT"] || env["SSH_TTY"] || env["SSH_CONNECTION"] || env["CI"])
}

function isNonUTC(): boolean {
  return new Date().getTimezoneOffset() !== 0
}

export { AGY_DEFAULT_PATH, defaultSpawn }
export type { SpawnFn } from "./spawn.js"
