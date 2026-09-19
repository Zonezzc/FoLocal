// This module must run before bootstrap imports initialize electron-store or the local database.
import { app, dialog } from "electron"

import { runProfileMaintenance } from "./lib/profile-backup"

if (!app.requestSingleInstanceLock()) {
  app.exit(0)
} else {
  try {
    runProfileMaintenance(app.getPath("userData"), app.getVersion())
  } catch (error) {
    dialog.showErrorBox(
      "FoLocal",
      `Profile maintenance failed. Your backup is retained.\n${String(error)}`,
    )
    app.exit(1)
  }
}
