# DSH Cockpit v2.8.0

DSH（DeepSeek Harness）套件插件：**自动续轮**、**会话归档管理**、**下载进度**、**删除审计**与**孤儿附件清理**。

> 不包含推理强度滑条；滑条由独立插件 `dsh-effort-slider` 提供。

## 功能

- **自动续轮**：请求失败后自动重新发起，**不向对话写入任何用户消息**；顶部内联提示显示第 N/M 次、故障码与中文原因。`agent/error` 与 `turn/end` 统一去重，兼容不同模型/通道；明确鉴权或额度错误不会无效重试。
- **可调参数**：设置 → 插件 → 自动续轮，支持启用开关、续轮次数、延迟、单请求额外重试、提示开关，并实时显示总请求次数公式；页面顶部提供独立的“空对话清理”区块。
- **会话归档**：已归档会话的检索、收藏、预览、恢复与永久删除（内置 upstream `@michengai/dsh-archive-manager` 代码，Apache-2.0）。
- **下载进度**：仅在下载活动时，于任务管理器入口左侧显示紧凑卡片，包含文件名、后缀、实时下载字节数与速率；Host 快照接口驱动，下载结束后自动隐藏。
- **删除审计**：每次删除写 JSONL，记录时间、操作者、会话 id 与结果；当前文件与单代轮转文件均限制为 2 MiB。
- **附件清理**：每 6 小时扫描一次，删除不再被任何存活会话引用的附件对象（保守策略，见下文）。

## 环境要求

- DSH Desktop `0.2.1-rc.2`（Web 客户端），Node.js 由 DSH 自带运行时提供
- Windows / macOS / Linux 均可运行；安装脚本示例使用 PowerShell

## 安装

1. 打包（在仓库根目录）：

   ```powershell
   node <dsh-runtime>\pnpm\bin\pnpm.mjs pack --pack-destination <输出目录>
   ```

2. 在 DSH 的插件管理中安装生成的 `.tgz`（`plugin_manager → install_bundle`）。
3. **完全重启** DSH Desktop 并刷新页面。

安装后可在「设置 → 插件 → 自动续轮」看到配置页；归档入口在「设置 → 归档会话」。

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

`providerRetryMaxRetries` 会通过 `agent/request-error` 覆盖所有模型的内部 `maxRetries`，不再只是展示值。启用插件后，各 provider 的系统默认值（例如 Kimi 的 5）都会被统一替换为配置值；`always` 模式也会转为带次数上限的 `normal` 模式。已有重试错误码和退避参数保留，只有上限被覆盖。`enabled` 在 Config schema 中的内置默认值是 `false`，随包 patch 显式设为 `true`，其他安装方式以实际 patch 为准。

## 自动续轮是怎么工作的

1. 监听 `agent/error`；若通道未提供该事件，则由持久化的 `turn/end reason.kind = "error"` 兜底，同一 Turn 只计一次；
2. agent 进入 `idle` 后，向 inbox 投递一条 `source.kind = "runtime-context"` 的消息；
3. agent loop 消费该消息但不写入 transcript，请求由现有上下文重新组装——等价于“重发上一次请求”；
4. 通过兼容的 `api-session/error` relay 发出提示，客户端渲染为输入框上方的细条；不同模型共用同一提示通道。

因此对话里不会出现“继续”消息，也不会产生用户消息。

## 会话归档

- 标题/正文检索、项目/收藏/日期筛选、快速预览
- 收藏、单条/批量恢复、按项目归档
- 永久删除已归档或未归档会话（二次确认），同时清理工作区记账、置顶、收藏及当前/历史投影缓存域
- 日志诊断与修复
- 空对话先预览再确认删除；当前/活动会话、fork、subagent、含真实内容或未知事件的会话均不纳入候选

> 删除是硬删除，无回收站。删除前请确认目标会话可丢弃。

## 删除审计与附件清理

- 审计文件：`<DSH_HOME>/storages/cockpit-audit/session-deletions.jsonl`
- 附件对象：`<DSH_HOME>/attachments/v1/objects`（内容寻址）
- 清理规则：逐 zstd 帧扫描所有存活会话转录，只保留引用哈希而不整份解析 JSONL；未被任何会话引用且超过 24 小时的对象才会删除。任一转录、帧或目录不可读以及会话根为空时**整轮放弃**。

## 测试

```bash
node verify-cockpit.cjs
node verify-auto-continue.cjs
node verify-archive.cjs
node verify-client-ui.cjs
node verify-downloads.cjs
node verify-maintenance.cjs
```

`client.js` 是生成物，改动 `vendor/archive-manager/lib/client.js` 或 `scripts/client-wrapper.js` 后执行：

```bash
node scripts/build-client.mjs        # 重新生成
node scripts/build-client.mjs --check
```

## 项目结构

```text
host.js             入口，只做组装
auto-continue.js    自动续轮引擎与 Config
archive.js          挂载 vendored 归档 host
maintenance.js      删除审计 + 孤儿附件清理
downloads.js        Host 下载字节观测与 Remote 进度事件
client.js           客户端产物（生成物）
scripts/            客户端生成脚本与发布脚本
vendor/             vendored 归档实现与 schemastery/cosmokit 副本
verify-*.cjs        回归测试
MAINTAINERS.md      维护手册
```

## 兼容性与限制

- 归档实现基于 upstream `@michengai/dsh-archive-manager@1.0.20`，其官方兼容声明止于 `0.2.1-alpha.3`；在 `0.2.1-rc.2` 上已验证归档页与常规操作。
- 下载卡片观测经过 DSH Host 且带 `Content-Disposition: attachment` 的响应；外部 URL 与 Electron updater 不在观测范围内。逐块统计实际响应字节并显示实时字节数与速率；无 `Content-Length` 时显示不定进度，不伪造百分比。
- 隐藏续轮依赖 agent loop 对 `runtime-context` 的过滤行为；DSH 升级后请先跑测试并确认对话中不出现多余消息。
- 安装/热更新可能卡住 Loader 的 HMR 队列，安装后请完全重启。

## 许可证

- 本项目：MIT，见 [LICENSE](LICENSE)
- `vendor/archive-manager`：Apache-2.0（保留原始 LICENSE，修改说明见 `vendor/archive-manager/MODIFICATIONS.md`）
- `vendor/schemastery.mjs`、`vendor/cosmokit.mjs`：MIT 副本（见 `vendor/LICENSE.schemastery`、`vendor/LICENSE.cosmokit`）
