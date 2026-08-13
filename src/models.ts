import { PROVIDER_ID } from "./constants.js"
import type { ModelEntry, ModelSlug } from "./types.js"
import type { Model as ModelV2 } from "@opencode-ai/sdk/v2"

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

// ASNEVER-001: typed mapper from our domain `ModelEntry` to the SDK's
// `ModelV2` shape. The previous `as never` cast hid the type-system
// boundary; the boundary still exists because the SDK brands
// `ProviderV2.ID` and `ModelV2.ID` which we cannot produce locally.
// opencode core overrides both branded fields per entry at
// `packages/opencode/src/provider/provider.ts:1417` before downstream
// consumption, so the cast is safe at this boundary.
function toModelV2(entry: ModelEntry): ModelV2 {
  return {
    id: entry.id,
    providerID: entry.providerID,
    api: entry.api,
    name: entry.name,
    family: entry.family,
    capabilities: entry.capabilities as ModelV2["capabilities"],
    cost: entry.cost as ModelV2["cost"],
    limit: entry.limit as ModelV2["limit"],
    status: entry.status,
    headers: entry.headers,
    options: entry.options as ModelV2["options"],
    release_date: entry.release_date,
    variants: {} as ModelV2["variants"],
  }
}

export function toModelV2Map(entries: Record<string, ModelEntry>): Record<string, ModelV2> {
  const out: Record<string, ModelV2> = {}
  for (const [id, entry] of Object.entries(entries)) {
    out[id] = toModelV2(entry)
  }
  return out
}
