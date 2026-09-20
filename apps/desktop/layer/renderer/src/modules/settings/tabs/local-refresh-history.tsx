import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"

import { localRequest } from "~/lib/local-request"

import { SettingSectionTitle } from "../section"

interface RefreshHistoryItem {
  startedAt: string
  finishedAt: string
  total: number
  completed: number
  failed: number
  deferred: number
  durationMs: number
}

export const LocalRefreshHistory = () => {
  const { t } = useTranslation("settings")
  const history = useQuery({
    queryKey: ["localRefreshHistory"],
    queryFn: () => localRequest<RefreshHistoryItem[]>("/local/refresh-history"),
    refetchInterval: 10_000,
  })
  return (
    <>
      <SettingSectionTitle title={t("local.history_title")} />
      <div className="space-y-3 rounded-lg border border-border p-4">
        <p className="text-sm text-text-secondary">{t("local.history_description")}</p>
        {history.error && <p className="text-red">{history.error.message}</p>}
        {history.data?.length === 0 && <p className="text-sm">{t("local.never_run")}</p>}
        {history.data?.slice(0, 5).map((run, index) => (
          <div key={`${run.startedAt}-${index}`} className="border-t border-border pt-3 text-xs">
            <p>{new Date(run.finishedAt).toLocaleString()}</p>
            <p>
              {t("local.history_result", {
                completed: run.completed,
                total: run.total,
                failed: run.failed,
                deferred: run.deferred,
                seconds: (run.durationMs / 1000).toFixed(1),
              })}
            </p>
          </div>
        ))}
      </div>
    </>
  )
}
