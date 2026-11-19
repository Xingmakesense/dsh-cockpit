# DSH Cockpit v3.0.0

DSH（DeepSeek Harness）会话工作台套件：基于官方恢复接口的自动续轮、会话归档与清理、输入框上方的「清理临时产物」按钮、下载进度、删除审计与孤儿附件回收。

> 本包不包含推理强度滑条；滑条由独立插件 `dsh-effort-slider` 提供。

## 3.0.0 变更

- **自动续轮重写为官方实现**：只使用 `agent/request-error` 恢复钩子、原生 Config/设置服务与同源快照路由。不再伪造 `runtime-context` inbox 消息，也不再借用内部 `api-session/error` 通道。
- **新增「清理临时产物」按钮**：位于输入框上方（输入框卡片外侧）右侧，点击后以用户身份发送一条普通消息 `清理本项目的临时产物`。
- 空对话清理改为独立的「设置 → 会话清理」分区。
- `providerRetryMaxRetries` 标记为废弃：provider 级重试预算由官方 `retryPolicy` / `dsh-llm-retry` 管理，本插件只追加提供方无关的额外续轮。

## 功能

### 自动续轮

- 接入官方 `agent/request-error` 瀑布：先用 `next()` 让官方提供方重试策略（`retryPolicy` / `dsh-llm-retry`）处理；只有它放弃后才追加本插件的额外续轮。
- 续轮返回官方动作 `{ kind: "retry" }`，直接复用当前步骤与已准备的请求组装：**不写入任何对话消息**，也不会产生新的用户消息。
- 按 Turn 计数，`turn/start` / `turn/end` 自动重置；达到上限后保留原始错误。
- 不可自愈的故障码（`AUTH` / `QUOTA` / `BAD_REQUEST` 等）不会重试，并按原因提示。
- 提示通过同源快照路由 `GET /api/cockpit/auto-continue` 轮询，渲染为输入框上方的细条；不使用内部事件通道。
- 「设置 → 插件 → 自动续轮」：启用开关、额外续轮次数、续轮延迟、提示开关。provider 级重试次数请在提供方配置中调整。

### 会话管理

- **归档页**（设置 → 归档会话）：标题/正文检索、项目/收藏/日期筛选、快速预览、收藏、单条与批量恢复、按项目归档、永久删除、日志诊断与修复。
- **删除会话**：会话列表右键菜单中的「删除会话」经二次确认后永久删除；父会话会连同全部层级的 subagent 子会话一起删除，fork 分支作为独立会话保留。
- **空对话清理**（设置 → 会话清理）：先只读预览再确认删除空对话，以及没有被任何父会话引用的幽灵会话；当前/活动会话、fork、subagent、含真实内容或未知事件的会话一律不纳入候选。

### 清理临时产物按钮

- 注册在 `conversation.input.dock`：位于输入框卡片上方的 dock 区域，右对齐，**不在输入框内侧**。
- 点击后通过官方 Session 接口 `sessions.binding(sessionId).session.prompt([{ type: "text", text }], "queue")` 发送，消息内容固定为 `清理本项目的临时产物`，与用户手动输入并回车完全等价：会作为普通用户消息进入 transcript。
- 按钮只负责发送；真正清理什么、怎么清理，由当前会话的 agent 与项目自身的约定决定。

### 下载进度

- 仅在下载活动时，于会话标题栏显示紧凑卡片：文件名、后缀、实时下载字节与速率；无 `Content-Length` 时显示不定进度，不伪造百分比。
- 下载结束后保留短暂完成态再自动隐藏；卡片与进度条全部使用 DSH 主题变量，浅色与深色主题下都保持可读。
- 进度只通过同源路由 `GET /api/cockpit/downloads` 快照传递。

### 删除审计与附件回收

- 每次删除写一行 JSONL：`<DSH_HOME>/storages/cockpit-audit/session-deletions.jsonl`，记录时间、操作者、会话 id 与结果；当前文件与单代轮转文件各限 2 MiB。
- 每 6 小时扫描一次 `<DSH_HOME>/attachments/v1/objects`，只删除不被任何存活会话引用、且超过 24 小时宽限期的附件对象。

## 环境要求

- DSH Desktop `0.2.2-rc.3`（Web 客户端），Node.js 由 DSH 自带运行时提供
- Windows / macOS / Linux 均可运行；安装示例使用 PowerShell

## 安装

1. 在仓库根目录打包：

   ```powershell
   node <dsh-runtime>\pnpm\bin\pnpm.mjs pack --pack-destination <输出目录>
   ```

2. 在 DSH 的插件管理中安装生成的 `.tgz`（`plugin_manager → install_bundle`）。
3. **完全重启** DSH Desktop 并刷新页面。

安装后：续轮配置在「设置 → 插件 → 自动续轮」；归档入口在「设置 → 归档会话」；清理入口在「设置 → 会话清理」；删除会话入口在会话列表右键菜单；「清理临时产物」按钮在输入框上方。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true`（随包 patch） | 是否启用额外续轮 |
| `maxAttempts` | `6` | 每个 Turn 在官方策略之后的额外续轮上限（1–50） |
| `delayMs` | `1500` | 续轮前等待（毫秒） |
| `emitProminentError` | `true` | 是否显示内联续轮提示 |
| `retryableCodes` | `TRANSPORT`/`TIMEOUT`/`RATE_LIMIT`/`SERVER`/`EMPTY_RESPONSE`/`UNKNOWN` | 可追加续轮的故障码 |
| `blockedCodes` | `AUTH`/`QUOTA`/… | 不重试的故障码 |
| `providerRetryMaxRetries` | `0` | **已废弃**，仅为兼容旧 profile 保留，不参与运行 |

## 使用要点

- 续轮发生在当前步骤内，不会新增对话消息；失败信息通过输入框上方的提示条与日志呈现。
- 删除是**硬删除**，没有回收站；删除前请确认目标会话可以丢弃。
- 删除会同时清理工作区记账、置顶、收藏以及当前/历史投影缓存域，避免残留条目。
- 「清理临时产物」按钮发送的是普通用户消息；如果当前会话还在运行，消息会按队列模式排队。

## 项目结构

```text
host.js             入口，只做组装
auto-continue.js    官方 agent/request-error 续轮层与 Config
archive.js          挂载 vendored 归档 host
maintenance.js      删除审计 + 孤儿附件清理
downloads.js        Host 下载字节观测与进度快照
client.js           客户端产物（生成物，勿手改）
scripts/            客户端生成脚本与发布脚本
vendor/             vendored 归档实现与 schemastery/cosmokit 副本
verify-*.cjs        回归测试
MAINTAINERS.md      维护手册
```

## 开发经验与常见坑

这些是开发和升级过程中反复踩到的点，改动相关代码前建议先看一遍。

1. **自动续轮只能走官方恢复钩子。** 正确做法：监听 `agent/request-error`，先 `await next()` 让官方 `retryPolicy` / `dsh-llm-retry` 决策；它返回 `{ kind: "retry" }` 就原样透传，只有它放弃后才追加自己的尝试。旧实现伪造 `source.kind = "runtime-context"` inbox 消息并借用内部 `api-session/error` 通道，二者都不是插件 API（前者由 agent loop 的 runtime-context 模块拥有，后者由会话控制器以错误链格式发出）。
2. **用户消息要走 Session prompt。** 客户端发送消息的官方路径是 `sessions.binding(sessionId).session.prompt(content, "queue")`；`queue` 就是普通用户消息，`steer` 是中途引导。不要在插件里自己构造 user 消息再塞进 inbox。
3. **按钮位置认准 dock 槽。** `conversation.input.dock` 渲染在输入框卡片上方（卡片外侧）；`conversation.input.left/right/overlay/activity` 都在卡片内侧。想贴在输入框右上方就用 dock + 右对齐。
4. **`client.js` 是生成物。** 它由 `vendor/archive-manager/lib/client.js` 与 `scripts/client-wrapper.js` 拼接而成；改客户端只改这两处，再执行 `node scripts/build-client.mjs`。
5. **会话菜单契约会随 DSH 版本迁移。** DSH 0.2.2 起会话右键菜单由 `ctx.contextMenus` 托管，旧的 `sidebar.workspaces.session.menu.item` 槽改挂在 `contextMenu.content` 的 session 条目下。只探测 `sidebar.workspaces` 会误判为“宿主没有菜单槽”，插件随之降级成自带侧栏，「删除会话」入口直接消失。
6. **提示数据走同源快照，不走内部事件。** 续轮提示与下载进度都由 Host 的 `connection.fetch.register` 路由提供，客户端轮询；这样不依赖内部 relay，也不会把自定义字符串塞进错误事件。
7. **主题色只能引用 DSH 真实存在的 `--dsw-*` 变量。** 写不存在的变量不会报错，只会静默回退：深色 fallback 落到浅色页面上就是“深底深字”。新增颜色时先确认变量存在，再补对比度断言。
8. **删除必须走同一条 registry 路径。** 归档页删除、右键删除、空对话清理共用 `workspaceRegistry` 的删除实现，并统一发出 `archive-manager/session-deleted` 审计事件；绕过它会导致缓存、置顶、收藏残留。
9. **父会话删除要级联 subagent。** `collectSubagentDescendants` 按全部层级收集 `origin: "subagent"` 后代，fork 分支（`isSeeded`）不连带删除。
10. **附件扫描是保守策略。** 逐 zstd 帧扫描并只保留 64 位哈希引用，不整份解析 JSONL；任一转录、帧或目录不可读，或会话根为空时整轮放弃。不要为了“更彻底”放宽这条安全阀。
11. **安装只替换文件。** 客户端变更需刷新页面，host 变更需完全重启 DSH；只刷新页面时 host 侧仍是旧代码。

## 测试

```bash
node verify-cockpit.cjs
node verify-auto-continue.cjs
node verify-archive.cjs
node verify-client-ui.cjs
node verify-downloads.cjs
node verify-maintenance.cjs
node verify-theme-tokens.cjs
```

或一次跑完：

```bash
npm test
```

只检查生成物与语法：

```bash
node scripts/build-client.mjs --check && node --check host.js && node --check auto-continue.js && node --check client.js
```

## 兼容性

目标环境为 DSH Desktop `0.2.2-rc.3` 的 Web 客户端（Windows 已验证）。插件依赖 DSH 的 slot、Remote、`agent/request-error` 与主题变量契约，升级 DSH 后建议先跑一遍测试。

## 许可证

- 本项目：MIT，见 [LICENSE](LICENSE)
- `vendor/archive-manager`：Apache-2.0（保留原始 LICENSE，修改说明见 `vendor/archive-manager/MODIFICATIONS.md`）
- `vendor/schemastery.mjs`、`vendor/cosmokit.mjs`：MIT 副本（见 `vendor/LICENSE.schemastery`、`vendor/LICENSE.cosmokit`）
