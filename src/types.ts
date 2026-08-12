// Lightweight domain types for the plugin. We don't import the heavy
// `@opencode-ai/sdk/v2` ModelV2 type here because:
//   1. This file is consumed by the plugin factory in index.ts, which
//      already has the SDK types in scope.
//   2. Keeping the shape flat lets tests stay free of type-cast noise.
//
// The shape mirrors what the plugin's `provider.models` hook must
// return: an object keyed by model slug, each entry satisfying the
// opencode ModelV2 contract (id, providerID, name, capabilities, cost, limit, ...).

export type ModelSlug =
  | "gemini-3.6-flash-high"
  | "gemini-3.6-flash-medium"
  | "gemini-3.5-flash-medium"
  | "gemini-3.1-pro-high"
  | "claude-sonnet-4-6"
  | "claude-opus-4-6"
  | "gpt-oss-120b-medium"

export type ModelModality = { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean }

export type ModelCapabilities = {
  temperature: boolean
  reasoning: boolean
  attachment: boolean
  toolcall: boolean
  input: ModelModality
  output: ModelModality
  interleaved: boolean
}

export type ModelCost = {
  input: number
  output: number
  cache: { read: number; write: number }
}

export type ModelLimit = {
  context: number
  input?: number
  output: number
}

// Re-exported via index.ts with the opencode ProviderV2 / ModelV2 branded
// ID casts applied there. Cost is 0 because the user subscription bills
// them, not the per-token API.
export type ModelEntry = {
  id: ModelSlug
  providerID: typeof import("./constants.js").PROVIDER_ID
  name: string
  family: string
  api: { id: ModelSlug; url: string; npm: string }
  status: "active" | "alpha" | "deprecated"
  capabilities: ModelCapabilities
  cost: ModelCost
  limit: ModelLimit
  headers: Record<string, string>
  options: Record<string, unknown>
  release_date: string
  variants: Record<string, Record<string, unknown>>
}
