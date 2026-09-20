# 思源无感剪贴修复

- 在文章中按 `Ctrl + Shift + C`，后台提取源网页并自动保存，完成后显示成功提示，可直接打开思源文档。
- 图片处理期间显示已保存张数、当前下载图片、已下载 KB 和进度条。失败提示提供重试，重复按键不会并发创建同一篇文章。
- 动态网页回退在隐藏窗口中加载；需要登录且无法提取时报告失败，可从集成设置手动打开源网页处理。
- 设置 → 集成 → 思源网页剪贴可配置「资源保存目录」。默认 `/assets/FoLocal/`，实际按 `日期/文章编号/` 分文件夹。
- 资源目录在任务开始上传时固定，重试沿用原目录。新文件名包含文章任务编号，避免思源按内容和名称去重后返回其他目录的旧资源。返回路径必须位于目标目录，正文和文件内容均回读核验后才提示成功。
- 当前原文剪贴自动处理正文图片；网页中的普通附件链接仍保留为链接。本次没有增加任意附件的自动下载。
- 设置中的手动剪贴提供正文预览和 Markdown 视图；失败后清除旧的“正在保存”状态。

## 实现依据

参考本地 `web-clipper` 的 `src/ui/clip-panel.vue`、`src/clipper/image-handler.ts`、`src/image-hosting/siyuan/service.ts`，以及 `siyuan-resource-inbox/src/api.ts`：后台保存反馈、逐图进度、可配置资源路径、按日归档、上传回执验证。

Electron 原失败请求手动设置 `Referer`，实际日志为 `Cancelling request ... with invalid referrer`，随后返回 `net::ERR_BLOCKED_BY_CLIENT`。改用 `referrer` 与 `referrerPolicy`，在原图片地址验证返回 200，下载 782035 字节。

思源跨目录去重行为已通过真实内核响应和[官方上传实现](https://github.com/siyuan-note/siyuan/blob/master/kernel/model/upload.go)交叉验证。

## 验证

- 全仓类型检查 22 项通过；ESLint 0 错误，944 条既有警告。
- 全仓测试通过，新增覆盖后台保存、重复快捷键、进度停止、失败重试、隐藏网页回退、资源目录校验及重试目录保持。
- 独立思源工作空间真实创建文档，图片存入日期和文章子目录；正文、资源 SHA-256 回读通过，再次保存返回同一文档。
- 已更新 `/Applications/FoLocal.app`，保留更新前副本 `/tmp/FoLocal-before-quick-clip.app`，重新签名及签名核验通过。
- 在本机原报错文章上实际按下快捷键，未弹出剪贴窗口，显示「已保存至思源并核验通过」；4 张图片全部位于文章子目录，原任务从失败恢复到完成，任务总数仍为 1。
- 慢速图片验收中，界面显示「下载并保存图片中」「已保存图片 0 / 1」「正在下载第 1 张」，进度条从 0 更新至 23%，随后保存成功；再次按快捷键仍返回同一文档，自定义目录 `/assets/FoLocal-Progress/` 实际生效。
- 最终 `npm exec turbo run format:check typecheck lint` 24 项通过；`CI=1 npm exec turbo run test` 11 项通过，562 个测试通过、2 个跳过；Electron 生产构建通过。
