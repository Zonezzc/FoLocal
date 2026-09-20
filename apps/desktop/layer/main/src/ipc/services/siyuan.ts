import type { SourceArticle } from "@follow/clipper-core"
import { app, net, session, shell } from "electron"
import { getIpcContext, IpcMethod, IpcService } from "electron-ipc-decorator"

import { isClipRendererURL } from "../../lib/clip-network"
import { getLocalDatabase } from "../../lib/local-app"
import { SiyuanClient } from "../../lib/siyuan-client"
import type { ClipProgress } from "../../lib/siyuan-clips"
import { listClipJobs, SiyuanClips } from "../../lib/siyuan-clips"
import { readSiyuanConfig, saveSiyuanConfig } from "../../lib/siyuan-config"
import { SOURCE_PARTITION } from "./source-article"

export class SiyuanService extends IpcService {
  static override readonly groupName = "siyuan"
  private progressByRequest = new Map<string, { owner: number; value?: ClipProgress }>()
  private trusted() {
    if (
      !isClipRendererURL(
        getIpcContext().sender.getURL(),
        app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL,
      )
    )
      throw new Error("Untrusted SiYuan caller")
  }
  @IpcMethod()
  async settings() {
    this.trusted()
    const { token, ...config } = readSiyuanConfig()
    return { ...config, hasToken: !!token }
  }
  @IpcMethod()
  async configure(input: {
    endpoint: string
    token?: string
    notebook: string
    path: string
    assetPath?: string
  }) {
    this.trusted()
    saveSiyuanConfig(input)
    return this.settings()
  }
  @IpcMethod()
  async notebooks() {
    this.trusted()
    return new SiyuanClient(readSiyuanConfig(), (input, init) => net.fetch(input, init)).notebooks()
  }
  @IpcMethod()
  async history() {
    this.trusted()
    return listClipJobs(await getLocalDatabase())
  }
  private async engine(onProgress?: (progress: ClipProgress) => void) {
    return new SiyuanClips(
      await getLocalDatabase(),
      new SiyuanClient(readSiyuanConfig(), (input, init) => net.fetch(input, init)),
      (input, init) => session.fromPartition(SOURCE_PARTITION).fetch(input, init),
      onProgress,
    )
  }
  @IpcMethod()
  async save(draft: SourceArticle, asCopy = false, requestId?: string) {
    this.trusted()
    const owner = getIpcContext().sender.id
    if (requestId) this.progressByRequest.set(requestId, { owner })
    try {
      return await (
        await this.engine((value) => {
          if (requestId) this.progressByRequest.set(requestId, { owner, value })
        })
      ).save(draft, asCopy)
    } finally {
      if (requestId) this.progressByRequest.delete(requestId)
    }
  }
  @IpcMethod()
  async progress(requestId: string) {
    this.trusted()
    const progress = this.progressByRequest.get(requestId)
    return progress?.owner === getIpcContext().sender.id ? progress.value : undefined
  }
  @IpcMethod()
  async retry(id: string) {
    this.trusted()
    return (await this.engine()).retry(id)
  }
  @IpcMethod()
  async openDocument(id: string) {
    this.trusted()
    if (!/^\d{14}-[a-z0-9]{7}$/.test(id)) throw new Error("Invalid SiYuan document ID")
    await shell.openExternal(`siyuan://blocks/${id}`)
  }
}
