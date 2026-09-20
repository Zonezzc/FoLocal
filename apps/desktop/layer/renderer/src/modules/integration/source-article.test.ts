import { beforeEach, describe, expect, it, vi } from "vitest"

import { acquireSourceArticle } from "./source-article"

const capture = vi.hoisted(() => vi.fn())
vi.mock("~/lib/client", () => ({ ipcServices: { sourceArticle: { capture } } }))

const html = `<html><head><title>Source article</title></head><body><article><p>${"Complete text from the source website. ".repeat(20)}</p></article></body></html>`
beforeEach(() => {
  capture.mockReset()
})
describe("desktop source acquisition", () => {
  it("uses the actual source HTML without requesting RSS content", async () => {
    capture.mockResolvedValue({
      url: "https://example.org/article",
      html,
      mode: "static",
      fetchedAt: "now",
    })
    const article = await acquireSourceArticle("https://example.org/article")
    expect(article.markdown).toContain("Complete text from the source website")
    expect(capture).toHaveBeenCalledExactlyOnceWith({ url: "https://example.org/article" })
  })
  it("falls back to rendered DOM when source HTML has no article", async () => {
    capture
      .mockResolvedValueOnce({
        url: "https://example.org/article",
        html: "<p>Loading</p>",
        mode: "static",
        fetchedAt: "now",
      })
      .mockResolvedValueOnce({
        url: "https://example.org/article",
        html,
        mode: "rendered",
        fetchedAt: "now",
      })
    expect((await acquireSourceArticle("https://example.org/article")).mode).toBe("rendered")
    expect(capture).toHaveBeenLastCalledWith({ url: "https://example.org/article", rendered: true })
  })
  it("reports failure when both acquisition methods fail", async () => {
    capture.mockRejectedValue(new Error("Unavailable source"))
    const result = await acquireSourceArticle("https://example.org/article").catch(
      (error: Error) => error.message,
    )
    expect(result).toBe("Unavailable source")
    expect(capture).toHaveBeenCalledTimes(2)
  })
  it("keeps the fallback browser hidden during quick clipping", async () => {
    capture.mockRejectedValueOnce(new Error("Needs rendering")).mockResolvedValueOnce({
      url: "https://example.org/article",
      html,
      mode: "rendered",
      fetchedAt: "now",
    })
    await acquireSourceArticle("https://example.org/article", false, true)
    expect(capture).toHaveBeenLastCalledWith({
      url: "https://example.org/article",
      rendered: true,
      background: true,
    })
  })
})
