import { db } from "./db.js"
import type { RefreshRunResult } from "./scheduler.js"

export const getRefreshHistory = (): RefreshRunResult[] =>
  (
    db.prepare("SELECT result FROM refresh_runs ORDER BY id DESC LIMIT 50").all() as {
      result: string
    }[]
  ).map((row) => JSON.parse(row.result) as RefreshRunResult)

export const saveRefreshRun = (run: RefreshRunResult) => {
  db.transaction(() => {
    db.prepare("INSERT INTO refresh_runs(result) VALUES(?)").run(JSON.stringify(run))
    db.exec(
      "DELETE FROM refresh_runs WHERE id NOT IN (SELECT id FROM refresh_runs ORDER BY id DESC LIMIT 50)",
    )
  })()
}
