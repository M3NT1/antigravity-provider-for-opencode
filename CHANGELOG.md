# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial plugin scaffold (package.json, tsconfig, bunfig).
- README, SECURITY, LICENSE, CHANGELOG skeletons.

## [0.1.0] - 2026-08-12

### Added
- 6 hardcoded Antigravity models (Gemini 3.6 Flash / 3.5 Flash / 3.1 Pro, Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS 120B).
- Cross-platform `agy` binary locator (macOS / Linux / Windows).
- Runtime preflight check that throws `AgyNotInstalledError` with install instructions when the binary is missing, both at plugin load and at every model load.
- Subscription-only env-strip that removes `ANTIGRAVITY_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENAI_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_GENAI_USE_GCA` from the spawned subprocess environment.
- Cross-platform install flow with visible stdout (curl-install on Unix, PowerShell on Windows).
- 3 auth methods: Install CLI, Sign in with Google, Use existing session.
- NDJSON stream parser → OpenAI-compatible SSE response (text-delta chunks + usage chunk + DONE terminator).
- `LanguageModelV3` reference implementation in `src/fetch.ts` (kept for direct consumer use; the plugin uses the fetch-override path).
- `SpawnFn` dependency-injection seam for unit testing.
- Subprocess timeout (5 min) with SIGTERM→SIGKILL escalation.
- AbortSignal propagation from opencode cancel to `agy`.
- Unit tests (env-strip, locator, fetch wrapper, model registry, install commands, auth flow, plugin factory).
- GitHub Actions CI (typecheck + test on push and PR).
- GitHub Actions release workflow (npm publish on tag).

### Security
- `src/env.ts` strips subscription-only env vars at every spawn boundary.
- `src/cli.ts` preflight runs both at plugin load and at every model load — the user cannot select an Antigravity model without the binary on PATH.
- `src/fetch-wrapper.ts` resolves the spawn env from `process.env` with a fresh clone, never a raw passthrough.
- `src/auth.ts` strips `Authorization` and `x-goog-api-key` headers from the AI SDK's outgoing request, so a stray API key in the AI SDK's environment cannot override the OAuth path.
- `SECURITY.md` documents the threat model (matching the Sentient-OS §11 invariants), the subscription-only env-strip, the subprocess hardening, and the OAuth storage isolation.
