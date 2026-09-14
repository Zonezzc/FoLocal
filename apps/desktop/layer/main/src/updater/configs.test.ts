import { describe, expect, it, vi } from "vitest"

vi.mock("@follow/shared/constants", () => ({
  DEV: false,
  MICROSOFT_STORE_BUILD: false,
  MODE: "production",
  ModeEnum: { staging: "staging" },
}))

const { appUpdaterConfig } = await import("./configs")

describe("FoLocal updater configuration", () => {
  it("does not consume the official Folo OTA channel", () => {
    expect(appUpdaterConfig.enableAppUpdate).toBe(false)
    expect(appUpdaterConfig.enableRenderHotUpdate).toBe(false)
  })
})
