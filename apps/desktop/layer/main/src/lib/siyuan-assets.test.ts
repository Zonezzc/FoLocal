import { describe, expect, it } from "vitest"

import { articleAssetDirectory, assetDirectory } from "./siyuan-assets"

describe("SiYuan resource directories", () => {
  it("groups resources below a configurable folder by day and article", () => {
    expect(assetDirectory()).toBe("/assets/FoLocal/")
    expect(articleAssetDirectory("assets/网页剪贴", "article-1")).toMatch(
      /^\/assets\/网页剪贴\/\d{4}-\d{2}-\d{2}\/article-1\/$/,
    )
  })
  it.each([
    "/",
    "/assets/",
    "/data/assets/",
    "assets/../secret",
    "assets/a/../../b",
    "assets/a%2fb",
    "assets/a\\b",
    "assets//b",
  ])("rejects unsafe or root directory %s", (path) => {
    expect(() => assetDirectory(path)).toThrow("subdirectory")
  })
})
