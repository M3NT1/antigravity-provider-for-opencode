import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { SUBSCRIPTION_ONLY_ENV_KEYS } from "../src/constants.js"
import { subscriptionOnlyEnv, detectLeakedSubscriptionKeys } from "../src/env.js"

// Snapshot helpers — keep the guard explicit so we know which keys
// we are poking in the parent process for the test.
const STORED: Record<string, string | undefined> = {}
function setLeaked(value: string) {
  for (const key of SUBSCRIPTION_ONLY_ENV_KEYS) {
    STORED[key] = process.env[key]
    process.env[key] = value
  }
}
function restoreEnv() {
  for (const key of SUBSCRIPTION_ONLY_ENV_KEYS) {
    if (STORED[key] === undefined) delete process.env[key]
    else process.env[key] = STORED[key]
  }
}

describe("subscriptionOnlyEnv", () => {
  beforeEach(() => setLeaked("leaked-value"))
  afterEach(restoreEnv)

  it("strips every subscription-only key from process.env", () => {
    const env = subscriptionOnlyEnv()
    for (const key of SUBSCRIPTION_ONLY_ENV_KEYS) {
      expect(env[key]).toBeUndefined()
    }
  })

  it("does not mutate the original process.env", () => {
    const before = { ...process.env }
    subscriptionOnlyEnv()
    for (const key of SUBSCRIPTION_ONLY_ENV_KEYS) {
      expect(process.env[key]).toBe(before[key])
    }
  })

  it("preserves unrelated process.env keys", () => {
    process.env["PATH_TEST_VAR"] = "keep-me"
    try {
      const env = subscriptionOnlyEnv()
      expect(env["PATH_TEST_VAR"]).toBe("keep-me")
    } finally {
      delete process.env["PATH_TEST_VAR"]
    }
  })

  it("merges extra env vars on top", () => {
    const env = subscriptionOnlyEnv({
      CUSTOM_LOG: "/tmp/agy.log",
      ANTIGRAVITY_API_KEY: "should-be-ignored-but-overrides-strip",
    })
    expect(env["CUSTOM_LOG"]).toBe("/tmp/agy.log")
    // The `extra` values win over the strip because we apply the strip
    // first and then merge — this is intentional: the caller has the
    // last word and can re-inject if it really wants to. The
    // detectLeakedSubscriptionKeys guard alerts if it does.
    expect(env["ANTIGRAVITY_API_KEY"]).toBe("should-be-ignored-but-overrides-strip")
  })

  it("skips undefined extra values without assigning the key", () => {
    const env = subscriptionOnlyEnv({ MAYBE: undefined })
    expect("MAYBE" in env).toBe(false)
  })

  it("returns a new object every call (no shared mutation)", () => {
    const a = subscriptionOnlyEnv()
    const b = subscriptionOnlyEnv()
    expect(a).not.toBe(b)
    a["INJECTED"] = "1"
    expect(b["INJECTED"]).toBeUndefined()
  })
})

describe("detectLeakedSubscriptionKeys", () => {
  beforeEach(() => setLeaked("leaked"))
  afterEach(restoreEnv)

  it("flags every subscription-only key currently in env", () => {
    const leaked = detectLeakedSubscriptionKeys()
    expect(leaked).toEqual([...SUBSCRIPTION_ONLY_ENV_KEYS])
  })

  it("returns an empty array when env is clean", () => {
    const clean: NodeJS.ProcessEnv = { PATH: "/usr/bin", HOME: "/home/test" }
    expect(detectLeakedSubscriptionKeys(clean)).toEqual([])
  })

  it("treats empty string as not leaked", () => {
    const clean: NodeJS.ProcessEnv = { ANTIGRAVITY_API_KEY: "" }
    expect(detectLeakedSubscriptionKeys(clean)).toEqual([])
  })

  it("scans an arbitrary env object, not just process.env", () => {
    const env = {
      ANTIGRAVITY_API_KEY: "x",
      GEMINI_API_KEY: "y",
      GOOGLE_API_KEY: "z",
      PATH: "/usr/bin",
    } as NodeJS.ProcessEnv
    expect(detectLeakedSubscriptionKeys(env)).toEqual([
      "ANTIGRAVITY_API_KEY",
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
    ])
  })
})
