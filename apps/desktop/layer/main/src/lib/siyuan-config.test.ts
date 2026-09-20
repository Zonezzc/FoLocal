import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

import { join } from "pathe"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { readSiyuanConfig, saveSiyuanConfig } from "./siyuan-config"

const state = vi.hoisted(() => ({ directory: "", encrypted: true }))
vi.mock("electron", () => ({
  app: { getPath: () => state.directory },
  safeStorage: {
    isEncryptionAvailable: () => state.encrypted,
    encryptString: (value: string) => Buffer.from(value.split("").reverse().join("")),
    decryptString: (value: Buffer) => value.toString().split("").reverse().join(""),
  },
}))

beforeEach(() => {
  state.directory = mkdtempSync(join(tmpdir(), "folocal-siyuan-config-"))
  state.encrypted = true
})
afterEach(() => rmSync(state.directory, { recursive: true, force: true }))
describe("SiYuan credential storage", () => {
  it("stores an encrypted token and never reuses it for a different endpoint", () => {
    const config = { endpoint: "http://localhost:6806", notebook: "book", path: "/FoLocal" }
    saveSiyuanConfig({ ...config, token: "private-token" })
    expect(readFileSync(join(state.directory, "siyuan.json"), "utf8")).not.toContain(
      "private-token",
    )
    saveSiyuanConfig(config)
    expect(readSiyuanConfig().token).toBe("private-token")
    saveSiyuanConfig({ ...config, endpoint: "http://localhost:6807" })
    expect(readSiyuanConfig().token).toBe("")
  })
  it("fails closed when encryption is unavailable", () => {
    state.encrypted = false
    expect(() =>
      saveSiyuanConfig({
        endpoint: "http://localhost:6806",
        notebook: "book",
        path: "/",
        token: "secret",
      }),
    ).toThrow("Secure credential")
  })
})
