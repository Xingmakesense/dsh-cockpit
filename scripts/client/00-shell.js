// ---------------------------------------------------------------------------
// dsh-cockpit client half.
//
// Generated into ../client.js by scripts/build-client.mjs:
//   client.js = vendor/archive-manager/lib/client.js + "\n" + this file
// Do not hand-edit client.js; edit the vendor bundle (or this wrapper) and
// rebuild instead.
//
// Two Cordis plugins are mounted here:
//   1. the vendored archive-manager client (`@michengai/dsh-archive-manager`),
//   2. the cockpit UI: the auto-continue notice, the download card, the
//      auto-continue settings page, the archive-page cleanup block and
//      the "clean temporary artifacts" button above the composer.
// ---------------------------------------------------------------------------
window.__ModuleLoader__.load({
    id: "dsh-cockpit",
    factory: (require) => {
        const module = { exports: {} };
        const exports = module.exports;
        const React = require("react");
        const h = React.createElement;


        const NS = "dsh-cockpit";
        const AUTO_CONTINUE_ROUTE = "api/cockpit/auto-continue";
        /** Exact user-side message the button above the composer sends. */
        const CLEAN_TEMP_MESSAGE = "清理本项目的临时产物";

        const DICTS = {
            zh: {
                cleanupTitle: "空对话清理",
                cleanupDescription: "删除空对话，以及没有父会话引用的子会话（幽灵会话）。先预览，确认后永久删除。",
                emptyCleanup: "清理",
                emptyNone: "没有需要清理的会话",
                emptyConfirm: "发现 {empty} 个空对话、{ghost} 个幽灵会话，将永久删除（跳过 {skipped} 项）。此操作不可恢复。",
                emptyDeleteConfirm: "确认删除",
                emptyDeleteResult: "已删除 {deleted}，跳过 {skipped}，失败 {failed}",
                emptyFailed: "操作失败：",
                cancel: "取消",
                cleanTemp: "清理临时产物",
                cleanTempHint: "以用户身份发送「清理本项目的临时产物」",
                sending: "发送中…",
                sent: "已发送",
                sendFailed: "发送失败：",
                tab: "自动续轮",
                title: "自动续轮",
                description: "请求失败后自动重试：先按单次请求重试次数重试，仍失败时再额外续轮。不会向对话写入任何消息。",
                enabled: "启用自动续轮",
                providerRetryMaxRetries: "单次请求重试次数",
                maxAttempts: "额外续轮次数",
                delayMs: "续轮延迟（毫秒）",
                prominent: "显示自动续轮提示",
                retryHint: "覆盖官方重试策略：每次请求最多重试 {provider} 次；官方重试结束后，再额外续轮 {max} 次（每轮都重新获得同样的重试预算）。",
                formulaTitle: "最多尝试次数",
                formula: "（1 + 单次请求重试次数）×（1 + 额外续轮次数）",
                requestUnit: "次请求",
                noticeExtra: "额外续轮",
                save: "保存",
                saving: "保存中…",
                saved: "已保存",
                reload: "重新读取",
                unavailable: "设置服务不可用；当前显示的是内置默认值。",
                loading: "正在读取配置…",
                loadFailed: "读取配置失败：",
                saveFailed: "保存失败：",
                noticeRetry: "自动续轮",
                noticeHalt: "自动续轮已停止",
                noticeBlocked: "自动续轮未启动",
                close: "关闭",
                failureCode: "故障码",
                attempt: "第 {attempt}/{max} 次"
            },
            en: {
                cleanupTitle: "Empty chat cleanup",
                cleanupDescription: "Delete empty chats and subagent sessions no parent references (ghost sessions). Preview first, then delete permanently.",
                emptyCleanup: "Clean",
                emptyNone: "Nothing to clean up",
                emptyConfirm: "{empty} empty chats and {ghost} ghost sessions will be permanently deleted ({skipped} skipped). This cannot be undone.",
                emptyDeleteConfirm: "Delete permanently",
                emptyDeleteResult: "Deleted {deleted}, skipped {skipped}, failed {failed}",
                emptyFailed: "Operation failed: ",
                cancel: "Cancel",
                cleanTemp: "Clean temporary artifacts",
                cleanTempHint: "Send \"清理本项目的临时产物\" as the user",
                sending: "Sending…",
                sent: "Sent",
                sendFailed: "Send failed: ",
                tab: "Auto-continue",
                title: "Auto-continue",
                description: "Retry failed requests automatically: first the provider retry limit, then extra continuations. No chat message is written.",
                enabled: "Enable auto-continue",
                providerRetryMaxRetries: "Retries per request",
                maxAttempts: "Extra continuations",
                delayMs: "Delay (ms)",
                prominent: "Show auto-continue notices",
                retryHint: "The official retry policy is replaced here: up to {provider} retries per request, then up to {max} extra continuation rounds, each with the same retry budget.",
                formulaTitle: "Maximum attempts",
                formula: "(1 + retries per request) × (1 + extra continuations)",
                requestUnit: "requests",
                noticeExtra: "Extra continuation",
                save: "Save",
                saving: "Saving…",
                saved: "Saved",
                reload: "Reload",
                unavailable: "Settings service unavailable; showing built-in defaults.",
                loading: "Loading configuration…",
                loadFailed: "Could not read configuration: ",
                saveFailed: "Could not save: ",
                noticeRetry: "Auto-continue",
                noticeHalt: "Auto-continue stopped",
                noticeBlocked: "Auto-continue not started",
                close: "Close",
                failureCode: "Failure code",
                attempt: "Attempt {attempt}/{max}"
            }
        };

        /** Send one ordinary user message through the official Session API. */
        const sendUserText = async (sessions, sessionId, text) => {
            const binding = sessions?.binding?.(sessionId);
            if (binding === undefined) throw new Error("session is unavailable");
            return binding.session.prompt([{ type: "text", text }], "queue");
        };
