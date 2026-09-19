# FoLocal 个人维护分支

本仓库基于 `Guyungy/Folo-Local`，该项目基于 `RSSNext/Folo`。两个上游都保留在 Git 历史中。

## 本地版修复

- 使用 `is.folocal.local` 应用标识和 `folocal://` 协议，不抢占原版的链接。
- 正式版数据保存在 `FoLocal`，开发版保存在 `FoLocal(dev)`。不自动读取原版 `Folo` 目录。
- RSS 图标地址支持相对路径和空白清理；网站图标直接访问源站，失败时有离线占位。
- 桌面窗口提供随主题变化的侧栏背景，避免透明区域出现黑底、图标不可辨认。
- 保留上游本地 SQLite、RSSHub 和 OpenAI-compatible 接口功能。

## 迁移与个人配置

迁移前退出应用，备份原版及 FoLocal 的完整数据目录。通过已有 `apps/server` 数据库导入工具，从明确指定的数据库副本迁移；不要让两个应用共用目录。

AI 配置由用户在本机填写。仓库不包含订阅数据库、OPML、浏览器 Cookie、账号、API Key 或个人 AI 配置。使用本地代理时，应保持代理运行。

## 两个上游如何同步

`upstreams.json` 定义两个来源。以下命令不会自动合并到 `dev`：

```bash
# 只检查待同步提交
node scripts/upstream-sync.mjs

# 在独立分支准备更新，创建草稿 PR；要求工作区干净且 gh 已登录
node scripts/upstream-sync.mjs --prepare

# 只处理一个上游
node scripts/upstream-sync.mjs --prepare --upstream=folocal
node scripts/upstream-sync.mjs --prepare --upstream=folo
```

无冲突时先把上游合并进独立同步分支，然后由 `FoLocal Checks` 验证类型、lint、服务测试、隔离测试和 Electron 构建。有冲突时保留上游提交供 PR 对比，明确列出冲突，等待处理。相同上游提交已有 PR 时不重复创建，包括已关闭的 PR，避免反复提出已拒绝的更新。

PR 检查通过也不自动发布。官方 Folo 可能新增官方服务依赖、套餐判断或数据库变化，需要检查本地实现是否兼容。客户端自动下载安装更新暂未启用，避免覆盖本地数据和修复。

Codex 任务的定时检查会调用上述脚本；这个定时任务依赖本机 Codex 自动化运行环境，单独克隆仓库不会继承该定时任务。也可手动执行脚本。

## 发布前验证

1. 构建主进程声明，再依次完成类型检查、lint 和测试。
2. 构建 Electron，检查应用标识和链接协议。
3. 用 `FOLO_E2E_USER_DATA_DIR` 指定临时目录，验证全新启动、订阅抓取、摘要和翻译。
4. 使用临时目录的数据副本测试覆盖升级，确认文章、已读、收藏和设置保留。
5. 发布我们自己的版本，保留前一版本和数据备份。未配置 Apple Developer 签名时只能提供 ad-hoc 签名版本，不能宣称已经公证。
