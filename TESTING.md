# Testing antigravity-provider-for-opencode

This document covers three levels of testing, from fastest to most realistic.

## 1. Unit tests (no opencode needed, no network)

The fastest sanity check. All 137 tests run in under 2 seconds.

```bash
cd /Users/kasnyiklaszlo/Documents/_OPENCODE/antigravity-provider-for-opencode

# Full run: typecheck + lint + tests
./script/test.sh

# Quick run: skip typecheck
./script/test.sh quick

# Or run individual stages
./script/test.sh typecheck
./script/test.sh lint
./script/test.sh test

# Direct equivalents
bash script/typecheck.sh
bun run lint
bun test
```

Expected: `137 pass, 0 fail, 306 expect() calls`.

## 2. Type checking

The package uses strict TypeScript + `noUncheckedIndexedAccess`.

```bash
bash script/typecheck.sh   # wraps `tsc --noEmit` and filters upstream errors
```

## 3. Lint

oxlint with the `.oxlintrc.json` baseline (mirrors `opencode_m3nt1/.oxlintrc.json`).

```bash
bun run lint
```

Expected: `0 warnings, 0 errors`.

## 4. Integration test with opencode_m3nt1

The plugin is already a workspace member (`bun pm ls` shows it). To use it
with the opencode instance running from this fork, point `plugin_origins`
at the absolute path of the package directory. opencode treats any absolute
path as a file plugin (see `packages/opencode/src/plugin/shared.ts:171`
`isPathPluginSpec`).

```jsonc
// ~/.config/opencode/config.json
{
  "plugin_origins": [
    "/Users/kasnyiklaszlo/Documents/_OPENCODE/antigravity-provider-for-opencode"
  ]
}
```

Then start opencode from the fork root so it uses the local code:

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/kasnyiklaszlo/Documents/_OPENCODE/opencode_m3nt1
bun run dev
```

In opencode:

```
/connect
→ Antigravity
→ Use existing Antigravity session
```

You should see one of three outcomes:

1. **Happy path** — `agy` is installed and the OS keyring session is valid;
   the marker token persists and `~/.local/share/opencode/auth.json`
   shows a `google` provider entry.
2. **Install prompt** — `agy` is missing; the Install CLI auth method's
   `authorize()` callback runs the platform installer and verifies via
   preflight. If the install succeeds, the method returns success.
3. **Headless warning** — `SSH_CLIENT`/`SSH_TTY`/`CI` is set and the
   timezone is non-UTC; the preflight throws `AgyNotInstalledError` with
   the `antigravity-cli#53` workaround hint.

After connecting, try a model:

```
/model antigravity/gemini-3.1-pro-high
hello
```

## 5. Smoke-test checklist

After connecting, verify end-to-end:

- [ ] `/model` — Antigravity models appear under the `google` provider, with `cost: 0`.
- [ ] First message — disclaimer is printed to stderr once (per `opencode-google-code-assist/README.md`).
- [ ] Send a simple prompt: `hello` — you should get a response from the gemini model.
- [ ] Stream a tool call: ask the model to read a file — tool calls should work.
- [ ] `Ctrl+C` during a request — verify the child `agy` is killed within ~5s
      (ABORT-001 fix). Use `ps aux | grep agy` to confirm.
- [ ] Send a request that finishes `agy` output without a trailing newline
      (simulate by patching `agy` or by hand-crafting the input) — verify
      the response is not silently dropped (FETCH-001 fix).

## 6. End-to-end as a published npm package

Build, pack, and install globally:

```bash
cd /Users/kasnyiklaszlo/Documents/_OPENCODE/antigravity-provider-for-opencode
bun run build
npm pack
# → antigravity-provider-for-opencode-0.1.0.tgz
npm install -g ./antigravity-provider-for-opencode-0.1.0.tgz
```

Then in `~/.config/opencode/config.json`:

```jsonc
{
  "plugin_origins": ["npm:antigravity-provider-for-opencode"]
}
```

## 7. Troubleshooting

**"OAuth callback timeout"** — you did not complete the browser consent in
5 minutes. Run `/connect antigravity` again.

**"Failed to load module: Cannot find module"** — the plugin's `package.json`
declares `@opencode-ai/core` and `@opencode-ai/plugin` as dependencies. If
you `npm install -g` outside the workspace, make sure opencode is on the
`npm install -g` path so it can resolve the workspace peer dependency. Inside
the fork's monorepo, this is automatic.

**"GEMINI_API_KEY is set; consider unsetting it"** — the AI SDK checks for
env vars in priority order. The plugin only takes over the `google` provider
when OAuth auth is used. If you have a leftover API key in the env, the
provider will use that path and bypass the plugin. Unset `GEMINI_API_KEY`,
`GOOGLE_API_KEY`, and `GOOGLE_GENERATIVE_AI_API_KEY` before testing.

**"The `/connect antigravity` UI shows only the API-key option"** — your
opencode build is not loading the plugin. Check the opencode startup log
for plugin load errors. The plugin's `config` hook should print the
disclaimer to stderr on first load.

**"First call hangs for ~5 seconds"** — this is the `agy` `--version`
probe + project cache miss on first call. Subsequent calls are cached for
30 s (per `opencode-google-code-assist/src/setup.ts:PROJECT_CACHE_TTL_MS`).

**"Quota error 429"** — wait the duration in the `RetryableQuotaError`
message, or switch to a smaller model.

## 8. Verifying individual fixes (smoke matrix)

Each P0/P1 fix can be verified with a one-liner:

| Fix | How to verify |
|---|---|
| **FETCH-001** (NDJSON tail flush) | Run `agy -p "test"` directly, observe if the final `result` event has a trailing `\n`. The plugin now handles both cases. |
| **ABORT-001** (AbortSignal) | Start a request, press `Ctrl+C`. The child `agy` should die within 5 seconds (run `ps aux \| grep agy` in another terminal). |
| **TIMEOUT-001** (SIGKILL) | Patch `agy` to trap SIGTERM (e.g., `trap '' SIGTERM; sleep 600`). The 5-min timeout should still fire (escalating to SIGKILL). |
| **PREFLIGHT-001** (env-strip) | Set `GOOGLE_API_KEY=secret`, run preflight, verify the spawned `agy` does NOT see the key (use `agy env` or `--help`). |
| **HEADLESS-001** (antigravity-cli#53) | Set `SSH_CLIENT=1 TZ=Asia/Tokyo`, run preflight, verify the error mentions `GEMINI_FORCE_FILE_STORAGE=true TZ=UTC`. |
| **AGRAUTH-001** (OAuth callback) | Select "Sign in with Google (run `agy` first)" in `/connect`. The callback should fail with `AgyNotInstalledError` if `agy` is missing. |