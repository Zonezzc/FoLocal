import { app, dialog, session, shell } from "electron"
import { IpcMethod, IpcService } from "electron-ipc-decorator"

import { t } from "../../lib/i18n"
import {
  backupRoot,
  listProfileSnapshots,
  requestProfileMaintenance,
  validateProfileSnapshot,
} from "../../lib/profile-backup"

export class ProfileService extends IpcService {
  static override readonly groupName = "profile"
  private restarting = false

  @IpcMethod()
  list() {
    return listProfileSnapshots(app.getPath("userData")).map(
      ({ files: _files, ...snapshot }) => snapshot,
    )
  }

  @IpcMethod()
  preview(id: string) {
    const { files: _files, ...snapshot } = validateProfileSnapshot(app.getPath("userData"), id)
    return snapshot
  }

  private restart(request: { kind: "backup" } | { kind: "restore"; id: string }) {
    if (this.restarting) throw new Error("Restart already pending")
    requestProfileMaintenance(app.getPath("userData"), request)
    this.restarting = true
    session.defaultSession.flushStorageData()
    setTimeout(() => {
      app.relaunch()
      app.quit()
    }, 200)
    return true
  }

  @IpcMethod()
  backup() {
    return this.restart({ kind: "backup" })
  }

  @IpcMethod()
  async restore(id: string) {
    const snapshot = validateProfileSnapshot(app.getPath("userData"), id)
    const answer = await dialog.showMessageBox({
      type: "warning",
      message: t("profile.restore_title"),
      detail: t("profile.restore_detail", {
        time: snapshot.createdAt,
        count: snapshot.counts.subscriptions,
      }),
      buttons: [t("profile.cancel"), t("profile.restore")],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    return answer.response === 1 ? this.restart({ kind: "restore", id }) : false
  }

  @IpcMethod()
  async openFolder() {
    return shell.openPath(backupRoot(app.getPath("userData")))
  }
}
