import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ setName: vi.fn(), setPath: vi.fn(), register: vi.fn() }))
vi.mock("electron", () => ({
  app: { getPath: () => "/profiles", setName: mocks.setName, setPath: mocks.setPath },
  protocol: { registerSchemesAsPrivileged: mocks.register },
}))

describe("desktop startup profile selection", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv("DEV", false)
    vi.stubEnv("FOLO_E2E_USER_DATA_DIR", undefined)
  })
  afterEach(() => vi.unstubAllEnvs())

  it("boots production into FoLocal without opening the official Folo profile", async () => {
    await import("./before-bootstrap")
    expect(mocks.setName).toHaveBeenCalledWith("FoLocal")
    expect(mocks.setPath).toHaveBeenCalledExactlyOnceWith("userData", "/profiles/FoLocal")
  })

  it("keeps the development profile separate", async () => {
    vi.stubEnv("DEV", true)
    await import("./before-bootstrap")
    expect(mocks.setPath).toHaveBeenCalledExactlyOnceWith("userData", "/profiles/FoLocal(dev)")
  })

  it("honors an explicitly isolated test profile", async () => {
    vi.stubEnv("FOLO_E2E_USER_DATA_DIR", "/test-only/profile")
    await import("./before-bootstrap")
    expect(mocks.setPath).toHaveBeenCalledExactlyOnceWith("userData", "/test-only/profile")
  })
})
