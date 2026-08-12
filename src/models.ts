import { PROVIDER_ID } from "./constants.js"
import type { ModelEntry, ModelSlug } from "./types.js"

// Conservative defaults sourced from the Antigravity docs /pages
// (models.md) and the gemini-cli CCPA fallbacks. Cost is 0 because
// the user subscription bills them, not per-token.
//
// Reasoning-capable models have `capabilities.reasoning: true`.
//
// The `npm` field is opaque to opencode (the plugin runs through the
// ai-sdk LanguageModelV3 contract directly, not via an npm package),
// but the schema requires it; we set it to a sentinel so the opencode
// model picker knows this is a custom plugin-served model.
const SENTRY_NPM = "@opencode-ai/antigravity-provider/agy"

const TEXT_MODALITY = { text: true, audio: false, image: false, video: false, pdf: false }
const IMAGE_MODALITY = { text: true, audio: false, image: true, video: false, pdf: false }

export const MODEL_BY_SLUG: Record<ModelSlug, ModelEntry> = {
  "gemini-3.6-flash-high": {
    id: "gemini-3.6-flash-high",
    providerID: PROVIDER_ID,
    name: "Gemini 3.6 Flash (High)",
    family: "gemini-flash",
    api: { id: "gemini-3.6-flash-high", url: "", npm: SENTRY_NPM },
    status: "active",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: IMAGE_MODALITY,
      output: TEXT_MODALITY,
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 1_000_000, input: 1_000_000, output: 65_536 },
    headers: {},
    options: {},
    release_date: "2026-07-21",
    variants: {},
  },
  "gemini-3.6-flash-medium": {
    id: "gemini-3.6-flash-medium",
    providerID: PROVIDER_ID,
    name: "Gemini 3.6 Flash (Medium)",
    family: "gemini-flash",
    api: { id: "gemini-3.6-flash-medium", url: "", npm: SENTRY_NPM },
    status: "active",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: IMAGE_MODALITY,
      output: TEXT_MODALITY,
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 1_000_000, input: 1_000_000, output: 65_536 },
    headers: {},
    options: {},
    release_date: "2026-07-21",
    variants: {},
  },
  "gemini-3.5-flash-medium": {
    id: "gemini-3.5-flash-medium",
    providerID: PROVIDER_ID,
    name: "Gemini 3.5 Flash (Medium)",
    family: "gemini-flash",
    api: { id: "gemini-3.5-flash-medium", url: "", npm: SENTRY_NPM },
    status: "active",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: IMAGE_MODALITY,
      output: TEXT_MODALITY,
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 1_000_000, input: 1_000_000, output: 65_536 },
    headers: {},
    options: {},
    release_date: "2026-05-19",
    variants: {},
  },
  "gemini-3.1-pro-high": {
    id: "gemini-3.1-pro-high",
    providerID: PROVIDER_ID,
    name: "Gemini 3.1 Pro (High)",
    family: "gemini-pro",
    api: { id: "gemini-3.1-pro-high", url: "", npm: SENTRY_NPM },
    status: "active",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: IMAGE_MODALITY,
      output: TEXT_MODALITY,
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 1_000_000, input: 1_000_000, output: 65_536 },
    headers: {},
    options: {},
    release_date: "2026-05-19",
    variants: {},
  },
  "claude-sonnet-4-6": {
    id: "claude-sonnet-4-6",
    providerID: PROVIDER_ID,
    name: "Claude Sonnet 4.6 (Thinking)",
    family: "claude-sonnet",
    api: { id: "claude-sonnet-4-6", url: "", npm: SENTRY_NPM },
    status: "active",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: IMAGE_MODALITY,
      output: TEXT_MODALITY,
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 200_000, input: 200_000, output: 8_192 },
    headers: {},
    options: {},
    release_date: "2026-05-19",
    variants: {},
  },
  "claude-opus-4-6": {
    id: "claude-opus-4-6",
    providerID: PROVIDER_ID,
    name: "Claude Opus 4.6 (Thinking)",
    family: "claude-opus",
    api: { id: "claude-opus-4-6", url: "", npm: SENTRY_NPM },
    status: "active",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: IMAGE_MODALITY,
      output: TEXT_MODALITY,
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 200_000, input: 200_000, output: 8_192 },
    headers: {},
    options: {},
    release_date: "2026-05-19",
    variants: {},
  },
  "gpt-oss-120b-medium": {
    id: "gpt-oss-120b-medium",
    providerID: PROVIDER_ID,
    name: "GPT-OSS 120B (Medium)",
    family: "gpt-oss",
    api: { id: "gpt-oss-120b-medium", url: "", npm: SENTRY_NPM },
    status: "active",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: false,
      input: TEXT_MODALITY,
      output: TEXT_MODALITY,
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128_000, input: 128_000, output: 8_192 },
    headers: {},
    options: {},
    release_date: "2026-05-19",
    variants: {},
  },
}

// silence "unused" lint by re-exporting the modality constants so the
// test file can assert against them per-model.
export { TEXT_MODALITY, IMAGE_MODALITY }
