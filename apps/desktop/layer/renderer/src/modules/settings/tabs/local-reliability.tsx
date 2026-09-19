import { Button } from "@follow/components/ui/button/index.js"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { ipcServices } from "~/lib/client"
import { localRequest } from "~/lib/local-request"

import { SettingSectionTitle } from "../section"

interface FeedHealth {
  id: string
  title: string
  error: string | null
  lastSuccess: string | null
  nextAttempt: string | null
  failures: number
  paused: number
}
export const LocalReliability = () => {
  const { t } = useTranslation("settings")
  const client = useQueryClient()
  const [showAll, setShowAll] = useState(false)
  const [preview, setPreview] = useState<Awaited<
    ReturnType<NonNullable<typeof ipcServices>["profile"]["preview"]>
  > | null>(null)
  const health = useQuery({
    queryKey: ["localFeedHealth"],
    queryFn: () => localRequest<FeedHealth[]>("/local/feed-health"),
    refetchInterval: 10_000,
  })
  const snapshots = useQuery({
    queryKey: ["profileSnapshots"],
    queryFn: () => ipcServices!.profile.list(),
    enabled: !!ipcServices,
  })
  const action = useMutation({
    mutationFn: async ({ id, paused }: { id: string; paused?: boolean }) => {
      if (paused === undefined)
        await localRequest("/feeds/refresh", { method: "POST", body: { ids: [id] } })
      else
        await localRequest(`/local/feed-health/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: { paused },
        })
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["localFeedHealth"] }),
    onError: (error) => toast.error(error.message),
  })
  const backup = useMutation({
    mutationFn: () => ipcServices!.profile.backup(),
    onError: (error) => toast.error(error.message),
  })
  const inspect = useMutation({
    mutationFn: (id: string) => ipcServices!.profile.preview(id),
    onSuccess: setPreview,
    onError: (error) => toast.error(error.message),
  })
  const restore = useMutation({
    mutationFn: (id: string) => ipcServices!.profile.restore(id),
    onError: (error) => toast.error(error.message),
  })
  const rows = health.data ?? []
  return (
    <>
      <SettingSectionTitle title={t("local.health_title")} />
      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm text-text-secondary">{t("local.health_description")}</p>
        <p className="text-sm">{t("local.health_count", { count: rows.length })}</p>
        {health.error && <p className="text-red">{health.error.message}</p>}
        {(showAll ? rows : rows.slice(0, 10)).map((row) => (
          <div key={row.id} className="space-y-2 border-t border-border pt-3">
            <p className="text-sm font-medium">{row.title}</p>
            <p className="break-words text-xs text-text-tertiary">
              {row.error ?? t("local.health_paused")}
            </p>
            <p className="text-xs text-text-tertiary">
              {t("local.health_times", {
                success: row.lastSuccess
                  ? new Date(row.lastSuccess).toLocaleString()
                  : t("local.never_run"),
                next: row.paused
                  ? t("local.health_paused")
                  : row.nextAttempt
                    ? new Date(row.nextAttempt).toLocaleString()
                    : "—",
              })}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={action.isPending}
                onClick={() => action.mutate({ id: row.id })}
              >
                {t("local.health_retry")}
              </Button>
              <Button
                variant="outline"
                disabled={action.isPending}
                onClick={() => action.mutate({ id: row.id, paused: !row.paused })}
              >
                {t(row.paused ? "local.health_resume" : "local.health_pause")}
              </Button>
            </div>
          </div>
        ))}
        {rows.length > 10 && (
          <Button variant="outline" onClick={() => setShowAll(!showAll)}>
            {t(showAll ? "local.health_less" : "local.health_all")}
          </Button>
        )}
      </div>
      <SettingSectionTitle title={t("local.profile_title")} />
      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm text-text-secondary">{t("local.profile_description")}</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!ipcServices || backup.isPending} onClick={() => backup.mutate()}>
            {t("local.profile_backup")}
          </Button>
          <Button
            variant="outline"
            disabled={!ipcServices}
            onClick={() => void ipcServices!.profile.openFolder()}
          >
            {t("local.profile_folder")}
          </Button>
        </div>
        {snapshots.error && <p className="text-red">{snapshots.error.message}</p>}
        {snapshots.data?.map((snapshot) => (
          <div
            key={snapshot.id}
            className="flex items-center justify-between gap-3 border-t border-border pt-3"
          >
            <div className="text-xs">
              <p>
                {new Date(snapshot.createdAt).toLocaleString()} · {snapshot.version}
              </p>
              <p>{t("local.profile_counts", snapshot.counts)}</p>
            </div>
            <Button
              variant="outline"
              disabled={inspect.isPending}
              onClick={() => inspect.mutate(snapshot.id)}
            >
              {t("local.profile_preview")}
            </Button>
          </div>
        ))}
        {preview && (
          <div className="space-y-3 rounded-lg bg-fill-secondary p-3">
            <p className="text-sm">{t("local.profile_verified")}</p>
            <p className="text-xs">
              {new Date(preview.createdAt).toLocaleString()} ·{" "}
              {t("local.profile_counts", preview.counts)}
            </p>
            <p className="text-xs text-text-secondary">{t("local.profile_restore_note")}</p>
            <Button
              variant="outline"
              disabled={restore.isPending}
              onClick={() => restore.mutate(preview.id)}
            >
              {t("local.profile_restore")}
            </Button>
          </div>
        )}
      </div>
    </>
  )
}
