import { rmSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

import { resolve } from "pathe"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const databasePath = resolve(`./data/regressions-${process.pid}.db`)
vi.stubEnv("DATABASE_PATH", databasePath)
vi.stubEnv("OPENAI_CONFIG_PATH", "")
vi.stubEnv("OPENAI_BASE_URL", "https://provider.test/v1")
vi.stubEnv("OPENAI_MODEL", "regression-model")
vi.stubEnv("OPENAI_API_KEY", "")
vi.stubEnv("RSSHUB_BASE_URL", "")
const { app } = await import("./app.js")
const { db } = await import("./db.js")
const { refreshFeed } = await import("./rss.js")
const { addInstance, routeFromURL } = await import("./rsshub.js")
const { buildOpml, parseOpml } = await import("./opml.js")
const { stopRefreshScheduler } = await import("./scheduler.js")
const fetchMock = vi.fn<typeof fetch>()
const now = "2026-09-12T00:00:00.000Z"
const rss = (items = "") =>
  `<rss version="2.0"><channel><title>Fixture</title><link>https://fixture.test/</link>${items}</channel></rss>`
const post = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
const seed = () => {
  db.prepare("INSERT INTO feeds (id,url,title,updated_at) VALUES (?,?,?,?)").run(
    "fixture-feed",
    "https://fixture.test/rss",
    "Fixture",
    now,
  )
  db.prepare("INSERT INTO subscriptions (id,user_id,feed_id,created_at) VALUES (?,?,?,?)").run(
    "fixture-sub",
    "local-user",
    "fixture-feed",
    now,
  )
  db.prepare(
    "INSERT INTO entries (id,feed_id,title,content,guid,inserted_at,published_at) VALUES (?,?,?,?,?,?,?)",
  ).run("fixture-entry", "fixture-feed", "Fixture", "Original content.", "fixture-guid", now, now)
}

beforeEach(() => {
  fetchMock.mockReset().mockRejectedValue(new Error("Unexpected external request"))
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  stopRefreshScheduler()
  db.exec(
    "DELETE FROM feeds; DELETE FROM rsshub_route_affinity; DELETE FROM local_settings; UPDATE rsshub_instances SET enabled=1;",
  )
  vi.unstubAllGlobals()
})
afterAll(() => {
  db.close()
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${databasePath}${suffix}`, { force: true })
  vi.unstubAllEnvs()
})

describe("local release regressions", () => {
  it.each([
    [false, "asc"],
    [false, "desc"],
    [true, "asc"],
    [true, "desc"],
  ] as const)(
    "paginates tied timestamps without omissions (collections: %s, order: %s)",
    async (isCollection, sortOrder) => {
      seed()
      for (const id of ["tie-a", "tie-b", "tie-c"]) {
        db.prepare(
          "INSERT INTO entries (id,feed_id,guid,inserted_at,published_at) VALUES (?,?,?,?,?)",
        ).run(id, "fixture-feed", id, now, now)
        db.prepare("INSERT INTO collections VALUES (?,?,?,?)").run(
          "local-user",
          id,
          0,
          "2026-09-13T00:00:00.000Z",
        )
      }
      const ids: string[] = []
      let cursor: string | null = null
      for (let page = 0; page < 6; page++) {
        const response = await post("/entries", {
          feedId: "fixture-feed",
          isCollection,
          sortOrder,
          limit: 1,
          ...(cursor
            ? { [sortOrder === "asc" ? "publishedBefore" : "publishedAfter"]: cursor }
            : {}),
        })
        const payload = await response.json()
        if (!payload.data.length) {
          expect(payload.nextCursor).toBeNull()
          break
        }
        ids.push(payload.data[0].entries.id)
        cursor = payload.nextCursor
        expect(cursor).toContain(isCollection ? "2026-09-13T00:00:00.000Z|" : `${now}|`)
      }
      const expected = isCollection
        ? ["tie-a", "tie-b", "tie-c"]
        : ["fixture-entry", "tie-a", "tie-b", "tie-c"]
      expect(ids).toEqual(sortOrder === "asc" ? expected : expected.reverse())
    },
  )

  it("resolves relative enclosures against the feed document and merges duplicate metadata", async () => {
    const xml =
      '<feed xmlns="http://www.w3.org/2005/Atom"><title>Fixture</title><link rel="alternate" href="https://website.test/"/><entry><id>relative</id><link rel="enclosure" href="episode.mp3" type="audio/mpeg"/><media:content url="episode.mp3"/><itunes:duration>12:34</itunes:duration></entry></feed>'
    fetchMock.mockResolvedValueOnce(new Response(xml))
    const { feed } = await refreshFeed("https://cdn.test/podcasts/feed.xml")
    const payload = await (await app.request(`/feeds?id=${feed.id}`)).json()
    expect(payload.data.entries[0].attachments).toEqual([
      {
        url: "https://cdn.test/podcasts/episode.mp3",
        mime_type: "audio/mpeg",
        duration_in_seconds: 754,
      },
    ])
  })

  it("imports legacy summaries after the cache schema migration without CLI side effects", async () => {
    const { importFollowDatabase } = await import("./import-follow-db.js")
    const sourcePath = `${databasePath}.legacy`
    const source = new DatabaseSync(sourcePath)
    try {
      source.exec(`
        CREATE TABLE feeds (id TEXT, url TEXT);
        CREATE TABLE entries (id TEXT, feed_id TEXT, guid TEXT, read INTEGER);
        CREATE TABLE subscriptions (id TEXT, feed_id TEXT);
        CREATE TABLE collections (entry_id TEXT, view INTEGER, created_at TEXT);
        CREATE TABLE summaries (entry_id TEXT, summary TEXT, readability_summary TEXT, created_at TEXT, language TEXT);
        INSERT INTO feeds VALUES ('legacy-feed', 'https://legacy.test/rss');
        INSERT INTO entries VALUES ('legacy-entry', 'legacy-feed', 'stable-guid', 1);
        INSERT INTO subscriptions VALUES ('legacy-sub', 'legacy-feed');
        INSERT INTO summaries VALUES ('legacy-entry', 'Imported summary', NULL, '2026-01-01T00:00:00.000Z', NULL);
      `)
      expect(importFollowDatabase(sourcePath)).toMatchObject({ entries: 1, summaries: 1, reads: 1 })
      expect(importFollowDatabase(sourcePath)).toMatchObject({ summaries: 1, subscriptions: 0 })
      expect(db.prepare("SELECT COUNT(*) count FROM summaries").get()).toEqual({ count: 1 })
      expect(await (await app.request("/ai/summary?id=legacy-entry")).json()).toMatchObject({
        data: "Imported summary",
      })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      source.close()
      rmSync(sourcePath, { force: true })
    }
  })

  it("persists generated summaries, coalesces requests and regenerates changed content", async () => {
    seed()
    let release!: (value: Response) => void
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const first = app.request("/ai/summary?id=fixture-entry&language=English")
    const second = app.request("/ai/summary?id=fixture-entry&language=English")
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    release(Response.json({ choices: [{ message: { content: "Summary one" } }] }))
    expect(await (await first).json()).toMatchObject({ data: "Summary one" })
    expect(await (await second).json()).toMatchObject({ data: "Summary one" })
    expect(
      await (await app.request("/ai/summary?id=fixture-entry&language=English")).json(),
    ).toMatchObject({ data: "Summary one" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(
      db.prepare("SELECT summary,source_hash FROM summaries WHERE entry_id=?").get("fixture-entry"),
    ).toMatchObject({ summary: "Summary one", source_hash: expect.any(String) })
    db.prepare("UPDATE entries SET content=? WHERE id=?").run("Changed article.", "fixture-entry")
    fetchMock.mockResolvedValueOnce(
      Response.json({ choices: [{ message: { content: "Summary two" } }] }),
    )
    expect(
      await (await app.request("/ai/summary?id=fixture-entry&language=English")).json(),
    ).toMatchObject({ data: "Summary two" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(db.prepare("SELECT COUNT(*) count FROM summaries").get()).toEqual({ count: 1 })
  })

  it("does not persist provider fallbacks or confuse distinct summary languages", async () => {
    seed()
    fetchMock.mockResolvedValueOnce(Response.json({ choices: [] }))
    expect(await (await app.request("/ai/summary?id=fixture-entry")).json()).toMatchObject({
      data: "Original content.",
    })
    expect(db.prepare("SELECT COUNT(*) count FROM summaries").get()).toEqual({ count: 0 })
    fetchMock.mockResolvedValueOnce(
      Response.json({ choices: [{ message: { content: "Default summary" } }] }),
    )
    await app.request("/ai/summary?id=fixture-entry")
    await app.request("/ai/summary?id=fixture-entry")
    fetchMock.mockResolvedValueOnce(
      Response.json({ choices: [{ message: { content: "中文摘要" } }] }),
    )
    expect(
      await (await app.request("/ai/summary?id=fixture-entry&language=Chinese")).json(),
    ).toMatchObject({ data: "中文摘要" })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(db.prepare("SELECT COUNT(*) count FROM summaries").get()).toEqual({ count: 2 })
  })

  it("locks selected refreshes, deduplicates IDs and publishes their completion", async () => {
    seed()
    let release!: (value: Response) => void
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const pending = post("/feeds/refresh", { ids: ["fixture-feed", "fixture-feed"] })
    try {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      expect(await (await app.request("/local/refresh-status")).json()).toMatchObject({
        data: { running: true },
      })
      const joined = post("/feeds/refresh", { ids: ["fixture-feed"] })
      release(new Response(rss()))
      expect((await joined).status).toBe(200)
    } finally {
      release(new Response(rss()))
      expect(await (await pending).json()).toMatchObject({ data: { total: 1, failed: 0 } })
    }
    expect(await (await app.request("/local/refresh-status")).json()).toMatchObject({
      data: { running: false, lastRun: { total: 1, finishedAt: expect.any(String) } },
    })
  })

  it.each([null, [], { ids: "all" }, { ids: [42] }, { ids: [""] }])(
    "rejects malformed refresh selection %j without fetching",
    async (body) => {
      seed()
      expect((await post("/feeds/refresh", body)).status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it("keeps an explicit empty refresh selection empty", async () => {
    seed()
    expect(await (await post("/feeds/refresh", { ids: [] })).json()).toMatchObject({
      data: { total: 0 },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("imports OPML metadata through the desktop text-serialized multipart payload", async () => {
    const xml =
      '<opml version="2.0"><body><outline text="Engineering"><outline text="My custom title" xmlUrl="https://fixture.test/rss"/></outline></body></opml>'
    const preview = await app.request("/subscriptions/parse-opml", { method: "POST", body: xml })
    expect(await preview.json()).toMatchObject({ data: { remaining: 1 } })
    const form = new FormData()
    form.set("items", JSON.stringify(["https://fixture.test/rss", "https://fixture.test/rss"]))
    form.set("file", new File([xml], "subscriptions.opml", { type: "text/xml" }))
    const request = new Request("http://localhost/subscriptions/import", {
      method: "POST",
      body: form,
    })
    fetchMock.mockResolvedValueOnce(new Response(rss()))
    const response = await app.request("/subscriptions/import", {
      method: "POST",
      headers: request.headers,
      body: await request.text(),
    })
    expect(await response.json()).toMatchObject({
      data: { successfulItems: [{ url: "https://fixture.test/rss" }] },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(db.prepare("SELECT title,category FROM subscriptions").get()).toEqual({
      title: "My custom title",
      category: "Engineering",
    })
    const exported = await (await app.request("/subscriptions/export?folderMode=category")).json()
    expect(parseOpml(exported.data.content, "local-user").subscriptions[0]).toMatchObject({
      title: "My custom title",
      category: "Engineering",
    })
  })

  it.each([{}, "not-an-array", [3]])(
    "rejects invalid OPML selections %j without fetching",
    async (items) => {
      const form = new FormData()
      form.set("items", JSON.stringify(items))
      expect(
        (await app.request("/subscriptions/import", { method: "POST", body: form })).status,
      ).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it("rejects selections missing from the original OPML file", async () => {
    const form = new FormData()
    form.set("items", JSON.stringify(["https://other.test/rss"]))
    form.set("file", '<opml><body><outline xmlUrl="https://fixture.test/rss"/></body></opml>')
    expect(
      (await app.request("/subscriptions/import", { method: "POST", body: form })).status,
    ).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(["category", "view"] as const)(
    "round-trips titles, categories and views in %s OPML",
    (folderMode) => {
      const entries = [
        {
          url: "https://fixture.test/audio",
          title: "A & B",
          siteUrl: null,
          category: "Podcast & music",
          view: 4,
        },
        {
          url: "https://fixture.test/pictures",
          title: "Gallery",
          siteUrl: null,
          category: null,
          view: 2,
        },
      ]
      const parsed = parseOpml(buildOpml(entries, { folderMode }), "local-user")
      for (const entry of entries)
        expect(parsed.subscriptions.find((item) => item.url === entry.url)).toMatchObject({
          title: entry.title,
          category: entry.category,
          view: entry.view,
        })
    },
  )

  it("stores RSS enclosures and media with renderer-compatible types on refresh", async () => {
    const document = (audio: string) =>
      rss(
        `<item><guid>media-1</guid><title>Media</title><enclosure url="${audio}" type="audio/mpeg"/><itunes:duration>01:02:03</itunes:duration><media:content url="https://fixture.test/video.mp4" type="video/mp4"/><media:thumbnail url="https://fixture.test/cover.jpg"/></item>`,
      )
    fetchMock.mockResolvedValueOnce(new Response(document("/episode.mp3")))
    const first = await refreshFeed("https://fixture.test/rss")
    const payload = await (await app.request(`/feeds?id=${first.feed.id}`)).json()
    expect(payload.data.entries[0].attachments).toContainEqual({
      url: "https://fixture.test/episode.mp3",
      mime_type: "audio/mpeg",
      duration_in_seconds: 3723,
    })
    expect(payload.data.entries[0].media).toContainEqual({
      url: "https://fixture.test/video.mp4",
      type: "video",
      preview_image_url: "https://fixture.test/cover.jpg",
    })
    expect(payload.data.entries[0].media).toContainEqual({
      url: "https://fixture.test/cover.jpg",
      type: "photo",
    })
    fetchMock.mockResolvedValueOnce(new Response(document("/episode-updated.mp3")))
    await refreshFeed("https://fixture.test/rss")
    const updated = await (await app.request(`/feeds?id=${first.feed.id}`)).json()
    expect(updated.data.entries).toHaveLength(1)
    expect(updated.data.entries[0].attachments[0].url).toBe(
      "https://fixture.test/episode-updated.mp3",
    )
  })

  it("stores Atom enclosure links and ignores non-HTTP attachment URLs", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        '<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><id>atom-media</id><title>Photo</title><link rel="enclosure" href="https://fixture.test/photo.jpg" type="image/jpeg"/><link rel="enclosure" href="javascript:alert(1)" type="image/jpeg"/></entry></feed>',
      ),
    )
    const result = await refreshFeed("https://fixture.test/atom")
    const payload = await (await app.request(`/feeds?id=${result.feed.id}`)).json()
    expect(payload.data.entries[0].attachments).toEqual([
      { url: "https://fixture.test/photo.jpg", mime_type: "image/jpeg" },
    ])
    expect(payload.data.entries[0].media).toEqual([
      { url: "https://fixture.test/photo.jpg", type: "photo" },
    ])
  })

  it("strips only the matching RSSHub base path and leaves unrelated feeds alone", async () => {
    addInstance("https://proxy.test/rsshub")
    addInstance("https://proxy.test/rsshub/nested")
    expect(routeFromURL(new URL("https://proxy.test/rsshub/nested/github/trending?limit=2"))).toBe(
      "/github/trending?limit=2",
    )
    expect(routeFromURL(new URL("https://proxy.test/rsshub/github/trending"))).toBe(
      "/github/trending",
    )
    expect(routeFromURL(new URL("https://proxy.test/rsshub-other/rss"))).toBeNull()
    expect(routeFromURL(new URL("https://proxy.test/rsshub/"))).toBeNull()
    expect(routeFromURL(new URL("https://proxy.test/unrelated/rss"))).toBeNull()
    await app.request("/settings/rsshub", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseURL: "https://proxy.test/rsshub" }),
    })
    fetchMock.mockResolvedValueOnce(new Response(rss()))
    await refreshFeed("https://proxy.test/rsshub/github/trending?limit=2")
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://proxy.test/rsshub/github/trending?limit=2")
  })

  it("does not fetch from the pool when all its instances are disabled", async () => {
    db.exec("UPDATE rsshub_instances SET enabled=0")
    const response = await app.request(
      `/feeds?url=${encodeURIComponent("rsshub://fixture/disabled")}`,
    )
    expect(response.status).toBe(422)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("bounds feed preview limits and handles invalid numeric values", async () => {
    seed()
    for (const limit of ["-1", "0"]) {
      const result = await (
        await app.request(`/feeds?id=fixture-feed&entriesLimit=${limit}`)
      ).json()
      expect(result.data.entries).toEqual([])
    }
    for (const limit of ["bad", "Infinity", "1.5"])
      expect((await app.request(`/feeds?id=fixture-feed&entriesLimit=${limit}`)).status).toBe(200)
  })
})
