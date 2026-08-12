# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial plugin scaffold (package.json, tsconfig, bunfig).
- README, SECURITY, LICENSE, CHANGELOG skeletons.

## [0.1.0] - TBD

### Added
- 6 hardcoded Antigravity models (Gemini 3.6 Flash / 3.5 Flash / 3.1 Pro, Claude Sonnet 4.6, Claude Opus 4.6, GPT-OSS 120B).
- Cross-platform `agy` binary locator (macOS / Linux / Windows).
- Runtime preflight check that throws `AgyNotInstalledError` with installation instructions when the binary is missing.
- Subscription-only env-strip that removes `ANTIGRAVITY_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENAI_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_GENAI_USE_GCA` from the spawned subprocess environment.
- Cross-platform install flow with visible stdout (curl-install on Unix, PowerShell / CMD on Windows).
- 3 auth methods: Install CLI, Sign in with Google, Use existing session.
- NDJSON stream parser → `LanguageModelV3.doStream` integration.
- `Process.spawn` injection point for unit testing.
- Subprocess timeout (5 min) with SIGTERM→SIGKILL escalation.
- AbortSignal propagation from opencode cancel to `agy`.
- Unit tests (env-strip, locator, fetch parser, model registry, install commands).
- GitHub Actions CI (typecheck + test).
