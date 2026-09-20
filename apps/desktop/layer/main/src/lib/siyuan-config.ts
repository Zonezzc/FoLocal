import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"

import { app, safeStorage } from "electron"
import { join } from "pathe"

import { httpURL } from "./clip-network"

export interface SiyuanConfig {
  endpoint: string
  token: string
  notebook: string
  path: string
}
type StoredConfig = Omit<SiyuanConfig, "token"> & { encryptedToken: string }
const filename = () => join(app.getPath("userData"), "siyuan.json")
export const readSiyuanConfig = (): SiyuanConfig => {
  if (!existsSync(filename()))
    return { endpoint: "http://127.0.0.1:6806", token: "", notebook: "", path: "/FoLocal" }
  const stored = JSON.parse(readFileSync(filename(), "utf8")) as StoredConfig
  let token = ""
  try {
    if (stored.encryptedToken)
      token = safeStorage.decryptString(Buffer.from(stored.encryptedToken, "base64"))
  } catch {
    /* A restored profile may need its token re-entered on another machine. */
  }
  return { endpoint: stored.endpoint, notebook: stored.notebook, path: stored.path, token }
}
export const saveSiyuanConfig = (input: Omit<SiyuanConfig, "token"> & { token?: string }): void => {
  const endpoint = httpURL(input.endpoint).replace(/\/$/, "")
  const url = new URL(endpoint)
  if (url.search) throw new Error("SiYuan endpoint cannot contain query parameters")
  const previous = readSiyuanConfig()
  const token = input.token ?? (endpoint === previous.endpoint ? previous.token : "")
  if (token && !safeStorage.isEncryptionAvailable())
    throw new Error("Secure credential storage is unavailable")
  const stored: StoredConfig = {
    endpoint,
    notebook: input.notebook,
    path: input.path,
    encryptedToken: token ? safeStorage.encryptString(token).toString("base64") : "",
  }
  writeFileSync(`${filename()}.tmp`, JSON.stringify(stored), { mode: 0o600 })
  renameSync(`${filename()}.tmp`, filename())
}
