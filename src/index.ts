// Entry point for the Antigravity provider plugin. The exported
// default is the plugin factory that opencode's plugin loader
// invokes when the user activates this plugin via plugin_origins.
//
// The shape matches @opencode-ai/plugin's Plugin type: an async
// function that takes a PluginInput and returns Promised Hooks.
// The implementation lives in src/auth.ts so this file stays a
// pure re-export, following the opencode-google-code-assist pattern
// where the package's main entry is a thin wrapper.

import { AntigravityProviderPlugin } from "./auth.js"

export const plugin = AntigravityProviderPlugin
export default AntigravityProviderPlugin
