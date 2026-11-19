# DSH Cockpit v3.2.0

DSH（DeepSeek Harness）会话工作台套件：覆盖官方重试策略的自动续轮、会话归档与清理、输入框上方的「清理临时产物」按钮、下载进度、删除审计与孤儿附件回收。

> 推理强度滑条由独立插件 `dsh-effort-slider` 提供，不属于本包。

## 功能

### 自动续轮

- 在官方 `agent/request-error` 恢复钩子上覆盖 `payload.retryPolicy`：先按“单次请求重试次数”执行官方重试，官方重试用尽后再按“额外续轮次数”继续自动重试。
- 监听器以 `prepend` 先于官方重试监听器运行，覆盖策略后通过 `next()` 交给官方 `dsh-llm-retry` 执行；重试、退避与取消全部由官方控件完成。
- 重试在当前步骤内进行，不写入任何对话消息，也不会产生新的用户消息。
- 不可自愈的故障码（`AUTH` / `QUOTA` / `BAD_REQUEST` 等）会从可重试集合中剔除，直接保留原始错误。
- 「设置 → 插件 → 自动续轮」：启用开关、单次请求重试次数、额外续轮次数、续轮延迟、提示开关；页面底部实时计算“最多尝试次数 = 1 + 单次请求重试次数 + 额外续轮次数”。
- 续轮进度来自官方持久化 `llm/retry` 事件，最终失败来自 `turn/end`；提示与操作按钮位于输入框上方同一固定高度行内，提示出现时不会改变布局高度。

### 会话管理

- **归档页**（设置 → 归档会话）：标题/正文检索、项目/收藏/日期筛选、快速预览、收藏、单条与批量恢复、按项目归档、永久删除、日志诊断与修复。
- **删除会话**：会话列表右键菜单中的「删除会话」经二次确认后永久删除；父会话会连同全部层级的 subagent 子会话一起删除，fork 分支作为独立会话保留。
- **空对话清理**（归档页顶部）：在「设置 → 归档会话」页面顶部直接预览并清理空对话与没有父会话引用的幽灵会话；当前/活动会话、fork、subagent、含真实内容或未知事件的会话一律不纳入候选。

### 清理临时产物按钮

- 注册在 `conversation.input.dock`：位于输入框卡片上方的 dock 区域，宽度与输入框卡片一致，按钮左对齐并位于卡片外侧。
- 点击后通过官方 Session 接口 `sessions.binding(sessionId).session.prompt([{ type: "text", text }], "queue")` 发送，消息内容固定为 `清理本项目的临时产物`，与用户手动输入并回车完全等价。
- 按钮只负责发送；具体清理范围由当前会话的 agent 按项目约定执行。

### 下载进度

- 仅在下载活动时，于会话标题栏显示紧凑卡片：文件名、后缀、实时下载字节与速率；无 `Content-Length` 时显示不定进度。
- 下载结束后保留短暂完成态再自动隐藏；卡片与进度条使用 DSH 主题变量，浅色与深色主题下都保持可读。
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

安装后：续轮配置在「设置 → 插件 → 自动续轮」；归档与空对话清理都在「设置 → 归档会话」；删除会话入口在会话列表右键菜单；「清理临时产物」按钮在输入框上方。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true`（随包 patch） | 是否覆盖官方重试策略 |
| `providerRetryMaxRetries` | `3` | 单次请求重试次数，覆盖官方 `retryPolicy.maxRetries`（0–10） |
| `maxAttempts` | `6` | 官方重试结束后额外续轮次数（1–50） |
| `delayMs` | `1500` | 额外续轮前的等待时间（毫秒） |
| `emitProminentError` | `true` | 是否显示续轮提示 |
| `retryableCodes` | `TRANSPORT`/`TIMEOUT`/`RATE_LIMIT`/`SERVER`/`EMPTY_RESPONSE`/`UNKNOWN` | 参与重试的故障码 |
| `blockedCodes` | `AUTH`/`QUOTA`/… | 永不重试的故障码，会从可重试集合中剔除 |

最多尝试次数（设置页实时计算）：

```text
1（首次请求） + providerRetryMaxRetries（单次请求重试） + maxAttempts（额外续轮）
```

覆盖后的策略保持官方 `ResolvedRetryPolicy` 的 `normal` 模式：`maxRetries` 固定取 `providerRetryMaxRetries`，`retryableCodes` 取本插件配置，`maxDelayMs`、`jitterRatio` 沿用官方提供方策略（缺失时使用 10 秒与 0.1）。

## 使用要点

- 续轮发生在当前步骤内，不会新增对话消息；失败信息通过输入框上方的提示条与日志呈现。
- 删除是**硬删除**，没有回收站；删除前请确认目标会话可以丢弃。
- 删除会同时清理工作区记账、置顶、收藏以及当前/历史投影缓存域。
- 「清理临时产物」按钮发送的是普通用户消息；如果当前会话还在运行，消息会按队列模式排队。

## 项目结构

```text
host.js             入口，只做组装
auto-continue.js    官方 retryPolicy 覆盖层与 Config
archive.js          挂载 vendored 归档 host
maintenance.js      删除审计 + 孤儿附件清理
downloads.js        Host 下载字节观测与进度快照
client.js           客户端产物（生成物，勿手改）
scripts/            客户端生成脚本与发布脚本
vendor/             vendored 归档实现与 schemastery/cosmokit 副本
verify-*.cjs        回归测试
MAINTAINERS.md      维护手册
```

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

## 容易踩的坑

1. **续轮必须覆盖官方策略，而不是绕开官方执行器。** 在 `agent/request-error` 上以 `prepend` 运行、改写 `payload.retryPolicy` 后调用 `next()`，让官方 `dsh-llm-retry` 执行重试；不要自己返回 `{kind:"retry"}` 绕过退避、取消与持久化事件，也不要伪造 `runtime-context` 消息。
2. **配置必须是原生 volatile schema。** `Config` 来自 vendored schemastery 且根节点 `.volatile()`，否则 `ctx.settings.describe()` 会静默跳过本插件；设置页必须走 `ctx.remote.settings`（返回 `RemoteResult`）。
3. **`client.js` 是生成物。** 它由 `vendor/archive-manager/lib/client.js` 与 `scripts/client-wrapper.js` 拼接而成；改客户端只改这两处，再执行 `node scripts/build-client.mjs`。
4. **会话菜单槽的声明位置。** 会话右键菜单由 `ctx.contextMenus` 托管，`sidebar.workspaces.session.menu.item` 槽声明在 `contextMenu.content`（key `session`）下；只探测 `sidebar.workspaces` 会让插件降级到自带侧栏，「删除会话」入口消失。
5. **主题色只能引用 DSH 真实存在的 `--dsw-*` 变量。** 不存在的变量不会报错，只会静默回退；深色 fallback 落到浅色页面上就是“深底深字”。
6. **删除必须走同一条 registry 路径。** 归档页删除、右键删除、空对话清理共用 `workspaceRegistry` 的删除实现并发出 `archive-manager/session-deleted` 审计事件；父会话删除必须级联全部 `origin: "subagent"` 后代，fork 分支不连带。
7. **附件清理是保守策略。** 逐 zstd 帧扫描并只保留 64 位哈希引用；任一转录、帧或目录不可读，或会话根为空时整轮放弃。
8. **进度与提示只走同源快照。** 下载卡片与续轮提示都由 Host 的 `connection.fetch.register` 路由提供、客户端轮询；不要借用内部事件 relay，也不要在无 `Content-Length` 时伪造百分比。
9. **按钮位置认准 dock 槽。** `conversation.input.dock` 在输入框卡片上方；`conversation.input.left/right/overlay/activity` 在卡片内侧。发送用户消息用 `prompt(..., "queue")`，不要自己构造 inbox 消息。
10. **安装只替换文件。** 客户端变更需刷新页面，host 变更需完全重启 DSH；只刷新页面时 host 侧不会更新。
