import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

import { join } from "pathe"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { parseFeedDate } from "./feed-date.js"
import { MAX_FEED_BYTES, parseFeedDocument, readFeedBody } from "./feed-document.js"
import { FeedFetchError } from "./feed-errors.js"

const folder = mkdtempSync(join(tmpdir(), "folocal-rss-reliability-"))
vi.stubEnv("DATABASE_PATH", join(folder, "test.db"))
const { db } = await import("./db.js")
const { refreshFeed } = await import("./rss.js")
const fetchMock = vi.fn<typeof fetch>()
const fixture = (date = "", content = "<description>Body</description>") =>
  `<rss><channel><title>Fixture</title><item><guid>stable</guid><title>Article</title>${date}${content}</item></channel></rss>`

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-20T00:00:00Z"))
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  db.exec("DELETE FROM feeds")
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
afterAll(() => {
  db.close()
  rmSync(folder, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe("feed publication dates", () => {
  it.each([
    ["週二, 1 九月 2026 12:53:00 +0000", "2026-09-01T12:53:00.000Z"],
    ["星期日, 16 八月 2026 08:13:00 +0800", "2026-08-16T00:13:00.000Z"],
    ["周三, 4 十一月 2026 12:26:00 +0000", "2026-11-04T12:26:00.000Z"],
    ["2026-01-01T12:00:00Z", "2026-01-01T12:00:00.000Z"],
    ["invalid", null],
    [null, null],
  ])("parses %s without substituting the current time", (input, expected) => {
    expect(parseFeedDate(input)).toBe(expected)
  })
  it.each(["", "<pubDate>invalid</pubDate>"])(
    "preserves existing dates when a refresh has %s",
    async (date) => {
      fetchMock.mockImplementation(async () => new Response(fixture(date)))
      await refreshFeed("https://fixture.test/rss")
      const original = db.prepare("SELECT * FROM entries").get()!
      db.prepare("INSERT INTO reads(user_id,entry_id,read_at) VALUES(?,?,?)").run(
        "local-user",
        String(original.id),
        String(original.inserted_at),
      )
      vi.setSystemTime(new Date("2026-09-21T00:00:00Z"))
      await refreshFeed("https://fixture.test/rss")
      expect(db.prepare("SELECT id,published_at,inserted_at FROM entries").all()).toEqual([
        { id: original.id, published_at: original.published_at, inserted_at: original.inserted_at },
      ])
      expect(db.prepare("SELECT COUNT(*) n FROM reads").get()!.n).toBe(1)
    },
  )
  it("repairs previously overwritten dates when the source has a recognizable date", async () => {
    fetchMock.mockImplementation(async () => new Response(fixture()))
    await refreshFeed("https://fixture.test/rss")
    fetchMock.mockImplementation(
      async () => new Response(fixture("<pubDate>週二, 1 九月 2026 12:53:00 +0000</pubDate>")),
    )
    await refreshFeed("https://fixture.test/rss")
    expect(db.prepare("SELECT published_at FROM entries").get()!.published_at).toBe(
      "2026-09-01T12:53:00.000Z",
    )
  })
  it("uses a valid alternative date when pubDate is invalid", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(fixture("<pubDate>invalid</pubDate><dc:date>2020-01-01T00:00:00Z</dc:date>")),
    )
    await refreshFeed("https://fixture.test/rss")
    expect(db.prepare("SELECT published_at FROM entries").get()!.published_at).toBe(
      "2020-01-01T00:00:00.000Z",
    )
  })
})

describe("bounded feed parsing", () => {
  it("repairs mismatched CDATA wrappers without parsing article HTML as XML", async () => {
    const html = `<p>Article &amp; code</p>${"<br>".repeat(110)}`
    fetchMock.mockImplementation(
      async () => new Response(fixture("", `<description>&lt;![CDATA[${html}]]></description>`)),
    )
    await refreshFeed("https://fixture.test/rss")
    expect(db.prepare("SELECT description FROM entries").get()!.description).toBe(html)
  })
  it("preserves correctly escaped literal text and proper CDATA", () => {
    const doc = parseFeedDocument(
      "<rss><channel><description>&lt;![CDATA[literal]]&gt;</description><item><description><![CDATA[<p>HTML</p>]]></description></item></channel></rss>",
    )
    expect(doc).toMatchObject({
      rss: {
        channel: {
          description: "<![CDATA[literal]]>",
          item: { description: [{ "#text": "<p>HTML</p>" }] },
        },
      },
    })
  })
  it("still rejects excessive XML nesting", () => {
    expect(() =>
      parseFeedDocument(`<rss>${"<nested>".repeat(110)}${"</nested>".repeat(110)}</rss>`),
    ).toThrow("Maximum nested tags")
  })
  it("cancels an oversized streamed response even without Content-Length", async () => {
    const cancel = vi.fn()
    let chunks = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks++
        controller.enqueue(new Uint8Array(1024 * 1024))
      },
      cancel,
    })
    await expect(readFeedBody(new Response(body))).rejects.toThrow("10 MiB")
    expect(cancel).toHaveBeenCalledOnce()
    expect(chunks).toBeLessThanOrEqual(MAX_FEED_BYTES / (1024 * 1024) + 2)
  })
  it("classifies a missing direct feed without describing an RSSHub instance", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }))
    await expect(refreshFeed("https://fixture.test/rss")).rejects.toMatchObject({
      kind: "permanent",
      message: expect.stringContaining("feed not found"),
    })
  })
  it("preserves the parser failure category through fetch aggregation", async () => {
    fetchMock.mockResolvedValue(new Response(`<rss>${"<nested>".repeat(110)}`))
    await expect(refreshFeed("https://fixture.test/rss")).rejects.toBeInstanceOf(FeedFetchError)
  })
})
