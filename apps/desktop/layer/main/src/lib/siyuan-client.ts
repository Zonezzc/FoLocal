import { createHash } from "node:crypto"

import { httpURL, readLimited } from "./clip-network"
import { assetDirectory } from "./siyuan-assets"
import type { SiyuanConfig } from "./siyuan-config"

export interface SiyuanNotebook {
  id: string
  name: string
  closed?: boolean
}
export const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex")
export const safeDocTitle = (title: string) =>
  title
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "Untitled"
export const targetPath = (parent: string, title: string) => {
  const parts = parent.split("/").filter(Boolean)
  if (parts.some((part) => part === "." || part === "..")) throw new Error("Invalid document path")
  return `/${[...parts.map(safeDocTitle), safeDocTitle(title)].join("/")}`
}
export class SiyuanClient {
  constructor(
    readonly config: SiyuanConfig,
    private readonly fetcher: typeof fetch,
  ) {}
  private request(path: string, init: RequestInit = {}) {
    const endpoint = httpURL(this.config.endpoint).replace(/\/$/, "")
    return this.fetcher(`${endpoint}${path}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(25_000),
      headers: {
        ...(this.config.token ? { Authorization: `Token ${this.config.token}` } : {}),
        ...init.headers,
      },
    })
  }
  async post<T>(path: string, body: unknown = {}): Promise<T> {
    const response = await this.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`SiYuan HTTP ${response.status}`)
    const result = (await response.json()) as { code: number; msg?: string; data: T }
    if (result.code !== 0) throw new Error(`SiYuan: ${result.msg || result.code}`)
    return result.data
  }
  async notebooks() {
    const result = await this.post<{ notebooks: SiyuanNotebook[] }>("/api/notebook/lsNotebooks")
    if (!Array.isArray(result.notebooks)) throw new Error("Invalid SiYuan notebook response")
    return result.notebooks.filter((row) => !row.closed)
  }
  async assertNotebook() {
    if (!(await this.notebooks()).some((row) => row.id === this.config.notebook))
      throw new Error("Choose an open SiYuan notebook")
  }
  async upload(bytes: Uint8Array<ArrayBuffer>, name: string, mime: string, directory: string) {
    const form = new FormData()
    const target = assetDirectory(directory)
    form.append("assetsDirPath", target)
    form.append("file[]", new Blob([bytes], { type: mime }), name)
    const response = await this.request("/api/asset/upload", { method: "POST", body: form })
    if (!response.ok) throw new Error(`SiYuan upload HTTP ${response.status}`)
    const result = (await response.json()) as {
      code: number
      data?: { errFiles?: string[]; succMap?: Record<string, string> }
    }
    const path = result.data?.succMap?.[name]
    if (
      result.code !== 0 ||
      result.data?.errFiles?.length ||
      !path ||
      !path.startsWith(target.slice(1)) ||
      !/^assets\/[\w\p{L}\p{N} .()/-]+$/u.test(path) ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("SiYuan did not return a valid uploaded asset")
    return path
  }
  async verifyAsset(path: string, hash: string) {
    if (!path.startsWith("assets/") || path.includes("..")) throw new Error("Invalid asset path")
    const response = await this.request("/api/file/getFile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: `/data/${path}` }),
    })
    if (response.status !== 200 || digest(await readLimited(response)) !== hash)
      throw new Error("SiYuan asset readback did not match")
  }
  exportDocument(id: string) {
    return this.post<{ content: string; hPath: string }>("/api/export/exportMdContent", { id })
  }
  findPath(path: string) {
    return this.post<string[]>("/api/filetree/getIDsByHPath", {
      notebook: this.config.notebook,
      path,
    })
  }
  create(path: string, markdown: string) {
    return this.post<string>("/api/filetree/createDocWithMd", {
      notebook: this.config.notebook,
      path,
      markdown,
    })
  }
  attributes(id: string, attrs: Record<string, string>) {
    return this.post("/api/attr/setBlockAttrs", { id, attrs })
  }
}
