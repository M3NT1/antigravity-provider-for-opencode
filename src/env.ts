import { SUBSCRIPTION_ONLY_ENV_KEYS } from "./constants.js"

// Build a sanitized environment for spawning the Antigravity CLI. The
// invariant is subscription-only: any env var that would let the CLI
// fall back to a paid per-token API key path is stripped before every
// spawn. This is enforced at the boundary so a stray export in the
// user's shell profile cannot punch a hole in the cost model.
//
// `extra` is merged on top so callers can pass additional vars
// (e.g. a custom log path) without re-introducing the stripped keys.
export function subscriptionOnlyEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of SUBSCRIPTION_ONLY_ENV_KEYS) {
    delete env[key]
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined) continue
      env[key] = value
    }
  }
  return env
}

// Diagnostic helper. If the parent process env somehow still contains
// a subscription-only key, the caller is advised to remove it.
// Returns the list of leaked keys, or an empty array if none.
export function detectLeakedSubscriptionKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const leaked: string[] = []
  for (const key of SUBSCRIPTION_ONLY_ENV_KEYS) {
    if (env[key] !== undefined && env[key] !== "") leaked.push(key)
  }
  return leaked
}
