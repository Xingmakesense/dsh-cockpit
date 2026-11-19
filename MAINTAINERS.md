# 维护手册（DSH Cockpit）

本文件面向仓库维护者，描述模块边界、关键契约、发布流程与排错方式。

## 1. 模块职责

| 文件 | 职责 | 不应做什么 |
|---|---|---|
| `host.js` | 入口，只组装续轮、归档、维护与下载安装 | 不写业务逻辑、不写 UI 文案 |
| `auto-continue.js` | 官方 `agent/request-error` 续轮层、Config、提示快照路由 | 不伪造运行时上下文、不写 transcript、不碰归档/文件系统 |
| `archive.js` | 通过 `ctx.inject` 挂载 vendored 归档 host，并注册空对话清理路由 | 不复制 vendored 逻辑 |
| `maintenance.js` | 删除审计落盘与轮转、孤儿附件清扫、定时器 | 不改会话/归档状态 |
| `downloads.js` | Host 下载字节观测、文件名解析与同源快照路由 | 不拦截保存路径，不重复下载文件 |
| `client.js` | 生成物，勿手改 | — |
| `scripts/client-wrapper.js` | 续轮提示、续轮设置页、下载卡片、清理设置分区、「清理临时产物」按钮 | 不写续轮状态机或归档 Host 逻辑 |
| `vendor/archive-manager/` | 归档实现（Apache-2.0） | 不与仓库其他部分循环依赖 |
| `vendor/schemastery.mjs`、`vendor/cosmokit.mjs` | Config 使用的原生 schema 副本（MIT） | 仅替换 import 路径，不改实现 |

## 2. 关键契约（改代码前必读）

1. **自动续轮只用官方恢复钩子。** 监听 `agent/request-error`，先 `await next()` 让官方 `retryPolicy` / `dsh-llm-retry` 决策；下游返回 `{ kind: "retry" }` 时原样透传，只有下游放弃后才追加本插件的尝试并返回 `{ kind: "retry" }`。不要伪造 `runtime-context` inbox 消息，不要借用内部 `api-session/error`。
2. **续轮不写 transcript。** 官方重试复用当前 step 与已准备的请求组装；插件不得追加用户消息、不得调用 `followup()` 来“假装续轮”。
3. **按 Turn 计数并复位。** 尝试次数以 `sessionId:turn` 为键，`turn/start`、`turn/end` 与 `agent/disposed` 时清理；达到上限后保留原始错误。
4. **提示走同源快照。** Host 通过 `connection.fetch.register` 暴露 `GET /api/cockpit/auto-continue`，Client 轮询后渲染；提示对象包含 `kind`、`code`、`detail`、`attempt`、`max`，过期由 Host 清理。
5. **用户消息发送。** 客户端发送普通用户消息用 `sessions.binding(sessionId).session.prompt(content, "queue")`；`queue` 等价于用户回车，`steer` 是中途引导。按钮固定发送 `清理本项目的临时产物`。
6. **按钮位置。** `conversation.input.dock` 渲染在输入框卡片上方（卡片外侧，全宽），入口右对齐；`conversation.input.left/right/overlay/activity` 位于卡片内侧。
7. **设置服务。** 续轮设置页必须用 `ctx.remote.settings`（返回 `RemoteResult`）；`ctx.get("remote")` 只是 carrier。Config 必须来自 vendored schemastery 且根节点 `.volatile()`，否则 `ctx.settings.describe()` 会静默跳过本插件。
8. **会话菜单宿主探测。** DSH 0.2.2 起会话右键菜单由 `ctx.contextMenus` 托管，旧的 `sidebar.workspaces.session.menu.item` 槽声明在 `contextMenu.content`（key `session`）之下。vendored 客户端的模式探测必须同时接受两种声明位置，并在 `sidebar.workspaces` 或 `contextMenu.content` 变化时重新协调；只看 `sidebar.workspaces` 会降级到自带侧栏，右键菜单里就没有「删除会话」。
9. **删除审计事件**：vendored 归档 host 发出 `archive-manager/session-deleted`，`maintenance.js` 落盘；改 vendored 删除流程时保持该事件。
10. **附件清理安全阀**：任一转录读取失败、zstd 帧不完整或会话根为空时整轮放弃；不要移除该保护。扫描必须逐帧解码并仅保留引用哈希，不得为了扫描再解析/序列化整份 JSONL。
11. **空对话清理与级联删除**：`previewEmptySessions` 只读，`deleteEmptySessions` 在确认后重新校验；当前/活动、fork、真实内容、未知事件和读取失败的会话一律保留。删除任一父会话时，`deleteDescendants` 必须通过 `collectSubagentDescendants` 收集全部层级的 `origin: "subagent"` 后代并逐个删除，结果以 `cascadedSessionIds` 返回；fork 分支（`isSeeded`）不得连带删除。
12. **缓存性能**：存活会话集合每次迁移/清扫最多读取一次 `sessionPersistence.list()`；兼容官方缓存记录每次迁移只读取一次；孤儿行在各自域内批量删除，不得按候选逐个 `stat()` 或重复开关全部域。
13. **下载观测**：只能在 `connection/request` 的响应包装中统计字节，必须调用原 `next()` 并保持原响应内容、背压和保存流程；无 `Content-Length` 时不得伪造百分比。进度只通过同源路由 `/api/cockpit/downloads` 快照传递。

### 2.1 样式只能使用 DSH 已定义的变量

`client-wrapper.js` 的内联样式全部走 `--dsw-*` 主题变量。写不存在的变量不会报错，只会静默回退到 fallback，
于是深色 fallback 落在浅色页面上就变成“深底深字”。`--dsw-alias-bg-elevated` 与 `--dsw-alias-bg-sunken`
就是这样踩过的坑，已分别改为 `--dsw-alias-bg-module-platform`、`--dsw-specific-input-major` 等真实变量。

新增颜色时：

1. 先在 DSH 主题里确认变量真实存在（`:root` 为浅色，`body[data-ds-dark-theme]` 为深色）；
2. 优先用 `THEME` 映射表里的取值，回退值使用系统色或中性半透明色，不要写死深色；
3. 更新 `verify-theme-tokens.cjs` 的 token 快照，并确认对比度断言仍然通过（正文 ≥ 4.5:1，图形 ≥ 3:1）。

## 3. 配置与默认值

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false`（patch 设为 `true`） | 是否启用额外续轮 |
| `maxAttempts` | `6` | 官方策略之后的额外续轮上限 |
| `delayMs` | `1500` | 续轮前等待 |
| `emitProminentError` | `true` | 是否发布提示快照 |
| `retryableCodes` / `blockedCodes` | 见 `CONTINUE_DEFAULTS` | 可重试/不可重试故障码 |
| `providerRetryMaxRetries` | `0` | 已废弃，仅兼容旧 profile，不参与运行 |

修改字段时同步：`auto-continue.js`、`client-wrapper.js` 的 `pickValues` / `NUMERIC_FIELDS` / `save`、测试与 README、以及 `cordis.patch.yml`。

## 4. 测试矩阵

| 命令 | 覆盖 |
|---|---|
| `node verify-cockpit.cjs` | host 入口与 Config、官方续轮契约、client 产物一致性、会话菜单探测、manifest/patch |
| `node verify-auto-continue.cjs` | 委托优先、额外续轮、上限、Turn 复位、不可重试码、Abort、提示快照路由 |
| `node verify-archive.cjs` | 归档纯函数（缺失 `seq`、Unicode 检索、截断、日期、错误分类） |
| `node verify-client-ui.cjs` | stub loader 评估 `client.js`：续轮提示、设置页、清理分区、按钮发送路径与主题 token |
| `node verify-downloads.cjs` | Host 附件响应包装、真实字节计数、文件名/后缀、完成状态与快照 |
| `node verify-maintenance.cjs` | 审计落盘、附件引用/孤儿/宽限期、多帧与损坏 zstd、空 home 安全阀 |
| `node verify-theme-tokens.cjs` | `client-wrapper.js` 只引用 DSH 真实存在的 `--dsw-*` 变量；两套主题对比度达标 |

发布前全部检查全绿，并执行 `node scripts/build-client.mjs --check`、`node --check host.js`、`node --check auto-continue.js`、`node --check client.js`。

## 5. 发布流程

1. 修改源码/文档；
2. 如改了 client 相关文件：`node scripts/build-client.mjs`；
3. 更新版本号（`package.json` + README 标题 + locale 简介）；
4. 跑完第 4 节全部检查；
5. 打包：

   ```powershell
   node <dsh-runtime>\pnpm\bin\pnpm.mjs pack --pack-destination <输出目录>
   ```

6. 安装到测试 profile，完全重启 DSH；
7. 验证：设置 → 插件 → 自动续轮可读写；设置 → 会话清理可预览/删除；归档页可打开；右键菜单「删除会话」可用；输入框上方按钮能发出消息；下载时显示卡片；
8. 提交（Conventional Commits），必要时打 tag。

## 6. 更新 vendored 归档实现

1. 解包新版 `@michengai/dsh-archive-manager`；
2. 替换 `vendor/archive-manager/lib/`、`locale/`、`LICENSE`；
3. 重新应用本地修改（见 `vendor/archive-manager/MODIFICATIONS.md`）：
   - 删除 GitHub/反馈入口与更新检查；
   - 删除 `plugin-updater.js`，`index.js` 只再导出 `host-install.js`；
   - 确认弹窗加 `centered`；
   - 删除流程保留 `archive-manager/session-deleted` 审计事件；
   - 会话菜单模式探测同时接受 `sidebar.workspaces` 与 `contextMenu.content` 两种声明位置（见 `MODIFICATIONS.md` 第 11 条）；
4. 重新生成 `client.js`；跑测试；真机验证归档页、右键删除、恢复。

## 7. 更新 schemastery 副本

`vendor/schemastery.mjs` 来自 `@deepseek-ai/schemastery` 的 `lib/index.mjs`，仅把
`from "@deepseek-ai/cosmokit"` 改为 `from "./cosmokit.mjs"`；`vendor/cosmokit.mjs` 原样复制。
同步更新 `LICENSE.schemastery`、`LICENSE.cosmokit`，并确认：

```js
Reflect.get(Config, Symbol.for("schemastery")) === true
Config.meta.volatile === true
```

## 8. 排错

| 症状 | 排查 |
|---|---|
| 续轮没有发生 | 先看 `retryableCodes` 是否包含该故障码；官方 `retryPolicy` 可能仍在重试（此时不会产生本插件的额外续轮），看日志是否有“第 N/M 次自动续轮” |
| 右键菜单没有「删除会话」 | 先确认 `client.js` 已重新生成并刷新页面；再看宿主 sidebar 是否把 `sidebar.workspaces.session.menu.item` 声明在 `contextMenu.content` 下（DSH 0.2.2+），以及控制台是否出现 `sidebar mode switch failed` |
| 输入框上方没有按钮 | 确认 `client.js` 已刷新；确认当前会话存在（dock 是 session 作用域的 slot）；看控制台是否出现 `cockpit UI skipped` |
| 按钮点击后没反应 | 看是否有“发送失败”提示；`sessions.binding(sessionId)` 为 `undefined` 时说明会话已被移除 |
| 设置页“设置服务不可用” | 先看“已注册”列表是否含 `cockpit`；不含则检查 `Config` 是否原生 volatile；再查 `ctx.remote.settings` 取值方式 |
| 提示条不出现 | 检查 `emitProminentError`、`/api/cockpit/auto-continue` 路由是否注册、客户端轮询是否在跑 |
| 删除失败 | 看 vendored 日志中的 `cannot delete session ...`；常见原因：持久化后端无 `locate()`、路径校验失败、文件占用 |
| 附件没被清理 | 检查会话转录是否可读、`<DSH_HOME>/sessions` 是否存在、对象是否仍在 24 小时宽限期 |
| 安装后页面没变化 | 安装只更新文件；client 变更需刷新页面，host 变更需完全重启 |

## 9. 已知限制

- 归档深层操作未逐项真机验证；
- 删除为硬删除，无回收站；审计只记录删除；
- 附件清理仅覆盖默认 DSH 存储布局；
- 下载进度仅覆盖带 `Content-Disposition: attachment` 的 DSH Host 响应，不覆盖外部 URL 或 Electron updater；
- 安装/热更新可能卡住 Loader HMR 队列，需完全重启。

## 10. 提交规范建议

- Conventional Commits：`feat:` / `fix:` / `docs:` / `refactor:` / `test:`
- 一次提交只做一件事；生成物 `client.js` 与源文件一起提交；
- 不提交 `.tgz`、`.zip`、日志与本机路径。
