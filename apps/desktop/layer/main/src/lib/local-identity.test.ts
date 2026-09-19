import { describe, expect, it } from "vitest"

import { getLocalUserDataPath, LOCAL_APP_ID, LOCAL_APP_PROTOCOL } from "./local-identity"

describe("local application isolation", () => {
  it("keeps production, development and test profiles separate from Folo", () => {
    expect(getLocalUserDataPath("/profiles", false)).toBe("/profiles/FoLocal")
    expect(getLocalUserDataPath("/profiles", true)).toBe("/profiles/FoLocal(dev)")
    expect(getLocalUserDataPath("/profiles", false, "/isolated/test")).toBe("/isolated/test")
    expect(LOCAL_APP_ID).not.toBe("is.follow")
    expect(["folo", "follow"]).not.toContain(LOCAL_APP_PROTOCOL)
  })
})
