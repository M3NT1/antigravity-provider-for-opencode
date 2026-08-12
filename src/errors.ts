// Typed errors raised by the plugin. The opencode auth UI surfaces
// these messages verbatim, so the strings must be actionable
// (include the install command) and human-readable.

export class AgyNotInstalledError extends Error {
  readonly platform: NodeJS.Platform
  constructor(platform: NodeJS.Platform, message: string) {
    super(message)
    this.name = "AgyNotInstalledError"
    this.platform = platform
  }
}

export class AgyAuthMissingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AgyAuthMissingError"
  }
}

export class AgySpawnError extends Error {
  readonly exitCode: number | null
  readonly stderr: string
  constructor(exitCode: number | null, stderr: string) {
    super(`Antigravity CLI exited with code ${exitCode ?? "unknown"}: ${stderr.trim() || "no stderr"}`)
    this.name = "AgySpawnError"
    this.exitCode = exitCode
    this.stderr = stderr
  }
}

export class AgyParseError extends Error {
  readonly line: string
  constructor(line: string, message: string) {
    super(message)
    this.name = "AgyParseError"
    this.line = line
  }
}

export class AgyUnsupportedModelError extends Error {
  readonly slug: string
  constructor(slug: string) {
    super(`Antigravity CLI does not recognize model slug: ${slug}\nRun 'agy models' for the supported list.`)
    this.name = "AgyUnsupportedModelError"
    this.slug = slug
  }
}

export class AgyExecutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AgyExecutionError"
  }
}
