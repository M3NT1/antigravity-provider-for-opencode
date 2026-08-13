// Authentication flow for the Antigravity provider.
//
// opencode's plugin API only allows an auth.loader to inject options
// into one of the BUNDLED_PROVIDERS SDKs (e.g. @ai-sdk/google). Plugins
// cannot add a new entry to the BUNDLED_PROVIDERS dict, so we hook
// the existing google provider and override its fetch — the same
// pattern opencode-google-code-assist uses for cloudcode-pa.
//
// The auth.loader returns a fetch function that the AI SDK calls
// instead of the real Generative Language API HTTP request. The
// override:
//
//   1. Detect whether the request is streamable (= `:streamGenerateContent?alt=sse`)
//   2. Extract the prompt and model from the request body
//   3. Spawn `agy -p <prompt> --model <slug> --output-format stream-json`
//   4. Translate the NDJSON stream into an SSE response that the
//      AI SDK can consume (chat.completion.chunk per text_delta,
//      plus a [DONE] terminator)
//
// Three auth methods are exposed to the user via /connect:
//
//   1. "Install Antigravity CLI" — runs the platform install command
//   2. "Sign in with Google" — spawns agy in foreground for OAuth
//   3. "Use existing antigravity session" — pure runtime check,
//      marks the auth as completed if agy is present and runnable.
//
// The provider.model hook returns the 6 Antigravity models so they
// appear in the opencode model picker under the "google" provider.

import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { preflight } from "./cli.js"
import { install, installInstructionsForPlatform } from "./install.js"
import { spawnAgyStream } from "./fetch-wrapper.js"
import { MODEL_BY_SLUG, toModelV2Map } from "./models.js"
import { AgyNotInstalledError, AgyAuthMissingError } from "./errors.js"
import { defaultSpawn } from "./spawn.js"

// preflight() uses defaultSpawn internally; we import it here so the
// re-export surface keeps the contract that callers can construct
// their own override should they need to mock the verifier.

// The provider we attach to. "google" is in models.dev and in
// BUNDLED_PROVIDERS via @ai-sdk/google, so opencode's plugin loop
// accepts the hook. The picker's label is "Google" but the model
// list is replaced by our 6 Antigravity models.
//
// The auth.provider MUST match the provider.id: when the user picks
// the provider from the list, opencode looks up the auth methods by
// the provider ID. Mismatching them (e.g. auth.provider="antigravity"
// while provider.id="google") means the user gets the built-in API
// key prompt instead of our OAuth flow.
const ATTACHED_PROVIDER_ID = "google"

// Extract the prompt from a Generative Language API (Vertex-AI-shaped)
// request body. The AI SDK produces this body shape from the
// google provider; we only need the prompt text.
function extractPrompt(body: unknown): string {
  if (!body || typeof body !== "object") return ""
  const b = body as { contents?: Array<{ parts?: Array<{ text?: string }> }> }
  const parts: string[] = []
  for (const c of b.contents ?? []) {
    for (const p of c.parts ?? []) {
      if (typeof p.text === "string") parts.push(p.text)
    }
  }
  return parts.join("\n")
}

// Detect the model slug and the method from the AI SDK's outgoing URL.
// The AI SDK builds URLs like /v1beta/models/{model}:{method} where
// method is `streamGenerateContent` (with ?alt=sse), `generateContent`,
// or `countTokens`. We only handle the streaming generation path;
// countTokens and any non-model URL pass through (404).
function parseAiSdkGoogleUrl(url: string): { slug: string; method: string } | null {
  const match = url.match(/\/models\/([^:/?]+):([^:?]+)/)
  if (!match) return null
  // match[1] and match[2] are guaranteed non-null when match is non-null
  // (the regex has two capture groups). The `!` is the standard
  // noUncheckedIndexedAccess escape hatch for regex captures.
  return { slug: match[1]!, method: match[2]! }
}

export const AntigravityProviderPlugin = async (_input: PluginInput): Promise<Hooks> => {
  // Resolve the agy binary once at plugin load. If it's missing the
  // model hook returns an empty model list so the picker shows no
  // Antigravity models (degrades gracefully, no error spam).
  const preflighted = await preflight().catch(() => null)
  const binary = preflighted?.binary ?? null

  return {
    config: async () => {
      // Empty config hook — the plugin's install instructions are
      // surfaced via the auth.methods wiring instead.
    },
    provider: {
      id: ATTACHED_PROVIDER_ID,
      models: async () => {
        if (!binary) return {}
        return toModelV2Map(MODEL_BY_SLUG)
      },
    },
    auth: {
      provider: "google",
      methods: [
        {
          label: "Install Antigravity CLI",
          type: "api",
          prompts: [
            {
              type: "text",
              key: "confirm",
              message: "Run the official install command?",
            },
          ],
        },
        {
          label: "Sign in with Google (run `agy` first)",
          type: "oauth",
          authorize: async () => {
            // OAuth actually happens in the OS keyring via `agy`,
            // not in this code path. The user runs `agy` in a
            // terminal; that binary opens the browser, completes
            // OAuth, and stores the refresh token in the OS
            // keychain. This callback verifies that `agy` is
            // installed and runnable before recording a marker.
            // The placeholder tokens are intentional — the real
            // OAuth state is in the OS keyring, never persisted to
            // opencode's auth.json (see SECURITY.md).
            return {
              url: "https://accounts.google.com/o/oauth/v2/auth?provider=antigravity",
              instructions:
                "Run `agy -p \"test\"` in a terminal first to complete the Google sign-in. " +
                "The Antigravity CLI opens the browser, completes OAuth, and stores the refresh token " +
                "in the OS keyring (Apple Keychain / Linux Secret Service / Windows Credential Manager). " +
                "After a successful sign-in, return to opencode and confirm the session.",
              method: "auto" as const,
              callback: async () => {
                await preflight()
                return {
                  type: "success" as const,
                  refresh: "antigravity-managed",
                  access: "antigravity-managed",
                  expires: Date.now() + 3600 * 1000,
                }
              },
            }
          },
        },
        {
          label: "Use existing Antigravity session",
          type: "oauth",
          authorize: async () => {
            return {
              url: "https://accounts.google.com/o/oauth/v2/auth?provider=antigravity",
              instructions:
                "Use this if you have already signed in via the Antigravity CLI in another terminal. " +
                "Verify by running `agy -p \"test\"` — if it returns a response without an auth error, " +
                "the session is active and you can continue.",
              method: "auto" as const,
              callback: async () => {
                await preflight()
                return {
                  type: "success" as const,
                  refresh: "antigravity-managed",
                  access: "antigravity-managed",
                  expires: Date.now() + 3600 * 1000,
                }
              },
            }
          },
        },
      ],
      loader: async (getAuth: () => Promise<unknown>) => {
        // Verify session is present.
        const auth = await getAuth()
        if (!auth) {
          throw new AgyAuthMissingError(
            "No antigravity session is configured. Run /connect antigravity first.",
          )
        }

        // Preflight: ensure agy is installed at every model load.
        // This is the runtime guard that prevents the user from
        // selecting an Antigravity model without the binary on PATH.
        let agyBinary: string
        try {
          const ok = await preflight()
          agyBinary = ok.binary
        } catch (err) {
          if (err instanceof AgyNotInstalledError) {
            throw new AgyNotInstalledError(
              err.platform,
              `${err.message}\n\nAntigravity auth is configured but the binary is missing. Use "Install Antigravity CLI" above to reinstall.`,
            )
          }
          throw err
        }

        // The fetch override is the heart of the plugin: every
        // request from the @ai-sdk/google SDK runs through this
        // function. We short-circuit non-Google URLs (countTokens,
        // any model listing) by passing them through.
        return {
          apiKey: "_antigravity_placeholder_", // never used — bearer token is in Keychain
          fetch: async (requestInput: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const url = typeof requestInput === "string"
              ? requestInput
              : requestInput instanceof URL
                ? requestInput.toString()
                : requestInput.url

            // Strip the AI SDK's API-key headers — we authenticate via
            // agy's Keychain session, not HTTP basic auth.
            if (init?.headers) {
              if (init.headers instanceof Headers) {
                init.headers.delete("authorization")
                init.headers.delete("x-goog-api-key")
              } else if (Array.isArray(init.headers)) {
                init.headers = init.headers.filter(
                  ([k]) =>
                    k !== undefined &&
                    k.toLowerCase() !== "authorization" &&
                    k.toLowerCase() !== "x-goog-api-key",
                )
              } else {
                // STRIP-001: handle both casings — `Headers` is case-
                // insensitive but plain record types aren't. Match the
                // opencode-google-code-assist/src/fetch.ts:99-114 pattern.
                delete init.headers["authorization"]
                delete init.headers["Authorization"]
                delete init.headers["x-goog-api-key"]
                delete init.headers["X-Goog-Api-Key"]
              }
            }

            // Anything we don't explicitly handle is passed through.
            // The google provider's own fetch (real Generative Language
            // API) only runs if the preflight above failed and we let
            // a request escape — which we shouldn't.
            const parsed = parseAiSdkGoogleUrl(url)
            if (!parsed) {
              return new Response("not an agy-handled request", { status: 404 })
            }
            // Only streamable generation is supported; countTokens and
            // other methods are passed through to the real API.
            if (parsed.method !== "streamGenerateContent" && parsed.method !== "generateContent") {
              return new Response("not an agy-handled request", { status: 404 })
            }

            const prompt = extractPrompt(
              init?.body ? JSON.parse(typeof init.body === "string" ? init.body : "{}") : {},
            )
            if (!prompt) {
              return new Response("empty prompt", { status: 400 })
            }

            return spawnAgyStream({
              binary: agyBinary,
              prompt,
              slug: parsed.slug as never,
              signal: init?.signal ?? undefined,
            })
          },
        }
      },
    },
  }
}

export default AntigravityProviderPlugin

// Re-export so consumers can import the full surface from one place.
export { install, installInstructionsForPlatform, defaultSpawn }
