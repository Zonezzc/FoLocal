import type { SourcePage } from "@follow/clipper-core"
import { app, BrowserWindow, session } from "electron"
import { getIpcContext, IpcMethod, IpcService } from "electron-ipc-decorator"

import { httpURL, isClipRendererURL, readLimited } from "../../lib/clip-network"

export const SOURCE_PARTITION = "persist:folocal-clipping"
const MAX_HTML = 10 * 1024 * 1024

export class SourceArticleService extends IpcService {
  static override readonly groupName = "sourceArticle"
  private windows = new Map<number, { url: string; window: BrowserWindow }>()

  @IpcMethod()
  async capture(input: {
    url: string
    rendered?: boolean
    background?: boolean
  }): Promise<SourcePage> {
    const url = httpURL(input.url)
    const owner = getIpcContext().sender
    if (
      !isClipRendererURL(
        owner.getURL(),
        app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL,
      )
    )
      throw new Error("Untrusted source capture caller")
    const sourceSession = session.fromPartition(SOURCE_PARTITION)
    if (!input.rendered) {
      const response = await sourceSession.fetch(url, {
        headers: { accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(25_000),
      })
      const type = response.headers.get("content-type") || ""
      if (!/text\/html|application\/xhtml\+xml/i.test(type))
        throw new Error("Source did not return an HTML page")
      const bytes = await readLimited(response, MAX_HTML)
      const charset = type.match(/charset=["']?([\w-]+)/i)?.[1] || "utf-8"
      let html: string
      try {
        html = new TextDecoder(charset).decode(bytes)
      } catch {
        html = new TextDecoder().decode(bytes)
      }
      return {
        url: httpURL(response.url || url),
        html,
        mode: "static",
        fetchedAt: new Date().toISOString(),
      }
    }
    let current = this.windows.get(owner.id)
    if (!current || current.url !== url || current.window.isDestroyed()) {
      current?.window.destroy()
      const window = new BrowserWindow({
        show: !input.background,
        width: 1100,
        height: 800,
        title: "FoLocal · Source article",
        webPreferences: {
          partition: SOURCE_PARTITION,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
        },
      })
      current = { url, window }
      this.windows.set(owner.id, current)
      sourceSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      )
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
      window.webContents.on("will-redirect", (event, target) => {
        try {
          httpURL(target)
        } catch {
          event.preventDefault()
        }
      })
      window.webContents.on("will-navigate", (event, target) => {
        try {
          httpURL(target)
        } catch {
          event.preventDefault()
        }
      })
      const closeWithOwner = () => {
        if (!window.isDestroyed()) window.destroy()
      }
      window.on("closed", () => {
        if (this.windows.get(owner.id)?.window === window) this.windows.delete(owner.id)
        owner.removeListener("destroyed", closeWithOwner)
      })
      owner.once("destroyed", closeWithOwner)
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          window.loadURL(url),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error("Source page load timed out; finish loading in its window and retry"),
                ),
              30_000,
            )
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
    }
    if (!input.background) current.window.show()
    let html = ""
    for (let attempt = 0; attempt < 4; attempt++) {
      if (current.window.isDestroyed()) throw new Error("Source window was closed")
      await new Promise((resolve) => setTimeout(resolve, 500))
      html = (await current.window.webContents.executeJavaScript(
        `document.documentElement.outerHTML.slice(0, ${MAX_HTML + 1})`,
      )) as string
    }
    if (html.length > MAX_HTML) throw new Error("Source page exceeds the size limit")
    return {
      url: httpURL(current.window.webContents.getURL()),
      html,
      mode: "rendered",
      fetchedAt: new Date().toISOString(),
    }
  }
}
