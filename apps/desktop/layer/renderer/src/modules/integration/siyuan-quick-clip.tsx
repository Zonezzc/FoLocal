import type { TFunction } from "i18next"
import { toast } from "sonner"

import { ipcServices } from "~/lib/client"

import { acquireSourceArticle } from "./source-article"

const active = new Set<string>()

export async function quickClipToSiyuan(
  url: string,
  t: TFunction<"settings">,
  openSettings: () => void,
) {
  const services = ipcServices
  if (!services) return
  const source = new URL(url)
  source.hash = ""
  const key = source.href
  if (active.has(key)) return
  active.add(key)
  const id = `siyuan-${key}`
  let timer: ReturnType<typeof setTimeout> | undefined
  let finished = false
  try {
    const config = await services.siyuan.settings()
    if (!config.notebook) {
      toast.error(t("siyuan.configure_first"), {
        id,
        action: { label: t("siyuan.configure"), onClick: openSettings },
      })
      return
    }
    toast.loading(t("siyuan.extracting"), { id })
    const draft = await acquireSourceArticle(url, false, true)
    const requestId = crypto.randomUUID()
    toast.loading(t("siyuan.saving"), { id, description: draft.title })
    const poll = async () => {
      try {
        const progress = await services.siyuan.progress(requestId)
        if (finished) return
        if (progress) {
          const download = progress.download
          const fraction = download?.total ? Math.min(download.received / download.total, 1) : 0
          const completed = download ? download.index - 1 : progress.uploaded
          const percent = progress.imageCount
            ? Math.floor(((completed + fraction) / progress.imageCount) * 100)
            : 0
          toast.loading(t(`siyuan.state_${progress.state}`), {
            id,
            description: (
              <div className="space-y-1">
                <p>{draft.title}</p>
                {progress.state === "uploading" && (
                  <>
                    <p>
                      {t("siyuan.image_progress", {
                        done: progress.uploaded,
                        total: progress.imageCount,
                      })}
                    </p>
                    {download && (
                      <p>
                        {t("siyuan.downloading", {
                          index: download.index,
                          kb: Math.ceil(download.received / 1024),
                        })}
                      </p>
                    )}
                    <progress
                      aria-label={t("siyuan.image_progress_label")}
                      className="h-1.5 w-full accent-blue"
                      max={100}
                      value={percent}
                    />
                  </>
                )}
              </div>
            ),
          })
        }
      } catch {
        // A progress read must never cancel an in-flight save.
      }
      if (!finished) timer = setTimeout(() => void poll(), 200)
    }
    timer = setTimeout(() => void poll(), 0)
    const result = await services.siyuan.save(draft, false, requestId)
    finished = true
    if (result.state !== "complete") throw new Error(result.error || t("siyuan.failed"))
    toast.success(t("siyuan.saved"), {
      id,
      duration: 5000,
      description: draft.title,
      action: result.docId
        ? {
            label: t("siyuan.open"),
            onClick: () => void services.siyuan.openDocument(result.docId!),
          }
        : undefined,
    })
  } catch (error) {
    finished = true
    toast.error(t("siyuan.failed"), {
      id,
      duration: 10000,
      description: error instanceof Error ? error.message : String(error),
      action: {
        label: t("siyuan.retry"),
        onClick: () => void quickClipToSiyuan(url, t, openSettings),
      },
    })
  } finally {
    finished = true
    clearTimeout(timer)
    active.delete(key)
  }
}
