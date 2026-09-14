import { MICROSOFT_STORE_BUILD } from "@follow/shared/constants"

const isStoreDistribution = Boolean(process.mas || MICROSOFT_STORE_BUILD)

export const appUpdaterConfig = {
  // Also reject cached official renderers at startup, not only new OTA downloads.
  enableRenderHotUpdate: false,
  enableCoreUpdate: !isStoreDistribution,

  // FoLocal is distributed from a separate repository and must never consume the official OTA
  // channel. Re-enable this only after the fork owns and validates an independent update service.
  enableAppUpdate: false,
  enableDistributionStoreUpdate: isStoreDistribution,

  app: {
    autoCheckUpdate: true,
    autoDownloadUpdate: true,
    checkUpdateInterval: 15 * 60 * 1000,
  },
}
