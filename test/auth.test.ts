import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "path"

import { AntigravityProviderPlugin } from "../src/auth.js"
import { AgyNotInstalledError, AgyAuthMissingError } from "../src/errors.js"
import type { Auth } from "@opencode-ai/sdk/v2"

function fakeAuth(type: "oauth" | "api" = "oauth"): Auth {
  if (type === "oauth") {
    return {
      type: "oauth",
      refresh: "fake-refresh",
      access: "fake-access",
      expires: Date.now() + 3600 * 1000,
    }
  }
  return { type: "api", key: "fake-key" }
}

// macOS os.homedir() reads from the system passwd database (not HOME),
// so we must override it directly for tests that need a fake home
// directory. We save/restore the original function on each test.
const originalHomedir = os.homedir
function mockHomedir(home: string) {
  ;(os as { homedir: () => string }).homedir = () => home
}
afterEach(() => {
  mockHomedir(originalHomedir())
  delete process.env["HOME"]
  delete process.env["PATH"]
})

// ===== Helpers =====

function makeExecutable(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  // The mock responds to `--version` with a parseable version string
  // (matches the real agy output: "Antigravity CLI X.Y.Z"). Without
  // a version string, the preflight verifyVersion() throws.
  fs.writeFileSync(filePath, "#!/bin/sh\n[ \"$1\" = \"--version\" ] && echo \"Antigravity CLI 99.0.0\" || echo ok\n")
  fs.chmodSync(filePath, 0o755)
}

let tmpHome: string
beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-"))
})
afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

// ===== Tests =====

describe("AntigravityProviderPlugin", () => {
  it("returns 3 auth methods", async () => {
    const hooks = await AntigravityProviderPlugin({} as never)
    expect(hooks.auth?.methods).toHaveLength(3)
    expect(hooks.auth?.methods.map((m) => m.label)).toEqual([
      "Install Antigravity CLI",
      "Sign in with Google (run `agy` first)",
      "Use existing Antigravity session",
    ])
  })

  it("uses the google provider id so it attaches to the existing BUNDLED_PROVIDERS entry", async () => {
    const hooks = await AntigravityProviderPlugin({} as never)
    expect(hooks.provider?.id).toBe("google")
    // auth.provider MUST match provider.id — otherwise the user
    // sees the built-in API-key prompt instead of our auth flow.
    expect(hooks.auth?.provider).toBe("google")
  })

  it("registers all 7 Antigravity models when agy is installed", async () => {
    const bin = path.join(tmpHome, ".local", "bin", "agy")
    makeExecutable(bin)
    mockHomedir(tmpHome)
    const hooks = await AntigravityProviderPlugin({} as never)
    const result = await hooks.provider!.models!(
      { id: "google", name: "Google", source: "env", env: [], options: {}, models: {} } as never,
      { auth: undefined },
    )
    const slugs = Object.keys(result as Record<string, unknown>)
    expect(slugs).toContain("gemini-3.6-flash-high")
    expect(slugs).toContain("gemini-3.6-flash-medium")
    expect(slugs).toContain("gemini-3.5-flash-medium")
    expect(slugs).toContain("gemini-3.1-pro-high")
    expect(slugs).toContain("claude-sonnet-4-6")
    expect(slugs).toContain("claude-opus-4-6")
    expect(slugs).toContain("gpt-oss-120b-medium")
  })

  it("returns an empty model list when agy is not installed (graceful degrade)", async () => {
    process.env["MOCK_PREFLIGHT_RESULT"] = "error"
    mockHomedir(tmpHome)
    process.env["PATH"] = "/nonexistent"
    const hooks = await AntigravityProviderPlugin({} as never)
    const result = await hooks.provider!.models!(
      { id: "google", name: "Google", source: "env", env: [], options: {}, models: {} } as never,
      { auth: undefined },
    )
    expect(result).toEqual({})
  })

  it("auth.loader throws AgyNotInstalledError when agy is missing", async () => {
    process.env["MOCK_PREFLIGHT_RESULT"] = "error"
    mockHomedir(tmpHome)
    process.env["PATH"] = "/nonexistent"
    const hooks = await AntigravityProviderPlugin({} as never)
    const loader = hooks.auth!.loader!
    await expect(loader(async () => fakeAuth(), {} as never)).rejects.toBeInstanceOf(AgyNotInstalledError)
  })

  it("auth.loader throws AgyNotInstalledError with the install command in the message", async () => {
    process.env["MOCK_PREFLIGHT_RESULT"] = "error"
    mockHomedir(tmpHome)
    process.env["PATH"] = "/nonexistent"
    const hooks = await AntigravityProviderPlugin({} as never)
    const loader = hooks.auth!.loader!
    try {
      await loader(async () => fakeAuth(), {} as never)
      throw new Error("expected to throw")
    } catch (err) {
      expect(err).toBeInstanceOf(AgyNotInstalledError)
      expect((err as AgyNotInstalledError).message).toContain(
        "curl -fsSL https://antigravity.google/cli/install.sh",
      )
    }
  })

  it("auth.loader throws AgyAuthMissingError when no auth is configured", async () => {
    const bin = path.join(tmpHome, ".local", "bin", "agy")
    makeExecutable(bin)
    mockHomedir(tmpHome)
    const hooks = await AntigravityProviderPlugin({} as never)
    const loader = hooks.auth!.loader!
    await expect(loader(async () => undefined as never, {} as never)).rejects.toBeInstanceOf(AgyAuthMissingError)
  })

  it("auth.loader returns a fetch override when agy is present", async () => {
    const bin = path.join(tmpHome, ".local", "bin", "agy")
    makeExecutable(bin)
    mockHomedir(tmpHome)
    const hooks = await AntigravityProviderPlugin({} as never)
    const loader = hooks.auth!.loader!
    const options = await loader(async () => fakeAuth(), {} as never)
    expect(options.apiKey).toBe("_antigravity_placeholder_")
    expect(typeof options.fetch).toBe("function")
  })

  it("fetch override strips Authorization and x-goog-api-key headers", async () => {
    const bin = path.join(tmpHome, ".local", "bin", "agy")
    makeExecutable(bin)
    mockHomedir(tmpHome)
    const hooks = await AntigravityProviderPlugin({} as never)
    const loader = hooks.auth!.loader!
    const options = await loader(async () => fakeAuth(), {} as never)
    const headers = new Headers({
      Authorization: "Bearer secret",
      "x-goog-api-key": "secret",
      "Content-Type": "application/json",
    })
    const response = await options.fetch!(
      "https://generativelanguage.googleapis.com/v1beta/models/foo:countTokens",
      { method: "POST", headers, body: "{}" },
    )
    expect(headers.has("authorization")).toBe(false)
    expect(headers.has("x-goog-api-key")).toBe(false)
    expect(headers.has("Content-Type")).toBe(true)
    expect(response.status).toBe(404)
  })

  it("fetch override returns 404 for non-model URLs (let it fall through)", async () => {
    const bin = path.join(tmpHome, ".local", "bin", "agy")
    makeExecutable(bin)
    mockHomedir(tmpHome)
    const hooks = await AntigravityProviderPlugin({} as never)
    const loader = hooks.auth!.loader!
    const options = await loader(async () => fakeAuth(), {} as never)
    const response = await options.fetch!(
      "https://generativelanguage.googleapis.com/v1beta/models",
      { method: "GET" },
    )
    expect(response.status).toBe(404)
  })

  it("OAuth callback runs preflight to verify agy is runnable before returning marker tokens", async () => {
    // When the user selects one of the OAuth methods, the callback
    // must verify that agy is installed and runnable — otherwise the
    // marker tokens get persisted to auth.json with no working
    // session backing them, leading to confusing failures at model
    // load time.
    const bin = path.join(tmpHome, ".local", "bin", "agy")
    makeExecutable(bin)
    mockHomedir(tmpHome)
    const hooks = await AntigravityProviderPlugin({} as never)
    const oauthMethods = hooks.auth!.methods.filter((m) => m.type === "oauth")
    expect(oauthMethods.length).toBe(2)
    for (const method of oauthMethods) {
      const result = await method.authorize!({})
      // The authorize() returns the "auto" branch of the union, but
      // TypeScript widens to the full union type. Cast to access the
      // auto-specific callback() arity and the oauth branch's expires.
      const autoResult = result as Extract<typeof result, { method: "auto" }>
      const callbackResult = await autoResult.callback()
      if (callbackResult.type !== "success") throw new Error("expected success")
      // Narrow to the oauth-success branch (refresh/access/expires) —
      // the other branch is the api-success (key/metadata).
      const oauthSuccess = "refresh" in callbackResult ? callbackResult : null
      expect(oauthSuccess).not.toBeNull()
      expect(oauthSuccess!.refresh).toBe("antigravity-managed")
      expect(oauthSuccess!.access).toBe("antigravity-managed")
      expect(oauthSuccess!.expires).toBeGreaterThan(Date.now() - 5000)
    }
  })

  it("OAuth callback throws AgyNotInstalledError when agy is missing", async () => {
    process.env["MOCK_PREFLIGHT_RESULT"] = "error"
    mockHomedir(tmpHome)
    process.env["PATH"] = "/nonexistent"
    const hooks = await AntigravityProviderPlugin({} as never)
    const oauthMethods = hooks.auth!.methods.filter((m) => m.type === "oauth")
    for (const method of oauthMethods) {
      const result = await method.authorize!({})
      const autoResult = result as Extract<typeof result, { method: "auto" }>
      await expect(autoResult.callback()).rejects.toBeInstanceOf(AgyNotInstalledError)
    }
  })
})
