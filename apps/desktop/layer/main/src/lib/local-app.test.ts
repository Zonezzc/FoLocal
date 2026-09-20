import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  configure: vi.fn(),
  online: vi.fn().mockReturnValue(true),
  configureOnline: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  proxy: vi.fn().mockResolvedValue(undefined),
  once: vi.fn(),
}))
vi.mock("electron", () => ({
  app: { getPath: () => "/isolated/profile", once: mocks.once },
  net: { fetch: mocks.fetch, isOnline: mocks.online },
}))
vi.mock("./proxy", () => ({ updateProxy: mocks.proxy }))
vi.mock("@follow/server", () => ({
  app: { request: vi.fn() },
  setNetworkFetch: mocks.configure,
  setNetworkOnline: mocks.configureOnline,
  startRefreshScheduler: mocks.start,
  stopRefreshScheduler: mocks.stop,
}))
beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})
describe("local server network integration", () => {
  it("initializes once and routes server requests through the configured Chromium session", async () => {
    const { getLocalApp } = await import("./local-app")
    const [first, second] = await Promise.all([getLocalApp(), getLocalApp()])
    expect(first).toBe(second)
    expect(mocks.start).toHaveBeenCalledOnce()
    expect(mocks.configureOnline.mock.calls[0]![0]()).toBe(true)
    expect(mocks.online).toHaveBeenCalledOnce()
    expect(mocks.proxy).toHaveBeenCalledOnce()
    const transport = mocks.configure.mock.calls[0]![0] as typeof fetch
    const signal = new AbortController().signal
    await transport("http://127.0.0.1:8317/v1/models", { signal })
    expect(mocks.fetch).toHaveBeenCalledWith("http://127.0.0.1:8317/v1/models", { signal })
    expect(mocks.proxy.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.configure.mock.invocationCallOrder[0]!,
    )
  })
})
