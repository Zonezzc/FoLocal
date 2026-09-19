import { describe, expect, it } from "vitest"

import { normalizeFeedImage } from "./feed-image.js"

describe("feed image normalization", () => {
  it("resolves imported relative and whitespace-padded image URLs", () => {
    expect(normalizeFeedImage(" logo.jpg ", "https://example.com/blog/")).toBe(
      "https://example.com/blog/logo.jpg",
    )
    expect(normalizeFeedImage("\n https://cdn.example.com/icon.png \n", null)).toBe(
      "https://cdn.example.com/icon.png",
    )
    expect(normalizeFeedImage("//cdn.example.com/icon.png", "https://example.com")).toBe(
      "https://cdn.example.com/icon.png",
    )
  })

  it.each([null, "", "file:///private/icon.png", "javascript:alert(1)"])(
    "does not expose a local file or executable URL: %s",
    (image) => expect(normalizeFeedImage(image, "https://example.com")).toBeNull(),
  )
})
