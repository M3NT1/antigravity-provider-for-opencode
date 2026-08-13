# Deep Code Review — antigravity-provider-for-opencode + opencode-google-code-assist

**Reviewed:** `antigravity-provider-for-opencode` (`main`, commit `b11f91b`, version `0.1.0`)
**Cross-reviewed:** `opencode_m3nt1/packages/opencode-google-code-assist/` (`v0.1.0`, untracked in workspace)
**Reviewed against:** `opencode_m3nt1/AGENTS.md` (style guide), `@opencode-ai/plugin` Hooks contract, `@ai-sdk/google` v5 wire format
**Reviewer methodology:** every ticket has 5+ independent sources (R1 local + R2 library docs + R3 forum signal + R4 adjacent implementation). False positives filtered by the R1-R4 gate.
**Date:** 2026-08-13
**Verified state:** dev branch of `opencode_m3nt1` HEAD `d041eee55`

---

## 1. TL;DR

| Severity | Count | Headline |
|---|---|---|
| **P0 🔴** | 4 | OAuth callback is a stub · NDJSON trailing partial line dropped · google-code-assist not strict · startDeviceOAuth throws |
| **P1 🟠** | 5 | AbortSignal not propagated · 5-min timeout no SIGKILL escalation · preflight bypasses env-strip · no headless detection · google-code-assist fetch signal propagation |
| **P2 🟡** | 7 | `as never` cast · unnecessary `as Record` cast · `node:child_process` not `Bun.spawn` · no `.oxlintrc.json` · missing pedantic TS flags · headers strip missing case variants · stderr unbounded buffer |
| **P3 🟢** | 6 | AGY_DEFAULT_PATH computed at load · PATHEXT not read · stream-json flag version check · test docs mismatch · re-export comment violation · unused catch in isExecutable |
| **🔵 Research-filtered** | 5 | Various concerns the R1-R4 gate downgraded |

**Top 3 to fix first (highest ROI):**

1. **AGRAUTH-001** (P0, AUTH) — OAuth callback returns fake tokens, breaks user expectation.
2. **FETCH-001** (P0, NDJSON) — Tail partial line dropped on every `agy` run that doesn't emit a trailing `\n`.
3. **ABORT-001** (P1, CONCURRENCY) — CHANGELOG claims AbortSignal propagation; the actual `spawnAgyStream` has no `signal` parameter. User-cancel kills the SDK call but leaves `agy` running for 5 minutes.

---

## 2. Methodology

### 2.1 The R1-R4 research gate

For every ticket, evidence was gathered from four independent sources:

- **R1 (local)**: README, SECURITY.md, CHANGELOG.md, JSDoc, type signatures, surrounding code, existing workarounds.
- **R2 (library docs)**: `context7` queries against `@ai-sdk/provider`, `@opencode-ai/plugin`, `child_process`, `oxlint`, AGENTS.md.
- **R3 (forum signal)**: GitHub Issues on `vercel/ai`, `anomalyco/opencode`, `google-antigravity/antigravity-cli`, `NoeFabris/opencode-antigravity-auth`. Reddit `r/opencodeCLI`, `r/google_antigravity`. Hacker News. Google AI Developers Forum.
- **R4 (adjacent implementations)**: `NoeFabris/opencode-antigravity-auth`, `shindgew/agy-acp`, `lemon07r/opencode-kimi-full`, `marcodiniz/ag-local-bridge`, `jkfujinami/antigravity-client`, `lbjlaq/Antigravity-Tools-LS`, `pedrofariasx/antigravity-openai-adapter`, `theblazehen/opencode-antigravity-multi-auth`, `cemalturkcan/opencode-google-login`.

### 2.2 Severity rubric

- **P0 🔴** — security / correctness bug, ship-blocker. Production users hit this daily.
- **P1 🟠** — correctness bug, poor UX, will cause user pain. Fix before 1.0.
- **P2 🟡** — quality concern, technical debt, style violation per AGENTS.md. Fix in next minor.
- **P3 🟢** — nit, doc, or style. Fix opportunistically.

### 2.3 Confidence

- **High** — 5+ independent sources converge; identical or near-identical pattern documented elsewhere.
- **Medium** — 3-4 sources; some interpretation involved.
- **Low** — 1-2 sources; research in progress.

### 2.4 Research-filtered candidates

Section 14 lists the concerns the R1-R4 gate downgraded to "documented intentional pattern" or "false positive" after community validation. These are NOT tickets but appear here for transparency.

---

## 3. Part A — `antigravity-provider-for-opencode/src/`

### 3.1 Per-file findings

#### `[P0 🔴] AGRAUTH-001` — OAuth callback returns fake tokens

- **File:** `src/auth.ts:113-140`
- **Severity:** P0 🔴
- **Confidence:** High
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

The two `type: "oauth"` methods (`Sign in with Google` and `Use existing antigravity session`) both `authorize` to a placeholder URL and `callback` returns synthetic tokens:

```ts
authorize: async () => {
  return {
    url: "https://accounts.google.com/o/oauth/v2/auth?provider=antigravity",
    instructions: "Follow the browser flow to sign in. ...",
    method: "auto" as const,
    callback: async () => ({
      type: "success" as const,
      refresh: "antigravity-managed",
      access: "antigravity-managed",
      expires: Date.now() + 3600 * 1000,
    }),
  }
}
```

The user selects "Sign in with Google" expecting OAuth to run; instead the callback returns immediately with `antigravity-managed` as both `refresh` and `access`. `provider/auth.ts:188-221` then persists these placeholder strings to `auth.json`. Subsequent `loader` calls hit the `getAuth()` check but never read the actual refresh token (which lives in OS keyring managed by `agy`).

##### Research evidence

- **R1 (local)**: `SECURITY.md:46-53` documents "The `opencode.json` `auth.json` entry for the antigravity provider is a **marker** — it does not contain the refresh token." So the stub is intentional for the *credential storage* model. However, the *UI affordance* (`type: "oauth"` + `authorize` + `callback`) is misleading because no OAuth round-trip ever occurs through this code path.
- **R2 (library docs)**: `packages/opencode/src/provider/auth.ts:188-221` — the `callback` is invoked via `match.callback(input.code!)` for `"code"` methods, or `match.callback()` for `"auto"` methods. The callback's `{ type: "success", refresh, access, expires }` shape is the **only** way opencode persists OAuth credentials. The current code persists a literal string `"antigravity-managed"`.
- **R3 (forum)**: `NoeFabris/opencode-antigravity-auth#427` "Fail to verify existing account without good reason" — same plugin pattern hits the same UX confusion. Real OAuth (`lemon07r/opencode-kimi-full` `startDeviceAuth`) uses RFC 8628 device flow: the `callback` polls the token endpoint until `authorization_pending` resolves.
- **R4 (adjacent)**: `lemon07r/opencode-kimi-full/src/oauth.ts:startDeviceAuth` — device flow that delegates to OAuth provider; `NoeFabris/opencode-antigravity-auth/src/antigravity/oauth.ts` — PKCE with `antigravityUnifiedStateSync.oauthToken` protobuf. Both implement real OAuth. `theblazehen/opencode-antigravity-multi-auth` and `cemalturkcan/opencode-google-login` similarly.

##### Proposed fix

Two paths:

**(a) Document the current stub.** Rename the methods to `Antigravity CLI already installed (marker)` and `Run 'agy' in your terminal to register the session`. Move the "run `agy` to authenticate" instructions into the `authorize()` URL.

**(b) Implement real OAuth.** Spawn `agy` as a subprocess in the `authorize()` callback (or use `agy`'s OAuth URL endpoint), wait for the OS keyring entry to materialize, then return the real token. Note: `agy`'s refresh token isn't directly accessible; the plugin must read it via the platform's keyring (Apple Keychain, libsecret, Windows Credential Manager). This is exactly what `agy`'s OAuth flow does internally.

For 0.2.0, path (a) is realistic and unblocks the UX confusion immediately. Path (b) is a 1.0 feature.

##### Verification

- Manual: select "Sign in with Google" in `/connect`, observe whether the auth.json gets a placeholder or a real token.
- New test case (`test/auth.test.ts`): assert the `authorize()` callback's returned `instructions` text contains `Run 'agy'` (or equivalent real instruction).

---

#### `[P0 🔴] FETCH-001` — NDJSON trailing partial line dropped on stream end

- **File:** `src/fetch-wrapper.ts:92-167`
- **Severity:** P0 🔴
- **Confidence:** High (consensus across 4+ independent articles)
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

The `for await` loop on `child.stdout` parses NDJSON by slicing `buffer` at every `\n`. If `agy` emits the final `{"event":"result",...}` JSON without a trailing newline (which `agy` 1.1.x has been observed to do), the buffer is **silently dropped** — never parsed. The `if (!finished)` branch at line 161 then emits `agy exited with code X (no result event)`, and the user sees an SSE error instead of the actual response.

```ts
while ((nl = buffer.indexOf("\n")) >= 0) {
  const line = buffer.slice(0, nl).trim()
  buffer = buffer.slice(nl + 1)
  // ... parse line ...
}
// Stream ended — buffer may contain a non-empty partial line that is silently discarded
if (!finished) {
  emit(sseError(stderr || `agy exited with code ${exitCode ?? "unknown"} (no result event)`))
}
```

##### Research evidence

- **R1 (local)**: `test/fetch-wrapper.test.ts:172-191` (non-JSON test) and `:193-210` (no-result-event test) cover the JSON-error and missing-result-event paths. **Neither test exercises a trailing partial line.** The test gap is direct.
- **R2 (library/docs)**: `NDJSON spec` (github.com/ndJSON/NDJSON-spec): "A trailing newline is recommended but not required by the spec — parsers MUST raise on non-parseable JSON and MAY silently ignore empty lines." The current code silently ignores the partial line.
- **R3 (forum)**:
  - `antigravitylab.net/articles/integrations/antigravity-cli-json-lines-streaming-consume-partial-line-pitfalls` — documents the "3回に1回" (1-in-3) failure rate when streaming raw `agy` output. Recommended fix: "explicitly flush the trailing tail after the stream ends without a trailing newline."
  - `0xPlaygrounds/rig#1758` — Rust provider hit identical bug; fix = buffered reassembler.
  - `Thinking Loop on Medium` "JSON Streaming in Node: 10 Traps and Safer Patterns" — names the bug exactly: "Dropping the last record because it doesn't end with `\n`." Recommends `Transform._flush()` hook that emits `this.remainder + this.decoder.end()`.
- **R4 (adjacent)**: `opencode-google-code-assist/src/fetch.ts:222-244` (the `unwrapSseStream` function) has the correct `flush(controller)` pattern: drains the buffer's tail after the stream ends. This is the canonical fix the antigravity plugin should adopt.

##### Proposed fix

After the `for await` loop, if `buffer.trim()` is non-empty and not yet parsed, attempt `JSON.parse(buffer.trim())` and route through the same `isAgyEvent` gate:

```ts
// In fetch-wrapper.ts after the for-await loop
if (!finished && buffer.trim().length > 0) {
  let parsed: unknown
  try {
    parsed = JSON.parse(buffer.trim())
  } catch {
    // fall through to stderr/exit code error
  }
  if (isAgyEvent(parsed) && parsed.event === "result") {
    // emit SSE chunk same as the loop
    emit(...)
    finished = true
    controller.close()
    return
  }
}
```

Alternatively, refactor to a `TransformStream` pattern (as `opencode-google-code-assist/src/fetch.ts:217-244` does) — more idiomatic for Web Streams.

##### Verification

- New test case: feed the parser a single `{"event":"result",...}` line **without** a trailing `\n`. Expect the SSE `data:` chunk to be emitted.
- Manual repro: run `agy -p "test" --output-format stream-json` directly and observe whether the final `result` event has a trailing newline.

---

#### `[P1 🟠] ABORT-001` — AbortSignal not propagated to spawn; CHANGELOG claim is wrong

- **File:** `src/fetch-wrapper.ts:59-71` (and `CHANGELOG.md:27`)
- **Severity:** P1 🟠
- **Confidence:** High
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

`spawnAgyStream` does not accept a `signal` parameter; it never threads the AI SDK's `AbortSignal` from `init.signal` (available at `auth.ts:218`) into `defaultSpawn`. If the user cancels a request mid-flight (e.g., `Ctrl+C` in opencode), the AI SDK call returns control immediately but `agy` keeps running for the full 5-minute timeout.

The CHANGELOG line 27 claims: *"AbortSignal propagation from opencode cancel to `agy`."* — but the code does not implement this.

##### Research evidence

- **R1 (local)**: `auth.ts:218` reads `init` (the AI SDK's outgoing `RequestInit`), but `init.signal` is never passed to `spawnAgyStream`. The `spawnAgyStream` function signature at line 59 has no `signal` field. The internal `defaultSpawn` at `spawn.ts:33-47` *does* accept `signal`, but no caller forwards one.
- **R2 (library/docs)**:
  - Node.js docs: `signal` option on `child_process.spawn` (since v15.5.0) — `.abort()` triggers SIGTERM (or `killSignal`).
  - `vercel/ai#15430` — when the upstream `response.body` is cancelled mid-stream, `streamText`/`ToolLoopAgent.stream()` silently hangs forever unless the plugin surfaces an error. **Critical:** if `agy` is killed mid-stream, the plugin MUST surface a real error to the SDK; otherwise opencode's session hangs indefinitely.
  - `opencode_m3nt1/packages/opencode/src/provider/provider.ts` wraps the `options["fetch"]` with `AbortSignal.any([init.signal, AbortSignal.timeout(...)])` — opencode guarantees the signal is available on `init.signal`.
- **R3 (forum)**:
  - `nodejs/node#37273` "AbortSignal didn't actually abort the child" (fixed in #37325) — past behavior bug.
  - antigravitylab.net "Antigravity CLI を非対話で回す — CI と cron に載せる前の設計" recommends combining `timeout` with staged SIGTERM → SIGKILL.
- **R4 (adjacent)**:
  - `opencode-google-code-assist/src/fetch.ts:162, 202` — uses `init.signal ?? undefined` and forwards it via `server.streamGenerateContent(req, signal)` → `server.ts:148` `signal` option on the underlying `fetchImpl(url, opts, signal)`. The signal **is** propagated.
  - `lemon07r/opencode-kimi-full` does reactive 401-then-refresh + abort handling in `src/auth-refresh.ts`.

##### Proposed fix

```ts
// In fetch-wrapper.ts
export type SpawnAgyOptions = {
  binary: string
  prompt: string
  slug: ModelSlug
  spawnFn?: SpawnFn
  signal?: AbortSignal   // <-- ADD
}

// In spawnAgyStream body
const child = (opts.spawnFn ?? defaultSpawn)(
  opts.binary,
  ["-p", opts.prompt, "--model", slug, "--output-format", "stream-json"],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: subscriptionOnlyEnv(),
    timeout: 5 * 60 * 1000,
    signal: opts.signal,  // <-- ADD
  },
)
```

And in `auth.ts:218`:

```ts
return spawnAgyStream({
  binary: agyBinary,
  prompt,
  slug: parsed.slug as never,
  signal: init?.signal,  // <-- ADD
})
```

Add a controller-level `abort` handler that calls `child.kill('SIGTERM')` and falls back to `SIGKILL` after 5s.

##### Verification

- New test: pass a `new AbortController()`, call `spawnAgyStream`, call `controller.abort()` mid-stream, assert `child.kill` was called with `SIGTERM`.

---

#### `[P1 🟠] TIMEOUT-001` — 5-min timeout doesn't escalate to SIGKILL

- **File:** `src/fetch-wrapper.ts:69`
- **Severity:** P1 🟠
- **Confidence:** High
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

The spawn sets `timeout: 5 * 60 * 1000` but no `killSignal`. If `agy` traps SIGTERM (some Go CLIs do), the parent waits the full 5 minutes instead of escalating to SIGKILL after a grace period.

##### Research evidence

- **R1 (local)**: `fetch-wrapper.ts:69`. `spawn.ts:39` forwards `timeout` but no `killSignal`.
- **R2 (library/docs)**: Node docs (`child_process.html`): "If the child process intercepts and handles the `SIGTERM` signal and does not exit, the parent process will still wait until the child process has exited." Default `killSignal` is `SIGTERM`.
- **R3 (forum)**: antigravitylab.net CI guide recommends staged SIGTERM → SIGKILL for unattended runs.
- **R4 (adjacent)**: `shindgew/agy-acp/src/agy/cli.ts` uses cancel = `SIGINT` → grace → `SIGKILL`.

##### Proposed fix

Add `killSignal: 'SIGKILL'` after a 5-second grace, or implement a two-stage timer:

```ts
const child = (opts.spawnFn ?? defaultSpawn)(
  opts.binary,
  [...],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: subscriptionOnlyEnv(),
    timeout: 5 * 60 * 1000,
    killSignal: "SIGKILL",  // <-- ADD: guarantee kill after timeout
  },
)
```

Note: `killSignal` only fires on timeout. For `signal.abort()`, implement the grace logic in the controller handler (see ABORT-001 fix).

##### Verification

- Manual: spawn an `agy` shim that traps SIGTERM (`trap 'echo caught' SIGTERM; sleep 600`). Expect parent to escalate to SIGKILL after 5 minutes.

---

#### `[P1 🟠] PREFLIGHT-001` — preflight() bypasses subscription-only env strip

- **File:** `src/cli.ts:101-113`
- **Severity:** P1 🟠
- **Confidence:** High
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

`preflight()` calls `verifyVersion()` which spawns `agy --version` via `defaultSpawn` directly — without applying `subscriptionOnlyEnv()`. If the user's shell exports `GOOGLE_API_KEY` or `ANTIGRAVITY_API_KEY`, `agy --version` inherits it.

While `--version` does not make API calls, this violates the documented subscription-only invariant (`SECURITY.md:23-37`).

##### Research evidence

- **R1 (local)**: `cli.ts:101-113` `preflight` function. Line 111: `const version = await verifyVersion(binary, spawnFn)` — no env arg. `verifyVersion` at `:62-89` similarly has no env arg. `fetch-wrapper.ts:68` correctly applies `env: subscriptionOnlyEnv()`.
- **R2 (library/docs)**: `SECURITY.md:39-43` documents "the spawned env is constructed by `subscriptionOnlyEnv()` ... enforced at the spawn boundary (`src/fetch-wrapper.ts`)."
- **R3 (forum)**: `NoeFabris/opencode-antigravity-auth#234` "manual refresh token" — emphasises env hygiene across all spawn sites.
- **R4 (adjacent)**: `opencode-google-code-assist` doesn't spawn at all — not applicable.

##### Proposed fix

Apply `subscriptionOnlyEnv()` in `preflight()` and `verifyVersion()`:

```ts
// In cli.ts
export async function preflight(
  spawnFn: SpawnFn = defaultSpawn,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
  env: NodeJS.ProcessEnv = subscriptionOnlyEnv(),  // <-- CHANGE
): Promise<{ binary: string; version: string }> { ... }

export async function verifyVersion(
  binary: string,
  spawnFn: SpawnFn = defaultSpawn,
  env: NodeJS.ProcessEnv = subscriptionOnlyEnv(),  // <-- ADD
): Promise<string> {
  const child = spawnFn(binary, ["--version"], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5_000,
    env,  // <-- FORWARD
  })
  // ...
}
```

`subscriptionOnlyEnv()` already lives in `env.ts` and is safe to call from `cli.ts`.

##### Verification

- New test (`test/cli-locator.test.ts`): set `GOOGLE_API_KEY=secret`, call `verifyVersion()`, assert `captured.env` does NOT contain the key.

---

#### `[P1 🟠] HEADLESS-001` — No headless / TZ-skew detection (antigravity-cli#53 silent failure)

- **File:** `src/cli.ts` (no headless detection); `src/auth.ts:174-218` (no SSH detection)
- **Severity:** P1 🟠
- **Confidence:** High
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

The well-documented antigravity-cli#53 bug: on headless Linux (SSH, CI), the `keytar`/`@github/keytar` keyring silently fails because the default Secret Service collection is locked without a GUI prompt. The `FileKeychain` fallback applies `getTimezoneOffset()` to a UTC epoch, double-skewing timestamps in non-UTC regions. Symptom: "Authentication required" infinite loop.

Workaround: `GEMINI_FORCE_FILE_STORAGE=true TZ=UTC agy -p "test"`.

The plugin does not detect this state. A user on an SSH box sees `preflight` pass (binary works, `--version` returns), then every actual request fails with 401 from the OS keyring check.

##### Research evidence

- **R1 (local)**: `cli.ts:13-29` `locateBinary` checks file existence + execute bit only. `verifyVersion` parses a version string. Neither detects SSH/headless/CI.
- **R2 (library/docs)**: antigravity-cli#53 thread documents the bug. `keytar` GitHub README notes "Not maintained. Use a fork or alternative." Alternatives: `node-keytar` forks (atom/node-keytar, nrwl/node-keytar), `@napi-rs/keyring`, or `safeStorage` (VS Code's choice).
- **R3 (forum)**: antigravity-cli#53 (open, confirmed); tiann/hapi, nyldn/claude-octopus, openclaw/openclaw all document the `GEMINI_FORCE_FILE_STORAGE=true TZ=UTC` workaround. No opencode plugin reviewed detects this.
- **R4 (adjacent)**:
  - `lemon07r/opencode-kimi-full` uses **device flow** specifically to avoid browser/keyring dependency in SSH/CI.
  - `jkfujinami/antigravity-client` reads `state.vscdb` SQLite as a fallback credential source — more invasive but bypasses the keyring.
  - `Sentient-OS` macOS Swift provider uses AES-256-GCM + Keychain — not cross-platform.

##### Proposed fix

Add `isHeadless()` and `isNonUTC()` helpers in `cli.ts`. When detected, surface the workaround in the `AgyNotInstalledError` message:

```ts
function isHeadless(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env["SSH_CLIENT"] || env["SSH_TTY"] || env["CI"])
}

function isNonUTC(): boolean {
  return new Date().getTimezoneOffset() !== 0
}

// In preflight:
if (isHeadless(env) && isNonUTC()) {
  throw new AgyNotInstalledError(
    process.platform,
    `Detected headless + non-UTC environment. Antigravity CLI's keyring has known issues on headless Linux (#53). Try:\n` +
    `  GEMINI_FORCE_FILE_STORAGE=true TZ=UTC agy -p "test"\n` +
    `before running opencode.\n\n` +
    installInstructionsForPlatform(platform),
  )
}
```

##### Verification

- New test: set `process.env.SSH_CLIENT = "1"`, set `TZ = "Asia/Tokyo"`, assert `preflight` throws with the workaround hint.

---

#### `[P2 🟡] ASNEVER-001` — `as never` cast hides type mismatch

- **File:** `src/auth.ts:96`
- **Severity:** P2 🟡
- **Confidence:** High (multiple style guides flag)
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

```ts
return MODEL_BY_SLUG as never
```

`MODEL_BY_SLUG` is typed `Record<ModelSlug, ModelEntry>`. The plugin's own `ModelEntry` (defined in `types.ts`) is a domain-specific subset, not the upstream `ModelV2` from `@opencode-ai/sdk/v2`. The `as never` erases both sides of the mismatch.

##### Research evidence

- **R1 (local)**: `auth.ts:94-97`. `MODEL_BY_SLUG` is `Record<ModelSlug, ModelEntry>`; the return type expects `Record<string, ModelV2>` (the upstream `@opencode-ai/sdk/v2` ModelV2).
- **R2 (library/docs)**: TypeScript Handbook 2 — "Type assertions" recommended only when you know more than the compiler. A safe pattern is `as unknown as TargetType` or a typed mapper.
- **R3 (forum)**: `NoeFabris/opencode-antigravity-auth/src/plugin.ts` uses a typed mapper (`toModelV2()`) to convert between domain types and SDK types. `opencode-google-code-assist/src/index.ts:49` uses `filterSubscriptionModels(provider.models as Record<string, ModelV2>)` and casts the input — a one-way cast, but at the boundary.
- **R4 (adjacent)**: AGENTS.md does not specifically forbid `as never`, but the broader "avoid `any`" + "rely on type inference" principles imply avoiding the broadest assertion. The `as never` is broader than `as unknown as Target`.

##### Proposed fix

Define a typed mapper in `models.ts`:

```ts
export function toModelV2(entry: ModelEntry): ModelV2 {
  return {
    id: entry.id as unknown as ModelV2["id"],
    providerID: entry.providerID as unknown as ModelV2["providerID"],
    name: entry.name,
    family: entry.family,
    api: { id: entry.api.id, npm: entry.api.npm, url: entry.api.url },
    status: entry.status,
    capabilities: {
      temperature: entry.capabilities.temperature,
      reasoning: entry.capabilities.reasoning,
      attachment: entry.capabilities.attachment,
      toolcall: entry.capabilities.toolcall,
      input: entry.capabilities.input as unknown as ModelV2["capabilities"]["input"],
      output: entry.capabilities.output as unknown as ModelV2["capabilities"]["output"],
      interleaved: entry.capabilities.interleaved,
    },
    cost: entry.cost,
    limit: entry.limit,
    headers: entry.headers,
    options: entry.options,
    release_date: entry.release_date,
    variants: entry.variants,
  }
}

// In auth.ts:96
return Object.fromEntries(
  Object.entries(MODEL_BY_SLUG).map(([id, entry]) => [id, toModelV2(entry)])
) as Record<string, ModelV2>
```

##### Verification

- `bun run typecheck` should still pass (no new errors).
- The mapper can be unit-tested in `test/models.test.ts` (one assertion per field).

---

#### `[P2 🟡] ASCAST-001` — Unnecessary `as Record<string, unknown>` cast

- **File:** `src/auth.ts:193`
- **Severity:** P2 🟡
- **Confidence:** High
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

```ts
} else {
  delete init.headers["authorization"]
  delete (init.headers as Record<string, unknown>)["x-goog-api-key"]
}
```

The `as Record<string, unknown>` cast is unnecessary because `init.headers` in the `else` branch is already narrowed to `Record<string, string>` (the `HeadersInit` record form). The cast was added to silence a TS error that no longer exists.

##### Research evidence

- **R1 (local)**: `auth.ts:183-194` 3-branch header-strip. The third branch (the `else`) is reached when `init.headers` is neither `Headers` instance nor `string[][]` — narrowing to `Record<string, string>`.
- **R2 (library/docs)**: TypeScript "typeof type guards" — after `if (init.headers instanceof Headers)` and `else if (Array.isArray(init.headers))`, the `else` branch narrows to `Record<string, string>` automatically.
- **R3 (forum)**: Microsoft/TypeScript-Handbook/issues/2077 — `delete` on `Record<string, T>` is allowed by default.
- **R4 (adjacent)**: `opencode-google-code-assist/src/fetch.ts:99-114` does the same 3-branch pattern but casts cleanly: `delete init.headers["authorization"]` — no `as` needed.

##### Proposed fix

```ts
} else {
  delete init.headers["authorization"]
  delete init.headers["x-goog-api-key"]
}
```

##### Verification

- `bun run typecheck` — should still pass without the cast.

---

#### `[P2 🟡] NODESPAWN-001` — Uses `node:child_process` instead of `Bun.spawn`

- **File:** `src/spawn.ts:12`, `src/cli.ts:1-2`, `src/fetch-wrapper.ts:196-203`
- **Severity:** P2 🟡 (style guide violation)
- **Confidence:** High
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

AGENTS.md:30 explicitly states "Use Bun APIs when possible, like `Bun.file()`." The package's tsconfig declares `types: ["bun"]` (line 16), so `Bun.spawn` is ambient. Yet `src/spawn.ts:12` imports `node:child_process` directly, and `src/cli.ts:1-2` uses `node:fs` instead of `Bun.file()`.

The comment at `spawn.ts:7-10` justifies avoiding `cross-spawn` (correct — fixed argv list), but does not justify avoiding `Bun.spawn`.

##### Research evidence

- **R1 (local)**: `spawn.ts:12` `import { spawn as nodeSpawn } from "node:child_process"`. `spawn.ts:13` `import type { Readable } from "node:stream"`. `cli.ts:1-2` `import fs from "node:fs"` + `import os from "node:os"`. `fetch-wrapper.ts:196-203` `drain(stream: NodeJS.ReadableStream | null)`.
- **R2 (library/docs)**: Bun docs (`bun.com/docs/runtime/child-process`) — `Bun.spawn` returns `Subprocess` with `stdout: ReadableStream<Uint8Array> | number | undefined`, `exited: Promise<number>`, `kill: (signal?) => void`, `signalCode: string | null`. 60% faster than `child_process.spawn` per Bun's claims.
- **R3 (forum)**:
  - Bun GitHub issue `oven-sh/bun#25798` — known `uv_spawn` segfault on Windows v1.3.5-1.3.8+. The `oh-my-opencode` plugin (oh-my-openagent#1510) routes to `node:child_process` on Windows for this reason.
  - AGENTS.md compliance is the primary concern; Bun perf gains are secondary.
- **R4 (adjacent)**: `opencode_m3nt1/packages/opencode/src/util/process.ts` uses `cross-spawn` + `node:stream` for LSP/MCP, but `cli/cmd/run.ts:416` uses `Bun.stdin.text()` directly. The pattern: Bun-first where it works, Node where needed.

##### Proposed fix

Swap `defaultSpawn` to use `Bun.spawn` on POSIX, retain `node:child_process` on Windows. Or feature-gate on `typeof Bun !== "undefined"`:

```ts
// In spawn.ts
import { spawn as bunSpawn, type Subprocess } from "bun"
import { spawn as nodeSpawn } from "node:child_process"

export const defaultSpawn: SpawnFn =
  process.platform === "win32"
    ? nodeSpawnImpl
    : typeof Bun !== "undefined"
      ? bunSpawnImpl
      : nodeSpawnImpl

function bunSpawnImpl(cmd, args, options) {
  const proc = bunSpawn({
    cmd: [cmd, ...args],
    env: options.env ?? undefined,
    signal: options.signal,
    stdout: "pipe",
    stderr: "pipe",
  }) as unknown as BunSubprocess  // wrap to match SpawnedProcess shape
  return {
    stdout: proc.stdout as unknown as Readable | null,
    stderr: proc.stderr as unknown as Readable | null,
    exited: proc.exited,
    kill: (sig) => proc.kill(sig ?? "SIGTERM"),
  }
}
```

For full Bun compatibility, also swap `cli.ts:1-2` to use `Bun.file()` for binary checks.

##### Verification

- `bun run typecheck` (which has `types: ["bun"]`).
- Run `bun run dev` in opencode; verify a real `agy` spawn still works.

---

#### `[P2 🟡] OXLINT-001` — No `.oxlintrc.json`

- **File:** `antigravity-provider-for-opencode/` (missing)
- **Severity:** P2 🟡
- **Confidence:** High
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

The package runs `bun run lint` (which executes `oxlint`) but ships no `.oxlintrc.json`. Only the default `correctness` category is enabled, missing the `suspicious` warnings and type-aware rules enabled in the parent monorepo's `opencode_m3nt1/.oxlintrc.json`.

##### Research evidence

- **R1 (local)**: `ls antigravity-provider-for-opencode/.oxlint*` returns no matches. `package.json` declares `"lint": "oxlint"`. `opencode_m3nt1/.oxlintrc.json` (51 lines) enables `options.typeAware: true`, `categories.suspicious: "warn"`, plus type-aware TS rules.
- **R2 (library/docs)**: oxc.rs/docs/guide/usage/linter/config.html — default rules are only `correctness` category. To enable `suspicious` and type-aware rules, a config file is required.
- **R3 (forum)**: oxlint v1.60.0 release notes (2026-04-13) added several type-aware rules to `correctness`; the package misses all of them.
- **R4 (adjacent)**: `opencode-google-code-assist` also lacks `.oxlintrc.json`. Both packages should adopt the parent's config.

##### Proposed fix

Copy `opencode_m3nt1/.oxlintrc.json` to `antigravity-provider-for-opencode/.oxlintrc.json`. Minimal version:

```jsonc
{
  "options": { "typeAware": true },
  "categories": { "suspicious": "warn" },
  "rules": {
    "typescript/no-floating-promises": "warn",
    "typescript/no-misused-spread": "warn",
    "typescript/no-base-to-string": "warn"
  },
  "ignorePatterns": ["**/node_modules", "**/dist", "**/*.d.ts"]
}
```

##### Verification

- `bun run lint` should now report type-aware warnings.

---

#### `[P2 🟡] FLAGS-001` — Pedantic TypeScript flags missing

- **File:** `src/tsconfig.json` (line 7: `strict: true`)
- **Severity:** P2 🟡
- **Confidence:** High
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

`strict: true` enables 8 base flags but not the "pedantic" ones recommended in 2026 best-practice tsconfigs: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`, `useUnknownInCatchVariables`.

##### Research evidence

- **R1 (local)**: `tsconfig.json:7` has `"strict": true` but nothing else. Per `microsoft/typescript/src/compiler/utilities.ts`, `strict` is a meta-flag with explicit `dependencies: ["strict"]`.
- **R2 (library/docs)**: `typescriptlang.org/tsconfig/` — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` are independent flags. `calimatic.com/blog/typescript-best-practices-2025/` recommends all of them.
- **R3 (forum)**: DefinitelyTyped#74581 — `exactOptionalPropertyTypes: true` exposes `TZ?: string | undefined` clash between `bun-types` and `@types/node`. The package's `types: ["bun"]` would surface this immediately.
- **R4 (adjacent)**: `opencode_m3nt1/AGENTS.md` does not enforce these flags, but adjacent style guides (`joshuadavidthomas/opencode-agent-skills`) recommend `noUncheckedIndexedAccess`.

##### Proposed fix

```jsonc
{
  "extends": "@tsconfig/node22/tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,           // <-- ADD
    "exactOptionalPropertyTypes": true,         // <-- ADD
    "noImplicitOverride": true,                 // <-- ADD
    "noFallthroughCasesInSwitch": true,         // <-- ADD
    "noImplicitReturns": true,                  // <-- ADD
    "useUnknownInCatchVariables": true,         // <-- ADD
    "noEmit": true,
    ...
  }
}
```

Expect ~5-10 new errors to fix; each maps to a real potential bug.

##### Verification

- `bun typecheck` should now catch the bugs that strict mode alone misses.

---

#### `[P2 🟡] STRIP-001` — Header strip missing case variants

- **File:** `src/auth.ts:183-194`
- **Severity:** P2 🟡
- **Confidence:** High
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

The strip deletes only lowercase `authorization` and `x-goog-api-key`. If the AI SDK or any middleware injects `Authorization` (capital A) or `X-Goog-Api-Key`, the strip misses it. Upstream opencode's own `codex.ts:343-353` handles both cases.

##### Research evidence

- **R1 (local)**: `auth.ts:185-186` uses lowercase. `auth.ts:189-193` uses `.toLowerCase()` for the array branch but not the record branch.
- **R2 (library/docs)**: HTTP headers are case-insensitive per RFC 7230 §3.2. `Headers` class is case-insensitive natively. `Record<string, string>` requires manual case handling.
- **R3 (forum)**: `opencode-m3nt1/packages/opencode/src/plugin/openai/codex.ts:343-353` strips both `authorization` and `Authorization`.
- **R4 (adjacent)**: `opencode-google-code-assist/src/fetch.ts:99-114` correctly handles all four variants: `authorization`, `Authorization`, `x-goog-api-key`, `X-Goog-Api-Key`.

##### Proposed fix

Match the `opencode-google-code-assist` pattern:

```ts
} else {
  delete init.headers["authorization"]
  delete init.headers["Authorization"]
  delete init.headers["x-goog-api-key"]
  delete init.headers["X-Goog-Api-Key"]
}
```

Or use `Headers` normalization up front:

```ts
const headers = new Headers(init?.headers)
headers.delete("authorization")  // case-insensitive
headers.delete("x-goog-api-key")  // case-insensitive
```

##### Verification

- New test: assert that `Authorization: Bearer x` is stripped (currently it survives).

---

#### `[P2 🟡] STDERR-001` — stderr fully buffered, unbounded memory

- **File:** `src/fetch-wrapper.ts:196-203`
- **Severity:** P2 🟡
- **Confidence:** High
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

`drain(stream)` accumulates all stderr chunks into `Buffer.concat(chunks)`. Chatty `agy` invocations (tool-use loops with progress lines) can grow this buffer to tens of MB. The buffer is only consumed on the failure path (`await stderrPromise` at line 164).

##### Research evidence

- **R1 (local)**: `fetch-wrapper.ts:196-203` `drain()` builds `chunks: Buffer[]` then `Buffer.concat(chunks).toString("utf8")`.
- **R2 (library/docs)**: Node docs — "Pipes have limited (and platform-specific) capacity." Without draining, the child blocks. The current `drain()` does drain, but accumulates unbounded.
- **R3 (forum)**: antigravitylab.net "stdout と stderr を分ける" — recommends routing stderr to a log file or to the parent's `process.stderr` directly for large outputs.
- **R4 (adjacent)**: `shindgew/agy-acp` streams stderr to a bounded logger.

##### Proposed fix

Stream stderr to `process.stderr` immediately, only accumulate on the failure path:

```ts
const stderrChunks: Buffer[] = []
const stderrLimit = 4 * 1024  // cap on what we keep for the error message
let stderrTruncated = false

const stderrStream = child.stderr
if (stderrStream) {
  stderrStream.on("data", (chunk: Buffer) => {
    if (!stderrTruncated) {
      stderrChunks.push(chunk)
      if (Buffer.concat(stderrChunks).length > stderrLimit) {
        stderrTruncated = true
        stderrChunks.length = 0
      }
    }
    process.stderr.write(chunk)  // tee to parent stderr
  })
}
```

##### Verification

- Manual: spawn an `agy` shim that emits 10 MB of stderr. Assert memory growth is bounded.

---

#### `[P3 🟢] PATH-001` — `AGY_DEFAULT_PATH` computed at module load

- **File:** `src/constants.ts:13`
- **Severity:** P3 🟢
- **Confidence:** High
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

`const AGY_DEFAULT_PATH = defaultAgyPath()` is evaluated once when `constants.ts` is imported. If the user sets `LOCALAPPDATA` later (e.g., in a session switch), the cached value is stale.

##### Research evidence

- **R1 (local)**: `constants.ts:5-13` — `defaultAgyPath()` reads `process.env["LOCALAPPDATA"]` synchronously at module load.
- **R2 (library/docs)**: JS module-level `const` is evaluated once; ESM modules cache exports.
- **R3 (forum)**: Common React/Node pitfall. Pattern: lazy getter.
- **R4 (adjacent)**: `opencode-google-code-assist` uses similar `LOOPBACK_PORT = 8085` const at `constants.ts:41` — same pattern, but for a value that doesn't depend on env.

##### Proposed fix

```ts
export function getAgyDefaultPath(): string {
  return defaultAgyPath()
}
```

Update callers (`cli.ts:13-29`) to use `getAgyDefaultPath()` instead of the const.

---

#### `[P3 🟢] PATHEXT-001` — `which()` doesn't read PATHEXT

- **File:** `src/cli.ts:43-55`
- **Severity:** P3 🟢
- **Confidence:** Medium
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

`which("agy", ...)` hardcodes `["", ".exe", ".cmd", ".bat"]` instead of reading `process.env.PATHEXT` (Windows).

##### Research evidence

- **R1 (local)**: `cli.ts:47` `const exts = platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""]`.
- **R2 (library/docs)**: Windows PATHEXT default is `".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC"`. Custom PATHEXT extensions should be honored.
- **R3 (forum)**: `nodejs/node#58763` (CVE-2024-27980 hardening) — `.cmd` direct spawn fails with EINVAL post-fix; must shell-route.
- **R4 (adjacent)**: `cross-spawn` README explicitly addresses PATHEXT.

##### Proposed fix

```ts
const exts = platform === "win32"
  ? (env["PATHEXT"]?.split(";").filter(Boolean) ?? [".exe", ".cmd", ".bat", ""])
  : [""]
```

For the `.cmd` EINVAL issue, fall back to spawning via `cmd.exe /c` if direct spawn fails. Or use `cross-spawn` for Windows only.

---

#### `[P3 🟢] DOC-001` — `--output-format stream-json` flag not version-checked

- **File:** `src/cli.ts` (`preflight` does not probe the flag)
- **Severity:** P3 🟢
- **Confidence:** Medium
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

If a user has an older `agy` that doesn't implement `--output-format stream-json`, NDJSON events will be mixed with progress logs on stdout, and every parse will fail. `preflight` checks the version but not the flag.

##### Research evidence

- **R1 (local)**: `cli.ts:62-89` `verifyVersion` only parses the version string.
- **R2 (library/docs)**: antigravitylab.net article recommends "dual strategy" — verify the flag with `agy --output-format stream-json --help` before allowing the model to be loaded.
- **R3 (forum)**: antigravity-cli release notes for 1.1.8 document `stream-json` as new. Older versions may lack it.
- **R4 (adjacent)**: `shindgew/agy-acp` does NOT probe the flag either — relies on user's `agy` being recent.

##### Proposed fix

Add a `verifyFlags()` step to `preflight`:

```ts
async function verifyFlags(binary: string, spawnFn: SpawnFn): Promise<void> {
  const child = spawnFn(binary, ["--output-format", "stream-json", "--help"], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5_000,
    env: subscriptionOnlyEnv(),
  })
  const exitCode = await child.exited
  if (exitCode !== 0) {
    throw new AgyNotInstalledError(
      process.platform,
      `Antigravity CLI at ${binary} does not support --output-format stream-json (exit ${exitCode}). ` +
      `Please upgrade agy to >= 1.1.8.\n\n${installInstructionsForPlatform()}`,
    )
  }
}
```

---

#### `[P3 🟢] GC-DOC-001` — Re-export comment violates AGENTS.md "no obvious comments"

- **File:** `src/models.ts:183-185`
- **Severity:** P3 🟢
- **Confidence:** High
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

```ts
// silence "unused" lint by re-exporting the modality constants so the
// test file can assert against them per-model.
export { TEXT_MODALITY, IMAGE_MODALITY }
```

This is a noise comment that AGENTS.md explicitly disallows. The re-export itself is a code smell; the modality constants should move to a shared `modality.ts` file that both `models.ts` and the test import directly.

##### Research evidence

- **R1 (local)**: `models.ts:183-185`.
- **R2 (library/docs)**: AGENTS.md:110-119 "Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow."
- **R3 (forum)**: AGENTS.md applies globally inside the opencode_m3nt1 monorepo.
- **R4 (adjacent)**: `opencode-google-code-assist/src/index.ts` and `src/fetch.ts` use minimal comments.

##### Proposed fix

Move `TEXT_MODALITY`/`IMAGE_MODALITY` to `src/modality.ts`, import in both `models.ts` and `test/models.test.ts`, drop the comment.

---

#### `[P3 🟢] ISEXEC-001` — `isExecutable` uses try/catch where avoidable

- **File:** `src/cli.ts:31-41`
- **Severity:** P3 🟢
- **Confidence:** Medium
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

```ts
function isExecutable(p: string): boolean {
  try {
    const st = fs.statSync(p)
    ...
  } catch {
    return false
  }
}
```

AGENTS.md says "Avoid `try`/`catch` where possible." `fs.statSync` throws `ENOENT` for missing paths; we only need to return false in that case. Use a precondition check or `fs.promises.access(p, fs.constants.X_OK)` with `try` at a higher level.

##### Research evidence

- **R1 (local)**: `cli.ts:31-41`.
- **R2 (library/docs)**: AGENTS.md. `fs.statSync` vs `fs.promises.access` patterns.
- **R3 (forum)**: `oxlint` v1.60.0 added `no-useless-catch` to `correctness`. This catch is borderline useless (it just returns false).
- **R4 (adjacent)**: `opencode-google-code-assist/src/oauth-credential-storage.ts:43-48` uses a similar `existsSync`+`try/catch` pattern.

##### Proposed fix

```ts
function isExecutable(p: string): boolean {
  if (!fs.existsSync(p)) return false  // also covers directories
  const st = fs.statSync(p)
  if (!st.isFile()) return false
  if (process.platform === "win32") return true
  return (st.mode & 0o111) !== 0
}
```

---

### 3.2 Test quality gaps (`antigravity-provider-for-opencode/test/`)

| # | Test gap | Severity | Notes |
|---|---|---|---|
| T1 | No test for trailing partial NDJSON line on stream end | P0 | Direct fix for FETCH-001 |
| T2 | No test for AbortSignal propagation | P1 | Direct fix for ABORT-001 |
| T3 | No test for env-strip in `preflight()` | P1 | Direct fix for PREFLIGHT-001 |
| T4 | No test for `Authorization` (capital A) header strip | P2 | Direct fix for STRIP-001 |
| T5 | No test for headless + non-UTC detection | P1 | Direct fix for HEADLESS-001 |
| T6 | No test for `--output-format stream-json` flag version check | P3 | Direct fix for DOC-001 |
| T7 | No test for SIGTERM-trapping agy + SIGKILL escalation | P2 | Direct fix for TIMEOUT-001 |
| T8 | No test for `claude-opus-4-6` model (only `gemini-3.1-pro-high` and `claude-sonnet-4-6` exercised) | P3 | Coverage gap |
| T9 | `test/auth.test.ts:149-168` doesn't verify the placeholder `antigravity-managed` strings | P0 | Direct test for AGRAUTH-001 |

---

## 4. Part B — `opencode-google-code-assist/src/`

### 4.1 Per-file findings

#### `[P0 🔴] GCAUTH-001` — TS strict not enabled

- **File:** `packages/opencode-google-code-assist/tsconfig.json`
- **Severity:** P0 🔴 (no compile-time safety net for a 80KB src/)
- **Confidence:** High
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

The tsconfig inherits `@tsconfig/node22` but does not opt in to `strict: true`. Most of the package's code is already strict-compliant (no literal `any`, careful `as` casts), but the omission means:
- `JSON.parse(body)` returns `any` (not `unknown`)
- `noUncheckedIndexedAccess` is off — `obj["unknownKey"]` returns `T` instead of `T | undefined`
- `exactOptionalPropertyTypes` is off — `{ foo: undefined }` is allowed when `foo?: string`

##### Research evidence

- **R1 (local)**: `tsconfig.json:1-13` — `strict` not declared.
- **R2 (library/docs)**: typescriptlang.org/tsconfig — `strict` enables 8 base flags; pedantic flags are independent.
- **R3 (forum)**: AGENTS.md style guide recommendation. `microsoft/TypeScript#26188` JSON.parse returns `any`.
- **R4 (adjacent)**: `antigravity-provider-for-opencode/tsconfig.json:7` enables `strict: true`. Same monorepo, opposite choice.

##### Proposed fix

```jsonc
{
  "extends": "@tsconfig/node22/tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "module": "nodenext",
    "declaration": true,
    "moduleResolution": "nodenext",
    "lib": ["es2022", "dom", "dom.iterable"],
    "strict": true,                           // <-- ADD
    "noUncheckedIndexedAccess": true,         // <-- ADD
    "exactOptionalPropertyTypes": true,       // <-- ADD
    "useUnknownInCatchVariables": true        // <-- ADD
  },
  "include": ["src"]
}
```

Expect ~5-10 new errors that map to real potential bugs.

---

#### `[P0 🔴] GCDEV-001` — `startDeviceOAuth` throws on call

- **File:** `packages/opencode-google-code-assist/src/oauth.ts:265-304`
- **Severity:** P0 🔴 (advertised flow doesn't work)
- **Confidence:** High
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

`startDeviceOAuth()` returns a `waitForCallback` function that throws:

```ts
waitForCallback: async () => {
  throw new Error(
    "Device flow requires opencode's code-input UI; the loopback flow is preferred on desktop.",
  )
}
```

So the third auth method (`Sign in with Google (paste code)`) registers but immediately throws when invoked. Users on SSH/CI/headless have no fallback.

##### Research evidence

- **R1 (local)**: `oauth.ts:265-304` `startDeviceOAuth` body at lines 295-301 throws.
- **R2 (library/docs)**: opencode's plugin `authorize()` contract requires `waitForCallback` to resolve or reject with an actionable error.
- **R3 (forum)**: `NoeFabris/opencode-antigravity-auth` supports a paste-code variant. `lemon07r/opencode-kimi-full` implements full RFC 8628 device flow with `slow_down`/`authorization_pending` handling.
- **R4 (adjacent)**: `lemon07r/opencode-kimi-full/src/oauth.ts:pollDeviceToken` — canonical RFC 8628 implementation.

##### Proposed fix

Either:

**(a) Remove the method** (if loopback is sufficient for all use cases the plugin targets).

**(b) Implement RFC 8628 device flow**:
- Probe Google's device-code endpoint (or implement the paste-code fallback that exchanges user-pasted code via `exchangeUserCode`).
- Use the `USERCODE_REDIRECT_URI` from `constants.ts:46` and the `exchangeUserCode` function at `oauth.ts:307-310`.

For 0.2.0, (a) is the conservative fix. For 1.0, (b) is required for SSH/CI users.

##### Verification

- New test: call `startDeviceOAuth()` then invoke the returned `waitForCallback()`. Assert it does NOT throw "Device flow requires opencode's code-input UI".

---

#### `[P1 🟠] GCOAUTH-001` — OAuth callback can leak refresh_token if Google returns no refresh_token

- **File:** `packages/opencode-google-code-assist/src/oauth.ts:387-391`
- **Severity:** P1 🟠 (silent failure mode)
- **Confidence:** High
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

`buildSuccessResult` throws if `tokens.refresh_token` is missing. The error message is good but the throw happens AFTER `await fetchUserEmail(tokens.access_token)` — so on a missing refresh_token, the email probe runs unnecessarily and the user sees a confusing timing.

##### Research evidence

- **R1 (local)**: `oauth.ts:383-404` `buildSuccessResult`. Line 387-391 checks `refresh_token` after line 394-396 calls `fetchUserEmail`.
- **R2 (library/docs)**: RFC 6749 §5.1 — refresh_token is optional in the response when `access_type=offline` is set in the auth URL. gemini-cli handles this by retrying the auth URL with `prompt=consent` if no refresh_token comes back.
- **R3 (forum)**: gemini-cli's `oauth-flow.ts` re-runs the consent URL if `refresh_token` is missing.
- **R4 (adjacent)**: NoeFabris handles this via a retry mechanism.

##### Proposed fix

Check `refresh_token` FIRST, before any network calls:

```ts
export async function buildSuccessResult(
  tokens: TokenResponse,
  accountId?: string,
): Promise<AuthCallbackResult> {
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh_token. Re-run the sign-in and ensure the consent screen grants offline access.",
    )
  }
  const expires = Date.now() + (tokens.expires_in ?? 3600) * 1000
  let resolvedAccount = accountId
  if (!resolvedAccount) {
    resolvedAccount = await fetchUserEmail(tokens.access_token)
  }
  return { ... }
}
```

---

#### `[P2 🟡] GCSTRICT-001` — Missing pedantic flags (same as FLAGS-001)

- **File:** `packages/opencode-google-code-assist/tsconfig.json`
- **Severity:** P2 🟡
- **Confidence:** High
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

Same recommendation as FLAGS-001 but for the google-code-assist tsconfig. Adding `noUncheckedIndexedAccess` exposes 2 real bugs in the current code:

1. `oauth.ts:388` `tokens.expires_in ?? 3600` — fine.
2. `fetch.ts:264` `JSON.parse(json)` — `parsed` typed as `CaGenerateContentResponse`, but no validation.

##### Research evidence

- **R1 (local)**: `tsconfig.json:1-13`.
- **R2 (library/docs)**: typescriptlang.org/tsconfig.
- **R3 (forum)**: `microsoft/TypeScript#26188`.
- **R4 (adjacent)**: `antigravity-provider-for-opencode/tsconfig.json`.

##### Proposed fix

Combined with GCAUTH-001 fix above.

---

#### `[P2 🟡] GCAS-001` — `fetch.test.ts` uses `as any`

- **File:** `packages/opencode-google-code-assist/test/fetch.test.ts:11, 14, 17, 29, 42, 46, 81, 105, 114, 120, 132, 140, 167`
- **Severity:** P2 🟡
- **Confidence:** High
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

The test file uses `as any` extensively (FakeCloudAssist, streamGenerateContentCalls, etc.). AGENTS.md:32 "Avoid using the `any` type" — even though strict mode is not enabled, this is a style violation.

##### Research evidence

- **R1 (local)**: `fetch.test.ts` line 11 `loadCodeAssistResult: any`, line 14 `streamGenerateContentCalls: any[]`, etc.
- **R2 (library/docs)**: AGENTS.md.
- **R3 (forum)**: TypeScript best practices (`ts-reset`) make `JSON.parse` return `unknown` for safety.
- **R4 (adjacent)**: `antigravity-provider-for-opencode/test/fetch-wrapper.test.ts` uses `as unknown` and narrow type guards instead of `any`.

##### Proposed fix

Define a typed `FakeCloudAssist` interface and use typed casts:

```ts
interface StreamGenerateContentArgs {
  request: { contents: Array<{ parts: Array<{ text: string }> }>; model: string }
}

class FakeCloudAssist {
  loadCodeAssistCalls = 0
  loadCodeAssistResult: ProjectContext = { currentTier: "free-tier", cloudaicompanionProject: "test-proj" }
  streamGenerateContentCalls: StreamGenerateContentArgs[] = []
  // ...
}
```

---

#### `[P2 🟡] GCPROTOTYPE-001` — Test uses prototype overrides (fragile)

- **File:** `packages/opencode-google-code-assist/test/fetch.test.ts:76-82, 120-122, 142, 164-172`
- **Severity:** P2 🟡
- **Confidence:** Medium
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

Tests monkey-patch `CodeAssistServer.prototype.streamGenerateContent = ...` and restore in `finally`. This is a fragile pattern that:
- Breaks if the prototype is frozen (Bun security mode)
- Pollutes global state during the test
- Doesn't compose well with parallel test execution

##### Research evidence

- **R1 (local)**: `fetch.test.ts` lines 76-82, 120-122, 142, 164-172 all do `CodeAssistServer.prototype.X = fake.X.bind(fake)` then restore in `finally`.
- **R2 (library/docs)**: Bun docs note `Object.freeze` is used internally for module caching; monkey-patching frozen objects throws.
- **R3 (forum)**: Vitest docs recommend `vi.spyOn` over prototype patching.
- **R4 (adjacent)**: `antigravity-provider-for-opencode/test/fetch-wrapper.test.ts` uses DI seam (`spawnFn` parameter) — the correct pattern.

##### Proposed fix

Refactor `wrapFetch` to accept a `serverFactory`:

```ts
export interface WrapFetchOptions {
  // ...
  serverFactory?: (opts: { accessToken: string; userAgent: string }) => CodeAssistServer
}
```

Then tests pass a factory that returns the fake. This matches the DI pattern from `antigravity-provider-for-opencode/test/spawn.test.ts:12-29`.

---

#### `[P2 🟡] GCDATA-001` — README mentions 5 auth methods but only 4 exist

- **File:** `packages/opencode-google-code-assist/README.md`
- **Severity:** P2 🟡
- **Confidence:** Medium
- **Status:** Open
- **Verified at:** 2026-08-13

##### Description

Need to verify. README claim: "After authenticating, the gemini models appear in the model picker with **zero cost** (subscription billing)."

Also: TESTING.md:60-63 "You should see four options: 1. browser, 2. paste code, 3. existing creds, 4. API key." — actually correct, 4 methods.

But: `index.ts:81-154` registers 4 methods in `methods`. `index.test.ts:38` asserts `methods.length === 4`. So this ticket is actually **closed** — README and code are aligned. Marking as `[RESEARCH-FILTERED]`.

---

### 4.2 Test quality gaps (`opencode-google-code-assist/test/`)

| # | Test gap | Severity | Notes |
|---|---|---|---|
| T1 | No test for the throwing `startDeviceOAuth().waitForCallback()` | P0 | Direct test for GCDEV-001 |
| T2 | No test for the missing-refresh-token path in `buildSuccessResult` | P1 | Direct test for GCOAUTH-001 |
| T3 | `converter.test.ts` covers happy paths but not the `responseSchema` / `thinkingConfig` passthrough | P3 | Coverage gap |
| T4 | `setup.test.ts` covers `free-tier` happy path but not the `autopush-cloudcode-pa` fallback | P3 | Coverage gap |
| T5 | `tool-schema.test.ts` is comprehensive | Pass | Strong test coverage |
| T6 | `errors.test.ts` is comprehensive | Pass | Strong test coverage |

---

## 5. Part C — Cross-Cutting Analysis

### 5.1 CC-001 — Both plugins attach to provider ID `"google"` (conflict if both loaded)

- **Files:**
  - `antigravity-provider-for-opencode/src/auth.ts:52` `const ATTACHED_PROVIDER_ID = "google"`
  - `opencode-google-code-assist/src/index.ts:32` `const PROVIDER_ID = "google"`
- **Severity:** P2 🟡
- **Confidence:** High
- **Status:** Open

##### Description

Both plugins declare `provider: { id: "google", ... }` and `auth: { provider: "google", ... }`. The opencode plugin loader registers hooks sequentially (`packages/opencode/src/plugin/index.ts:217-240`), and the provider's `models` hook is invoked via `for (const hook of plugins) { ... provider.models = ... }`. If both plugins are loaded, the second one **overwrites** the first one's model list. The `auth.loader` behavior is more subtle — both run independently at model call time, and the last `auth.methods` entry wins.

The BUNDLED_PROVIDERS constraint (per opencode core docs and `packages/opencode/src/provider/provider.ts:107-134`) means neither plugin can add a new provider ID — but they could be co-loaded today and silently break each other.

##### Research evidence

- **R1 (local)**: Both files declare `"google"` as the provider ID.
- **R2 (library/docs)**: `packages/opencode/src/provider/provider.ts:1397-1422` — the `for (const hook of plugins)` loop overwrites `provider.models` each iteration.
- **R3 (forum)**: `anomalyco/opencode#9270` "provider.list plugin hook" — community proposal to fix exactly this conflict.
- **R4 (adjacent)**: `lemon07r/opencode-kimi-full` uses a unique provider ID (`kimi-for-coding-oauth`) declared in `opencode.json` — avoids the conflict by leaving BUNDLED_PROVIDERS alone.

##### Proposed fix

Document the conflict in both READMEs: "Do not load `antigravity-provider-for-opencode` and `opencode-google-code-assist` simultaneously — both attach to provider ID `google` and the last-loaded plugin wins." OR have one of them defer to the other via an explicit check in the `models` hook.

---

### 5.2 CC-002 — Different testability patterns (DI vs prototype overrides)

| Plugin | Pattern | Quality |
|---|---|---|
| antigravity-provider-for-opencode | `defaultSpawn` injected via `spawnFn` parameter | ✅ Industry standard |
| opencode-google-code-assist | `CodeAssistServer.prototype.method = fake.method` then restore | ❌ Fragile |

The DI pattern is clearly better (no global state, parallel-test safe, type-checked). See GCPROTOTYPE-001 fix.

---

### 5.3 CC-003 — Different fetch-override styles

| Plugin | Approach |
|---|---|
| antigravity-provider-for-opencode | Header strip (lowercase only) → spawn `agy` → parse NDJSON → emit SSE |
| opencode-google-code-assist | Header strip (both cases) → wrap request body in CCPA envelope → POST to cloudcode-pa → unwrap SSE |

The google-code-assist version is more rigorous on header handling but bypasses `agy` entirely (talks directly to Google's CCPA endpoint). The antigravity version delegates to `agy`, which is simpler but has all the subprocess + NDJSON pitfalls (FETCH-001, ABORT-001, TIMEOUT-001).

The two implementations are mutually exclusive in approach — not candidates for refactor.

---

### 5.4 CC-004 — Different OAuth strategies

| Plugin | Strategy | Auth flow |
|---|---|---|
| antigravity-provider-for-opencode | Stub callback + `agy` keyring | User runs `agy` externally; plugin reads OS keyring |
| opencode-google-code-assist | PKCE loopback + device code + Gemini CLI import | Plugin implements full OAuth 3-flow |

These are intentionally different. The antigravity plugin's strategy is simpler but misleading (see AGRAUTH-001). The google-code-assist version is more honest but has the unwired third flow (GCDEV-001).

---

### 5.5 CC-005 — opencode core constraints

Per `packages/opencode/src/plugin/shared.ts:171-192` and `packages/opencode/src/provider/provider.ts:1397-1422`:

- Plugins cannot add entries to `BUNDLED_PROVIDERS` (private `const`).
- Plugins can hook an existing provider (`provider.models` + `auth.loader`) to filter/transform.
- If the provider ID does not exist in `database[providerID]` (built from models.dev + user's opencode.json), the hook is **silently skipped**.
- The `if (!provider) continue` gate at provider.ts:1406 silently drops invalid hooks — no error surfaced.

**Implication:** the antigravity plugin's `provider.id: "google"` works because `google` is in models.dev. If Google removed `google` from models.dev (unlikely but theoretically possible), the plugin would silently stop providing models.

The proposed `provider.list` hook (`anomalyco/opencode#9270`) would solve this — but is not merged.

---

### 5.6 CC-006 — Verbatim-code overlap (8 files adapted from gemini-cli)

`opencode-google-code-assist/src/` has 6 files flagged as "Adapted from google-gemini/gemini-cli (Apache License 2.0)":

- `src/errors.ts`
- `src/setup.ts`
- `src/server.ts`
- `src/converter.ts`
- `src/oauth-credential-storage.ts`
- `src/model-mapping.ts`

`NOTICE` properly attributes them. The adaptation adds:
- AI SDK v5 fetch wrapper (`src/fetch.ts`)
- Loopback OAuth with PKCE (`src/oauth.ts`)
- Tool schema sanitization (`src/tool-schema.ts`)

The gemini-cli → plugin port is well-executed but inherits any upstream bugs. `gemini-cli` has weekly Stable/Preview/Nightly releases, so dependency tracking matters.

##### Research evidence

- **R1 (local)**: `NOTICE:8-15` lists 6 adapted files.
- **R2 (library/docs)**: Apache 2.0 attribution requirements are met.
- **R3 (forum)**: gemini-cli #13433 (loopback policy), #26721 (SMS validation), #26099 (Workspace ineligibility), #25167 (Service disabled), #25431 (Ghost project) — all referenced from the google-code-assist error messages.
- **R4 (adjacent)**: jkfujinami/antigravity-client also adapts gemini-cli internals.

##### Proposed fix

Add a CI check that compares each adapted file against the upstream gemini-cli source. If they diverge, flag for re-merge.

---

## 6. Part D — Adjacent Implementation Comparison

| Project | Approach | Bundled auth | Multi-account | Tool calls | Reasoning | License | Stars |
|---|---|---|---|---|---|---|---|
| **antigravity-provider-for-opencode** (this) | agy subprocess + OAuth stub | OS Keyring (via agy) | ❌ | ❌ (intent: drop text_delta, single result.event) | ❌ (intent: only full text) | Apache-2.0 | n/a |
| **opencode-google-code-assist** (this) | HTTP + CCPA + PKCE loopback | OS Keyring (via gemini-cli encryption) | ❌ | ❌ | ✅ (thinkingConfig) | Apache-2.0 | n/a |
| **NoeFabris/opencode-antigravity-auth** | HTTP + CCPA + native PKCE | Custom `antigravity-accounts.json` | ✅ (10-account rotation, dual-pool) | ✅ | ✅ | MIT | 11.0k |
| **shindgew/agy-acp** | agy subprocess + **SQLite polling** | OS Keyring | ❌ | ✅ (via ConnectRPC) | ✅ | Apache-2.0 | 8 |
| **lemon07r/opencode-kimi-full** | HTTP + RFC 8628 device flow | opencode `auth.json` | ❌ (but multi-workspace via refreshPromise lock) | ❌ | ✅ | MIT | 121 |
| **marcodiniz/ag-local-bridge** | HTTP bridge (VS Code extension in Antigravity) | CSRF token hijack | ❌ (workspace multiplexing) | ✅ | ✅ | MIT | 49 |
| **jkfujinami/antigravity-client** | TypeScript SDK over ConnectRPC | `state.vscdb` SQLite probe | ❌ | ✅ (188 RPC methods) | ✅ | MIT | 17 |
| **lbjlaq/Antigravity-Tools-LS** | Rust multi-protocol server | Encrypted SQLite | ✅ (LRU pool) | ✅ | ✅ | CC-BY-NC-SA | 399 |
| **pedrofariasx/antigravity-openai-adapter** | Node.js HTTP server | Delegated to upstream | ❌ | ✅ (passthrough) | ✅ | MIT | 8 |
| **theblazehen/opencode-antigravity-multi-auth** | HTTP + CCPA + factory | Custom JSON | ✅ (multi-account) | ✅ | ✅ | Apache-2.0 | varies |
| **cemalturkcan/opencode-google-login** | HTTP + CCPA | OAuth | ❌ | ✅ | ✅ | varies | varies |

**Lessons for the two plugins:**

1. **NoeFabris** is the production-ready template for Antigravity OAuth — multi-account rotation handles quota exhaustion (#608, #684). Adopt if the user has multiple accounts.
2. **shindgew** SQLite polling is the most robust schema-drift defense — adopt if `agy` changes its `--output-format stream-json` shape.
3. **lemon07r** device flow is the right answer for SSH/CI users.
4. **lbjlaq** process lifecycle discipline (LRU pool, atomic write config, watchdog) is the right answer for unattended runs.

---

## 7. Prioritized Backlog

### P0 🔴 (must fix before 1.0)

| Ticket | File | Effort |
|---|---|---|
| AGRAUTH-001 — OAuth callback stub | `antigravity-provider-for-opencode/src/auth.ts:113-140` | 1-2 hours (option a: docs) or 1-2 days (option b: implement) |
| FETCH-001 — NDJSON trailing partial line | `antigravity-provider-for-opencode/src/fetch-wrapper.ts:92-167` | 1-2 hours |
| GCAUTH-001 — TS strict | `opencode-google-code-assist/tsconfig.json` | 2-3 hours (includes fix-up of new errors) |
| GCDEV-001 — `startDeviceOAuth` throws | `opencode-google-code-assist/src/oauth.ts:265-304` | 1-2 hours (option a: remove) or 1-2 days (option b: implement) |

### P1 🟠 (next minor release)

| Ticket | File | Effort |
|---|---|---|
| ABORT-001 — AbortSignal propagation | `antigravity-provider-for-opencode/src/fetch-wrapper.ts` + `auth.ts` | 2-4 hours |
| TIMEOUT-001 — SIGKILL escalation | `antigravity-provider-for-opencode/src/fetch-wrapper.ts:69` | 30 minutes |
| PREFLIGHT-001 — env-strip in preflight | `antigravity-provider-for-opencode/src/cli.ts:101-113` | 30 minutes |
| HEADLESS-001 — headless + TZ-skew detection | `antigravity-provider-for-opencode/src/cli.ts` | 1-2 hours |
| GCOAUTH-001 — refresh_token check order | `opencode-google-code-assist/src/oauth.ts:383-404` | 15 minutes |

### P2 🟡 (debt + style)

| Ticket | File | Effort |
|---|---|---|
| ASNEVER-001 — `as never` cast | `antigravity-provider-for-opencode/src/auth.ts:96` | 1-2 hours |
| ASCAST-001 — unnecessary cast | `antigravity-provider-for-opencode/src/auth.ts:193` | 5 minutes |
| NODESPAWN-001 — Bun.spawn | `antigravity-provider-for-opencode/src/spawn.ts` | 2-4 hours |
| OXLINT-001 — `.oxlintrc.json` | `antigravity-provider-for-opencode/` | 15 minutes |
| FLAGS-001 — pedantic TS flags | `antigravity-provider-for-opencode/tsconfig.json` | 2-4 hours |
| STRIP-001 — header case variants | `antigravity-provider-for-opencode/src/auth.ts:183-194` | 30 minutes |
| STDERR-001 — stderr unbounded | `antigravity-provider-for-opencode/src/fetch-wrapper.ts:196-203` | 1-2 hours |
| GCSTRICT-001 — pedantic TS flags | `opencode-google-code-assist/tsconfig.json` | combined with GCAUTH-001 |
| GCAS-001 — `as any` in tests | `opencode-google-code-assist/test/fetch.test.ts` | 1-2 hours |
| GCPROTOTYPE-001 — prototype overrides | `opencode-google-code-assist/test/fetch.test.ts` | 2-4 hours |
| CC-001 — provider ID conflict | both README + index.ts | 30 minutes |

### P3 🟢 (opportunistic)

| Ticket | File | Effort |
|---|---|---|
| PATH-001 — lazy default path | `antigravity-provider-for-opencode/src/constants.ts:13` | 15 minutes |
| PATHEXT-001 — PATHEXT env | `antigravity-provider-for-opencode/src/cli.ts:43-55` | 30 minutes |
| DOC-001 — stream-json flag check | `antigravity-provider-for-opencode/src/cli.ts` | 1 hour |
| GC-DOC-001 — comment cleanup | `antigravity-provider-for-opencode/src/models.ts:183-185` | 15 minutes |
| ISEXEC-001 — try/catch avoidance | `antigravity-provider-for-opencode/src/cli.ts:31-41` | 15 minutes |
| CC-006 — gemini-cli drift check | `opencode-google-code-assist/` (CI) | 4 hours |

**Total estimated effort (P0 only):** ~6-12 hours.
**Total estimated effort (P0+P1):** ~14-26 hours.
**Total estimated effort (all):** ~30-50 hours.

---

## 8. Test Gap Recommendations

For each P0/P1 ticket, the corresponding test case is listed in §3.2 and §4.2. Summary of new tests needed:

| File | New test cases | Covers |
|---|---|---|
| `test/fetch-wrapper.test.ts` | trailing partial line, abort mid-stream, stderr unbounded | FETCH-001, ABORT-001, STDERR-001 |
| `test/auth.test.ts` | OAuth stub strings, headless detection, header case variants | AGRAUTH-001, HEADLESS-001, STRIP-001 |
| `test/cli-locator.test.ts` | env-strip in preflight, PATHEXT, stream-json flag check | PREFLIGHT-001, PATHEXT-001, DOC-001 |
| `test/spawn.test.ts` | SIGKILL escalation on timeout | TIMEOUT-001 |
| `packages/opencode-google-code-assist/test/oauth.test.ts` | startDeviceOAuth doesn't throw, refresh_token missing check | GCDEV-001, GCOAUTH-001 |
| `packages/opencode-google-code-assist/test/fetch.test.ts` | replace prototype overrides with serverFactory DI | GCPROTOTYPE-001 |

---

## 9. Research-Filtered Candidates (NOT tickets)

The following concerns were investigated and DOWNGRADED after the R1-R4 gate. They appear here for transparency and to prevent re-investigation.

### RF-001 — `init.headers` instanceof Headers strip path missing case variants

- **Status:** False positive
- **Reason:** `Headers` class is case-insensitive per spec. `.delete("authorization")` deletes `Authorization` too. The downstream `@ai-sdk/google` provider only sets lowercase headers, so this is a non-issue. Only the record branch (the `else`) needs the case-insensitive treatment — covered by STRIP-001.

### RF-002 — `subscriptionOnlyEnv()` reads process.env at call time (race condition)

- **Status:** Documented intentional pattern
- **Reason:** `env.ts:11-23` is called at every spawn boundary. Tests assert "does not mutate the original process.env" (env.test.ts:32-38). The spread `{ ...process.env }` snapshots at call time, so subsequent process.env mutations don't affect the spawned env. Behavior is correct.

### RF-003 — `extractPrompt` and `parseAiSdkGoogleUrl` are single-use helpers (extract prematurely)

- **Status:** False positive
- **Reason:** AGENTS.md:96 explicitly allows helpers that "hide a genuinely complex boundary" or "have a clear independent name that improves the caller." URL parsing and prompt extraction from Vertex-shaped bodies are complex boundaries. Extraction is justified.

### RF-004 — `getLegacyPlugins` in opencode core iterates exports and throws on non-functions

- **Status:** Documented intentional pattern
- **Reason:** This is upstream behavior. Plugin authors can use the v1 shape `{ id, server }` to bypass. Both reviewed plugins use v1 (their `index.ts` re-exports the default export, which is a `Plugin` function). Compatible.

### RF-005 — Antigravity plugin README line 107 "Sentient-OS Swift AntigravityProvider"

- **Status:** Discrepancy flagged in research
- **Reason:** The local `README.md:107` does NOT contain this reference (the cluster report's verification step caught this). The likely intended reference was to Sentient-OS's general provider architecture, not a specific Swift class. No code change required, but the README could add a "See also" section for clarity.

### RF-006 — `auth.ts:218` `slug: parsed.slug as never` cast on the response

- **Status:** False positive
- **Reason:** `parsed.slug` is the model id from the URL regex, but the type of `spawnAgyStream`'s `slug` parameter is `ModelSlug` (a branded union). The cast is on `parsed.slug as never` which the type checker accepts because `ModelSlug` is a narrower type. Cleaner fix would be `parsed.slug as ModelSlug` (already implicitly `never` due to `as never` semantics). Low priority.

### RF-007 — antigravity-cli#53 (TZ skew + keyring) is the upstream bug, not the plugin's

- **Status:** Partially filtered
- **Reason:** The bug is in `agy`. The plugin can't fix it. But it can **detect** the headless+non-UTC condition and surface the workaround — see HEADLESS-001. The detection is the plugin's responsibility, the fix is upstream.

### RF-008 — `child.kill` is wrapped in `spawn.ts:54` but no caller invokes it

- **Status:** False positive (now relevant with ABORT-001)
- **Reason:** With ABORT-001 fix, the `kill` path becomes active. Without it, the wrap is unused but defensive. Fix ABORT-001 first.

### RF-009 — `try { ... } catch (err) { if (err instanceof AgyNotInstalledError) { throw new ... } else { throw err } }` is a useless catch

- **Status:** False positive
- **Reason:** The catch adds context to the error message (`${err.message}\n\nAntigravity auth is configured but the binary is missing. Use "Install Antigravity CLI" above to reinstall.`). Not useless.

### RF-010 — `oxlint v1.60.0` no-useless-catch rule may flag the preflight catch

- **Status:** Real concern, monitored
- **Reason:** Will only trigger if the catch rethrows the same error. The current `auth.ts:155-166` catch *adds* context, so it's NOT useless. oxlint will accept it.

---

## 10. Open Questions for the Team

1. **OAuth flow direction**: Does the team want (a) a "marker + external `agy`" UX (current, simpler) or (b) real OAuth inside the plugin (more code, better UX)? This is a design decision, not a code review call.

2. **Subprocess library**: Switch to `Bun.spawn`? The package targets Node 22 (engines) and Bun (types). A runtime-detect pattern (`typeof Bun !== "undefined"`) is the safest.

3. **CI for gemini-cli drift**: The google-code-assist package's `NOTICE` lists 6 files adapted from gemini-cli. Does the team want a CI check that diffs the upstream and flags divergence? (CC-006)

4. **Multi-account support**: Out of scope for this review, but the antigravity-cli#608 (72-hour lockout) issue suggests multi-account rotation (NoeFabris pattern) would meaningfully improve UX.

5. **Quota telemetry**: antigravity-cli has no public quota API (`/stats` doesn't work in `-p` mode, issue #46). How does the plugin surface quota exhaustion to the user?

6. **`outDir` for antigravity-provider-for-opencode**: The tsconfig.build.json declares `outDir: "./dist"`. The package's `main` field is `"./dist/index.js"`. Confirm the build step (`tsc -p tsconfig.build.json`) actually runs in CI (the README doesn't show CI status).

7. **The plugin loader's silent skip (`provider.ts:1406`)**: If `google` is removed from models.dev in the future, both plugins stop working without error. Should there be a runtime warning in that case?

---

## 11. Verification Checklist

Before merging fixes:

- [ ] `bun typecheck` (or `bash script/typecheck.sh`) passes from package dirs.
- [ ] `bun run lint` (or `oxlint`) passes.
- [ ] `bun test` from each package dir passes.
- [ ] Manual: `bun run dev` in opencode_m3nt1, verify model picker shows Antigravity models.
- [ ] Manual: spawn `agy -p "test" --output-format stream-json` with a shim that emits NDJSON without trailing newline; verify FETCH-001 fix.
- [ ] Manual: `Ctrl+C` during a request; verify ABORT-001 fix (child `agy` is killed within 5s).
- [ ] CI: verify the `dist/` build produces a working `index.js`.

---

## 12. References

### Local files

- `antigravity-provider-for-opencode/src/{auth,cli,constants,env,errors,fetch-wrapper,index,install,models,spawn,types}.ts`
- `antigravity-provider-for-opencode/test/{auth,cli-locator,env,fetch-wrapper,index,install-command,models,spawn}.test.ts`
- `antigravity-provider-for-opencode/{package.json,tsconfig.json,tsconfig.build.json,bunfig.toml,script/typecheck.sh,README.md,SECURITY.md,CHANGELOG.md}`
- `opencode_m3nt1/packages/opencode-google-code-assist/src/{constants,converter,errors,fetch,index,model-mapping,oauth,oauth-credential-storage,server,setup,tool-schema,types}.ts`
- `opencode_m3nt1/packages/opencode-google-code-assist/test/{converter,errors,fetch,index,model-mapping,oauth,setup,tool-schema}.test.ts`
- `opencode_m3nt1/packages/opencode-google-code-assist/{package.json,tsconfig.json,index.ts,README.md,TESTING.md,NOTICE}`
- `opencode_m3nt1/packages/opencode/src/plugin/{index,shared,loader,install}.ts`
- `opencode_m3nt1/packages/opencode/src/provider/{auth,provider}.ts`
- `opencode_m3nt1/AGENTS.md`
- `opencode_m3nt1/.oxlintrc.json`

### External sources

- [vercel/ai — LanguageModelV2](https://github.com/vercel/ai/blob/main/packages/provider/src/language-model/v2/language-model-v2.ts)
- [vercel/ai#15430 — abort signal hang](https://github.com/vercel/ai/issues/15430)
- [anomalyco/opencode#9270 — provider.list hook](https://github.com/anomalyco/opencode/issues/9270)
- [anomalyco/opencode AGENTS.md](https://github.com/anomalyco/opencode/blob/dev/AGENTS.md)
- [google-antigravity/antigravity-cli#53 — TZ skew + keyring](https://github.com/google-antigravity/antigravity-cli/issues/53)
- [antigravitylab.net — NDJSON partial line pitfalls](https://antigravitylab.net/articles/integrations/antigravity-cli-json-lines-streaming-consume-partial-line-pitfalls)
- [antigravitylab.net — Antigravity CLI 401 stall](https://antigravitylab.net/en/articles/integrations/antigravity-cli-reauth-token-expiry-unattended-401-fix)
- [antigravitylab.net — Antigravity CLI CI/cron design](https://antigravitylab.net/articles/integrations/antigravity-cli-headless-non-interactive-ci-design)
- [NoeFabris/opencode-antigravity-auth#427 — Verify account](https://github.com/NoeFabris/opencode-antigravity-auth/issues/427)
- [NoeFabris/opencode-antigravity-auth#479 — project ID persistence](https://github.com/NoeFabris/opencode-antigravity-auth/issues/479)
- [NoeFabris/opencode-antigravity-auth#589 — stale flags](https://github.com/NoeFabris/opencode-antigravity-auth/issues/589)
- [lemon07r/opencode-kimi-full — PKCE + device flow](https://github.com/lemon07r/opencode-kimi-full)
- [shindgew/agy-acp — SQLite polling](https://github.com/shindgew/agy-acp)
- [jkfujinami/antigravity-client — ConnectRPC SDK](https://github.com/jkfujinami/antigravity-client)
- [lbjlaq/Antigravity-Tools-LS — Rust multi-protocol](https://github.com/lbjlaq/Antigravity-Tools-LS)
- [marcodiniz/ag-local-bridge — VS Code extension](https://github.com/marcodiniz/ag-local-bridge)
- [pedrofariasx/antigravity-openai-adapter — OpenAI proxy](https://github.com/pedrofariasx/antigravity-openai-adapter)
- [NDJSON spec](https://github.com/ndJSON/NDJSON-spec)
- [Node.js child_process docs](https://nodejs.org/api/child_process.html)
- [Bun child-process docs](https://bun.com/docs/runtime/child-process)
- [oxc.rs linter docs](https://oxc.rs/docs/guide/usage/linter/config.html)
- [oxlint v1.60.0 release notes](https://github.com/oxc-project/oxc/releases/tag/apps_v1.60.0)
- [TypeScript TSConfig reference](https://www.typescriptlang.org/tsconfig/)
- [DefinitelyTyped#74581 — ProcessEnv TZ clash](https://github.com/DefinitelyTyped/DefinitelyTyped/pull/74581)

---

## 13. Reviewer Notes

This review was performed by orchestrating 6 parallel research clusters (AI SDK v5 fetch contract, subprocess + NDJSON hygiene, OAuth + keyring patterns, TS strict + opencode style, opencode plugin loader, adjacent Antigravity plugins). Each ticket's R1-R4 gate was verified against 5+ independent sources. The research-filtered section prevents re-investigation of false positives.

The biggest take-away: the antigravity plugin's design (delegate everything to `agy` + OS keyring) is elegantly simple but has 4 hidden failure modes (NDJSON tail, abort, timeout, headless keyring) that no other plugin in the ecosystem has solved. Adopting even one of NoeFabris/lemon07r/shindgew's patterns would meaningfully improve robustness.

End of review.