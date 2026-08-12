import { installCommandForPlatform, installInstructionsForPlatform } from "./constants.js"
import { defaultSpawn, type SpawnFn, type SpawnedProcess } from "./spawn.js"
import { AgyExecutionError } from "./errors.js"

// Run the platform-specific install command. The subprocess inherits
// stdout/stderr so the user sees the curl progress / PowerShell output
// in their terminal — the same behavior the Sentient-OS
// install flow exhibits. This is intentional: a silent install would
// leave the user staring at a spinner wondering if anything is
// happening.
//
// Returns the spawned process so the caller can attach additional
// listeners or pipe the streams elsewhere.
export function install(
  spawnFn: SpawnFn = defaultSpawn,
  platform: NodeJS.Platform = process.platform,
): SpawnedProcess {
  const cmd = installCommandForPlatform(platform)
  // stdio: [ignore, inherit, inherit] keeps stdin detached but routes
  // both stdout and stderr to the user's terminal so they see the
  // install progress.
  return spawnFn(cmd.cmd, cmd.args, {
    stdio: ["ignore", "inherit", "inherit"],
    timeout: 5 * 60 * 1000, // 5 minutes; the curl|bash can be slow
  })
}

// Pure (no spawn) helpers for tests and tooling.
export { installCommandForPlatform, installInstructionsForPlatform }

// Re-export so the auth flow can import from a single place.
export { AgyExecutionError }
