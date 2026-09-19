import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

const config = JSON.parse(readFileSync(new URL("../upstreams.json", import.meta.url), "utf8"))
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
const args = process.argv.slice(2)
if (args.some((arg) => !arg.startsWith("--upstream=")))
  throw new Error("Only --upstream=<name> is supported; this script only checks updates")
const name = args.find((arg) => arg.startsWith("--upstream="))?.split("=")[1]
if (name !== undefined && !config.upstreams.some((source) => source.name === name))
  throw new Error("Unknown upstream")
const origin = git("remote", "get-url", "origin").replace(/\.git$/, "")
if (
  ![`https://github.com/${config.repository}`, `git@github.com:${config.repository}`].includes(
    origin,
  )
)
  throw new Error("Origin does not match the configured fork")
git("fetch", "--no-tags", "origin", config.base)
const base = git("rev-parse", `origin/${config.base}`)
const results = []

for (const source of config.upstreams.filter((source) => !name || source.name === name)) {
  const expected = `https://github.com/${source.repository}.git`
  if (git("remote").split("\n").includes(source.remote)) {
    if (git("remote", "get-url", source.remote) !== expected)
      throw new Error(`Unexpected URL for ${source.remote}`)
  } else git("remote", "add", source.remote, expected)
  git("fetch", "--no-tags", source.remote, source.branch)
  const head = git("rev-parse", `${source.remote}/${source.branch}`)
  const pending = Number(git("rev-list", "--count", `${base}..${head}`))
  const result = { upstream: source.name, repository: source.repository, base, head, pending }
  if (pending === 0) {
    results.push({ ...result, status: "up-to-date", conflicts: [] })
    continue
  }
  // Simulate the merge without changing branches, the index, or working files.
  const merge = spawnSync(
    "git",
    ["merge-tree", "--write-tree", "--name-only", "--no-messages", base, head],
    { encoding: "utf8" },
  )
  if (merge.error) throw merge.error
  if (merge.status !== 0 && merge.status !== 1)
    throw new Error(merge.stderr || `Merge check failed with status ${merge.status}`)
  const conflicts =
    merge.status === 1 ? merge.stdout.trim().split("\n").slice(1).filter(Boolean) : []
  results.push({
    ...result,
    status: merge.status === 1 ? "conflicts" : "ready-for-validation",
    conflicts,
  })
}
console.log(JSON.stringify(results, null, 2))
