# 维护手册（DSH Cockpit）

本文件面向仓库维护者，描述模块边界、关键契约、发布流程与排错方式。

## 1. 模块职责

| 文件 | 职责 | 不应做什么 |
|---|---|---|
| `host.js` | 入口，只组装续轮、归档、维护与下载安装 | 不写业务逻辑、不写 UI 文案 |
| `auto-continue.js` | 官方 `agent/request-error` 上的 `retryPolicy` 覆盖、Config、提示快照路由 | 不自己执行重试、不写 transcript、不碰归档/文件系统 |
| `archive.js` | 通过 `ctx.inject` 挂载 vendored 归档 host，并注册空对话清理路由 | 不复制 vendored 逻辑 |
| `maintenance.js` | 删除审计落盘与轮转、孤儿附件清扫、定时器 | 不改会话/归档状态 |
| `downloads.js` | Host 下载字节观测、文件名解析与同源快照路由 | 不拦截保存路径，不重复下载文件 |
| `client.js` | 生成物，勿手改 | — |
| `scripts/client/` | 按功能拆分的客户端模块：`00-shell`、`10-downloads`、`20-cleanup`、`30-theme`、`40-auto-continue`、`50-composer`、`90-boot` | 不写续轮状态机或归档 Host 逻辑；模块之间不互相导入；改完运行 `node scripts/build-client.mjs` |
| `vendor/archive-manager/` | 归档实现（Apache-2.0） | 不与仓库其他部分循环依赖 |
| `vendor/schemastery.mjs`、`vendor/cosmokit.mjs` | Config 使用的原生 schema 副本（MIT） | 仅替换 import 路径，不改实现 |

## 2. 关键契约（改代码前必读）

1. **续轮覆盖官方策略，再由官方执行，最后追加额外续轮。** 以 `prepend: true` 监听 `agent/request-error`，把 `payload.retryPolicy` 替换为 `resolveRetryPolicy(...)`（`maxRetries = providerRetryMaxRetries`），再调用 `next()`。官方 `dsh-llm-retry` 负责退避、取消与 `llm/retry` 持久化事件；官方重试用尽后，本插件按 Turn 计数返回官方动作 `{kind:"retry"}`，最多 `maxAttempts` 次。为了复刻旧版的乘法总次数，每一轮额外续轮都会把策略指纹中的 `jitterRatio` 增加 `1e-9`，让官方执行器把该轮视为新策略并重新获得 `providerRetryMaxRetries` 预算。不要伪造 `runtime-context` 消息。
2. **不可重试码从集合中剔除。** `blockedCodes` 必须从覆盖后的 `retryableCodes` 中移除；否则官方执行器仍会重试。
3. **续轮提示来自官方事件与额外续轮层。** 官方 `llm/retry` 提供 `phase: "provider"` 的重试进度；本插件的额外续轮发布 `phase: "extra"`；`turn/end reason.kind = "error"` 为不可重试错误提供 `blocked` 提示。客户端轮询 `GET /api/cockpit/auto-continue`，提示与清理按钮共用 32px 固定高度 dock 行。
4. **Config 必须原生 volatile。** `Config` 来自 vendored schemastery 且根节点 `.volatile()`，否则 `ctx.settings.describe()` 会静默跳过本插件；设置页必须走 `ctx.remote.settings`（返回 `RemoteResult`）。
5. **用户消息发送。** 客户端发送普通用户消息用 `sessions.binding(sessionId).session.prompt(content, "queue")`；`queue` 等价于用户回车，`steer` 是中途引导。按钮固定发送 `清理本项目的临时产物`。
6. **按钮位置。** `conversation.input.dock` 渲染在输入框卡片上方（卡片外侧，宽度与卡片一致），按钮左对齐；该行高度固定为 32px，续轮提示内联在同一行，因此提示出现不会推动按钮或官方回到底部按钮。`conversation.input.left/right/overlay/activity` 位于卡片内侧。
7. **会话菜单宿主探测。** 会话右键菜单由 `ctx.contextMenus` 托管，`sidebar.workspaces.session.menu.item` 槽声明在 `contextMenu.content`（key `session`）下。vendored 客户端的模式探测必须同时接受 `contextMenu.content` 与 `sidebar.workspaces` 两种声明位置，并在两者变化时重新协调。
8. **删除审计事件**：vendored 归档 host 发出 `archive-manager/session-deleted`，`maintenance.js` 落盘；改 vendored 删除流程时保持该事件。
9. **附件清理安全阀**：任一转录读取失败、zstd 帧不完整或会话根为空时整轮放弃；扫描必须逐帧解码并仅保留引用哈希。
10. **空对话清理与级联删除**：`previewEmptySessions` 只读，`deleteEmptySessions` 在确认后重新校验；删除父会话时通过 `collectSubagentDescendants` 收集全部层级 `origin: "subagent"` 后代并逐个删除，结果以 `cascadedSessionIds` 返回；fork 分支（`isSeeded`）不连带删除。
11. **缓存性能**：存活会话集合每次迁移/清扫最多读取一次 `sessionPersistence.list()`；孤儿行在各自域内批量删除，不得按候选逐个 `stat()`。
12. **下载观测**：只在 `connection/request` 的响应包装中统计字节，必须调用原 `next()` 并保持原响应内容、背压和保存流程；无 `Content-Length` 时不得伪造百分比。

### 2.1 样式只能使用 DSH 已定义的变量

`scripts/client/` 各模块的内联样式全部走 `--dsw-*` 主题变量。写不存在的变量不会报错，只会静默回退到 fallback，
深色 fallback 落在浅色页面上就会变成“深底深字”。新增颜色时：

1. 先在 DSH 主题里确认变量真实存在（`:root` 为浅色，`body[data-ds-dark-theme]` 为深色）；
2. 优先用 `THEME` 映射表里的取值，回退值使用系统色或中性半透明色；
3. 更新 `verify-theme-tokens.cjs` 的 token 快照，并确认对比度断言通过（正文 ≥ 4.5:1，图形 ≥ 3:1）。

## 3. 配置与默认值

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false`（patch 设为 `true`） | 是否覆盖官方重试策略 |
| `providerRetryMaxRetries` | `3` | 覆盖后的 `retryPolicy.maxRetries`，对所有提供方生效 |
| `maxAttempts` | `6` | 官方重试结束后额外续轮次数 |
| `delayMs` | `1500` | 覆盖后的 `initialDelayMs` |
| `emitProminentError` | `true` | 是否发布提示快照 |
| `retryableCodes` / `blockedCodes` | 见 `CONTINUE_DEFAULTS` | 参与/不参与重试的故障码 |

修改字段时同步：`auto-continue.js`、`scripts/client/40-auto-continue.js` 的 `pickValues` / `NUMERIC_FIELDS` / `save` / 公式、测试与 README、以及 `cordis.patch.yml`。

## 4. 测试矩阵

| 命令 | 覆盖 |
|---|---|
| `node verify-cockpit.cjs` | host 入口与 Config、策略覆盖契约、client 产物一致性、会话菜单探测、manifest/patch |
| `node verify-auto-continue.cjs` | prepend 顺序、策略替换、blocked 码剔除、官方 `llm/retry` 与 `turn/end` 提示、快照路由 |
| `node verify-archive.cjs` | 归档纯函数（缺失 `seq`、Unicode 检索、截断、日期、错误分类） |
| `node verify-client-ui.cjs` | stub loader 评估 `client.js`：续轮提示、设置页、归档页顶部清理块、按钮发送路径与主题 token |
| `node verify-downloads.cjs` | Host 附件响应包装、真实字节计数、文件名/后缀、完成状态与快照 |
| `node verify-maintenance.cjs` | 审计落盘、附件引用/孤儿/宽限期、多帧与损坏 zstd、空 home 安全阀 |
| `node verify-theme-tokens.cjs` | `scripts/client/` 模块只引用 DSH 真实存在的 `--dsw-*` 变量；两套主题对比度达标 |

发布前全部检查全绿，并执行 `node scripts/build-client.mjs --check`、`node --check host.js`、`node --check auto-continue.js`、`node --check client.js`。

## 5. 发布流程

1. 修改源码/文档；
2. 如改了 client 相关文件：`node scripts/build-client.mjs`；
3. 更新版本号（`package.json` + README 标题）；
4. 跑完第 4 节全部检查；
5. 打包：

   ```powershell
   node <dsh-runtime>\pnpm\bin\pnpm.mjs pack --pack-destination <输出目录>
   ```

6. 安装到测试 profile，完全重启 DSH；
7. 验证：设置 → 插件 → 自动续轮可读写；归档页顶部清理块可预览/删除；右键菜单「删除会话」可用；输入框上方按钮能发出消息；下载时显示卡片；
8. 提交（Conventional Commits）并打 tag。

## 6. 更新 vendored 归档实现

1. 解包新版 `@michengai/dsh-archive-manager`；
2. 替换 `vendor/archive-manager/lib/`、`locale/`、`LICENSE`；
3. 重新应用本地修改（见 `vendor/archive-manager/MODIFICATIONS.md`）：
   - 删除 GitHub/反馈入口与更新检查；
   - 删除 `plugin-updater.js`，`index.js` 只再导出 `host-install.js`；
   - 确认弹窗加 `centered`；
   - 删除流程保留 `archive-manager/session-deleted` 审计事件；
   - 会话菜单模式探测同时接受 `contextMenu.content` 与 `sidebar.workspaces`（见 `MODIFICATIONS.md` 第 11 条）；
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
| 续轮没有发生 | 确认 `enabled`；确认故障码在 `retryableCodes` 且不在 `blockedCodes`；确认官方 `dsh-llm-retry` 已加载（它负责执行重试） |
| 提示条不出现 | 检查 `emitProminentError`、`/api/cockpit/auto-continue` 路由是否注册、客户端轮询是否在跑 |
| 设置页“设置服务不可用” | 先看“已注册”列表是否含 `cockpit`；不含则检查 `Config` 是否原生 volatile；再查 `ctx.remote.settings` 取值方式 |
| 右键菜单没有「删除会话」 | 确认 `client.js` 已重新生成并刷新页面；确认宿主 sidebar 把槽声明在 `contextMenu.content` 下；看控制台是否出现 `sidebar mode switch failed` |
| 输入框上方没有按钮 | 确认 `client.js` 已刷新；确认当前会话存在（dock 是 session 作用域）；看控制台是否出现 `cockpit UI skipped` |
| 按钮点击后没反应 | 看是否有“发送失败”提示；`sessions.binding(sessionId)` 为 `undefined` 时说明会话不可用 |
| 删除失败 | 看 vendored 日志中的 `cannot delete session ...`；常见原因：持久化后端无 `locate()`、路径校验失败、文件占用 |
| 附件没被清理 | 检查会话转录是否可读、`<DSH_HOME>/sessions` 是否存在、对象是否仍在 24 小时宽限期 |
| 安装后页面没变化 | client 变更需刷新页面，host 变更需完全重启 |

## 9. 提交规范建议

- Conventional Commits：`feat:` / `fix:` / `docs:` / `refactor:` / `test:`
- 一次提交只做一件事；生成物 `client.js` 与源文件一起提交；
- 不提交 `.tgz`、`.zip`、日志与本机路径。
