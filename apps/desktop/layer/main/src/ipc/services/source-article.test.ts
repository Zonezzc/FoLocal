import { beforeEach, describe, expect, it, vi } from "vitest"

import { SourceArticleService } from "./source-article"

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  ownerURL: "app://folo.is/index.html",
}))
vi.mock("electron", () => ({
  app: { isPackaged: true },
  BrowserWindow: class {},
  session: { fromPartition: () => ({ fetch: mocks.fetch }) },
}))
vi.mock("electron-ipc-decorator", () => ({
  IpcService: class {},
  IpcMethod: () => () => {},
  getIpcContext: () => ({ sender: { getURL: () => mocks.ownerURL } }),
}))
beforeEach(() => {
  mocks.fetch.mockReset()
  mocks.ownerURL = "app://folo.is/index.html"
})
describe("source page transport", () => {
  it("fetches HTML from the original URL, preserving the snapshot origin", async () => {
    mocks.fetch.mockResolvedValue(
      new Response("<article>原文</article>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    )
    const page = await new SourceArticleService().capture({ url: "https://source.test/article" })
    expect(page.html).toContain("原文")
    expect(page.mode).toBe("static")
    expect(page.url).toBe("https://source.test/article")
    expect(mocks.fetch.mock.calls[0]?.[0]).toBe(page.url)
  })
  it("rejects remote callers and non-HTTP sources before networking", async () => {
    mocks.ownerURL = "https://source.test/article"
    await expect(
      new SourceArticleService().capture({ url: "https://source.test/article" }),
    ).rejects.toThrow("Untrusted")
    await expect(new SourceArticleService().capture({ url: "file:///etc/passwd" })).rejects.toThrow(
      "HTTP",
    )
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it("does not treat JSON or HTTP errors as source articles", async () => {
    mocks.fetch.mockResolvedValue(Response.json({ content: "RSS summary" }))
    await expect(
      new SourceArticleService().capture({ url: "https://source.test/article" }),
    ).rejects.toThrow("HTML")
    mocks.fetch.mockResolvedValue(
      new Response("Access denied", { status: 403, headers: { "content-type": "text/html" } }),
    )
    await expect(
      new SourceArticleService().capture({ url: "https://source.test/article" }),
    ).rejects.toThrow("HTTP 403")
  })
})
