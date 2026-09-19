import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { DatabaseSync } from "node:sqlite"

import { join } from "pathe"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  backupRoot,
  createProfileSnapshot,
  listProfileSnapshots,
  requestProfileMaintenance,
  runProfileMaintenance,
  validateProfileSnapshot,
} from "./profile-backup"

let root: string, profile: string
const value = () => {
  const db = new DatabaseSync(join(profile, "local-api.db"), { readOnly: true })
  try {
    return db.prepare("SELECT title FROM entries").get()!.title
  } finally {
    db.close()
  }
}
const modify = () => {
  const db = new DatabaseSync(join(profile, "local-api.db"))
  db.exec("UPDATE entries SET title='newer article'")
  db.close()
  writeFileSync(join(profile, "openai.json"), '{"model":"newer"}')
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "folocal-backup-"))
  profile = join(root, "profile")
  mkdirSync(join(profile, "Local Storage", "leveldb"), { recursive: true })
  writeFileSync(join(profile, "Local Storage", "leveldb", "fixture"), "preferences")
  writeFileSync(join(profile, "openai.json"), '{"model":"original","apiKey":"test-key"}')
  const db = new DatabaseSync(join(profile, "local-api.db"))
  db.exec(`PRAGMA journal_mode=WAL;CREATE TABLE subscriptions(id TEXT);CREATE TABLE entries(title TEXT);
    CREATE TABLE reads(id TEXT);CREATE TABLE collections(id TEXT);
    INSERT INTO subscriptions VALUES('source');INSERT INTO entries VALUES('original article');`)
  db.close()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))
describe("complete offline profile snapshots", () => {
  it("restores database, provider settings and UI preferences, retaining a recovery snapshot", () => {
    const snapshot = createProfileSnapshot(profile, "1.13.1", "manual")
    expect(validateProfileSnapshot(profile, snapshot.id).counts).toMatchObject({
      subscriptions: 1,
      entries: 1,
    })
    modify()
    writeFileSync(join(profile, "Local Storage", "leveldb", "fixture"), "changed")
    requestProfileMaintenance(profile, { kind: "restore", id: snapshot.id })
    runProfileMaintenance(profile, "1.13.1")
    expect(value()).toBe("original article")
    expect(readFileSync(join(profile, "openai.json"), "utf8")).toContain("original")
    expect(readFileSync(join(profile, "Local Storage", "leveldb", "fixture"), "utf8")).toBe(
      "preferences",
    )
    const rollback = listProfileSnapshots(profile).find((s) => s.reason === "before-restore")!
    requestProfileMaintenance(profile, { kind: "restore", id: rollback.id })
    runProfileMaintenance(profile, "1.13.1")
    expect(value()).toBe("newer article")
    expect(readFileSync(join(profile, "openai.json"), "utf8")).toContain("newer")
  })
  it("rejects a modified backup before changing current data", () => {
    const snapshot = createProfileSnapshot(profile, "1.13.1", "manual")
    writeFileSync(join(backupRoot(profile), snapshot.id, "data", "openai.json"), "tampered")
    expect(() => requestProfileMaintenance(profile, { kind: "restore", id: snapshot.id })).toThrow(
      "checksum",
    )
    expect(value()).toBe("original article")
    expect(existsSync(join(backupRoot(profile), "pending.json"))).toBe(false)
  })
  it("rolls back an interrupted restore before opening the app", () => {
    const safety = createProfileSnapshot(profile, "1.13.1", "before-restore")
    modify()
    writeFileSync(
      join(backupRoot(profile), "restore-journal.json"),
      JSON.stringify({ rollbackId: safety.id }),
    )
    runProfileMaintenance(profile, "1.13.1")
    expect(value()).toBe("original article")
    expect(existsSync(join(backupRoot(profile), "restore-journal.json"))).toBe(false)
  })
  it("takes one snapshot per upgrade and rejects databases from a newer schema", () => {
    runProfileMaintenance(profile, "1.13.1")
    runProfileMaintenance(profile, "1.13.1")
    expect(listProfileSnapshots(profile)).toHaveLength(1)
    runProfileMaintenance(profile, "1.13.2")
    expect(listProfileSnapshots(profile)).toHaveLength(2)
    const db = new DatabaseSync(join(profile, "local-api.db"))
    db.exec("PRAGMA user_version=999")
    db.close()
    expect(() => createProfileSnapshot(profile, "1.13.2", "manual")).toThrow("newer FoLocal")
    expect(listProfileSnapshots(profile)).toHaveLength(2)
  })
  it("rejects path traversal and records a manual backup request", () => {
    expect(() => requestProfileMaintenance(profile, { kind: "restore", id: "../outside" })).toThrow(
      "identifier",
    )
    requestProfileMaintenance(profile, { kind: "backup" })
    runProfileMaintenance(profile, "1.13.1")
    expect(listProfileSnapshots(profile).some((s) => s.reason === "manual")).toBe(true)
    expect(existsSync(join(backupRoot(profile), "pending.json"))).toBe(false)
  })
})
