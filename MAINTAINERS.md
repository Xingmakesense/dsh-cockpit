# 维护手册（DSH Cockpit）

本文件面向仓库维护者，描述模块边界、关键契约、发布流程与排错方式。

## 1. 模块职责

| 文件 | 职责 | 不应做什么 |
|---|---|---|
| `host.js` | 入口，只组装 `Config` 与三个 install 调用 | 不写业务逻辑、不写 UI 文案 |
| `auto-continue.js` | 续轮状态机、`Config` schema、配置归一化、提示文本 | 不碰归档/文件系统 |
| `archive.js` | 通过 `ctx.inject` 挂载 vendored 归档 host | 不复制 vendored 逻辑 |
| `maintenance.js` | 删除审计落盘、孤儿附件清扫、定时器 | 不改会话/归档状态 |
| `client.js` | 生成物，勿手改 | — |
| `scripts/client-wrapper.js` | 归档 UI 挂载、内联提示 dock、设置页 | 不写续轮状态机 |
| `vendor/` | 归档实现（Apache-2.0）与 schemastery/cosmokit（MIT）副本 | 不与仓库其他部分循环依赖 |

## 2. 关键契约（改代码前必读）

1. **隐藏重试**：续轮投递 `source.kind = "runtime-context"` 的 inbox 消息；agent loop 消费但不写 transcript。若 DSH 修改该行为，续轮会失效或出现多余消息。
2. **提示文本格式**：`auto-continue.js` 发出的 `【自动续轮…】` 文本由 `client-wrapper.js` 的 `parseNotice` 解析：
   - `第 N/M 次`、`故障码 XXX`、`失败原因：…`、`已停止` / `未启动` 关键字。
   - 改文案必须两侧同步，并更新 `verify-auto-continue.cjs`。
3. **设置服务**：必须用 `ctx.remote.settings`（Cordis 的 `remote.<namespace>` 访问器），返回 `RemoteResult`（`{ok,value}`）；`ctx.get("remote")` 只是 carrier。
4. **原生 Config**：`Config` 必须来自 `vendor/schemastery.mjs` 且根节点 `.volatile()`；否则 `ctx.settings.describe()` 会静默跳过本插件。
5. **删除审计事件**：vendored 归档 host 发出 `archive-manager/session-deleted`，`maintenance.js` 落盘；改 vendored 删除流程时保持该事件。
6. **附件清理安全阀**：任一转录读取失败或会话根为空时整轮放弃；不要移除该保护。

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
| `node verify-auto-continue.cjs` | 续轮状态机（隐藏重试、提示、上限、volatile 配置、`emitProminentError`） |
| `node verify-archive.cjs` | 归档纯函数（提取、检索片段、预览、日期、错误分类） |
| `node verify-client-ui.cjs` | 用 stub loader 评估 `client.js`，校验 `conversation.input.dock`、`settings.plugins.tab`、`api-session/error` 订阅 |
| `node verify-maintenance.cjs` | 审计落盘、附件引用/孤儿/宽限期/空 home 安全阀 |

发布前五项全绿，并执行 `node scripts/build-client.mjs --check` 与 `node --check host.js`。

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
4. 重新生成 `client.js`；跑测试；真机验证归档页、删除、恢复。

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
| 没有内联提示 | 检查 `emitProminentError`、`【自动续轮` 前缀、`api-session/error` 订阅是否注册 |
| 删除失败 | 看 vendored 日志中的 `cannot delete session ...`；常见原因：持久化后端无 `locate()`、路径校验失败、文件占用 |
| 附件没被清理 | 检查会话转录是否可读、`<DSH_HOME>/sessions` 是否存在、对象是否仍在 24 小时宽限期 |
| 安装后页面没变化 | 安装只更新文件；client 变更需刷新页面，host 变更需完全重启 |

## 9. 已知限制

- 归档深层操作未逐项真机验证；
- 续轮依赖 DSH 内部行为，升级需回归；
- 删除为硬删除，无回收站；审计只记录删除；
- 附件清理仅覆盖默认 DSH 存储布局；
- 安装/热更新可能卡住 Loader HMR 队列，需完全重启。

## 10. 提交规范建议

- Conventional Commits：`feat:` / `fix:` / `docs:` / `refactor:` / `test:`
- 一次提交只做一件事；生成物 `client.js` 与源文件一起提交；
- 不提交 `.tgz`、`.zip`、日志与本机路径。
