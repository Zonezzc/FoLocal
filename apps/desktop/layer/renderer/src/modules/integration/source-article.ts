import { extractSourceArticle } from "@follow/clipper-core"

import { ipcServices } from "~/lib/client"

export async function acquireSourceArticle(url: string, rendered = false, background = false) {
  if (!ipcServices) throw new Error("Source clipping requires the desktop app")
  if (!rendered) {
    try {
      return extractSourceArticle(await ipcServices.sourceArticle.capture({ url }))
    } catch {
      // Dynamic and authenticated pages need the isolated source browser.
    }
  }
  return extractSourceArticle(
    await ipcServices.sourceArticle.capture({
      url,
      rendered: true,
      ...(background ? { background } : {}),
    }),
  )
}
