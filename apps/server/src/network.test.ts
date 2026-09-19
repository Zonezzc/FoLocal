import { describe, expect, it, vi } from "vitest"

import { describeNetworkError, networkFetch, setNetworkFetch } from "./network.js"

describe("desktop transport", () => {
  it("uses the injected transport and preserves cancellation and HTTP validators", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 304 }))
    setNetworkFetch(transport)
    const controller = new AbortController()
    const init = { headers: { "if-none-match": "test" }, signal: controller.signal }
    const result = await networkFetch("https://feed.test/rss", init)
    expect(transport).toHaveBeenCalledWith("https://feed.test/rss", init)
    expect(result.status).toBe(304)
  })
  it("retains the network cause while removing URLs that may contain tokens", () => {
    const cause = Object.assign(new Error("https://private.test/feed?token=secret"), {
      code: "ECONNREFUSED",
    })
    const message = describeNetworkError(new Error("fetch failed", { cause }))
    expect(message).toContain("ECONNREFUSED")
    expect(message).not.toContain("secret")
  })
})
