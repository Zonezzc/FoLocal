import { db, getLocalSetting, setLocalSetting } from "./db.js"
import { classifyFeedError } from "./feed-errors.js"
import { describeNetworkError } from "./network.js"
import { getRefreshHistory, saveRefreshRun } from "./refresh-history.js"
import { refreshFeed } from "./rss.js"

export const DEFAULT_REFRESH_INTERVAL_MINUTES = 60
const REFRESH_INTERVAL_KEY = "refresh_interval_minutes"
const CONCURRENCY = 3
const STARTUP_DELAY_MS = 15_000
const POLL_MS = 30_000

export interface RefreshRunResult {
  total: number
  completed: number
  failed: number
  notModified: number
  startedAt: string
  finishedAt: string
  durationMs: number
  deferred: number
}
export interface RefreshRunState extends RefreshRunResult {
  running: boolean
}
let running: Promise<RefreshRunResult> | null = null
let lastRun: RefreshRunResult | null = null
let currentRun: RefreshRunResult | null = null
let timer: ReturnType<typeof setInterval> | null = null
let startupTimer: ReturnType<typeof setTimeout> | null = null
const queue: string[] = []
let networkOnline = () => true
let networkPreviouslyOffline = true
export const setNetworkOnline = (check: () => boolean) => {
  networkOnline = check
}
const scheduled = new Set<string>()
let outcomes = new Map<string, { notModified: boolean; error?: string }>()

export const getRefreshIntervalMinutes = () => {
  const minutes = Number(getLocalSetting(REFRESH_INTERVAL_KEY) ?? DEFAULT_REFRESH_INTERVAL_MINUTES)
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_REFRESH_INTERVAL_MINUTES
}
export const setRefreshIntervalMinutes = (minutes: number) => {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440)
    throw new Error("Refresh interval must be between 0 and 1440 minutes")
  setLocalSetting(REFRESH_INTERVAL_KEY, String(Math.floor(minutes)))
  // Recalculate due times using the new interval; retain failure backoff.
  db.prepare("UPDATE feed_refresh_state SET next_attempt_at=NULL WHERE failures=0").run()
  restartRefreshScheduler()
}
const subscribedFeedIds = () =>
  (db.prepare("SELECT DISTINCT feed_id AS id FROM subscriptions").all() as { id: string }[]).map(
    (r) => r.id,
  )

export const dueFeedIds = (intervalMinutes: number) => {
  const now = new Date().toISOString()
  const cutoff = new Date(Date.now() - intervalMinutes * 60_000).toISOString()
  let offlineCount = 0
  return (
    db
      .prepare(
        `
    SELECT f.id,r.error_kind FROM feeds f LEFT JOIN feed_refresh_state r ON r.feed_id=f.id
    WHERE EXISTS (SELECT 1 FROM subscriptions s WHERE s.feed_id=f.id)
      AND COALESCE(r.paused,0)=0
      AND ((r.next_attempt_at IS NOT NULL AND r.next_attempt_at<=?)
        OR (r.next_attempt_at IS NULL AND (f.last_refreshed_at IS NULL OR f.last_refreshed_at<=?)))
    ORDER BY COALESCE(r.last_attempt_at,f.last_refreshed_at,'')
  `,
      )
      .all(now, cutoff) as { id: string; error_kind: string | null }[]
  )
    .filter((row) => row.error_kind !== "offline" || ++offlineCount <= CONCURRENCY)
    .map((r) => r.id)
}
const recordAttempt = (feedId: string, durationMs: number, error?: unknown) => {
  const now = new Date().toISOString()
  const previous = db
    .prepare("SELECT failures FROM feed_refresh_state WHERE feed_id=?")
    .get(feedId) as { failures: number } | undefined
  const kind = error === undefined ? null : classifyFeedError(error)
  const failures = kind === null ? 0 : (previous?.failures ?? 0) + (kind === "offline" ? 0 : 1)
  const delayMinutes =
    kind === "offline"
      ? 1
      : kind === "permanent"
        ? 24 * 60
        : kind === "parse"
          ? 6 * 60
          : kind
            ? Math.min(24 * 60, 5 * 2 ** Math.min(failures - 1, 9))
            : Math.max(1, getRefreshIntervalMinutes())
  const next = new Date(Date.now() + delayMinutes * 60_000).toISOString()
  db.prepare(
    `INSERT INTO feed_refresh_state(feed_id,failures,last_attempt_at,next_attempt_at,error_kind,last_duration_ms)
    VALUES(?,?,?,?,?,?) ON CONFLICT(feed_id) DO UPDATE SET failures=excluded.failures,
    last_attempt_at=excluded.last_attempt_at,next_attempt_at=excluded.next_attempt_at,
    error_kind=excluded.error_kind,last_duration_ms=excluded.last_duration_ms`,
  ).run(feedId, failures, now, next, kind, durationMs)
  db.prepare("UPDATE feeds SET error_at=?,error_message=? WHERE id=?").run(
    kind ? now : null,
    kind ? describeNetworkError(error) : null,
    feedId,
  )
}

export const runRefreshSweep = (feedIds: string[]): Promise<RefreshRunResult> => {
  if (!running) {
    scheduled.clear()
    outcomes = new Map()
    currentRun = {
      total: 0,
      completed: 0,
      failed: 0,
      notModified: 0,
      startedAt: new Date().toISOString(),
      finishedAt: "",
      durationMs: 0,
      deferred: 0,
    }
  }
  for (const id of feedIds) {
    if (scheduled.has(id)) continue
    scheduled.add(id)
    queue.push(id)
    currentRun!.total++
  }
  if (running) return running
  // Defer workers until the shared promise is assigned, including empty sweeps.
  running = Promise.resolve()
    .then(async () => {
      const state = currentRun!
      const results = outcomes
      let offlineDetected = false
      const worker = async () => {
        while (queue.length && !offlineDetected) {
          const id = queue.shift()!
          const startedAt = Date.now()
          const row = db.prepare("SELECT url FROM feeds WHERE id=?").get(id) as
            { url: string } | undefined
          try {
            if (row) {
              const result = await refreshFeed(row.url, { conditional: true })
              results.set(id, { notModified: !!result.notModified })
              if (result.notModified) state.notModified++
              // A subscription may be removed while its request is in flight.
              if (db.prepare("SELECT 1 FROM feeds WHERE id=?").get(id))
                recordAttempt(id, Date.now() - startedAt)
            }
          } catch (error) {
            results.set(id, { notModified: false, error: describeNetworkError(error) })
            state.failed++
            if (classifyFeedError(error) === "offline") {
              offlineDetected = true
              networkPreviouslyOffline = true
            }
            if (db.prepare("SELECT 1 FROM feeds WHERE id=?").get(id))
              recordAttempt(id, Date.now() - startedAt, error)
          } finally {
            state.completed++
          }
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker))
      state.finishedAt = new Date().toISOString()
      state.durationMs = Date.now() - Date.parse(state.startedAt)
      state.deferred = queue.length
      queue.length = 0
      lastRun = { ...state }
      saveRefreshRun(lastRun)
      return lastRun
    })
    .finally(() => {
      running = null
      currentRun = null
      queue.length = 0
      scheduled.clear()
    })
  return running
}
export const refreshAllSubscribedFeeds = () => runRefreshSweep(subscribedFeedIds())
export const refreshFeedsByIds = (ids: string[]) => runRefreshSweep(ids)
export const refreshFeedById = async (id: string) => {
  const pending = runRefreshSweep([id])
  const results = outcomes
  await pending
  const result = results.get(id)
  if (!result || result.error)
    throw new Error(
      result?.error ??
        (db.prepare("SELECT 1 FROM feeds WHERE id=?").get(id)
          ? "Refresh deferred until the network recovers"
          : "Feed no longer exists"),
    )
  return result
}
export const runFullRefreshSweep = refreshAllSubscribedFeeds
export const sweepDueFeeds = async () => {
  const interval = getRefreshIntervalMinutes()
  if (!interval) return
  if (!networkOnline()) {
    networkPreviouslyOffline = true
    return
  }
  if (networkPreviouslyOffline) {
    db.prepare("UPDATE feed_refresh_state SET next_attempt_at=? WHERE error_kind='offline'").run(
      new Date().toISOString(),
    )
    networkPreviouslyOffline = false
  }
  const ids = dueFeedIds(interval)
  if (ids.length) await runRefreshSweep(ids)
}
const restartRefreshScheduler = () => {
  if (timer) clearInterval(timer)
  timer = null
  if (!getRefreshIntervalMinutes()) return
  timer = setInterval(() => void sweepDueFeeds().catch(console.error), POLL_MS)
  timer.unref?.()
}
export const startRefreshScheduler = () => {
  restartRefreshScheduler()
  if (startupTimer) clearTimeout(startupTimer)
  startupTimer = setTimeout(() => {
    startupTimer = null
    void sweepDueFeeds().catch(console.error)
  }, STARTUP_DELAY_MS)
  startupTimer.unref?.()
}
export const stopRefreshScheduler = () => {
  if (timer) clearInterval(timer)
  if (startupTimer) clearTimeout(startupTimer)
  timer = null
  startupTimer = null
  networkPreviouslyOffline = true
}
export const getRefreshStatus = (): RefreshRunState | null => {
  const state = currentRun ?? lastRun ?? getRefreshHistory()[0]
  return state ? { ...state, running: running !== null } : null
}
export const isRefreshRunning = () => running !== null
