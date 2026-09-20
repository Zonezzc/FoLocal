import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

import { join } from "pathe"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FeedFetchError } from "./feed-errors.js"

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("./rss.js", () => ({ refreshFeed: mocks.refresh }))
const folder = mkdtempSync(join(tmpdir(), "folocal-scheduler-"))
vi.stubEnv("DATABASE_PATH", join(folder, "test.db"))
const { db } = await import("./db.js")
const scheduler = await import("./scheduler.js")
const { getRefreshHistory } = await import("./refresh-history.js")
const seed = (count: number) => {
  for (let n = 0; n < count; n++) {
    const id = String(n)
    db.prepare("INSERT INTO feeds(id,url,updated_at) VALUES(?,?,?)").run(
      id,
      `https://feed-${id}.test/rss`,
      new Date().toISOString(),
    )
    db.prepare("INSERT INTO subscriptions(id,user_id,feed_id,created_at) VALUES(?,?,?,?)").run(
      id,
      "local-user",
      id,
      new Date().toISOString(),
    )
  }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-20T00:00:00Z"))
  mocks.refresh.mockReset().mockResolvedValue({ notModified: false })
  scheduler.setNetworkOnline(() => true)
})
afterEach(() => {
  scheduler.stopRefreshScheduler()
  db.exec("DELETE FROM feeds; DELETE FROM local_settings; DELETE FROM refresh_runs;")
  vi.useRealTimers()
})
afterAll(() => {
  db.close()
  rmSync(folder, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe("fair feed refresh queue", () => {
  it("does not fetch or penalize feeds while the device is offline", async () => {
    seed(10)
    scheduler.setNetworkOnline(() => false)
    await scheduler.sweepDueFeeds()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(db.prepare("SELECT COUNT(*) n FROM feed_refresh_state").get()!.n).toBe(0)
    scheduler.setNetworkOnline(() => true)
    await scheduler.sweepDueFeeds()
    expect(mocks.refresh).toHaveBeenCalledTimes(10)
  })
  it("stops a batch when connectivity is lost without escalating offline failures", async () => {
    seed(10)
    mocks.refresh.mockRejectedValue(new Error("net::ERR_INTERNET_DISCONNECTED"))
    const result = await scheduler.runRefreshSweep(Array.from({ length: 10 }, (_, n) => String(n)))
    expect(mocks.refresh).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({ total: 10, completed: 3, failed: 3, deferred: 7 })
    expect(db.prepare("SELECT failures,error_kind FROM feed_refresh_state").all()).toEqual(
      Array.from({ length: 3 }, () => ({ failures: 0, error_kind: "offline" })),
    )
  })
  it("retries previously offline feeds in bounded groups after recovery", async () => {
    seed(8)
    for (let n = 0; n < 8; n++)
      db.prepare(
        "INSERT INTO feed_refresh_state(feed_id,failures,error_kind,next_attempt_at) VALUES(?,8,'offline','2026-09-21T00:00:00Z')",
      ).run(String(n))
    scheduler.setNetworkOnline(() => false)
    await scheduler.sweepDueFeeds()
    scheduler.setNetworkOnline(() => true)
    await scheduler.sweepDueFeeds()
    expect(mocks.refresh).toHaveBeenCalledTimes(3)
    await scheduler.sweepDueFeeds()
    expect(mocks.refresh).toHaveBeenCalledTimes(6)
  })
  it.each([
    ["permanent", "2026-09-21T00:00:00.000Z"],
    ["parse", "2026-09-20T06:00:00.000Z"],
  ] as const)("uses a distinct retry policy for %s", async (kind, next) => {
    seed(1)
    mocks.refresh.mockRejectedValueOnce(new FeedFetchError(kind, "fixture error"))
    await scheduler.runRefreshSweep(["0"])
    expect(db.prepare("SELECT error_kind,next_attempt_at FROM feed_refresh_state").get()).toEqual({
      error_kind: kind,
      next_attempt_at: next,
    })
  })
  it("persists bounded batch history and timing without source URLs", async () => {
    seed(1)
    for (let n = 0; n < 52; n++) await scheduler.runRefreshSweep(["0"])
    const history = getRefreshHistory()
    expect(history).toHaveLength(50)
    expect(history[0]).toMatchObject({
      total: 1,
      completed: 1,
      failed: 0,
      deferred: 0,
      durationMs: 0,
    })
    expect(JSON.stringify(history)).not.toContain("https://")
    expect(db.prepare("SELECT COUNT(*) n FROM refresh_runs").get()!.n).toBe(50)
  })
  it("refreshes all 461 due feeds with at most three requests in flight", async () => {
    seed(461)
    let active = 0,
      peak = 0
    mocks.refresh.mockImplementation(async () => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      return { notModified: false }
    })
    expect(scheduler.dueFeedIds(60)).toHaveLength(461)
    await scheduler.sweepDueFeeds()
    expect(mocks.refresh).toHaveBeenCalledTimes(461)
    expect(peak).toBeLessThanOrEqual(3)
    expect(scheduler.getRefreshStatus()).toMatchObject({
      total: 461,
      completed: 461,
      running: false,
    })
    expect(scheduler.dueFeedIds(60)).toEqual([])
  })
  it("enqueues new selections while a sweep runs without duplicating an active feed", async () => {
    seed(4)
    let release!: () => void
    mocks.refresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ notModified: false })
        }),
    )
    const first = scheduler.runRefreshSweep(["0"])
    await Promise.resolve()
    const second = scheduler.runRefreshSweep(["0", "1", "2", "3"])
    expect(scheduler.getRefreshStatus()).toMatchObject({ total: 4, running: true })
    release()
    await Promise.all([first, second])
    expect(mocks.refresh).toHaveBeenCalledTimes(4)
    expect(scheduler.getRefreshStatus()).toMatchObject({ completed: 4 })
  })
  it("backs off failures and keeps healthy feeds eligible", async () => {
    seed(2)
    mocks.refresh.mockRejectedValueOnce(
      new Error("fetch failed", {
        cause: Object.assign(new Error("DNS lookup failed"), { code: "ENOTFOUND" }),
      }),
    )
    await scheduler.runRefreshSweep(["0"])
    expect(scheduler.dueFeedIds(60)).toEqual(["1"])
    const state = db.prepare("SELECT * FROM feed_refresh_state WHERE feed_id='0'").get()!
    expect(state.failures).toBe(1)
    expect(state.next_attempt_at).toBe("2026-09-20T00:05:00.000Z")
    expect(
      String(db.prepare("SELECT error_message FROM feeds WHERE id='0'").get()!.error_message),
    ).toContain("ENOTFOUND")
    vi.setSystemTime(new Date("2026-09-20T00:05:00Z"))
    expect(scheduler.dueFeedIds(60)).toContain("0")
    mocks.refresh.mockRejectedValueOnce(new Error("still offline"))
    await scheduler.runRefreshSweep(["0"])
    expect(
      db.prepare("SELECT next_attempt_at FROM feed_refresh_state WHERE feed_id='0'").get()!
        .next_attempt_at,
    ).toBe("2026-09-20T00:15:00.000Z")
  })
  it("excludes paused feeds from automatic refresh while allowing an explicit retry", async () => {
    seed(1)
    db.prepare("INSERT INTO feed_refresh_state(feed_id,paused) VALUES('0',1)").run()
    await scheduler.sweepDueFeeds()
    expect(mocks.refresh).not.toHaveBeenCalled()
    await scheduler.refreshFeedById("0")
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(scheduler.dueFeedIds(60)).toEqual([])
  })
  it("polls due work without enabling refresh when disabled", async () => {
    seed(1)
    scheduler.setRefreshIntervalMinutes(0)
    scheduler.startRefreshScheduler()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
