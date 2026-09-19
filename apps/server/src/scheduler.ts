import { db, getLocalSetting, setLocalSetting } from "./db.js"
import { describeNetworkError } from "./network.js"
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
  return (
    db
      .prepare(
        `
    SELECT f.id FROM feeds f LEFT JOIN feed_refresh_state r ON r.feed_id=f.id
    WHERE EXISTS (SELECT 1 FROM subscriptions s WHERE s.feed_id=f.id)
      AND COALESCE(r.paused,0)=0
      AND ((r.next_attempt_at IS NOT NULL AND r.next_attempt_at<=?)
        OR (r.next_attempt_at IS NULL AND (f.last_refreshed_at IS NULL OR f.last_refreshed_at<=?)))
    ORDER BY COALESCE(r.last_attempt_at,f.last_refreshed_at,'')
  `,
      )
      .all(now, cutoff) as { id: string }[]
  ).map((r) => r.id)
}
const recordAttempt = (feedId: string, error?: unknown) => {
  const now = new Date().toISOString()
  const previous = db
    .prepare("SELECT failures FROM feed_refresh_state WHERE feed_id=?")
    .get(feedId) as { failures: number } | undefined
  const failures = error === undefined ? 0 : (previous?.failures ?? 0) + 1
  const delayMinutes = failures
    ? Math.min(24 * 60, 5 * 2 ** Math.min(failures - 1, 9))
    : Math.max(1, getRefreshIntervalMinutes())
  const next = new Date(Date.now() + delayMinutes * 60_000).toISOString()
  db.prepare(
    `INSERT INTO feed_refresh_state(feed_id,failures,last_attempt_at,next_attempt_at)
    VALUES(?,?,?,?) ON CONFLICT(feed_id) DO UPDATE SET failures=excluded.failures,
    last_attempt_at=excluded.last_attempt_at,next_attempt_at=excluded.next_attempt_at`,
  ).run(feedId, failures, now, next)
  db.prepare("UPDATE feeds SET error_at=?,error_message=? WHERE id=?").run(
    failures ? now : null,
    failures ? describeNetworkError(error) : null,
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
      const worker = async () => {
        while (queue.length) {
          const id = queue.shift()!
          const row = db.prepare("SELECT url FROM feeds WHERE id=?").get(id) as
            { url: string } | undefined
          try {
            if (row) {
              const result = await refreshFeed(row.url, { conditional: true })
              results.set(id, { notModified: !!result.notModified })
              if (result.notModified) state.notModified++
              // A subscription may be removed while its request is in flight.
              if (db.prepare("SELECT 1 FROM feeds WHERE id=?").get(id)) recordAttempt(id)
            }
          } catch (error) {
            results.set(id, { notModified: false, error: describeNetworkError(error) })
            state.failed++
            if (db.prepare("SELECT 1 FROM feeds WHERE id=?").get(id)) recordAttempt(id, error)
          } finally {
            state.completed++
          }
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker))
      state.finishedAt = new Date().toISOString()
      lastRun = { ...state }
      return lastRun
    })
    .finally(() => {
      running = null
      currentRun = null
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
  if (!result || result.error) throw new Error(result?.error ?? "Feed no longer exists")
  return result
}
export const runFullRefreshSweep = refreshAllSubscribedFeeds
export const sweepDueFeeds = async () => {
  const interval = getRefreshIntervalMinutes()
  if (!interval) return
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
}
export const getRefreshStatus = (): RefreshRunState | null => {
  const state = currentRun ?? lastRun
  return state ? { ...state, running: running !== null } : null
}
export const isRefreshRunning = () => running !== null
