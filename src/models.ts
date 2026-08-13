import { PROVIDER_ID } from "./constants.js"
import type { ModelEntry, ModelSlug } from "./types.js"

// Conservative defaults sourced from the Antigravity docs /pages
// (models.md) and the gemini-cli CCPA fallbacks. Cost is 0 because
// the user subscription bills them, not per-token.
//
// Reasoning-capable models have `capabilities.reasoning: true`.
//
// api.npm MUST point to a BUNDLED_PROVIDERS entry. The plugin attaches
// to @ai-sdk/google and overrides its fetch — the SDK factory is
// happy as long as the package resolves. The "id" field is the slug
// the agy CLI expects; the "url" is empty (we don't make HTTP calls).
const AI_SDK_GOOGLE_NPM = "@ai-sdk/google"

const TEXT_MODALITY = { text: true, audio: false, image: false, video: false, pdf: false }
const IMAGE_MODALITY = { text: true, audio: false, image: true, video: false, pdf: false }

export const MODEL_BY_SLUG: Record<ModelSlug, ModelEntry> = {
  "gemini-3.6-flash-high": {
    id: "gemini-3.6-flash-high",
    providerID: PROVIDER_ID,
    name: "Gemini 3.6 Flash (High)",
    family: "gemini-flash",
    api: { id: "gemini-3.6-flash-high", url: "", npm: AI_SDK_GOOGLE_NPM },
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
    api: { id: "gemini-3.6-flash-medium", url: "", npm: AI_SDK_GOOGLE_NPM },
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
    api: { id: "gemini-3.5-flash-medium", url: "", npm: AI_SDK_GOOGLE_NPM },
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
    api: { id: "gemini-3.1-pro-high", url: "", npm: AI_SDK_GOOGLE_NPM },
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
    api: { id: "claude-sonnet-4-6", url: "", npm: AI_SDK_GOOGLE_NPM },
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
    api: { id: "claude-opus-4-6", url: "", npm: AI_SDK_GOOGLE_NPM },
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
    api: { id: "gpt-oss-120b-medium", url: "", npm: AI_SDK_GOOGLE_NPM },
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

// Test file imports these directly via `../src/models.js`; no re-export needed.
export { TEXT_MODALITY, IMAGE_MODALITY }
