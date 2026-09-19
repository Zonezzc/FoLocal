import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"

import { join } from "pathe"
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock("./rss.js", () => ({ refreshFeed: mocks.refresh }))
const folder = mkdtempSync(join(tmpdir(), "folocal-scheduler-"))
vi.stubEnv("DATABASE_PATH", join(folder, "test.db"))
const { db } = await import("./db.js")
const scheduler = await import("./scheduler.js")
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
})
afterEach(() => {
  scheduler.stopRefreshScheduler()
  db.exec("DELETE FROM feeds; DELETE FROM local_settings;")
  vi.useRealTimers()
})
afterAll(() => {
  db.close()
  rmSync(folder, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe("fair feed refresh queue", () => {
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
