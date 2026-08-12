import { describe, expect, it } from "bun:test"
import { Readable } from "node:stream"

import { install, installCommandForPlatform, installInstructionsForPlatform } from "../src/install.js"
import { AgyExecutionError } from "../src/errors.js"
import type { SpawnFn, SpawnedProcess } from "../src/spawn.js"

describe("installCommandForPlatform", () => {
  it("returns the curl|bash command on darwin", () => {
    const cmd = installCommandForPlatform("darwin")
    expect(cmd.cmd).toBe("bash")
    expect(cmd.args).toEqual(["-c", "curl -fsSL https://antigravity.google/cli/install.sh | bash"])
  })

  it("returns the curl|bash command on linux", () => {
    const cmd = installCommandForPlatform("linux")
    expect(cmd.cmd).toBe("bash")
    expect(cmd.args[0]).toBe("-c")
    expect(cmd.args[1]).toContain("curl -fsSL https://antigravity.google/cli/install.sh")
  })

  it("returns the PowerShell command on win32", () => {
    const cmd = installCommandForPlatform("win32")
    expect(cmd.cmd).toBe("powershell.exe")
    expect(cmd.args).toContain("-NoProfile")
    expect(cmd.args[2]).toBe("irm https://antigravity.google/cli/install.ps1 | iex")
  })

  it("throws on unsupported platforms", () => {
    expect(() => installCommandForPlatform("aix" as NodeJS.Platform)).toThrow(/Unsupported platform/)
  })
})

describe("installInstructionsForPlatform", () => {
  it("returns the curl line on darwin", () => {
    const text = installInstructionsForPlatform("darwin")
    expect(text).toContain("curl -fsSL https://antigravity.google/cli/install.sh")
    expect(text).toContain("Then retry this auth method")
  })

  it("returns the PowerShell + CMD lines on win32", () => {
    const text = installInstructionsForPlatform("win32")
    expect(text).toContain("irm https://antigravity.google/cli/install.ps1")
    expect(text).toContain("install.cmd")
  })
})

describe("install spawn", () => {
  function fakeSpawn(
    captured: { cmd?: string; args?: readonly string[]; stdio?: readonly unknown[] } | null,
    code: number | null = 0,
  ): SpawnFn {
    return (cmd, args, options) => {
      if (captured) {
        captured.cmd = cmd
        captured.args = args
        captured.stdio = options.stdio
      }
      const proc: SpawnedProcess = {
        stdout: Readable.from([]),
        stderr: Readable.from([]),
        exited: Promise.resolve(code),
        kill: () => true,
      }
      return proc
    }
  }

  it("spawns the platform command and inherits stdout/stderr", () => {
    const captured: { cmd?: string; args?: readonly string[]; stdio?: readonly unknown[] } = {}
    install(fakeSpawn(captured), "darwin")
    expect(captured.cmd).toBe("bash")
    expect(captured.stdio).toEqual(["ignore", "inherit", "inherit"])
  })

  it("keeps stdin detached (ignore)", () => {
    const captured: { stdio?: readonly unknown[] } = {}
    install(fakeSpawn(captured), "win32")
    expect(captured.stdio?.[0]).toBe("ignore")
  })

  it("forwards the spawn call to the underlying CLI args", () => {
    const captured: { args?: readonly string[] } = {}
    install(fakeSpawn(captured), "win32")
    expect(captured.args).toContain("-NoProfile")
    expect(captured.args).toContain("irm https://antigravity.google/cli/install.ps1 | iex")
  })
})

describe("AgyExecutionError", () => {
  it("is a typed Error subclass", () => {
    const err = new AgyExecutionError("install failed")
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe("AgyExecutionError")
    expect(err.message).toBe("install failed")
  })
})
