# DSH Cockpit v2.8.12

DSH（DeepSeek Harness）驾驶舱套件：请求失败自动续轮、会话归档与清理、下载进度、删除审计与孤儿附件回收。

> 本包不包含推理强度滑条；滑条由独立插件 `dsh-effort-slider` 提供。

## 功能

### 自动续轮

- 请求失败后自动重新发起，**不向对话写入任何用户消息**。
- 以 `agent/error` 为快速路径，`turn/end reason.kind = "error"` 为持久化兜底；同一 Turn 只计一次，兼容不同模型与通道。
- 内联提示跟随 DSH 的浅色/深色主题着色，故障码单独使用主题错误色，显示第 N/M 次与中文原因；明确的鉴权或额度错误不会无效重试。
- 「设置 → 插件 → 自动续轮」提供启用开关、续轮次数、延迟、单次请求额外重试与提示开关，并实时显示总请求次数。

### 会话管理

- **归档页**（设置 → 归档会话）：标题/正文检索、项目/收藏/日期筛选、快速预览、收藏、单条与批量恢复、按项目归档、永久删除、日志诊断与修复。
- **删除会话**：会话列表右键菜单中的「删除会话」经二次确认后永久删除；父会话会连同全部层级的 subagent 子会话一起删除，fork 分支作为独立会话保留。
- **空对话清理**：先只读预览再确认删除空对话，以及没有被任何父会话引用的幽灵会话；当前/活动会话、fork、subagent、含真实内容或未知事件的会话一律不纳入候选。

### 下载进度

- 仅在下载活动时，于会话标题栏显示紧凑卡片：文件名、后缀、实时下载字节与速率；无 `Content-Length` 时显示不定进度，不伪造百分比。
- 下载结束后保留短暂完成态再自动隐藏；卡片与进度条全部使用 DSH 主题变量，浅色与深色主题下都保持可读。

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

安装后可在「设置 → 插件 → 自动续轮」看到配置页；归档入口在「设置 → 归档会话」；会话删除入口在会话列表的右键菜单中。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true`（随包 patch） | 是否自动续轮 |
| `maxAttempts` | `6` | 续轮上限（1–50） |
| `delayMs` | `1500` | 进入 idle 后、投递前的等待（毫秒） |
| `providerRetryMaxRetries` | `3` | 覆盖所有模型单次请求的内部重试上限，也用于预算公式展示 |
| `emitProminentError` | `true` | 是否显示内联续轮提示 |
| `retryableCodes` | `TRANSPORT`/`TIMEOUT`/`RATE_LIMIT`/`SERVER`/`EMPTY_RESPONSE`/`UNKNOWN` | 可续轮故障码 |
| `blockedCodes` | `AUTH`/`QUOTA`/… | 不可续轮故障码 |

总请求次数（仅展示）：

```text
（1 + providerRetryMaxRetries）×（1 + maxAttempts）
```

`providerRetryMaxRetries` 不止用于展示：它通过 `agent/request-error` 重写所有 provider 的内部重试策略，把系统默认上限统一替换为配置值。`enabled` 在 Config schema 中的内置默认值是 `false`，随包 patch 显式设为 `true`。

## 使用要点

- 删除是**硬删除**，没有回收站；删除前请确认目标会话可以丢弃。
- 删除会同时清理工作区记账、置顶、收藏以及当前/历史投影缓存域，避免残留条目。
- 归档页与右键菜单对未归档、已归档会话都支持永久删除。

## 项目结构

```text
host.js             入口，只做组装
auto-continue.js    自动续轮引擎与 Config
archive.js          挂载 vendored 归档 host
maintenance.js      删除审计 + 孤儿附件清理
downloads.js        Host 下载字节观测与 Remote 进度事件
client.js           客户端产物（生成物，勿手改）
scripts/            客户端生成脚本与发布脚本
vendor/             vendored 归档实现与 schemastery/cosmokit 副本
verify-*.cjs        回归测试
MAINTAINERS.md      维护手册
```

## 开发经验与常见坑

这些是开发和升级过程中反复踩到的点，改动相关代码前建议先看一遍。

1. **`client.js` 是生成物。** 它由 `vendor/archive-manager/lib/client.js` 与 `scripts/client-wrapper.js` 拼接而成；改客户端只改这两处，再执行 `node scripts/build-client.mjs`，不要手改 `client.js`。
2. **会话菜单契约会随 DSH 版本迁移。** DSH 0.2.2 起会话右键菜单由 `ctx.contextMenus` 托管，旧的 `sidebar.workspaces.session.menu.item` 槽改挂在 `contextMenu.content` 的 session 条目下。只探测 `sidebar.workspaces` 会误判为“宿主没有菜单槽”，插件随之降级成自带侧栏，「删除会话」入口直接消失。探测逻辑要同时接受两种声明位置。
3. **设置服务必须走 `ctx.remote.settings`。** 它返回 `RemoteResult`（`{ok, value}`）；`ctx.get("remote")` 只是 carrier，没有 `.settings`。写成后者时页面只会显示“设置服务不可用”。
4. **`Config` 必须来自 vendored schemastery 且根节点 `.volatile()`。** 否则 `ctx.settings.describe()` 会静默跳过本插件，配置页永远拿不到命名空间。
5. **隐藏续轮依赖 agent loop 对 `source.kind = "runtime-context"` 消息的过滤。** 升级 DSH 后先跑测试，并确认对话里没有多出“继续”之类的新消息；一旦过滤行为变化，续轮要么失效，要么变成显式发言。
6. **提示与下载共用 `api-session/error` relay。** 续轮文本以 `【自动续轮` 开头，下载快照以 `【下载】` 开头；客户端必须分别解析，否则下载 JSON 会被当成错误提示渲染。
7. **主题色只能引用 DSH 真实存在的 `--dsw-*` 变量。** 写不存在的变量不会报错，只会静默回退：深色 fallback 落到浅色页面上就是“深底深字”。新增颜色时先确认变量存在，再补对比度断言。
8. **删除必须走同一条 registry 路径。** 归档页删除、右键删除、空对话清理共用 `workspaceRegistry` 的删除实现，并统一发出 `archive-manager/session-deleted` 审计事件；绕过它会导致缓存、置顶、收藏残留。
9. **父会话删除要级联 subagent。** `collectSubagentDescendants` 按全部层级收集 `origin: "subagent"` 后代，fork 分支（`isSeeded`）不连带删除。
10. **附件扫描是保守策略。** 逐 zstd 帧扫描并只保留 64 位哈希引用，不整份解析 JSONL；任一转录、帧或目录不可读，或会话根为空时整轮放弃。不要为了“更彻底”放宽这条安全阀。
11. **安装只替换文件。** 客户端变更需刷新页面，host 变更需完全重启 DSH；只刷新页面时 host 侧仍是旧代码。

## 测试

```bash
node verify-cockpit.cjs
node verify-archive.cjs
node verify-auto-continue.cjs
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
node scripts/build-client.mjs --check && node --check host.js && node --check client.js
```

## 兼容性

目标环境为 DSH Desktop `0.2.2-rc.3` 的 Web 客户端（Windows 已验证）。插件依赖 DSH 的 slot、Remote 与主题变量契约，升级 DSH 后建议先跑一遍测试。

## 许可证

- 本项目：MIT，见 [LICENSE](LICENSE)
- `vendor/archive-manager`：Apache-2.0（保留原始 LICENSE，修改说明见 `vendor/archive-manager/MODIFICATIONS.md`）
- `vendor/schemastery.mjs`、`vendor/cosmokit.mjs`：MIT 副本（见 `vendor/LICENSE.schemastery`、`vendor/LICENSE.cosmokit`）
