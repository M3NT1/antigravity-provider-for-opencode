# Getting Started — antigravity-provider-for-opencode

This plugin lets you use Google's Gemini AI Pro / Ultra subscription (via the `agy` CLI) as a model provider inside [opencode](https://opencode.ai). Models include Gemini 3.x, Claude Sonnet/Opus 4.6, and GPT-OSS 120B — all billed against your subscription, not per-token.

---

## 0. Prerequisites

| What | Version | Why |
|---|---|---|
| [opencode](https://opencode.ai/docs) | 1.18+ | Runtime |
| [Bun](https://bun.sh) | 1.3+ | Used by the plugin's scripts |
| [Google Antigravity CLI (`agy`)](https://antigravity.google) | **>= 1.1.8** | The CLI this plugin wraps |
| Google account with AI Pro / Ultra | — | Required for subscription billing |

---

## 1. Install `agy` and sign in (one-time)

```bash
# macOS / Linux
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy -p "hello"   # this opens your browser for OAuth on first run
```

The first `agy` invocation opens a Google sign-in window. After you complete OAuth, the refresh token is stored in your OS keyring (Apple Keychain / Linux Secret Service / Windows Credential Manager). Subsequent `agy` calls reuse the cached session silently.

> **Verify:** `agy -p "what version are you"` should return a model response without re-prompting you.

---

## 2. Install the plugin

You have three options. Pick the one matching your setup.

### Option A — from the PR branch (recommended while #1 is open)

```bash
git clone -b code-review-fixes https://github.com/M3NT1/antigravity-provider-for-opencode
# Point opencode at the cloned directory — see Step 3.
```

### Option B — from a local build

```bash
git clone https://github.com/M3NT1/antigravity-provider-for-opencode
cd antigravity-provider-for-opencode
bun install --frozen-lockfile
bun run build
# → produces ./dist/index.js
# Point opencode at this directory.
```

### Option C — from a packed tarball (after the PR merges)

```bash
# Once merged + published to npm:
npm install -g antigravity-provider-for-opencode
```

---

## 3. Register the plugin with opencode

Edit `~/.config/opencode/opencode.json` (or `<project>/.opencode/config.json` for project-scoped):

```jsonc
{
  "plugin_origins": [
    // For Option A / B — point at the cloned directory:
    "/Users/kasnyiklaszlo/Documents/_OPENCODE/antigravity-provider-for-opencode"
    // For Option C — use the npm name:
    // "antigravity-provider-for-opencode"
  ]
}
```

The path can be absolute (as above) or relative to the opencode config file.

---

## 4. Restart opencode and connect

Start opencode in dev mode (from the fork root, so it uses your local plugin code):

```bash
# If using Option A / B (local plugin):
cd /Users/kasnyiklaszlo/Documents/_OPENCODE/opencode_m3nt1
bun run dev
```

In the opencode TUI:

```
/connect
→ Antigravity
→ Use existing Antigravity session
```

The plugin verifies that `agy` is installed, parses the version (must be `>= 1.1.8`), and persists a marker to `~/.local/share/opencode/auth.json` under the `google` provider. No browser interaction is required at this step — the OAuth session lives in the OS keyring.

> If the connect fails with "Antigravity CLI is not installed", run `agy -p "test"` in a terminal first to verify the install.

---

## 5. Select a model and chat

```
/model antigravity/gemini-3.1-pro-high
```

Available model slugs:

| Slug | Display | Notes |
|---|---|---|
| `antigravity/gemini-3.6-flash-high` | Gemini 3.6 Flash (High) | Reasoning-on, fast |
| `antigravity/gemini-3.6-flash-medium` | Gemini 3.6 Flash (Medium) | Default reasoning |
| `antigravity/gemini-3.5-flash-medium` | Gemini 3.5 Flash (Medium) | Fallback |
| `antigravity/gemini-3.1-pro-high` | Gemini 3.1 Pro (High) | Deep reasoning |
| `antigravity/claude-sonnet-4-6` | Claude Sonnet 4.6 (Thinking) | Anthropic via Google routing |
| `antigravity/claude-opus-4-6` | Claude Opus 4.6 (Thinking) | Anthropic via Google routing |
| `antigravity/gpt-oss-120b-medium` | GPT-OSS 120B (Medium) | Open-source model |

All models report `cost: 0` because the user's subscription bills Google, not the per-token API.

Now send a message:

```
> write a haiku about the Antigravity CLI
```

---

## 6. Verify it's working

```bash
# Make a direct test call (no opencode required):
agy -p "what is 2+2?"
# Should return: "4" (or similar) without re-prompting

# Check the auth marker:
cat ~/.local/share/opencode/auth.json | head -20
# Should show: "google": { "type": "oauth", "access": "antigravity-managed", ... }

# Check process telemetry:
ps aux | grep agy   # should show one running process while a request is in flight
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Antigravity CLI is not installed` | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` |
| `unparseable version` from preflight | Update `agy`: `agy update` or reinstall |
| `infinite "Authentication required" loop` (CI/SSH only) | Set `GEMINI_FORCE_FILE_STORAGE=true TZ=UTC agy -p "test"` to work around upstream `antigravity-cli#53` |
| `/connect antigravity` shows only API-key option | Plugin didn't load — check `~/.config/opencode/opencode.json` for `plugin_origins` typo and restart opencode |
| `Ctrl+C` doesn't kill the request | Update opencode to the fork (`code-review-fixes-assist` branch) — ABORT-001 fix |
| Stuck on "loading model" | Check `ps aux \| grep agy` — if 0 processes, run `agy -p "test"` in a terminal to re-establish the keyring session |

---

## What's next

- **Run the full test suite**: `./script/test.sh full` — typecheck + lint + 137 unit tests
- **Read the deep code review**: `CODE_REVIEW.md` — 1586 lines, 27 tickets, R1-R4 evidence gate
- **Submit a bug**: https://github.com/M3NT1/antigravity-provider-for-opencode/issues
- **Contribute**: see `CODE_REVIEW.md` for the open P2/P3 tickets