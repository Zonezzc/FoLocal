export const DEFAULT_ASSET_PATH = "/assets/FoLocal/"

export function assetDirectory(value = DEFAULT_ASSET_PATH): string {
  const parts = value.replace(/^\/+|\/+$/g, "").split("/")
  if (
    parts[0] !== "assets" ||
    parts.length < 2 ||
    parts.some(
      (part) => !part || part === "." || part === ".." || !/^[\w\p{L}\p{N} .()-]+$/u.test(part),
    )
  )
    throw new Error("Use a subdirectory of /assets/, for example /assets/FoLocal/")
  return `/${parts.join("/")}/`
}

export function articleAssetDirectory(parent: string | undefined, id: string): string {
  const date = new Date()
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  return assetDirectory(`${assetDirectory(parent)}${day}/${id}`)
}
