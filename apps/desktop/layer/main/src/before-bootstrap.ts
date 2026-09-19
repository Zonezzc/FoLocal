import { app, protocol } from "electron"

import { getLocalUserDataPath, LOCAL_APP_NAME } from "./lib/local-identity"

const e2eUserDataDir = process.env.FOLO_E2E_USER_DATA_DIR

app.setName(LOCAL_APP_NAME)

// Never open the official Folo profile implicitly; import an explicit backup instead.
app.setPath(
  "userData",
  getLocalUserDataPath(app.getPath("appData"), import.meta.env.DEV, e2eUserDataDir),
)

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      bypassCSP: true,
      supportFetchAPI: true,
      secure: true,
    },
  },
])
