import { describe, expect, it } from "vitest"

import { getLocalUrlIcon } from "./local-icons"

describe("local site icons", () => {
  it("requests only the site's origin and keeps the fallback offline", () => {
    const icon = getLocalUrlIcon("https://www.example.com/private/feed?token=not-for-icons")
    expect(icon.src).toBe("https://www.example.com/favicon.ico")
    expect(icon.fallbackUrl).toMatch(/^data:image\/svg\+xml/)
    expect(icon.fallbackUrl).not.toContain("not-for-icons")
  })

  it.each(["", "invalid", "file:///private/file", "javascript:alert(1)"])(
    "uses a safe offline image for %s",
    (value) => {
      const icon = getLocalUrlIcon(value)
      expect(icon.src).toBe(icon.fallbackUrl)
      expect(decodeURIComponent(icon.fallbackUrl)).not.toContain("<script")
    },
  )
})
