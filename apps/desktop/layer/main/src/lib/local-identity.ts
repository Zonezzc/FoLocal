import path from "pathe"

export const LOCAL_APP_NAME = "FoLocal"
export const LOCAL_APP_ID = "is.folocal.local"
export const LOCAL_APP_PROTOCOL = "folocal"

export const getLocalUserDataPath = (appData: string, development: boolean, override?: string) =>
  override || path.join(appData, development ? "FoLocal(dev)" : LOCAL_APP_NAME)
