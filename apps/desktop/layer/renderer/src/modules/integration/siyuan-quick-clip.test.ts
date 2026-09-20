import type { TFunction } from "i18next"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { quickClipToSiyuan } from "./siyuan-quick-clip"

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  save: vi.fn(),
  progress: vi.fn(),
  openDocument: vi.fn(),
  acquire: vi.fn(),
  loading: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock("~/lib/client", () => ({ ipcServices: { siyuan: mocks } }))
vi.mock("./source-article", () => ({ acquireSourceArticle: mocks.acquire }))
vi.mock("sonner", () => ({ toast: mocks }))
const t = ((key: string) => key) as TFunction<"settings">
const url = "https://example.org/article"
beforeEach(() => {
  vi.resetAllMocks()
  mocks.settings.mockResolvedValue({ notebook: "book" })
  mocks.acquire.mockResolvedValue({ title: "Article", images: [] })
  mocks.save.mockResolvedValue({ state: "complete", docId: "20260921120000-abcdefg" })
})
afterEach(() => vi.useRealTimers())
describe("background SiYuan clipping", () => {
  it("saves without opening a panel and offers the verified document", async () => {
    const open = vi.fn()
    await quickClipToSiyuan(url, t, open)
    expect(open).not.toHaveBeenCalled()
    expect(mocks.acquire).toHaveBeenCalledWith(url, false, true)
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Article" }),
      false,
      expect.any(String),
    )
    expect(mocks.success).toHaveBeenCalledWith(
      "siyuan.saved",
      expect.objectContaining({ action: expect.any(Object) }),
    )
    mocks.success.mock.calls[0]![1].action.onClick()
    expect(mocks.openDocument).toHaveBeenCalledWith("20260921120000-abcdefg")
  })
  it("offers setup when the destination is missing without extracting or saving", async () => {
    mocks.settings.mockResolvedValue({ notebook: "" })
    const open = vi.fn()
    await quickClipToSiyuan(url, t, open)
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.acquire).not.toHaveBeenCalled()
    mocks.error.mock.calls[0]![1].action.onClick()
    expect(open).toHaveBeenCalledOnce()
  })
  it("coalesces repeated shortcuts and stops polling after completion", async () => {
    vi.useFakeTimers()
    let resolveSave!: (result: { state: string }) => void
    mocks.save.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve
        }),
    )
    mocks.progress.mockResolvedValue({
      state: "uploading",
      imageCount: 4,
      uploaded: 1,
      download: { index: 2, received: 1024, total: 2048 },
    })
    const first = quickClipToSiyuan(url, t, vi.fn())
    await quickClipToSiyuan(`${url}#reply0`, t, vi.fn())
    await vi.advanceTimersByTimeAsync(250)
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(mocks.loading).toHaveBeenCalledWith(
      "siyuan.state_uploading",
      expect.objectContaining({ description: expect.any(Object) }),
    )
    resolveSave({ state: "complete" })
    await first
    const count = mocks.progress.mock.calls.length
    await vi.advanceTimersByTimeAsync(1000)
    expect(mocks.progress).toHaveBeenCalledTimes(count)
  })
  it("replaces the loading toast with a retryable error and never reports false success", async () => {
    mocks.save.mockResolvedValueOnce({ state: "failed", error: "Image unavailable" })
    await quickClipToSiyuan(url, t, vi.fn())
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith(
      "siyuan.failed",
      expect.objectContaining({ id: `siyuan-${url}`, description: "Image unavailable" }),
    )
    await quickClipToSiyuan(url, t, vi.fn())
    expect(mocks.success).toHaveBeenCalledOnce()
  })
})
