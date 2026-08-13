import { describe, expect, it } from "bun:test"
import { PROVIDER_ID } from "../src/constants.js"
import { MODEL_BY_SLUG, IMAGE_MODALITY, TEXT_MODALITY, toModelV2Map } from "../src/models.js"
import type { ModelSlug } from "../src/types.js"

const ALL_SLUGS = Object.keys(MODEL_BY_SLUG) as ModelSlug[]

describe("MODEL_BY_SLUG", () => {
  it("contains exactly 7 models", () => {
    expect(ALL_SLUGS).toHaveLength(7)
  })

  it.each(ALL_SLUGS)("%s has id matching its key", (slug) => {
    const model = MODEL_BY_SLUG[slug]
    expect(model.id).toBe(slug)
  })

  it.each(ALL_SLUGS)("%s has providerID = 'antigravity'", (slug) => {
    const model = MODEL_BY_SLUG[slug]
    expect(model.providerID).toBe(PROVIDER_ID)
  })

  it.each(ALL_SLUGS)("%s has api.npm pointing to a BUNDLED_PROVIDERS entry", (slug) => {
    const model = MODEL_BY_SLUG[slug]
    // The plugin attaches to the @ai-sdk/google SDK and overrides its
    // fetch. The api.npm field MUST match a BUNDLED_PROVIDERS key or
    // opencode's model initializer falls through to Npm.add(), which
    // fails for non-existent packages and throws InitError.
    expect(model.api.npm).toBe("@ai-sdk/google")
  })

  it.each(ALL_SLUGS)("%s has cost = 0 (subscription-billed)", (slug) => {
    const model = MODEL_BY_SLUG[slug]
    expect(model.cost.input).toBe(0)
    expect(model.cost.output).toBe(0)
    expect(model.cost.cache.read).toBe(0)
    expect(model.cost.cache.write).toBe(0)
  })

  it.each(ALL_SLUGS)("%s has status = 'active'", (slug) => {
    const model = MODEL_BY_SLUG[slug]
    expect(model.status).toBe("active")
  })

  it.each(ALL_SLUGS)("%s has non-empty name and family", (slug) => {
    const model = MODEL_BY_SLUG[slug]
    expect(model.name.length).toBeGreaterThan(0)
    expect(model.family.length).toBeGreaterThan(0)
  })

  it.each(ALL_SLUGS)("%s has limit.context > 0 and limit.output > 0", (slug) => {
    const model = MODEL_BY_SLUG[slug]
    expect(model.limit.context).toBeGreaterThan(0)
    expect(model.limit.output).toBeGreaterThan(0)
  })

  it("reasoning flag matches the family expectation", () => {
    // All Antigravity models expose reasoning=true on the wire (per the
    // /docs/models table — every reasoning model the UI exposes ships
    // with thinking on).
    for (const slug of ALL_SLUGS) {
      expect(MODEL_BY_SLUG[slug].capabilities.reasoning).toBe(true)
    }
  })

  it("Gemini and Claude families accept image input", () => {
    for (const slug of ALL_SLUGS) {
      const cap = MODEL_BY_SLUG[slug].capabilities
      if (slug.startsWith("gemini-") || slug.startsWith("claude-")) {
        expect(cap.attachment).toBe(true)
        expect(cap.input.image).toBe(true)
      }
    }
  })

  it("GPT-OSS does not declare image attachment (text-only)", () => {
    const gpt = MODEL_BY_SLUG["gpt-oss-120b-medium"]
    expect(gpt.capabilities.attachment).toBe(false)
    expect(gpt.capabilities.input.image).toBe(false)
    expect(gpt.capabilities.input).toEqual(TEXT_MODALITY)
  })

  it("claude models have 200k context window", () => {
    expect(MODEL_BY_SLUG["claude-sonnet-4-6"].limit.context).toBe(200_000)
    expect(MODEL_BY_SLUG["claude-opus-4-6"].limit.context).toBe(200_000)
  })

  it("gemini-3.6-flash and 3.5-flash share the gemini-flash family", () => {
    expect(MODEL_BY_SLUG["gemini-3.6-flash-high"].family).toBe("gemini-flash")
    expect(MODEL_BY_SLUG["gemini-3.6-flash-medium"].family).toBe("gemini-flash")
    expect(MODEL_BY_SLUG["gemini-3.5-flash-medium"].family).toBe("gemini-flash")
  })

  it("claude-sonnet and claude-opus have distinct families", () => {
    expect(MODEL_BY_SLUG["claude-sonnet-4-6"].family).toBe("claude-sonnet")
    expect(MODEL_BY_SLUG["claude-opus-4-6"].family).toBe("claude-opus")
  })

  it("modality constants are immutable singleton shapes", () => {
    expect(IMAGE_MODALITY).toEqual({ text: true, audio: false, image: true, video: false, pdf: false })
    expect(TEXT_MODALITY).toEqual({ text: true, audio: false, image: false, video: false, pdf: false })
  })
})

describe("toModelV2Map (ASNEVER-001)", () => {
  it("produces an entry for every ModelSlug with the same id key", () => {
    const out = toModelV2Map(MODEL_BY_SLUG)
    expect(Object.keys(out).toSorted()).toEqual(Object.keys(MODEL_BY_SLUG).toSorted())
  })

  it("preserves id, name, family, status, release_date from ModelEntry", () => {
    const entry = MODEL_BY_SLUG["gemini-3.1-pro-high"]
    const out = toModelV2Map(MODEL_BY_SLUG)
    const mapped = out["gemini-3.1-pro-high"]!
    expect(mapped.id).toBe(entry.id)
    expect(mapped.name).toBe(entry.name)
    expect(mapped.family).toBe(entry.family)
    expect(mapped.status).toBe(entry.status)
    expect(mapped.release_date).toBe(entry.release_date)
  })

  it("preserves the api.url pointing at @ai-sdk/google BUNDLED_PROVIDERS", () => {
    const out = toModelV2Map(MODEL_BY_SLUG)
    for (const model of Object.values(out)) {
      expect(model.api.npm).toBe("@ai-sdk/google")
    }
  })

  it("keeps cost = 0 (subscription billing)", () => {
    const out = toModelV2Map(MODEL_BY_SLUG)
    for (const model of Object.values(out)) {
      expect(model.cost.input).toBe(0)
      expect(model.cost.output).toBe(0)
    }
  })
})
