import { Hono } from "hono"

import { db } from "./db.js"
import { getRefreshHistory } from "./refresh-history.js"
import {
  getRefreshIntervalMinutes,
  getRefreshStatus,
  isRefreshRunning,
  setRefreshIntervalMinutes,
} from "./scheduler.js"

export const localRoutes = new Hono<{ Variables: { userId: string } }>()
const ok = <T>(data: T) => ({ code: 0 as const, data })

localRoutes.get("/local/refresh-status", (c) =>
  c.json(
    ok({
      intervalMinutes: getRefreshIntervalMinutes(),
      lastRun: getRefreshStatus(),
      running: isRefreshRunning(),
    }),
  ),
)

localRoutes.get("/settings/refresh", (c) =>
  c.json(ok({ intervalMinutes: getRefreshIntervalMinutes(), lastRun: getRefreshStatus() })),
)

localRoutes.get("/local/feed-health", (c) =>
  c.json(
    ok(
      db
        .prepare(
          `
  SELECT f.id, COALESCE(s.title,f.title,f.url) AS title, f.url,
    f.error_at AS errorAt,f.error_message AS error,f.last_refreshed_at AS lastSuccess,
    r.last_attempt_at AS lastAttempt,r.next_attempt_at AS nextAttempt,
    COALESCE(r.failures,0) AS failures,COALESCE(r.paused,0) AS paused,
    r.error_kind AS errorKind,r.last_duration_ms AS durationMs
  FROM feeds f JOIN subscriptions s ON s.feed_id=f.id
    LEFT JOIN feed_refresh_state r ON r.feed_id=f.id
  WHERE s.user_id=? AND (f.error_at IS NOT NULL OR r.paused=1)
  ORDER BY r.paused, f.error_at DESC
`,
        )
        .all(c.get("userId")),
    ),
  ),
)

localRoutes.put("/local/feed-health/:id", async (c) => {
  const id = c.req.param("id")
  if (
    !db
      .prepare("SELECT 1 FROM subscriptions WHERE feed_id=? AND user_id=?")
      .get(id, c.get("userId"))
  )
    return c.json({ code: 404, message: "Subscription not found" }, 404)
  const body = await c.req.json<{ paused?: boolean }>()
  if (typeof body.paused !== "boolean")
    return c.json({ code: 400, message: "paused must be boolean" }, 400)
  db.prepare(
    `INSERT INTO feed_refresh_state(feed_id,paused) VALUES(?,?)
    ON CONFLICT(feed_id) DO UPDATE SET paused=excluded.paused,next_attempt_at=NULL`,
  ).run(id, Number(body.paused))
  return c.json(ok({ saved: true }))
})
localRoutes.put("/settings/refresh", async (c) => {
  const body = await c.req.json<{ intervalMinutes?: number }>()
  try {
    setRefreshIntervalMinutes(body.intervalMinutes ?? 0)
  } catch (error) {
    return c.json(
      { code: 400, message: error instanceof Error ? error.message : "Invalid interval" },
      400,
    )
  }
  return c.json(ok({ intervalMinutes: getRefreshIntervalMinutes() }))
})

localRoutes.get("/local/refresh-history", (c) => c.json(ok(getRefreshHistory())))
