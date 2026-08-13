import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "path"

import { locateBinary, verifyVersion, preflight } from "../src/cli.js"
import { AgyNotInstalledError } from "../src/errors.js"
import type { SpawnFn, SpawnedProcess } from "../src/spawn.js"
import { Readable } from "node:stream"

// ===== locateBinary =====

function makeExecutable(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, "#!/bin/sh\necho agy\n")
  fs.chmodSync(filePath, 0o755)
}

describe("locateBinary", () => {
  let tmpHome: string
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "agy-locator-"))
  })
  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("finds darwin binary at ~/.local/bin/agy", () => {
    const bin = path.join(tmpHome, ".local", "bin", "agy")
    makeExecutable(bin)
    expect(locateBinary("darwin", tmpHome, {})).toBe(bin)
  })

  it("finds linux binary at ~/.local/bin/agy", () => {
    const bin = path.join(tmpHome, ".local", "bin", "agy")
    makeExecutable(bin)
    expect(locateBinary("linux", tmpHome, {})).toBe(bin)
  })

  it("finds windows binary at %LOCALAPPDATA%/agy/bin/agy.exe", () => {
    const localAppData = path.join(tmpHome, "AppData", "Local")
    const bin = path.join(localAppData, "agy", "bin", "agy.exe")
    makeExecutable(bin)
    expect(locateBinary("win32", tmpHome, { LOCALAPPDATA: localAppData })).toBe(bin)
  })

  it("falls back to PATH / which", () => {
    const dir = path.join(tmpHome, "bin")
    fs.mkdirSync(dir, { recursive: true })
    const bin = path.join(dir, "agy")
    makeExecutable(bin)
    expect(locateBinary("linux", tmpHome, { PATH: dir })).toBe(bin)
  })

  it("returns null when the binary is missing everywhere", () => {
    expect(locateBinary("linux", tmpHome, { PATH: "/nonexistent" })).toBeNull()
  })

  it("ignores non-executable files at the default path", () => {
    const dir = path.join(tmpHome, ".local", "bin")
    fs.mkdirSync(dir, { recursive: true })
    const bin = path.join(dir, "agy")
    fs.writeFileSync(bin, "not executable")
    fs.chmodSync(bin, 0o644)
    expect(locateBinary("darwin", tmpHome, {})).toBeNull()
  })

  it("treats files that exist but are directories as missing", () => {
    const dir = path.join(tmpHome, ".local", "bin", "agy")
    fs.mkdirSync(dir, { recursive: true })
    expect(locateBinary("darwin", tmpHome, {})).toBeNull()
  })
})

// ===== verifyVersion =====

function fakeStream(text: string): Readable {
  return Readable.from(Buffer.from(text, "utf8")) as unknown as Readable
}

function fakeSpawn(stdout: string, stderr: string, code: number | null): SpawnFn {
  return () => {
    const proc: SpawnedProcess = {
      stdout: fakeStream(stdout),
      stderr: fakeStream(stderr),
      exited: Promise.resolve(code),
      kill: () => true,
    }
    return proc
  }
}

describe("verifyVersion", () => {
  it("parses 'agy X.Y.Z'", async () => {
    const v = await verifyVersion("/some/agy", fakeSpawn("agy 1.1.12\n", "", 0))
    expect(v).toBe("1.1.12")
  })

  it("parses 'Antigravity CLI X.Y.Z'", async () => {
    const v = await verifyVersion("/some/agy", fakeSpawn("Antigravity CLI 2.0.0\n", "", 0))
    expect(v).toBe("2.0.0")
  })

  it("parses 'vX.Y.Z'", async () => {
    const v = await verifyVersion("/some/agy", fakeSpawn("v0.3.1\n", "", 0))
    expect(v).toBe("0.3.1")
  })

  it("reads version from stderr if stdout is empty", async () => {
    const v = await verifyVersion("/some/agy", fakeSpawn("", "version 1.2.3\n", 0))
    expect(v).toBe("1.2.3")
  })

  it("throws AgyNotInstalledError on non-zero exit", async () => {
    await expect(verifyVersion("/some/agy", fakeSpawn("", "permission denied", 1))).rejects.toBeInstanceOf(
      AgyNotInstalledError,
    )
  })

  it("throws AgyNotInstalledError when no version is found", async () => {
    await expect(verifyVersion("/some/agy", fakeSpawn("unparseable garbage", "", 0))).rejects.toBeInstanceOf(
      AgyNotInstalledError,
    )
  })

  it("includes the install instructions in the error message", async () => {
    try {
      await verifyBinaryThrows()
    } catch (err) {
      expect((err as Error).message).toContain("curl -fsSL https://antigravity.google/cli/install.sh")
    }
  })

  async function verifyBinaryThrows() {
    await verifyVersion("/some/agy", fakeSpawn("", "EACCES", 1))
  }
})

// ===== preflight =====

describe("preflight", () => {
  let tmpHome: string
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "agy-preflight-"))
  })
  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("returns { binary, version } when installed", async () => {
    const bin = path.join(tmpHome, ".local", "bin", "agy")
    makeExecutable(bin)
    const result = await preflight(fakeSpawn("agy 1.1.8\n", "", 0), "darwin", tmpHome, {})
    expect(result.binary).toBe(bin)
    expect(result.version).toBe("1.1.8")
  })

  it("throws AgyNotInstalledError when binary is missing", async () => {
    await expect(
      preflight(fakeSpawn("never called", "", 0), "linux", tmpHome, { PATH: "/nonexistent" }),
    ).rejects.toBeInstanceOf(AgyNotInstalledError)
  })

  it("the error message includes the install command for the running platform", async () => {
    try {
      await preflight(fakeSpawn("noop", "", 0), "linux", tmpHome, { PATH: "/nonexistent" })
      throw new Error("expected to throw")
    } catch (err) {
      expect(err).toBeInstanceOf(AgyNotInstalledError)
      expect((err as AgyNotInstalledError).message).toContain(
        "curl -fsSL https://antigravity.google/cli/install.sh",
      )
    }
  })

  it("uses PowerShell instruction on win32", async () => {
    try {
      const localAppData = path.join(tmpHome, "AppData", "Local")
      await preflight(fakeSpawn("noop", "", 0), "win32", tmpHome, { LOCALAPPDATA: localAppData })
      throw new Error("expected to throw")
    } catch (err) {
      expect(err).toBeInstanceOf(AgyNotInstalledError)
      expect((err as AgyNotInstalledError).message).toContain("irm https://antigravity.google/cli/install.ps1")
    }
  })

  it("uses PATHEXT env when looking up agy on Windows", async () => {
    // PATHEXT-001: respect user-customized PATHEXT (defaults to common
    // extensions if unset). Empty string first to prefer exact match.
    // On case-sensitive test filesystems the filename must match the
    // PATHEXT case (Windows itself is case-insensitive in practice).
    const dir = path.join(tmpHome, "bin")
    fs.mkdirSync(dir, { recursive: true })
    const bin = path.join(dir, "agy.CMD")
    fs.writeFileSync(bin, "echo ok\n")
    fs.chmodSync(bin, 0o755)
    expect(
      locateBinary("win32", tmpHome, {
        PATH: dir,
        PATHEXT: ".CMD;.EXE",
      }),
    ).toBe(bin)
  })

  it("falls back to default Windows PATHEXT order when PATHEXT is unset", async () => {
    // The default order is .COM;.EXE;.BAT;.CMD;… — uppercase to match
    // the vscode/varlock/orca convention. On case-sensitive test
    // filesystems the filename must use the matching case.
    const dir = path.join(tmpHome, "bin")
    fs.mkdirSync(dir, { recursive: true })
    const bin = path.join(dir, "agy.CMD")
    fs.writeFileSync(bin, "echo ok\n")
    fs.chmodSync(bin, 0o755)
    expect(locateBinary("win32", tmpHome, { PATH: dir })).toBe(bin)
  })

  it("surfaces the antigravity-cli#53 workaround on SSH/CI + non-UTC", async () => {
    // HEADLESS-001: when SSH/CI + non-UTC is detected AND verifyVersion
    // fails, the error message must mention the upstream workaround.
    // Provide an agy binary at the default path so locateBinary
    // succeeds and we hit the verifyVersion / headless code path.
    const savedTz = process.env["TZ"]
    process.env["TZ"] = "Asia/Tokyo"
    const bin = path.join(tmpHome, ".local", "bin", "agy")
    makeExecutable(bin)
    ;(os.homedir as () => string) = () => tmpHome
    try {
      const env = { ...process.env, SSH_CLIENT: "1" }
      // fakeSpawn returns code 1 to simulate verifyVersion failure
      // (agy runs but exits non-zero).
      await preflight(fakeSpawn("noop", "", 1), "linux", tmpHome, env)
      throw new Error("expected to throw")
    } catch (err) {
      expect(err).toBeInstanceOf(AgyNotInstalledError)
      const msg = (err as AgyNotInstalledError).message
      expect(msg).toContain("headless + non-UTC")
      expect(msg).toContain("GEMINI_FORCE_FILE_STORAGE=true")
      expect(msg).toContain("TZ=UTC")
    } finally {
      if (savedTz === undefined) delete process.env["TZ"]
      else process.env["TZ"] = savedTz
    }
  })

it("throws AgyNotInstalledError when agy version is below 1.1.8 (DOC-001)", async () => {
    // DOC-001: the plugin requires agy >= 1.1.8 (introduced
    // --output-format stream-json). The preflight parses the version
    // output and rejects older versions.
    const bin = path.join(tmpHome, ".local", "bin", "agy")
    makeExecutable(bin)
    ;(os.homedir as () => string) = () => tmpHome
    try {
      // fakeSpawn returns "1.0.0" + code 0 — version parse succeeds,
      // but the semver check rejects the version.
      await preflight(fakeSpawn("Antigravity CLI 1.0.0\n", "", 0), "linux", tmpHome, {})
      throw new Error("expected to throw")
    } catch (err) {
      expect(err).toBeInstanceOf(AgyNotInstalledError)
      const msg = (err as AgyNotInstalledError).message
      expect(msg).toContain("1.0.0")
      expect(msg).toContain("minimum required (1.1.8)")
      expect(msg).toContain("upgrade agy to >= 1.1.8")
    }
  })

  it("accepts agy versions >= 1.1.8 (DOC-001)", async () => {
    const bin = path.join(tmpHome, ".local", "bin", "agy")
    makeExecutable(bin)
    ;(os.homedir as () => string) = () => tmpHome
    const result = await preflight(
      fakeSpawn("Antigravity CLI 1.1.8\n", "", 0),
      "linux",
      tmpHome,
      {},
    )
    expect(result.binary).toBe(bin)
    expect(result.version).toBe("1.1.8")
  })
})
