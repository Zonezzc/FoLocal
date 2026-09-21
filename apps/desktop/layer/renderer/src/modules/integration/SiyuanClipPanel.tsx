import type { SourceArticle } from "@follow/clipper-core"
import { IN_ELECTRON } from "@follow/shared/constants"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Markdown } from "~/components/ui/markdown/Markdown"
import { ipcServices } from "~/lib/client"

import { acquireSourceArticle } from "./source-article"

const fieldClass = "w-full rounded-lg border border-fill bg-background p-2 text-sm"
const buttonClass =
  "rounded-lg bg-fill-secondary px-3 py-2 text-sm hover:bg-fill disabled:opacity-40"
const settingsKey = ["siyuan-settings"]
const historyKey = ["siyuan-history"]
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function SiyuanClipPanel({
  initialUrl = "",
  settings = false,
}: {
  initialUrl?: string
  settings?: boolean
}) {
  const { t } = useTranslation("settings")
  const client = useQueryClient()
  const config = useQuery({
    queryKey: settingsKey,
    queryFn: () => ipcServices!.siyuan.settings(),
    enabled: IN_ELECTRON,
  })
  const history = useQuery({
    queryKey: historyKey,
    queryFn: () => ipcServices!.siyuan.history(),
    enabled: IN_ELECTRON,
    refetchInterval: 1500,
  })
  const [url, setUrl] = useState(initialUrl)
  const [draft, setDraft] = useState<SourceArticle>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [showMarkdown, setShowMarkdown] = useState(false)
  const [connection, setConnection] = useState<{
    endpoint: string
    notebook: string
    path: string
    assetPath?: string
    addSourceLink?: boolean
  }>()
  const [token, setToken] = useState("")
  const [notebooks, setNotebooks] = useState<{ id: string; name: string }[]>([])
  const values = connection ||
    config.data || {
      endpoint: "http://127.0.0.1:6806",
      notebook: "",
      path: "/FoLocal",
      assetPath: "/assets/FoLocal/",
      addSourceLink: true,
    }
  const update = (key: "endpoint" | "notebook" | "path" | "assetPath", value: string) =>
    setConnection({ ...values, [key]: value })
  const action = async (task: () => Promise<void>) => {
    setBusy(true)
    setError("")
    setMessage("")
    try {
      await task()
    } catch (cause) {
      setMessage("")
      setError(errorText(cause))
    } finally {
      setBusy(false)
      void client.invalidateQueries({ queryKey: historyKey })
    }
  }
  const configure = async () => {
    const saved = await ipcServices!.siyuan.configure({ ...values, token: token || undefined })
    client.setQueryData(settingsKey, saved)
    setToken("")
    setConnection(undefined)
  }
  const extract = (rendered: boolean) =>
    action(async () => {
      setDraft(undefined)
      setMessage(t("siyuan.extracting"))
      const article = await acquireSourceArticle(url, rendered)
      setDraft(article)
      setMessage("")
    })
  const save = (asCopy = false) =>
    action(async () => {
      if (!draft) return
      setMessage(t("siyuan.saving"))
      const result = await ipcServices!.siyuan.save(draft, asCopy)
      if (result.state !== "complete") throw new Error(result.error || t("siyuan.failed"))
      setMessage(t("siyuan.saved"))
    })
  if (!IN_ELECTRON) return null
  return (
    <section className="space-y-4 p-4">
      {settings && <h3 className="font-semibold">{t("siyuan.title")}</h3>}
      <p className="text-sm text-text-secondary">{t("siyuan.description")}</p>
      {settings && (
        <fieldset disabled={busy || config.isLoading} className="space-y-3">
          <label className="block text-sm">
            {t("siyuan.endpoint")}
            <input
              className={fieldClass}
              value={values.endpoint}
              onChange={(event) => update("endpoint", event.target.value)}
            />
          </label>
          <label className="block text-sm">
            {t("siyuan.token")}
            <input
              type="password"
              autoComplete="off"
              className={fieldClass}
              value={token}
              placeholder={config.data?.hasToken ? t("siyuan.token_saved") : ""}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <button
            className={buttonClass}
            onClick={() =>
              void action(async () => {
                await configure()
                setNotebooks(await ipcServices!.siyuan.notebooks())
                setMessage(t("siyuan.connected"))
              })
            }
          >
            {t("siyuan.connect")}
          </button>
          <label className="block text-sm">
            {t("siyuan.notebook")}
            <select
              className={fieldClass}
              value={values.notebook}
              onChange={(event) => update("notebook", event.target.value)}
            >
              <option value="">{t("siyuan.choose_notebook")}</option>
              {values.notebook && !notebooks.some((item) => item.id === values.notebook) && (
                <option value={values.notebook}>{values.notebook}</option>
              )}
              {notebooks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            {t("siyuan.path")}
            <input
              className={fieldClass}
              value={values.path}
              onChange={(event) => update("path", event.target.value)}
            />
          </label>
          <label className="block text-sm">
            {t("siyuan.asset_path")}
            <input
              className={fieldClass}
              value={values.assetPath ?? "/assets/FoLocal/"}
              onChange={(event) => update("assetPath", event.target.value)}
            />
          </label>
          <p className="text-xs text-text-secondary">{t("siyuan.asset_path_hint")}</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.addSourceLink !== false}
              onChange={(event) =>
                setConnection({ ...values, addSourceLink: event.target.checked })
              }
            />
            {t("siyuan.add_source_link")}
          </label>
          <p className="text-xs text-text-secondary">{t("siyuan.add_source_link_hint")}</p>
          <button
            className={buttonClass}
            onClick={() =>
              void action(async () => {
                await configure()
                setMessage(t("siyuan.config_saved"))
              })
            }
          >
            {t("siyuan.save_settings")}
          </button>
        </fieldset>
      )}
      <fieldset disabled={busy} className="space-y-3">
        <label className="block text-sm">
          {t("siyuan.url")}
          <input
            type="url"
            className={fieldClass}
            value={url}
            placeholder="https://"
            onChange={(event) => {
              setUrl(event.target.value)
              setDraft(undefined)
              setMessage("")
              setError("")
            }}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className={buttonClass}
            disabled={!url.trim()}
            onClick={() => void extract(false)}
          >
            {t("siyuan.extract")}
          </button>
          <button className={buttonClass} disabled={!url.trim()} onClick={() => void extract(true)}>
            {t("siyuan.rendered")}
          </button>
        </div>
        <p className="text-xs text-text-secondary">{t("siyuan.login_hint")}</p>
        {draft && (
          <div className="space-y-3">
            <label className="block text-sm">
              {t("siyuan.article_title")}
              <input
                className={fieldClass}
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </label>
            <p className="break-all text-xs text-text-secondary">
              {draft.canonicalUrl} ·{" "}
              {t(draft.mode === "rendered" ? "siyuan.mode_rendered" : "siyuan.mode_static")} ·{" "}
              {t("siyuan.images", { count: draft.images.length })}
            </p>
            <div className="flex gap-2">
              <button
                className={buttonClass}
                aria-pressed={!showMarkdown}
                onClick={() => setShowMarkdown(false)}
              >
                {t("siyuan.readable_preview")}
              </button>
              <button
                className={buttonClass}
                aria-pressed={showMarkdown}
                onClick={() => setShowMarkdown(true)}
              >
                {t("siyuan.preview")}
              </button>
            </div>
            {showMarkdown ? (
              <label className="block text-sm">
                <span className="sr-only">{t("siyuan.preview")}</span>
                <textarea
                  readOnly
                  className={`${fieldClass} h-64 resize-y font-mono`}
                  value={draft.images.reduce(
                    (markdown, image) => markdown.replaceAll(image.placeholder, image.url),
                    draft.markdown,
                  )}
                />
              </label>
            ) : (
              <div className="max-h-80 overflow-auto rounded-lg border border-fill p-4">
                <Markdown>
                  {draft.images.reduce(
                    (markdown, image) => markdown.replaceAll(image.placeholder, image.url),
                    draft.markdown,
                  )}
                </Markdown>
              </div>
            )}
            <p className="text-sm text-text-secondary">
              {config.data?.notebook
                ? `${t("siyuan.destination")}: ${config.data.notebook}${config.data.path}`
                : t("siyuan.configure_first")}
            </p>
            <div className="flex gap-2">
              <button
                className={buttonClass}
                disabled={!config.data?.notebook}
                onClick={() => void save()}
              >
                {t("siyuan.save")}
              </button>
              <button
                className={buttonClass}
                disabled={!config.data?.notebook}
                onClick={() => void save(true)}
              >
                {t("siyuan.save_copy")}
              </button>
            </div>
          </div>
        )}
      </fieldset>
      {message && (
        <p role="status" className="text-sm text-text-secondary">
          {message}
        </p>
      )}
      {(error || config.error || history.error) && (
        <p role="alert" className="break-words text-sm text-red">
          {error || errorText(config.error || history.error)}
        </p>
      )}
      <details className="text-sm" open={settings}>
        <summary>{t("siyuan.history")}</summary>
        <ul className="mt-3 space-y-3">
          {history.data?.slice(0, 10).map((job) => (
            <li key={job.id} className="rounded-lg border border-fill p-3">
              <p className="font-medium">{job.title}</p>
              <p className="text-text-secondary">
                {t(`siyuan.state_${job.state}`)} · {job.uploaded}/{job.imageCount}
              </p>
              {job.error && <p className="break-words text-red">{job.error}</p>}
              <div className="mt-2 flex gap-2">
                {job.state !== "complete" && (
                  <button
                    className={buttonClass}
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const result = await ipcServices!.siyuan.retry(job.id)
                        if (result.state !== "complete")
                          throw new Error(result.error || t("siyuan.failed"))
                        setMessage(t("siyuan.saved"))
                      })
                    }
                  >
                    {t("siyuan.retry")}
                  </button>
                )}
                {job.docId && (
                  <button
                    className={buttonClass}
                    onClick={() => void action(() => ipcServices!.siyuan.openDocument(job.docId!))}
                  >
                    {t("siyuan.open")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}
