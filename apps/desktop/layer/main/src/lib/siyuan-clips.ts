import { randomUUID } from "node:crypto"
import type { DatabaseSync } from "node:sqlite"

import type { SourceArticle } from "@follow/clipper-core"

import { httpURL, readLimited } from "./clip-network"
import type { SiyuanClient } from "./siyuan-client"
import { digest, targetPath } from "./siyuan-client"

export interface ClipReceipt {
  id: string
  url: string
  title: string
  state: "pending" | "uploading" | "writing" | "verifying" | "complete" | "failed" | "uncertain"
  docId?: string
  error?: string
  uploaded: number
  imageCount: number
  updatedAt: string
}
interface ClipJob extends ClipReceipt {
  key: string
  draft: SourceArticle
  path: string
  endpoint: string
  notebook: string
  assets: Record<string, { path: string; hash: string }>
  finalMarkdown?: string
}
const active = new Map<string, Promise<ClipReceipt>>()
const receipt = (job: ClipJob): ClipReceipt => ({
  id: job.id,
  url: job.url,
  title: job.title,
  state: job.state,
  docId: job.docId,
  error: job.error,
  uploaded: Object.keys(job.assets).length,
  imageCount: job.draft.images.length,
  updatedAt: job.updatedAt,
})
export const listClipJobs = (db: DatabaseSync): ClipReceipt[] =>
  (
    db
      .prepare(
        "SELECT COALESCE(receipt, data) AS data FROM siyuan_clips ORDER BY updated_at DESC LIMIT 50",
      )
      .all() as {
      data: string
    }[]
  ).map((row) => {
    const value = JSON.parse(row.data) as ClipJob | ClipReceipt
    return "draft" in value ? receipt(value) : value
  })

export class SiyuanClips {
  constructor(
    private readonly db: DatabaseSync,
    private readonly client: SiyuanClient,
    private readonly fetchSource: typeof fetch,
  ) {}
  private persist(job: ClipJob) {
    job.updatedAt = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO siyuan_clips(id,clip_key,updated_at,receipt,data) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,receipt=excluded.receipt,data=excluded.data`,
      )
      .run(job.id, job.key, job.updatedAt, JSON.stringify(receipt(job)), JSON.stringify(job))
  }
  private load(column: "id" | "clip_key", value: string): ClipJob | undefined {
    const row = this.db.prepare(`SELECT data FROM siyuan_clips WHERE ${column}=?`).get(value) as
      { data: string } | undefined
    return row ? (JSON.parse(row.data) as ClipJob) : undefined
  }
  async save(draft: SourceArticle, asCopy = false): Promise<ClipReceipt> {
    httpURL(draft.url)
    httpURL(draft.canonicalUrl)
    if (
      draft.extractorVersion !== 1 ||
      !draft.markdown.trim() ||
      draft.markdown.length > 2_000_000 ||
      draft.images.length > 100
    )
      throw new Error("Invalid source article snapshot")
    const key = digest(
      `${this.client.config.endpoint}\n${this.client.config.notebook}\n${draft.canonicalUrl}${asCopy ? `\n${randomUUID()}` : ""}`,
    )
    const existing = this.load("clip_key", key)
    if (existing) return this.run(existing)
    const job: ClipJob = {
      id: randomUUID(),
      key,
      url: draft.url,
      title: draft.title,
      draft: { ...draft, html: "" },
      endpoint: this.client.config.endpoint,
      notebook: this.client.config.notebook,
      path: targetPath(this.client.config.path, draft.title),
      assets: {},
      state: "pending",
      uploaded: 0,
      imageCount: draft.images.length,
      updatedAt: new Date().toISOString(),
    }
    this.persist(job)
    return this.run(job)
  }
  async retry(id: string): Promise<ClipReceipt> {
    const job = this.load("id", id)
    if (!job) throw new Error("Clipping task not found")
    if (
      job.endpoint !== this.client.config.endpoint ||
      job.notebook !== this.client.config.notebook
    )
      throw new Error("Select this task's original SiYuan endpoint and notebook before retrying")
    return this.run(job)
  }
  private run(job: ClipJob): Promise<ClipReceipt> {
    const previous = active.get(job.key)
    if (previous) return previous
    const task = this.execute(job).finally(() => active.delete(job.key))
    active.set(job.key, task)
    return task
  }
  private async verify(job: ClipJob) {
    if (!job.docId) throw new Error("Missing document ID")
    const exported = await this.client.exportDocument(job.docId)
    if (
      exported.hPath !== job.path ||
      !exported.content.includes(job.draft.canonicalUrl) ||
      !exported.content.includes(`Clip ID: ${job.id}`)
    )
      throw new Error("Saved document location or source link did not match")
    // SiYuan rewrites Markdown punctuation, including table separator widths.
    const plain = (value: string) => value.replace(/[\s\p{P}\p{S}]/gu, "")
    const probe = plain(job.finalMarkdown || "")
    if (!probe || !plain(exported.content).includes(probe))
      throw new Error("Saved article content did not match")
    for (const image of Object.values(job.assets)) {
      if (!exported.content.includes(image.path))
        throw new Error("Saved document is missing an image")
      await this.client.verifyAsset(image.path, image.hash)
    }
  }
  private async execute(job: ClipJob): Promise<ClipReceipt> {
    let writing = false
    try {
      job.error = undefined
      await this.client.assertNotebook()
      // A previous successful save is never overwritten, even when the user edits their note.
      if (job.state === "complete" && job.docId) {
        await this.client.exportDocument(job.docId)
        return receipt(job)
      }
      if (!job.docId && ["writing", "uncertain"].includes(job.state)) {
        const ids = await this.client.findPath(job.path)
        if (ids.length === 1) {
          job.docId = ids[0]
          try {
            await this.verify(job)
          } catch (error) {
            job.docId = undefined
            job.state = "uncertain"
            throw error
          }
        } else {
          job.state = "uncertain"
          throw new Error(
            "Previous write is unconfirmed; check the target document before retrying",
          )
        }
      }
      if (!job.docId) {
        const occupied = await this.client.findPath(job.path)
        if (occupied.length) job.path = `${job.path} · ${job.id.slice(0, 8)}`
        job.state = "uploading"
        this.persist(job)
        for (const image of job.draft.images) {
          const imageURL = httpURL(image.url)
          if (job.assets[imageURL]) {
            try {
              await this.client.verifyAsset(job.assets[imageURL].path, job.assets[imageURL].hash)
              continue
            } catch {
              delete job.assets[imageURL]
            }
          }
          const response = await this.fetchSource(imageURL, {
            headers: { referer: job.url },
            signal: AbortSignal.timeout(25_000),
          })
          const mime = response.headers.get("content-type")?.split(";")[0] || ""
          if (!mime.startsWith("image/")) throw new Error("Image URL did not return an image")
          const bytes = await readLimited(response)
          if (!bytes.length) throw new Error("Empty image response")
          const hash = digest(bytes)
          const extension = mime
            .split("/")[1]!
            .replace(/[^a-z0-9]/gi, "")
            .slice(0, 16)
          const path = await this.client.upload(
            bytes,
            `folocal-${hash.slice(0, 20)}.${extension}`,
            mime,
          )
          await this.client.verifyAsset(path, hash)
          job.assets[imageURL] = { path, hash }
          this.persist(job)
        }
        let markdown = job.draft.markdown
        for (const image of job.draft.images)
          markdown = markdown.replaceAll(image.placeholder, job.assets[httpURL(image.url)]!.path)
        if (markdown.includes("https://folocal.invalid/clip-image/"))
          throw new Error("Not all article images were localized")
        const metadata = [job.draft.author, job.draft.publishedAt]
          .filter(Boolean)
          .map((value) => value.replace(/[\r\n]/g, " "))
          .join(" · ")
        job.finalMarkdown = `${markdown}\n\n---\n${metadata ? `${metadata}\n\n` : ""}[Source](${job.draft.canonicalUrl})\n\nClipped: ${job.draft.fetchedAt}\n\nClip ID: ${job.id}\n`
        job.state = "writing"
        this.persist(job)
        writing = true
        job.docId = await this.client.create(job.path, job.finalMarkdown)
        if (!/^\d{14}-[a-z0-9]{7}$/.test(job.docId))
          throw new Error("SiYuan did not return a valid document ID")
        writing = false
        job.state = "verifying"
        this.persist(job)
      }
      job.state = "verifying"
      this.persist(job)
      await this.verify(job)
      await this.client.attributes(job.docId!, {
        "custom-folocal-source": job.draft.canonicalUrl,
        "custom-folocal-key": job.key,
        "custom-folocal-complete": "true",
      })
      job.state = "complete"
    } catch (error) {
      if (writing || job.state === "uncertain") job.state = "uncertain"
      else job.state = "failed"
      job.error = (error instanceof Error ? error.message : "Clipping failed")
        .replace(/https?:\/\/\S+/g, "[URL]")
        .slice(0, 500)
    }
    this.persist(job)
    return receipt(job)
  }
}
