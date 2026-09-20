import { DatabaseSync } from "node:sqlite"

import type { SourceArticle } from "@follow/clipper-core"
import { afterEach, describe, expect, it, vi } from "vitest"

import { SiyuanClient } from "./siyuan-client"
import { listClipJobs, SiyuanClips } from "./siyuan-clips"

const databases: DatabaseSync[] = []
afterEach(() => databases.splice(0).forEach((db) => db.close()))
const draft: SourceArticle = {
  url: "https://source.test/article",
  canonicalUrl: "https://source.test/article",
  title: "Original",
  author: "Author",
  publishedAt: "",
  html: "<p>Full original text</p>",
  markdown: "Full original text\n\n![image](https://folocal.invalid/clip-image/0/)",
  images: [
    { url: "https://source.test/a.png", placeholder: "https://folocal.invalid/clip-image/0/" },
  ],
  mode: "static",
  fetchedAt: "2026-09-20",
  extractorVersion: 1,
}
function fixture() {
  const db = new DatabaseSync(":memory:")
  databases.push(db)
  db.exec(
    "CREATE TABLE siyuan_clips(id TEXT PRIMARY KEY,clip_key TEXT UNIQUE,updated_at TEXT,receipt TEXT,data TEXT)",
  )
  const docs = new Map<string, { path: string; content: string }>()
  const assets = new Map<string, Uint8Array>()
  let created = 0
  let loseCreateResponse = false
  let badAsset = false
  const ok = (data: unknown) => Response.json({ code: 0, data })
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {}
    if (path === "/api/notebook/lsNotebooks")
      return ok({ notebooks: [{ id: "book", name: "Test" }] })
    if (path === "/api/filetree/getIDsByHPath")
      return ok([...docs.entries()].filter(([, doc]) => doc.path === body.path).map(([id]) => id))
    if (path === "/api/asset/upload") {
      const file = (init!.body as FormData).get("file[]") as File
      const path = `${String((init!.body as FormData).get("assetsDirPath")).replace(/^\//, "")}${file.name}`
      assets.set(path, new Uint8Array(await file.arrayBuffer()))
      return ok({ errFiles: [], succMap: { [file.name]: path } })
    }
    if (path === "/api/file/getFile")
      return badAsset
        ? new Response("missing", { status: 202 })
        : new Response(assets.get(body.path.replace("/data/", "")) as Uint8Array<ArrayBuffer>)
    if (path === "/api/filetree/createDocWithMd") {
      const id = `20260920120000-${String(++created).padStart(7, "a")}`
      docs.set(id, { path: body.path, content: body.markdown })
      if (loseCreateResponse) {
        loseCreateResponse = false
        throw new Error("Connection lost after write")
      }
      return ok(id)
    }
    if (path === "/api/export/exportMdContent") {
      const doc = docs.get(body.id)
      return doc
        ? ok({ hPath: doc.path, content: doc.content })
        : Response.json({ code: -1, msg: "missing" })
    }
    if (path === "/api/attr/setBlockAttrs") return ok(null)
    throw new Error(`Unexpected API: ${path}`)
  })
  const sourceFetch = vi.fn<typeof fetch>(
    async () =>
      new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }),
  )
  const client = new SiyuanClient(
    { endpoint: "http://localhost:6806", token: "secret", notebook: "book", path: "/FoLocal" },
    fetcher,
  )
  return {
    db,
    docs,
    client,
    fetcher,
    sourceFetch,
    engine: new SiyuanClips(db, client, sourceFetch),
    loseResponse: () => {
      loseCreateResponse = true
    },
    badAsset: () => {
      badAsset = true
    },
  }
}
describe("durable SiYuan clipping", () => {
  it("loads lightweight history without parsing saved article snapshots", async () => {
    const f = fixture()
    const result = await f.engine.save(draft)
    f.db.prepare("UPDATE siyuan_clips SET data=? WHERE id=?").run("not read by history", result.id)
    expect(listClipJobs(f.db)[0]?.state).toBe("complete")
  })
  it("uploads, reads back and localizes images, deduplicates and preserves later user edits", async () => {
    const f = fixture()
    const result = await f.engine.save(draft)
    expect(result.state).toBe("complete")
    expect(f.docs.get(result.docId!)?.content).toContain("assets/FoLocal/")
    expect(f.docs.get(result.docId!)?.content).not.toContain("folocal.invalid")
    f.docs.get(result.docId!)!.content = "User edited this note"
    expect((await f.engine.save(draft)).docId).toBe(result.docId)
    expect(f.docs.size).toBe(1)
    expect(f.docs.get(result.docId!)!.content).toBe("User edited this note")
    expect((await f.engine.save(draft, true)).state).toBe("complete")
    expect(f.docs.size).toBe(2)
  })
  it("recovers a lost create response from persisted state without creating a duplicate", async () => {
    const f = fixture()
    f.loseResponse()
    const result = await f.engine.save(draft)
    expect(result.state).toBe("uncertain")
    const restarted = new SiyuanClips(f.db, f.client, f.sourceFetch)
    expect((await restarted.retry(result.id)).state).toBe("complete")
    expect(f.docs.size).toBe(1)
    expect(listClipJobs(f.db)[0]?.state).toBe("complete")
  })
  it("does not associate or modify an unrelated document during uncertain recovery", async () => {
    const f = fixture()
    f.loseResponse()
    const result = await f.engine.save(draft)
    for (const doc of f.docs.values()) doc.content = `Full original text ${draft.canonicalUrl}`
    const recovered = await f.engine.retry(result.id)
    expect(recovered.state).toBe("uncertain")
    expect(recovered.docId).toBeUndefined()
    expect(
      f.fetcher.mock.calls.filter(([url]) => String(url).endsWith("setBlockAttrs")),
    ).toHaveLength(0)
  })
  it("fails before document creation if image readback returns kernel error status 202", async () => {
    const f = fixture()
    f.badAsset()
    expect((await f.engine.save(draft)).state).toBe("failed")
    expect(f.docs.size).toBe(0)
  })
  it("coalesces concurrent requests for the same source", async () => {
    const f = fixture()
    const results = await Promise.all([f.engine.save(draft), f.engine.save(draft)])
    expect(results[0]?.id).toBe(results[1]?.id)
    expect(f.docs.size).toBe(1)
    expect(f.sourceFetch).toHaveBeenCalledTimes(1)
  })
  it("uploads into the configured article folder and preserves it across retries", async () => {
    const f = fixture()
    f.client.config.assetPath = "/assets/PrivateClips/"
    f.sourceFetch.mockRejectedValueOnce(new Error("Temporary network error"))
    const failed = await f.engine.save(draft)
    f.client.config.assetPath = "/assets/AnotherFolder/"
    const result = await f.engine.retry(failed.id)
    expect(result.state).toBe("complete")
    const content = f.docs.get(result.docId!)!.content
    expect(content).toContain(`/${failed.id}/folocal-`)
    expect(content).toContain("assets/PrivateClips/")
    expect(content).not.toContain("AnotherFolder")
  })
  it("uses Chromium referrer options and reports image bytes before verified completion", async () => {
    const f = fixture()
    const progress = vi.fn()
    const engine = new SiyuanClips(f.db, f.client, f.sourceFetch, progress)
    expect((await engine.save(draft)).state).toBe("complete")
    expect(f.sourceFetch).toHaveBeenCalledWith(
      draft.images[0]!.url,
      expect.objectContaining({
        referrer: draft.url,
        referrerPolicy: "strict-origin-when-cross-origin",
      }),
    )
    expect(f.sourceFetch.mock.calls[0]![1]?.headers).toBeUndefined()
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        state: "uploading",
        download: { index: 1, received: 4, total: undefined },
      }),
    )
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "complete", uploaded: 1 }),
    )
  })
  it("resumes after an image failure without uploading completed images or creating duplicates", async () => {
    const f = fixture()
    const article = {
      ...draft,
      images: [...draft.images, { url: "https://source.test/b.png", placeholder: "IMAGE2" }],
      markdown: `${draft.markdown}\n![second](IMAGE2)`,
    }
    f.sourceFetch
      .mockResolvedValueOnce(
        new Response(new Uint8Array([137, 80]), { headers: { "content-type": "image/png" } }),
      )
      .mockRejectedValueOnce(new Error("net::ERR_BLOCKED_BY_CLIENT"))
    const failed = await f.engine.save(article)
    expect(failed.state).toBe("failed")
    expect(failed.uploaded).toBe(1)
    expect(f.docs.size).toBe(0)
    expect((await f.engine.retry(failed.id)).state).toBe("complete")
    expect(f.sourceFetch).toHaveBeenCalledTimes(3)
    expect(f.docs.size).toBe(1)
  })
})
