import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { appLog } from "~/lib/log"
import { invalidateAfterRefresh, useRefreshStatusQuery } from "~/queries/feed"

/**
 * The local backend refreshes subscriptions on a timer, in the main process, with no way to push
 * into the renderer. Polling the scheduler status and invalidating when a sweep finishes is what
 * makes freshly fetched entries appear without a manual refresh.
 */
export const LocalRefreshSync = () => {
  const queryClient = useQueryClient()
  const { data } = useRefreshStatusQuery()
  const lastHandledRef = useRef<string | null | undefined>(undefined)
  const finishedAt = data === undefined ? undefined : (data.lastRun?.finishedAt ?? null)

  useEffect(() => {
    if (finishedAt === undefined) return
    if (lastHandledRef.current === undefined) {
      // The first valid status establishes the baseline, including no completed run.
      lastHandledRef.current = finishedAt
      return
    }
    if (!finishedAt || lastHandledRef.current === finishedAt) return
    lastHandledRef.current = finishedAt
    appLog(`Background refresh finished, invalidating entries (${finishedAt})`)
    void invalidateAfterRefresh(queryClient).catch((error) => {
      appLog("Background refresh invalidation failed", error)
    })
  }, [finishedAt, queryClient])

  return null
}
