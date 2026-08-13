# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **NDJSON trailing partial line drop** — `agy` 1.1.x sometimes emits the final
  `result` event without a trailing newline. The stream parser now flushes
  the residual buffer on stream end (`fetch-wrapper.ts` `buildResultChunk`
  helper + tail-flush in `start()`). Confirmed by `antigravitylab.net`
  documenting the "roughly 1 in 3 runs" failure rate on raw stdout NDJSON.
- **AbortSignal propagation** — The AI SDK's `init.signal` is now forwarded
  into the `agy` subprocess via Node's `spawn({ signal })` option. The
  `ReadableStream`'s `cancel()` handler kills the child on consumer-driven
  cancellation. CHANGELOG 0.1.0 claimed this feature; it is now actually
  implemented (per `vercel/ai#15430` the previous manual SIGTERM/SIGKILL
  escalation was a hand-rolled workaround that didn't compose with the
  SDK's `controller.error()` cleanup path).
- **5-min timeout escalation** — Spawn `killSignal` is now `"SIGKILL"`,
  so the timeout fires even when `agy` traps SIGTERM (per Node docs on
  `child_process.spawn` timeout semantics).
- **preflight env-strip** — `verifyVersion` and `preflight` now apply
  `subscriptionOnlyEnv()` to the spawned env. SECURITY.md documents the
  subscription-only invariant; the previous code violated it at the
  preflight boundary.
- **headless / TZ-skew detection** — `preflight` detects SSH/CI +
  non-UTC environments (the `antigravity-cli#53` silent failure mode)
  and surfaces the upstream workaround (`GEMINI_FORCE_FILE_STORAGE=true
  TZ=UTC agy -p "test"`) before opencode stalls. The headless branch
  always wraps the underlying error with the workaround message
  (previously the `if (err instanceof AgyNotInstalledError) throw err`
  short-circuit skipped the surface, defeating the feature).
- **OAuth callback stub** — The two `type: "oauth"` methods now run
  `preflight()` before returning marker tokens. Previously they returned
  success immediately, persisting placeholder `antigravity-managed`
  strings to `auth.json` with no working session backing them.
- **OAuth method labels** — `"Sign in with Google"` and
  `"Use existing antigravity session"` were renamed for clarity. The
  instructions now explain that OAuth happens via `agy` (OS keyring),
  not via a browser round-trip through this plugin.
- **PATHEXT Windows fallback** — Previously the fallback was
  `[".exe", ".cmd", ".bat"]` which was missing `.COM` (the first
  extension Windows checks) and had wrong order. The new fallback
  uses the canonical `.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC`
  order that matches vscode/orca/varlock convention.
- **`AGY_DEFAULT_PATH` lazy const** — Previously exported BOTH a const
  AND a function. The const defeated the lazy-evaluation purpose (it
  was evaluated at module load). Removed the const; callers use
  `getAgyDefaultPath()` only.
- **Version detection: `--help` → semver** — The `--output-format
  stream-json --help` exit-code probe is unreliable (many CLIs exit 0
  for `--help` regardless of unknown flags). Replaced with a semver
  parse of `agy --version` output, requiring `>= 1.1.8`. This also
  unifies the two preflight checks (version + flag support) into one.

### Changed
- **Subscription-only env strip** — Now applied at every spawn
  boundary (`fetch-wrapper.ts`, `cli.ts` `preflight`/`verifyVersion`).
- **stderr handling** — stderr is now bounded (4 KB cap) and tee'd
  to `process.stderr` immediately. Previously stderr was buffered
  unbounded in `Buffer.concat` and only consumed on the failure path;
  chatty `agy` runs could grow memory linearly.
- **Header stripping** — The `Record<string, string>` branch of the
  fetch-override header strip now handles both casings
  (`authorization`/`Authorization`, `x-goog-api-key`/`X-Goog-Api-Key`)
  to match `opencode-google-code-assist/src/fetch.ts:99-114`.
- **Install CLI auth method** — Now has an `authorize()` callback that
  actually runs the platform install command and verifies the result
  via `preflight()`. Previously selecting this method showed a
  confirmation prompt but the install never ran.
- **AbortSignal implementation** — Switched from hand-rolled
  SIGTERM→SIGKILL escalation to Node's built-in `spawn({ signal })`
  option, plus a `cancel()` handler on the `ReadableStream`. Per
  Node PR #62450, mixing `controller.error()` with a manual kill
  prevented the source's `cancel()` cleanup from running.

### Security
- **Subscription-only invariant** — Documented as enforced at every
  spawn boundary. `subscriptionOnlyEnv()` is now applied uniformly
  (see `SECURITY.md:23-37`).

### Tests
- 7 new test cases:
  - `fetch-wrapper.test.ts`: trailing partial line flush, tail-line
    parse failure, AbortSignal kill propagation
  - `auth.test.ts`: OAuth callback runs preflight, OAuth callback
    throws `AgyNotInstalledError` when agy is missing

### Tooling
- **`.oxlintrc.json`** — Mirrors `opencode_m3nt1/.oxlintrc.json` baseline
  (`suspicious: warn` + key type-aware rules). Previously only the
  default `correctness` category was active; the new config flags
  real bugs (e.g. unused variables, no-unused-vars in tests).
- **`noUncheckedIndexedAccess`** — Enabled in `tsconfig.json`. Catches
  the silent "array access returns `undefined`" class of bugs at
  type-check time. Updated `auth.ts`, `cli.ts`, and the test files
  to add explicit non-null assertions at the documented invariant
  points (regex captures, split+filter tuples).

### Refactored
- **`as never` → typed `toModelV2Map`** (ASNEVER-001) — The previous
  `as never` cast at `auth.ts:96` hid the boundary between our domain
  `ModelEntry` type and the SDK's `ModelV2` shape. Replaced with a
  typed mapper (`models.ts` `toModelV2` + `toModelV2Map`) that makes
  the boundary explicit and documented. opencode core still overrides
  the branded `ProviderV2.ID` / `ModelV2.ID` fields per entry at
  `packages/opencode/src/provider/provider.ts:1417`.
- **`bunSpawnImpl` documented as future work** (NODESPAWN-001) —
  Initially implemented but reverted because the Bun.spawn test
  mock strategy does not fit the existing `mock.module("node:child_process", ...)`
  pattern. The Bun.spawn option requires a parallel test infrastructure
  that is out of scope for this fix batch. The package's tsconfig
  still has `types: ["bun"]`, so Bun globals remain available.

### Code review
- Added `CODE_REVIEW.md` — deep research-validated review (6 parallel
  research clusters, R1-R4 evidence gate, 27 tickets identified with
  19 real + 8 research-filtered). Covers `antigravity-provider-for-opencode`
  and the adjacent `opencode-google-code-assist` package plus
  opencode core cross-cutting constraints.

## [0.1.0] - 2026-08-12

### Added
- 7 hardcoded Antigravity models (Gemini 3.6 Flash / 3.5 Flash / 3.1 Pro,
  Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS 120B).
- Cross-platform `agy` binary locator (macOS / Linux / Windows).
- Runtime preflight check that throws `AgyNotInstalledError` with
  install instructions when the binary is missing, both at plugin load
  and at every model load.
- Subscription-only env-strip that removes `ANTIGRAVITY_API_KEY`,
  `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENAI_API_KEY`,
  `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_GENAI_USE_VERTEXAI`,
  `GOOGLE_GENAI_USE_GCA` from the spawned subprocess environment.
- Cross-platform install flow with visible stdout (curl-install on Unix,
  PowerShell on Windows).
- 3 auth methods: Install CLI, Sign in with Google, Use existing session.
- NDJSON stream parser → OpenAI-compatible SSE response (text-delta
  chunks + usage chunk + DONE terminator).
- `LanguageModelV3` reference implementation in `src/fetch.ts` (kept
  for direct consumer use; the plugin uses the fetch-override path).
- `SpawnFn` dependency-injection seam for unit testing.
- Subprocess timeout (5 min) with SIGTERM→SIGKILL escalation.
- AbortSignal propagation from opencode cancel to `agy`.
- Unit tests (env-strip, locator, fetch wrapper, model registry,
  install commands, auth flow, plugin factory).
- GitHub Actions CI (typecheck + test on push and PR).
- GitHub Actions release workflow (npm publish on tag).

### Security
- `src/env.ts` strips subscription-only env vars at every spawn boundary.
- `src/cli.ts` preflight runs both at plugin load and at every model
  load — the user cannot select an Antigravity model without the
  binary on PATH.
- `src/fetch-wrapper.ts` resolves the spawn env from `process.env`
  with a fresh clone, never a raw passthrough.
- `src/auth.ts` strips `Authorization` and `x-goog-api-key` headers from
  the AI SDK's outgoing request, so a stray API key in the AI SDK's
  environment cannot override the OAuth path.
- `SECURITY.md` documents the threat model (matching the Sentient-OS
  §11 invariants), the subscription-only env-strip, the subprocess
  hardening, and the OAuth storage isolation.

> **Note:** Several entries in the 0.1.0 "Added" section above were
> documented but not actually implemented (e.g. "AbortSignal
> propagation"). They have been moved to the `[Unreleased]` "Fixed"
> section above. The `[Unreleased]` entries reflect the actual state
> as of `b11f91b` + code-review-fixes branch.