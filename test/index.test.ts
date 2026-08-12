import { describe, expect, it } from "bun:test"
import plugin from "../src/index.js"
import { AntigravityProviderPlugin } from "../src/auth.js"

describe("plugin factory", () => {
  it("default export is the AntigravityProviderPlugin factory", () => {
    expect(plugin).toBe(AntigravityProviderPlugin)
  })

  it("named export 'plugin' is the same factory", () => {
    expect(plugin).toBe(AntigravityProviderPlugin)
  })

  it("factory returns a Hooks object with config, provider, and auth", async () => {
    const hooks = await plugin({} as never)
    expect(hooks.config).toBeDefined()
    expect(hooks.provider).toBeDefined()
    expect(hooks.auth).toBeDefined()
  })

  it("factory accepts a PluginInput (smoke check, no field usage)", async () => {
    // The factory does not currently read any PluginInput fields,
    // but we accept it per the contract. The smoke check ensures
    // the signature is compatible with @opencode-ai/plugin's Plugin.
    const hooks = await plugin({
      client: {} as never,
      project: {} as never,
      directory: "/tmp",
      worktree: "/tmp",
      experimental_workspace: { register: () => {} },
      serverUrl: new URL("http://localhost:4096"),
    } as never)
    expect(hooks.provider).toBeDefined()
  })
})
