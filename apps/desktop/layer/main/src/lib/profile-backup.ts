import { createHash, randomUUID } from "node:crypto"
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { DatabaseSync } from "node:sqlite"

import { join, relative } from "pathe"

// Chromium caches and OS credentials are deliberately outside the portable reader profile.
const ITEMS = [
  "local-api.db",
  "local-api.db-wal",
  "local-api.db-shm",
  "openai.json",
  "siyuan.json",
  "db.json",
  "Local Storage",
  "IndexedDB",
  "Session Storage",
  "Preferences",
  "Local State",
  "WebStorage",
  "blob_storage",
]
const MAX_SCHEMA = 1
export interface ProfileSnapshot {
  format: 1
  id: string
  createdAt: string
  version: string
  reason: string
  schema: number
  counts: { subscriptions: number; entries: number; reads: number; collections: number }
  includesAI: boolean
  bytes: number
  files: Record<string, string>
}
export const backupRoot = (profile: string) => `${profile}-backups`
const atomicJSON = (path: string, data: unknown) => {
  const temporary = `${path}.tmp`
  writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 })
  renameSync(temporary, path)
}
const prepareRoot = (profile: string) => {
  const root = backupRoot(profile)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  chmodSync(root, 0o700)
  return root
}
const snapshotPath = (profile: string, id: string) => {
  if (!/^[\dT-]+-[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid backup identifier")
  return join(backupRoot(profile), id)
}
const filesIn = (directory: string, base = directory): string[] =>
  readdirSync(directory)
    .flatMap((name) => {
      const file = join(directory, name)
      const stat = lstatSync(file)
      if (stat.isSymbolicLink()) throw new Error("Backups cannot contain symbolic links")
      if (stat.isDirectory()) return filesIn(file, base)
      if (!stat.isFile()) throw new Error("Unsupported backup file")
      return [relative(base, file)]
    })
    .sort()

const inspectDatabase = (file: string) => {
  const database = new DatabaseSync(file, { readOnly: true })
  try {
    const schema = Number(database.prepare("PRAGMA user_version").get()!.user_version)
    if (schema > MAX_SCHEMA) throw new Error("This backup requires a newer FoLocal version")
    const checks = database.prepare("PRAGMA integrity_check").all()
    if (checks.length !== 1 || Object.values(checks[0]!)[0] !== "ok")
      throw new Error("Backup database failed integrity check")
    if (database.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("Backup database contains broken references")
    const count = (table: string) =>
      Number(database.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n)
    const counts = {
      subscriptions: count("subscriptions"),
      entries: count("entries"),
      reads: count("reads"),
      collections: count("collections"),
    }
    return { schema, counts }
  } finally {
    database.close()
  }
}

/** Call only before the local backend and Chromium profile are opened. */
export const createProfileSnapshot = (
  profile: string,
  version: string,
  reason: string,
): ProfileSnapshot => {
  const root = prepareRoot(profile)
  const id = `${new Date().toISOString().replace(/[:.Z]/g, "-")}-${randomUUID()}`
  const destination = join(root, id)
  const data = join(destination, "data")
  mkdirSync(data, { recursive: true, mode: 0o700 })
  try {
    for (const item of ITEMS) {
      if (item.startsWith("local-api.db")) continue
      const source = join(profile, item)
      if (existsSync(source))
        cpSync(source, join(data, item), { recursive: true, errorOnExist: true })
    }
    const source = new DatabaseSync(join(profile, "local-api.db"), { readOnly: true })
    try {
      source.exec(`VACUUM INTO '${join(data, "local-api.db").replace(/'/g, "''")}'`)
    } finally {
      source.close()
    }
    const info = inspectDatabase(join(data, "local-api.db"))
    const files: Record<string, string> = {}
    let bytes = 0
    for (const file of filesIn(data)) {
      const path = join(data, file)
      files[file] = createHash("sha256").update(readFileSync(path)).digest("hex")
      bytes += statSync(path).size
      chmodSync(path, 0o600)
    }
    const snapshot: ProfileSnapshot = {
      format: 1,
      id,
      version,
      reason,
      createdAt: new Date().toISOString(),
      ...info,
      files,
      bytes,
      includesAI: existsSync(join(data, "openai.json")),
    }
    atomicJSON(join(destination, "manifest.json"), snapshot)
    return snapshot
  } catch (error) {
    rmSync(destination, { recursive: true, force: true })
    throw error
  }
}

export const listProfileSnapshots = (profile: string): ProfileSnapshot[] => {
  const root = prepareRoot(profile)
  return readdirSync(root)
    .flatMap((id) => {
      try {
        const file = join(snapshotPath(profile, id), "manifest.json")
        const snapshot = JSON.parse(readFileSync(file, "utf8")) as ProfileSnapshot
        return snapshot.format === 1 && snapshot.id === id ? [snapshot] : []
      } catch {
        return []
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
export const validateProfileSnapshot = (profile: string, id: string): ProfileSnapshot => {
  const folder = snapshotPath(profile, id)
  if (lstatSync(folder).isSymbolicLink()) throw new Error("Invalid backup directory")
  const snapshot = JSON.parse(
    readFileSync(join(folder, "manifest.json"), "utf8"),
  ) as ProfileSnapshot
  if (snapshot.format !== 1 || snapshot.id !== id || !snapshot.files)
    throw new Error("Invalid backup manifest")
  const data = join(folder, "data")
  if (lstatSync(data).isSymbolicLink()) throw new Error("Invalid backup data")
  const files = filesIn(data)
  if (JSON.stringify(files) !== JSON.stringify(Object.keys(snapshot.files).sort()))
    throw new Error("Backup file list does not match its manifest")
  for (const file of files) {
    if (!ITEMS.includes(file.split("/")[0]!)) throw new Error("Unexpected profile data")
    if (
      createHash("sha256")
        .update(readFileSync(join(data, file)))
        .digest("hex") !== snapshot.files[file]
    )
      throw new Error("Backup checksum mismatch")
  }
  const info = inspectDatabase(join(data, "local-api.db"))
  return { ...snapshot, ...info }
}
export const requestProfileMaintenance = (
  profile: string,
  request: { kind: "backup" } | { kind: "restore"; id: string },
) => {
  const root = prepareRoot(profile)
  if (existsSync(join(root, "pending.json")))
    throw new Error("Another backup or restore is pending")
  if (request.kind === "restore") validateProfileSnapshot(profile, request.id)
  atomicJSON(join(root, "pending.json"), request)
}
const applySnapshot = (profile: string, id: string) => {
  validateProfileSnapshot(profile, id)
  const data = join(snapshotPath(profile, id), "data")
  for (const item of ITEMS) {
    rmSync(join(profile, item), { recursive: true, force: true })
    if (existsSync(join(data, item)))
      cpSync(join(data, item), join(profile, item), { recursive: true })
  }
}
/** A journal keeps interrupted multi-file restores from booting a partially restored profile. */
export const runProfileMaintenance = (profile: string, version: string) => {
  const root = prepareRoot(profile)
  const journal = join(root, "restore-journal.json")
  const pendingFile = join(root, "pending.json")
  const marker = join(root, "version.json")
  if (existsSync(journal)) {
    const { rollbackId } = JSON.parse(readFileSync(journal, "utf8")) as { rollbackId: string }
    applySnapshot(profile, rollbackId)
    rmSync(journal)
    rmSync(pendingFile, { force: true })
    atomicJSON(join(root, "last-result.json"), { status: "rolled-back", rollbackId })
  }
  const pending = existsSync(pendingFile)
    ? (JSON.parse(readFileSync(pendingFile, "utf8")) as { kind: string; id?: string })
    : null
  if (pending?.kind === "restore" && pending.id) {
    validateProfileSnapshot(profile, pending.id)
    const safety = createProfileSnapshot(profile, version, "before-restore")
    atomicJSON(journal, { rollbackId: safety.id })
    try {
      applySnapshot(profile, pending.id)
      atomicJSON(join(root, "last-result.json"), {
        status: "restored",
        id: pending.id,
        rollbackId: safety.id,
      })
      rmSync(journal)
      rmSync(pendingFile)
    } catch (error) {
      applySnapshot(profile, safety.id)
      rmSync(journal)
      rmSync(pendingFile, { force: true })
      throw error
    }
  } else if (pending?.kind === "backup") {
    const snapshot = createProfileSnapshot(profile, version, "manual")
    atomicJSON(join(root, "last-result.json"), { status: "backed-up", id: snapshot.id })
    rmSync(pendingFile)
  }
  let previous: string | undefined
  try {
    previous = JSON.parse(readFileSync(marker, "utf8")).version
  } catch {
    /* First maintained launch. */
  }
  if (previous !== version && existsSync(join(profile, "local-api.db")))
    createProfileSnapshot(profile, version, "before-upgrade")
  atomicJSON(marker, { version })
}
