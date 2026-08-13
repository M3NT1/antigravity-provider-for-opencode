# Security Policy

## Threat model

This plugin is a thin wrapper around the Google `agy` CLI. Its security surface is the boundary between the opencode runtime and the `agy` subprocess. The threat model is composed of the following axes:

### What the plugin does

1. At startup, `preflight()` runs `agy --version` to verify the binary is present and runnable. It does not spawn any other process.
2. At every model load, the `auth.loader` callback again runs `preflight()` and the `provider.models` hook returns the 6 Antigravity models.
3. For every chat request, the `auth.loader`'s `fetch` override spawns `agy -p <prompt> --model <slug> --output-format stream-json` and pipes the NDJSON output back as an SSE response that the AI SDK can consume.

The `agy` binary itself manages the OAuth session via the OS-native keyring (Apple Keychain / Linux Secret Service / Windows Credential Manager). **The plugin never sees the OAuth refresh token**. It only ever starts a child process and reads the result.

### What the plugin does NOT do

- It does not read, store, or transmit the OAuth refresh token. The token stays in the OS keyring, managed by `agy`.
- It does not call any HTTP endpoint directly. The fetch override is a pure local proxy through `agy`.
- It does not bind any TCP port (no loopback callback server, no localhost HTTP).
- It does not write to disk outside its own filesystem footprint.
- It does not silently fall back to a per-token API key path. The subscription-only env strip (below) actively prevents this.

## Subscription-only invariant

The `agy` CLI accepts an `ANTIGRAVITY_API_KEY` env var as a paid escape hatch for enterprise / CI users. If the user's shell profile (`~/.zshrc`, `~/.bashrc`) accidentally exports one of the following vars, the CLI would silently route requests onto the per-token billing path even when the user intended the subscription path:

- `ANTIGRAVITY_API_KEY`
- `GEMINI_API_KEY`
- `GOOGLE_API_KEY`
- `GOOGLE_GENAI_API_KEY`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `GOOGLE_GENAI_USE_VERTEXAI`
- `GOOGLE_GENAI_USE_GCA`

To prevent this, the plugin strips every key in the list above from the spawned subprocess environment before every `agy` invocation. This is enforced at the spawn boundary (`src/fetch-wrapper.ts`) so a stray export cannot punch a hole through the cost model.

The `detectLeakedSubscriptionKeys()` helper in `src/env.ts` is available for callers that want to surface a warning when the parent process env contains any of these keys. The plugin itself does not call this helper (it would block on user cleanup), but it documents the diagnostic so users can audit their environment.

## Subprocess hardening

- **No shell**: the spawn uses `args: [...]` directly, never `shell: true`. No command injection vector.
- **No env passthrough**: the spawned env is constructed by `subscriptionOnlyEnv()`, which is a fresh clone of `process.env` with the subscription-only keys removed. The `extra` parameter (used only by the install flow) is merged on top.
- **Timeout**: 5 minutes per spawn (matches the `agy` print-mode default). We use Node's `spawn({ timeout, killSignal: "SIGKILL" })` so the timeout fires even if `agy` traps SIGTERM.
- **AbortSignal propagation**: if the user cancels mid-request (Ctrl+C in opencode), the AI SDK's AbortSignal is passed to `spawn()` as the `signal` option (Node's documented pattern). Node sends SIGTERM to the child on abort. The `ReadableStream`'s `cancel()` handler also kills the child so consumer-driven cancellation (via `response.body.cancel()`) is independent of the SDK's signal path.

## OAuth storage

The `opencode.json` `auth.json` entry for the antigravity provider is a **marker** — it does not contain the refresh token. The actual OAuth state lives in:
- macOS: `~/Library/Keychains/login.keychain`, item type generic-password, service `Antigravity Safe Storage`
- Linux: Secret Service / dbus
- Windows: Windows Credential Manager

This is consistent with the opencode convention for all providers: the plugin does not write tokens to disk, and the OS keyring is the canonical secure storage. If the user's environment is compromised and the `opencode` data dir is exfiltrated, the attacker does not get the refresh token.

## Trust boundary

The plugin assumes:

- The `agy` binary installed at the platform default path (`~/.local/bin/agy` on macOS/Linux, `%LOCALAPPDATA%\agy\bin\agy.exe` on Windows) is the genuine Google-signed binary. The plugin does not verify a cryptographic signature.
- The user's shell profile does not contain a malicious `agy` shim. Standard `curl | bash` install hygiene applies.
- The OS keyring is not compromised (i.e. the user trusts the OS keychain, Secret Service, or Credential Manager).

If the `agy` binary is replaced by a malicious actor, the actor can read the prompt and the response (sent over plain subprocess pipes), but cannot steal the refresh token because the keyring access is bound to the `agy` executable's signature / path.

## Reporting a vulnerability

Please open a GitHub issue at https://github.com/m3nt1/antigravity-provider-for-opencode/issues for any non-critical security finding. For critical findings, contact the maintainer directly via the GitHub security advisory process (`/security/advisories/new`).

## Acknowledgments

The security model is informed by the audit of the equivalent Swift provider in [Sentient-OS-Labs/sentient-os](https://github.com/Sentient-OS-Labs/sentient-os), specifically `SECURITY_AUDIT.md §11` (multi-provider fork — provider-agnostic invariants). The subscription-only env strip invariant is identical; the only adaptation is the opencode-specific plain-text auth marker (vs. SENTIENT_OS's macOS-only Keychain approach).
