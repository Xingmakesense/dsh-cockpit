# 维护手册（DSH Cockpit）

本文件面向仓库维护者，描述模块边界、关键契约、发布流程与排错方式。

## 1. 模块职责

| 文件 | 职责 | 不应做什么 |
|---|---|---|
| `host.js` | 入口，只组装 `Config` 与各 install 调用 | 不写业务逻辑、不写 UI 文案 |
| `auto-continue.js` | 续轮状态机、`Config` schema、配置归一化、提示文本 | 不按 provider 写分支，不碰归档/文件系统 |
| `archive.js` | 通过 `ctx.inject` 挂载 vendored 归档 host | 不复制 vendored 逻辑 |
| `maintenance.js` | 删除审计落盘与轮转、孤儿附件清扫、定时器 | 不改会话/归档状态 |
| `downloads.js` | Host 下载字节观测、文件名解析、Remote 进度事件 | 不拦截保存路径，不重复下载文件 |
| `client.js` | 生成物，勿手改 | — |
| `scripts/client-wrapper.js` | 归档 UI、续轮提示、下载卡片、空对话清理与设置页 | 不写续轮状态机或下载字节统计 |
| `vendor/` | 归档实现（Apache-2.0）与 schemastery/cosmokit（MIT）副本 | 不与仓库其他部分循环依赖 |

## 2. 关键契约（改代码前必读）

1. **隐藏重试**：续轮投递 `source.kind = "runtime-context"` 的 inbox 消息；agent loop 消费但不写 transcript。若 DSH 修改该行为，续轮会失效或出现多余消息。
2. **提示文本格式**：`auto-continue.js` 发出的 `【自动续轮…】` 文本由 `client-wrapper.js` 的 `parseNotice` 解析：
   - `第 N/M 次`、`故障码 XXX`、`失败原因：…`、`已停止` / `未启动` 关键字。
   - 改文案必须两侧同步，并更新 `verify-auto-continue.cjs`。
3. **设置服务**：必须用 `ctx.remote.settings`（Cordis 的 `remote.<namespace>` 访问器），返回 `RemoteResult`（`{ok,value}`）；`ctx.get("remote")` 只是 carrier。
4. **原生 Config**：`Config` 必须来自 `vendor/schemastery.mjs` 且根节点 `.volatile()`；否则 `ctx.settings.describe()` 会静默跳过本插件。
5. **删除审计事件**：vendored 归档 host 发出 `archive-manager/session-deleted`，`maintenance.js` 落盘；改 vendored 删除流程时保持该事件。
6. **附件清理安全阀**：任一转录读取失败、zstd 帧不完整或会话根为空时整轮放弃；不要移除该保护。扫描必须逐帧解码并仅保留引用哈希，不得为了扫描再解析/序列化整份 JSONL。
7. **续轮触发与去重**：`agent/error` 是快速路径，`turn/end reason.kind = "error"` 是持久化兜底；同一 Turn 只武装一次，只有 `agent.followup()` 成功才计次数。
8. **提示与下载事件**：统一复用已验证的 `api-session/error` relay；续轮以 `【自动续轮` 开头，下载以 `【下载】` 开头。Client 必须分别解析，不能让下载 JSON 被当成错误提示。
9. **下载观测**：只能在 `connection/request` 的响应包装中统计字节，必须调用原 `next()` 并保持原响应内容、背压和保存流程；无 `Content-Length` 时不得伪造百分比。
10. **空对话清理与级联删除**：`previewEmptySessions` 只读，`deleteEmptySessions` 在确认后重新校验；当前/活动、fork、真实内容、未知事件和读取失败的会话一律保留。删除任一父会话时，`deleteDescendants` 必须通过 `collectSubagentDescendants` 收集全部层级的 `origin: "subagent"` 后代并逐个删除，结果以 `cascadedSessionIds` 返回；fork 分支（`isSeeded`）不得连带删除。
11. **缓存性能**：存活会话集合每次迁移/清扫最多读取一次 `sessionPersistence.list()`；兼容官方缓存记录每次迁移只读取一次；孤儿行在各自域内批量删除，不得按候选逐个 `stat()` 或重复开关全部域。
12. **内层重试覆盖**：`providerRetryMaxRetries` 在 `agent/request-error` 中生成新的 `ResolvedNormalRetryPolicy` 并继续 `next()`，覆盖所有模型的系统默认上限；不得只修改预算公式，也不得修改其他插件的 profile 配置。
13. **会话菜单宿主探测**：DSH 0.2.2 起会话右键菜单由 `ctx.contextMenus` 托管，旧的 `sidebar.workspaces.session.menu.item` 槽声明在 `contextMenu.content`（key `session`）之下。vendored 客户端的模式探测必须同时接受两种声明位置，并在 `sidebar.workspaces` 或 `contextMenu.content` 变化时重新协调；只看 `sidebar.workspaces` 会降级到自带侧栏，右键菜单里就没有「删除会话」。

## 3. 配置与默认值

见 README 的配置表。修改字段时同步：

1. `auto-continue.js` 的 `Config` 与 `normalizeContinueConfig`；
2. `client-wrapper.js` 的 `pickValues` / `NUMERIC_FIELDS` / `save` 键列表；
3. `verify-cockpit.cjs` 的 known keys 与 `verify-auto-continue.cjs` 的断言；
4. README 配置表；
5. `cordis.patch.yml`（仅当默认值需要随包覆盖）。

## 4. 测试矩阵

| 命令 | 覆盖 |
|---|---|
| `node verify-cockpit.cjs` | host 导出、配置归一化、client 产物一致性、`cordis.patch.yml`、移除项残留 |
| `node verify-auto-continue.cjs` | 续轮状态机（隐藏重试、Turn 去重、`turn/end` 兜底、额度分类、上限、volatile 配置、定时器释放） |
| `node verify-archive.cjs` | 归档纯函数（缺失 `seq`、Unicode 检索、截断、日期、错误分类） |
| `node verify-client-ui.cjs` | 用 stub loader 评估 `client.js`，校验续轮/下载事件、`conversation.input.dock`、标题栏下载卡片、归档空对话按钮与设置页 |
| `node verify-downloads.cjs` | Host 附件响应包装、真实字节计数、文件名/后缀、完成状态与 `api-session/error` relay |
| `node verify-maintenance.cjs` | 审计落盘、附件引用/孤儿/宽限期、多帧与损坏 zstd、空 home 安全阀 |
| `node verify-theme-tokens.cjs` | `client-wrapper.js` 只引用 DSH 真实存在的 `--dsw-*` 变量；浅色/深色两套主题下文字与进度条对比度达标 |

发布前全部检查全绿，并执行 `node scripts/build-client.mjs --check` 与 `node --check host.js`、`node --check client.js`。

### 4.1 样式只能使用 DSH 已定义的变量

`client-wrapper.js` 的内联样式全部走 `--dsw-*` 主题变量。写不存在的变量不会报错，只会静默回退到 fallback，
于是深色 fallback 落在浅色页面上就变成“深底深字”。`--dsw-alias-bg-elevated` 与 `--dsw-alias-bg-sunken`
就是这样踩过的坑，已分别改为 `--dsw-alias-bg-module-platform`、`--dsw-specific-input-major` 等真实变量。

新增颜色时：

1. 先在 DSH 主题里确认变量真实存在（`:root` 为浅色，`body[data-ds-dark-theme]` 为深色）；
2. 优先用 `THEME` 映射表里的取值，回退值使用系统色或中性半透明色，不要写死深色；
3. 更新 `verify-theme-tokens.cjs` 的 token 快照，并确认对比度断言仍然通过（正文 ≥ 4.5:1，图形 ≥ 3:1）。

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
7. 验证：设置 → 插件 → 自动续轮 可读写；归档页可打开；测试一次失败续轮（或检查日志）；
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
同步更新 `LICENSE.schemastery`、`LICENSE.cosmokit`，并确认 `Config` 仍满足：

```js
Reflect.get(Config, Symbol.for("schemastery")) === true
Config.meta.volatile === true
```

## 8. 排错

| 症状 | 排查 |
|---|---|
| 设置页“设置服务不可用” | 先看“已注册”列表是否含 `cockpit`；不含则检查 `Config` 是否原生 volatile（`Config.listConfigs` 状态应为 `schema`）；再查 `ctx.remote.settings` 取值方式 |
| 续轮后对话出现“继续”消息 | DSH 可能改变了 `runtime-context` 过滤行为；先跑 `verify-auto-continue.cjs`，再核对 agent-loop 的 `step()` |
| 没有内联提示 | 检查 `emitProminentError`、`【自动续轮` 前缀及 `api-session/error` 订阅是否注册 |
| 右键菜单没有「删除会话」 | 先确认 `client.js` 已重新生成并刷新页面；再看宿主 sidebar 是否把 `sidebar.workspaces.session.menu.item` 声明在 `contextMenu.content` 下（DSH 0.2.2+），以及控制台是否出现 `sidebar mode switch failed` |
| 删除失败 | 看 vendored 日志中的 `cannot delete session ...`；常见原因：持久化后端无 `locate()`、路径校验失败、文件占用 |
| 附件没被清理 | 检查会话转录是否可读、`<DSH_HOME>/sessions` 是否存在、对象是否仍在 24 小时宽限期 |
| 安装后页面没变化 | 安装只更新文件；client 变更需刷新页面，host 变更需完全重启 |

## 9. 已知限制

- 归档深层操作未逐项真机验证；
- 续轮依赖 DSH 内部行为，升级需回归；
- 删除为硬删除，无回收站；审计只记录删除；
- 附件清理仅覆盖默认 DSH 存储布局；
- 下载进度仅覆盖带 `Content-Disposition: attachment` 的 DSH Host 响应，不覆盖外部 URL 或 Electron updater；
- 安装/热更新可能卡住 Loader HMR 队列，需完全重启。

## 10. 提交规范建议

- Conventional Commits：`feat:` / `fix:` / `docs:` / `refactor:` / `test:`
- 一次提交只做一件事；生成物 `client.js` 与源文件一起提交；
- 不提交 `.tgz`、`.zip`、日志与本机路径。
