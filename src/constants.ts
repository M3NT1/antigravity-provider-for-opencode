import os from "node:os"
import path from "path"

// ===== Platform-specific agy binary location =====
function defaultAgyPath(): string {
  if (process.platform === "win32") {
    const localAppData = process.env["LOCALAPPDATA"] ?? path.join(os.homedir(), "AppData", "Local")
    return path.join(localAppData, "agy", "bin", "agy.exe")
  }
  return path.join(os.homedir(), ".local", "bin", "agy")
}

// Evaluated lazily so changes to `process.env.LOCALAPPDATA` after module
// load are picked up on subsequent calls.
export function getAgyDefaultPath(): string {
  return defaultAgyPath()
}

export const AGY_DEFAULT_PATH = getAgyDefaultPath()

// ===== Platform-specific install command (spawn arg-list form) =====
// Each entry is an array that gets passed to Process.spawn (...) so we never
// invoke a shell. The visible stdout behavior is preserved by passing
// stdio: ["ignore", "inherit", "inherit"] to the spawn in install.ts.
export type InstallCommand = { cmd: string; args: string[] }

export function installCommandForPlatform(platform: NodeJS.Platform = process.platform): InstallCommand {
  switch (platform) {
    case "darwin":
    case "linux":
      return {
        cmd: "bash",
        args: ["-c", "curl -fsSL https://antigravity.google/cli/install.sh | bash"],
      }
    case "win32":
      return {
        cmd: "powershell.exe",
        args: ["-NoProfile", "-Command", "irm https://antigravity.google/cli/install.ps1 | iex"],
      }
    default:
      throw new Error(`Unsupported platform: ${platform}`)
  }
}

export function installInstructionsForPlatform(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    return [
      "Antigravity CLI is not installed.",
      "Install it with one of:",
      "  PowerShell: irm https://antigravity.google/cli/install.ps1 | iex",
      "  CMD:         curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd",
      "Then retry this auth method.",
    ].join("\n")
  }
  return [
    "Antigravity CLI is not installed.",
    "Install it with:",
    "  curl -fsSL https://antigravity.google/cli/install.sh | bash",
    "Then retry this auth method.",
  ].join("\n")
}

// ===== Subscription-only invariant =====
// The Antigravity CLI accepts an `ANTIGRAVITY_API_KEY` env var as a paid
// API-key escape hatch (per-token billing). Our plugin operates the
// subscription path only, so we strip these keys from the spawned
// subprocess environment before every agy invocation. The same list
// is used on every platform.
//
// Mirrors the Sentient-OS AntigravityProvider env-strip invariant.
export const SUBSCRIPTION_ONLY_ENV_KEYS = [
  "ANTIGRAVITY_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENAI_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GOOGLE_GENAI_USE_GCA",
] as const

// ===== Spawn behavior =====
export const SPAWN_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes, matches gemini-cli's print mode
export const SIGTERM_GRACE_MS = 5_000

// ===== Provider identity =====
export const PROVIDER_ID = "antigravity"
export const PROVIDER_NAME = "Antigravity (Google AI Subscription)"
export const PROVIDER_ENV: string[] = [] // no env-detected API key path; auth is interactive only
