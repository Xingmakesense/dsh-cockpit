# vendor/watcher-insights 说明

本目录承载 dsh-cockpit 的统计投影实现，来源为 dsh-watcher（MIT，见 `LICENSE`）。

## 原样副本

以下文件从 dsh-watcher 的 `src/insights/` **逐字节复制**，不得改写：

| 文件 | 作用 |
|---|---|
| `engine.mjs` | `watcherInsights` 的 fold、初始状态与 wire view（`stateVersion 5`） |
| `presentation.mjs` | 跨会话模型/工具/Skill/工作区聚合与 workspace 标签 |
| `calendar.mjs` | 浏览器本地日历日工具；投影 `days[].start` 使用 UTC 15 分钟桶 |

只允许在升级上游时整体替换，并同步更新 `verify-stats.cjs` 中的 SHA-256 快照。

## 本地新增

| 文件 | 作用 |
|---|---|
| `analytics.mjs` | 从 dsh-watcher 的 `InsightsSettings` 统计 `useMemo` 迁移到 Host 的范围聚合：汇总、模型、三榜、轮次分布、按日趋势与会话列表；热力图与费用估算按需求未移植 |

约束：

- 不修改 `engine.mjs` 的 reduce / view 语义；
- engine 内部的 `KEY` 仍是 `watcherInsights`；cockpit 以 `cockpitInsights` 注册同一个 stateVersion 5 的投影，避免与已安装的 dsh-watcher 争用同一 key。
- 投影只在 `GET /api/cockpit/stats` 第一次被调用时注册，不在 Host 启动阶段扫描会话。
