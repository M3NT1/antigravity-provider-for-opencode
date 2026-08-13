import fs from "node:fs"
import os from "node:os"
import path from "path"

import { getAgyDefaultPath, installInstructionsForPlatform } from "./constants.js"
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

// Windows default PATHEXT order — Windows checks these left-to-right
// when a bare command is invoked. Matches vscode/orca/varlock convention
// (microsoft/vscode/src/vs/base/node/processes.ts and following).
const DEFAULT_WIN_PATHEXT = ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC"

function which(bin: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | null {
  const pathVar = env["PATH"]
  if (!pathVar) return null
  const dirs = pathVar.split(path.delimiter)
  // PATHEXT-001: read PATHEXT on Windows (defaults to the canonical
  // .COM;.EXE;.BAT;.CMD;… order if unset). Empty string first to
  // prefer exact match. Do NOT re-sort — Windows relies on PATHEXT
  // order to disambiguate same-name files with different extensions.
  const exts =
    platform === "win32"
      ? ["", ...(env["PATHEXT"] ?? DEFAULT_WIN_PATHEXT).split(";").filter(Boolean)]
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
        // HEADLESS-001: ALWAYS surface the upstream workaround in
        // headless+non-UTC environments, regardless of whether the
        // underlying error is already an AgyNotInstalledError (which
        // verifyVersion always throws). The original short-circuit
        // `if (err instanceof AgyNotInstalledError) throw err` skipped
        // the workaround surface, defeating the entire feature.
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

  // DOC-001: parse the semver output from `agy --version` and reject
  // versions older than the minimum required (`>= 1.1.8`, which
  // introduced `--output-format stream-json`). We probe the version
  // (a deterministic output) rather than the `--help` exit code for a
  // flag combination (`--output-format stream-json --help`) because
  // many CLIs exit 0 for `--help` regardless of unknown flags.
  await assertAgyVersionAtLeast(version, MIN_AGY_VERSION)

  return { binary, version }
}

// Minimum supported `agy` version. Bump when the plugin requires newer
// CLI features (e.g. when `--output-format stream-json` shipped in 1.1.8).
const MIN_AGY_VERSION = "1.1.8"

// Compare semver triples (major.minor.patch) — returns true if
// `actual` >= `minimum`. Returns false on any parse failure so that
// unknown version strings do not silently bypass the version check.
function isAtLeast(actual: string, minimum: string): boolean {
  const a = actual.split(".").map((n) => Number.parseInt(n, 10))
  const m = minimum.split(".").map((n) => Number.parseInt(n, 10))
  if (a.length !== 3 || m.length !== 3) return false
  if (a.some((n) => !Number.isFinite(n)) || m.some((n) => !Number.isFinite(n))) return false
  for (let i = 0; i < 3; i++) {
    const an = a[i]!
    const mn = m[i]!
    if (an > mn) return true
    if (an < mn) return false
  }
  return true
}

async function assertAgyVersionAtLeast(actual: string, minimum: string): Promise<void> {
  if (!isAtLeast(actual, minimum)) {
    throw new AgyNotInstalledError(
      process.platform,
      `Antigravity CLI version ${actual} is older than the minimum required (${minimum}). ` +
        `Please upgrade agy to >= ${minimum}.\n\n${installInstructionsForPlatform()}`,
    )
  }
}

function isHeadless(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env["SSH_CLIENT"] || env["SSH_TTY"] || env["SSH_CONNECTION"] || env["CI"])
}

function isNonUTC(): boolean {
  return new Date().getTimezoneOffset() !== 0
}

export { getAgyDefaultPath, defaultSpawn }
export type { SpawnFn } from "./spawn.js"
