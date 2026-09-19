import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const config = JSON.parse(readFileSync(new URL("../upstreams.json", import.meta.url), "utf8"))
const run = (command, args) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
const git = (...args) => run("git", ["-c", "core.hooksPath=/dev/null", ...args])
const gh = (...args) => run("gh", args)
const prepare = process.argv.includes("--prepare")
const name = process.argv.find((arg) => arg.startsWith("--upstream="))?.split("=")[1]
if (name && !config.upstreams.some((source) => source.name === name))
  throw new Error("Unknown upstream")
if (prepare && git("status", "--porcelain"))
  throw new Error("Commit or stash local changes before preparing a sync PR")
const originalBranch = git("branch", "--show-current")
if (prepare && !originalBranch) throw new Error("Use a branch, not detached HEAD")
const origin = git("remote", "get-url", "origin").replace(/\.git$/, "")
if (
  ![`https://github.com/${config.repository}`, `git@github.com:${config.repository}`].includes(
    origin,
  )
)
  throw new Error("Origin does not match the configured fork")
git("fetch", "--no-tags", "origin", config.base)
const results = []

for (const source of config.upstreams.filter((source) => !name || source.name === name)) {
  const expected = `https://github.com/${source.repository}.git`
  if (git("remote").split("\n").includes(source.remote)) {
    if (git("remote", "get-url", source.remote) !== expected)
      throw new Error(`Unexpected URL for ${source.remote}`)
  } else git("remote", "add", source.remote, expected)
  git("fetch", "--no-tags", source.remote, source.branch)
  const head = git("rev-parse", `${source.remote}/${source.branch}`)
  const pending = Number(git("rev-list", "--count", `origin/${config.base}..${head}`))
  const result = { upstream: source.name, repository: source.repository, head, pending }
  if (!prepare || pending === 0) {
    results.push(result)
    continue
  }
  const branch = `sync/${source.name}-${head.slice(0, 12)}`
  const existing = JSON.parse(
    gh(
      "pr",
      "list",
      "--repo",
      config.repository,
      "--base",
      config.base,
      "--head",
      branch,
      "--state",
      "all",
      "--json",
      "url,state",
    ),
  )
  if (existing.length) {
    results.push({
      ...result,
      pr: existing[0].url,
      status: `already-${existing[0].state.toLowerCase()}`,
    })
    continue
  }
  const temporary = mkdtempSync(join(tmpdir(), "folocal-upstream-"))
  try {
    if (git("branch", "--list", branch))
      throw new Error(`Local branch ${branch} exists; inspect it before retrying`)
    git("switch", "-c", branch, `origin/${config.base}`)
    let conflicts = []
    try {
      git("merge", "--no-ff", head, "-m", `同步 ${source.repository} 上游 ${head.slice(0, 12)}`)
    } catch (error) {
      conflicts = git("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean)
      if (!conflicts.length) throw error
      git("merge", "--abort")
      // Keep upstream history intact so GitHub can show the conflict against our fork.
      git("reset", "--hard", head)
    }
    git("push", "origin", branch)
    const body = [
      `同步来源：${source.repository} 的 ${source.branch}，提交 ${head}。`,
      `待同步提交数：${pending}。`,
      conflicts.length
        ? `存在合并冲突，需先人工处理：\n\n${conflicts.map((path) => `- \`${path}\``).join("\n")}`
        : "已在同步分支合并上游，等待 FoLocal CI 验证。",
      "合入前检查：独立数据目录与协议、本地抓取、自带 AI API、图标、数据库迁移及升级兼容性。",
      "此 PR 不会自动合并，也不会自动发布或替换已安装应用。",
    ].join("\n\n")
    const bodyPath = join(temporary, "pr.md")
    writeFileSync(bodyPath, body)
    const pr = gh(
      "pr",
      "create",
      "--repo",
      config.repository,
      "--base",
      config.base,
      "--head",
      branch,
      "--draft",
      "--title",
      `同步 ${source.repository} 上游 ${head.slice(0, 12)}`,
      "--body-file",
      bodyPath,
    )
    results.push({
      ...result,
      pr,
      conflicts,
      status: conflicts.length ? "conflicts" : "checks-pending",
    })
  } finally {
    try {
      git("merge", "--abort")
    } catch {
      /* No merge is normally in progress. */
    }
    git("switch", originalBranch)
    rmSync(temporary, { recursive: true, force: true })
  }
}
console.log(JSON.stringify(results, null, 2))
