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
//      auto-continue settings page, the session-cleanup settings section and
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
                cleanupSection: "会话清理",
                cleanupTitle: "会话清理",
                cleanupDescription: "预览并永久删除空对话，以及没有被任何父会话引用的子会话（幽灵会话）；删除前会显示候选数量并要求确认。",
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
                description: "覆盖官方提供方重试策略：失败请求按本页设置的请求重试上限自动重试，重试由官方重试执行器完成；不会写入任何对话消息。",
                enabled: "启用自动续轮",
                providerRetryMaxRetries: "请求重试上限",
                delayMs: "续轮延迟（毫秒）",
                prominent: "显示自动续轮提示",
                retryHint: "官方 retryPolicy 会被本页设置覆盖：请求最多重试 {max} 次，初始延迟 {delay} ms。",
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
                cleanupSection: "Session cleanup",
                cleanupTitle: "Session cleanup",
                cleanupDescription: "Preview and permanently delete empty chats and subagent sessions no parent references (ghost sessions). The candidate count is shown before you confirm.",
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
                description: "Override the official provider retry policy: failed requests retry with the configured request limit, executed by the official retry engine. No chat message is written.",
                enabled: "Enable auto-continue",
                providerRetryMaxRetries: "Request retry limit",
                delayMs: "Delay (ms)",
                prominent: "Show auto-continue notices",
                retryHint: "The official retryPolicy is replaced by these settings: up to {max} request retries with a {delay} ms initial delay.",
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

        /** Active-download snapshots with short-window, byte-based speeds. */
        function createDownloadStore() {
            const items = new Map();
            const completed = new Map();
            const removalTimers = new Map();
            const samples = new Map();
            const listeners = new Set();
            let snapshot = Object.freeze([]);

            const speedOf = (id) => {
                const rows = samples.get(id) ?? [];
                if (rows.length < 2) return null;
                const first = rows[0];
                const last = rows[rows.length - 1];
                const elapsed = last.time - first.time;
                if (elapsed <= 0) return null;
                return Math.max(0, (last.bytes - first.bytes) * 1000 / elapsed);
            };
            const publish = () => {
                const active = [...items.values()].map((item) => Object.freeze({ ...item, speed: speedOf(item.id) }));
                const finished = [...completed.values()].map((item) => Object.freeze({ ...item, speed: null }));
                snapshot = Object.freeze([...active, ...finished]
                    .sort((left, right) => (left.state === "downloading" ? 0 : 1) - (right.state === "downloading" ? 0 : 1)
                        || left.startedAt - right.startedAt));
                for (const listener of listeners) {
                    try {
                        listener();
                    } catch {
                        /* one bad view must not break download observation */
                    }
                }
            };
            const clearCompletionTimer = (id) => {
                const timer = removalTimers.get(id);
                if (timer !== undefined) clearTimeout(timer);
                removalTimers.delete(id);
            };
            const clearCompletion = (id) => {
                clearCompletionTimer(id);
                completed.delete(id);
            };
            const recordCompletion = (record) => {
                if (!record || typeof record.id !== "string") return;
                items.delete(record.id);
                samples.delete(record.id);
                const previous = completed.get(record.id);
                completed.set(record.id, { ...previous, ...record, state: "completed", completedAt: previous?.completedAt ?? Date.now() });
                if (previous) return;
                clearCompletionTimer(record.id);
                // A completed transfer must remain readable instead of
                // disappearing between two React renders.
                const timer = setTimeout(() => {
                    removalTimers.delete(record.id);
                    completed.delete(record.id);
                    publish();
                }, 3000);
                timer.unref?.();
                removalTimers.set(record.id, timer);
            };
            return {
                get: () => snapshot,
                subscribe(listener) {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
                update(record) {
                    if (!record || typeof record.id !== "string") return;
                    if (record.state !== "downloading") {
                        recordCompletion(record);
                    } else {
                        clearCompletion(record.id);
                        const previous = items.get(record.id);
                        items.set(record.id, { ...previous, ...record, misses: 0 });
                        if (!previous || previous.receivedBytes !== record.receivedBytes) {
                            const time = Number(record.updatedAt) || Date.now();
                            const rows = [...(samples.get(record.id) ?? []), { time, bytes: record.receivedBytes }]
                                .filter((row) => time - row.time <= 2500)
                                .slice(-12);
                            samples.set(record.id, rows);
                        }
                    }
                    publish();
                },
                /** Replace the active set with one authoritative Host snapshot. */
                replace(records) {
                    const activeIds = new Set();
                    for (const record of Array.isArray(records) ? records : []) {
                        if (!record || typeof record.id !== "string") continue;
                        if (record.state !== "downloading") {
                            recordCompletion(record);
                            continue;
                        }
                        activeIds.add(record.id);
                        clearCompletion(record.id);
                        const previous = items.get(record.id);
                        items.set(record.id, { ...previous, ...record, misses: 0 });
                        if (!previous || previous.receivedBytes !== record.receivedBytes) {
                            const time = Number(record.updatedAt) || Date.now();
                            const rows = [...(samples.get(record.id) ?? []), { time, bytes: record.receivedBytes }]
                                .filter((row) => time - row.time <= 2500)
                                .slice(-12);
                            samples.set(record.id, rows);
                        }
                    }
                    for (const [id, item] of [...items]) {
                        if (activeIds.has(id)) continue;
                        const misses = (item.misses ?? 0) + 1;
                        if (misses < 2) {
                            items.set(id, { ...item, misses });
                        } else {
                            recordCompletion(item);
                        }
                    }
                    publish();
                },
                clear() {
                    items.clear();
                    samples.clear();
                    for (const timer of removalTimers.values()) clearTimeout(timer);
                    removalTimers.clear();
                    completed.clear();
                    publish();
                }
            };
        }

        function formatDownloadBytes(value) {
            const bytes = Number.isFinite(value) && value >= 0 ? value : 0;
            const units = ["B", "KB", "MB", "GB"];
            let size = bytes;
            let index = 0;
            while (size >= 1024 && index < units.length - 1) {
                size /= 1024;
                index += 1;
            }
            return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
        }

        function formatDownloadSpeed(value) {
            if (!Number.isFinite(value) || value < 0) return "计算中…";
            return `${formatDownloadBytes(value)}/s`;
        }

        function DownloadActivityCard({ store }) {
            const active = React.useSyncExternalStore(store.subscribe, store.get, store.get);
            if (active.length === 0) return null;
            const item = active[0];
            const completed = item.state === "completed";
            const statusText = completed ? "已完成" : formatDownloadSpeed(item.speed);
            const extension = item.extension || "文件";
            const stem = item.extension && item.filename.endsWith(item.extension)
                ? item.filename.slice(0, -item.extension.length)
                : item.filename;
            const percent = completed ? 100 : Number.isFinite(item.totalBytes) && item.totalBytes > 0
                ? Math.max(0, Math.min(100, item.receivedBytes * 100 / item.totalBytes))
                : null;
            return h("div", {
                role: "status",
                "aria-live": "polite",
                "aria-label": `${item.filename}，已下载 ${formatDownloadBytes(item.receivedBytes)}，${completed ? "下载完成" : statusText}`,
                style: {
                    boxSizing: "border-box",
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "min(360px, 44vw)",
                    minWidth: 240,
                    height: 36,
                    padding: "0 9px",
                    borderRadius: 8,
                    border: `1px solid ${THEME.border}`,
                    background: THEME.surface,
                    color: THEME.textSecondary,
                    fontSize: 12,
                    lineHeight: "15px",
                    whiteSpace: "nowrap"
                }
            },
            h("style", null, "@keyframes cockpit-download-indeterminate{from{transform:translateX(-110%)}to{transform:translateX(240%)}}.cockpit-download-indeterminate{animation:cockpit-download-indeterminate 1.15s linear infinite}@media(prefers-reduced-motion:reduce){.cockpit-download-indeterminate{animation:none}}"),
            h("span", {
                style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: THEME.text, fontWeight: 500 }
            }, stem),
            h("span", { style: { flex: "none", fontSize: 11, color: THEME.textSecondary } }, extension),
            h("span", {
                style: { flex: "none", width: 142, display: "flex", flexDirection: "column", alignItems: "stretch" }
            },
                h("span", { style: { height: 13, fontSize: 11, lineHeight: "13px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: THEME.textSecondary } }, `${formatDownloadBytes(item.receivedBytes)} · ${statusText}`),
                h("span", { style: { display: "block", height: 5, marginTop: 2, borderRadius: 999, overflow: "hidden", background: THEME.track } },
                    h("span", {
                        className: !completed && percent === null ? "cockpit-download-indeterminate" : "",
                        style: {
                            display: "block",
                            width: percent === null ? "45%" : `${percent}%`,
                            height: "100%",
                            borderRadius: 999,
                            background: THEME.accent,
                            transition: !completed && percent === null ? "none" : "width 160ms ease-out"
                        }
                    })
                )
            ),
            active.length > 1 ? h("span", { style: { flex: "none", fontSize: 11, color: THEME.textSecondary } }, `+${active.length - 1}`) : null
            );
        }

        const CLEANUP_ROUTE = "api/cockpit/empty-sessions";
        const DOWNLOAD_ROUTE = "api/cockpit/downloads";

        function EmptySessionCleanup({ t, getWorkspaceRegistry }) {
            const [state, setState] = React.useState({ phase: "idle", candidates: [], skipped: 0, error: "", result: null });

            const unavailable = () => Object.assign(new Error("cleanup route unavailable"), { routeUnavailable: true });
            const callRemote = async (method, input) => {
                let registry;
                try {
                    registry = getWorkspaceRegistry?.();
                } catch {
                    registry = undefined;
                }
                if (!registry || typeof registry[method] !== "function") throw unavailable();
                const response = input === void 0 ? await registry[method]() : await registry[method](input);
                if (response && response.ok === false) throw new Error(response.error?.message ?? `${method} failed`);
                return response && response.ok === true ? response.value : response;
            };
            const call = async (method, input) => {
                try {
                    const response = await fetch(CLEANUP_ROUTE, {
                        method: input === void 0 ? "GET" : "POST",
                        cache: "no-store",
                        headers: input === void 0
                            ? { accept: "application/json" }
                            : { accept: "application/json", "content-type": "application/json" },
                        ...input === void 0 ? {} : { body: JSON.stringify(input) }
                    });
                    if (response.status === 404 || response.status === 405) throw unavailable();
                    const payload = await response.json().catch(() => null);
                    if (!response.ok || !payload || payload.ok === false) {
                        throw new Error(payload?.error?.message ?? `cleanup request failed: HTTP ${response.status}`);
                    }
                    return payload.value;
                } catch (error) {
                    if (error?.routeUnavailable) return callRemote(method, input);
                    throw error;
                }
            };
            const preview = async () => {
                setState({ phase: "loading", candidates: [], skipped: 0, ghostCount: 0, emptyCount: 0, error: "", result: null });
                try {
                    const value = await call("previewEmptySessions");
                    const candidates = value.items;
                    const ghostCount = candidates.filter((item) => item.kind === "ghost").length;
                    const emptyCount = candidates.length - ghostCount;
                    setState({ phase: candidates.length > 0 ? "confirm" : "empty", candidates, skipped: value.skipped.length, ghostCount, emptyCount, error: "", result: null });
                } catch (error) {
                    setState({ phase: "error", candidates: [], skipped: 0, ghostCount: 0, emptyCount: 0, error: error instanceof Error ? error.message : String(error), result: null });
                }
            };
            const remove = async () => {
                setState((current) => ({ ...current, phase: "deleting", error: "" }));
                try {
                    const result = await call("deleteEmptySessions", { sessionIds: state.candidates.map((item) => item.sessionId) });
                    setState({ phase: "done", candidates: [], skipped: 0, ghostCount: 0, emptyCount: 0, error: "", result });
                } catch (error) {
                    setState((current) => ({ ...current, phase: "error", error: error instanceof Error ? error.message : String(error) }));
                }
            };
            const close = () => setState({ phase: "idle", candidates: [], skipped: 0, ghostCount: 0, emptyCount: 0, error: "", result: null });
            const busy = state.phase === "loading" || state.phase === "deleting";
            return h("span", { style: { position: "relative", display: "inline-flex" } },
                h("button", {
                    type: "button",
                    disabled: busy,
                    onClick: preview,
                    style: { ...ghostButtonStyle, padding: "4px 10px", fontSize: 12, opacity: busy ? 0.55 : 1 }
                }, busy ? "…" : t("emptyCleanup")),
                state.phase !== "idle" ? h("span", {
                    role: state.phase === "confirm" ? "alertdialog" : "status",
                    style: {
                        position: "absolute",
                        zIndex: 100,
                        top: "calc(100% + 8px)",
                        right: 0,
                        width: 300,
                        boxSizing: "border-box",
                        padding: 12,
                        borderRadius: 10,
                        border: `1px solid ${THEME.border}`,
                        background: THEME.surface,
                        boxShadow: "0 12px 32px rgba(0,0,0,.35)",
                        color: THEME.text,
                        fontSize: 12,
                        lineHeight: 1.6
                    }
                },
                state.phase === "loading" ? h("span", null, "…") : null,
                state.phase === "empty" ? h("span", null, t("emptyNone")) : null,
                state.phase === "confirm" ? h("span", null, t("emptyConfirm", { empty: state.emptyCount, ghost: state.ghostCount, skipped: state.skipped })) : null,
                state.phase === "deleting" ? h("span", null, "…") : null,
                state.phase === "done" ? h("span", null, t("emptyDeleteResult", {
                    deleted: state.result.deletedSessionIds.length,
                    skipped: state.result.skippedSessionIds.length,
                    failed: state.result.failures.length
                })) : null,
                state.phase === "error" ? h("span", null, `${t("emptyFailed")}${state.error}`) : null,
                h("span", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 } },
                    state.phase === "confirm" ? h("button", { type: "button", onClick: remove, style: { ...buttonStyle, padding: "5px 10px", fontSize: 12 } }, t("emptyDeleteConfirm")) : null,
                    h("button", { type: "button", onClick: close, style: { ...ghostButtonStyle, padding: "5px 10px", fontSize: 12 } }, t("cancel"))
                )) : null
            );
        }

        // -------------------------------------------------------------------
        // Styles (inline; the harness theme tokens are used when present).
        //
        // Only tokens that DSH actually defines may be referenced: an unknown
        // `var(--dsw-alias-…)` silently falls back, and a dark fallback on a
        // light page turns into dark-on-dark text. `--dsw-alias-bg-elevated`
        // and `--dsw-alias-bg-sunken` were exactly that trap. Fallbacks now use
        // system colours or translucent neutrals, which follow both themes.
        // -------------------------------------------------------------------
        const token = (name, fallback) => `var(${name}, ${fallback})`;
        const THEME = {
            surface: token("--dsw-alias-bg-module-platform", "rgba(127, 127, 127, 0.12)"),
            sunken: token("--dsw-alias-interactive-bg-hover", "rgba(127, 127, 127, 0.16)"),
            field: token("--dsw-specific-input-major", "Canvas"),
            border: token("--dsw-alias-border-l2", "rgba(127, 127, 127, 0.32)"),
            text: token("--dsw-alias-label-primary", "CanvasText"),
            textSecondary: token("--dsw-alias-label-secondary", "rgba(127, 127, 127, 0.95)"),
            track: token("--dsw-alias-interactive-bg-active", "rgba(127, 127, 127, 0.3)"),
            accent: token("--dsw-alias-state-business-primary", "#4176e6"),
            // State colours are tuned for fills and icons; as small text they
            // are too light on the light surface (warn ~2.6:1, success ~2.1:1).
            // Mixing 55% state colour with the theme's primary label keeps the
            // hue but lands above 4.5:1 on both themes (light #f5f6f7, dark
            // #353638); the mix direction follows the theme automatically.
            warnText: `color-mix(in srgb, ${token("--dsw-alias-state-warn-primary", "#f59e0b")} 55%, ${token("--dsw-alias-label-primary", "CanvasText")})`,
            dangerText: `color-mix(in srgb, ${token("--dsw-alias-state-error-primary", "#ec1313")} 55%, ${token("--dsw-alias-label-primary", "CanvasText")})`,
            successText: `color-mix(in srgb, ${token("--dsw-alias-state-success-primary", "#22c55e")} 55%, ${token("--dsw-alias-label-primary", "CanvasText")})`,
            onAccent: token("--dsw-alias-label-primary-foreground", "#fff"),
            shadow: token("--dsw-shadow-lv3", "0 0 1px rgba(0, 0, 0, 0.2), 0 12px 32px rgba(0, 0, 0, 0.12)")
        };
        const cardBase = {
            background: THEME.surface,
            color: THEME.text,
            border: `1px solid ${THEME.border}`,
            borderRadius: 14,
            boxShadow: THEME.shadow
        };

        const labelStyle = {
            fontSize: 12,
            color: THEME.textSecondary,
            marginBottom: 4
        };
        const inputStyle = {
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid " + THEME.border,
            background: THEME.field,
            color: THEME.text,
            fontSize: 13
        };
        const buttonStyle = {
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            background: token("--dsw-alias-button-primary-fill", "#4176e6"),
            color: THEME.onAccent,
            fontSize: 13,
            cursor: "pointer"
        };
        const ghostButtonStyle = {
            ...buttonStyle,
            background: "transparent",
            border: `1px solid ${THEME.border}`,
            color: THEME.text
        };

        // Right-aligned button above the composer card: it sends an ordinary
        // user message through the documented Session prompt API, exactly like
        // typing it and pressing Enter.
        /** Notices published by the Host snapshot route. */
        function createNoticeStore() {
            let value = Object.freeze([]);
            const listeners = new Set();
            const dismissed = new Set();
            const publish = () => {
                for (const listener of listeners) {
                    try {
                        listener();
                    } catch {
                        /* one bad view must not break notices */
                    }
                }
            };
            return {
                get: () => value,
                subscribe(listener) {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
                replace(notices) {
                    const next = (Array.isArray(notices) ? notices : [])
                        .filter((notice) => notice && typeof notice.id === "string" && !dismissed.has(notice.id))
                        .sort((left, right) => (left.at ?? 0) - (right.at ?? 0))
                        .map((notice) => Object.freeze({ ...notice }));
                    const previous = value;
                    if (previous.length === next.length
                        && previous.every((notice, index) => notice.id === next[index].id && notice.at === next[index].at)) return;
                    value = Object.freeze(next);
                    publish();
                },
                dismiss(id) {
                    if (typeof id !== "string") return;
                    dismissed.add(id);
                    if (dismissed.size > 1000) dismissed.clear();
                    value = Object.freeze(value.filter((notice) => notice.id !== id));
                    publish();
                },
                clear() {
                    value = Object.freeze([]);
                    publish();
                }
            };
        }

        /** User-facing Chinese reason shown immediately after the failure code. */
        function chineseFailureReason(notice) {
            const code = String(notice.code || "UNKNOWN").toUpperCase();
            const detail = String(notice.detail || notice.reason || "");
            if (/insufficient[ _-]?(?:balance|funds)|quota\s+(?:is\s+)?exhausted|usage\s+limit|free\s+quota|recharge|wallet|余额不足|额度(?:不足|耗尽|已用完)|钱包余额|充值后继续使用/iu.test(detail)) {
                return "账户额度不足或已用完";
            }
            const reasons = {
                TRANSPORT: "网络连接或传输中断",
                TIMEOUT: "模型请求超时",
                RATE_LIMIT: "模型服务暂时限流，请稍后重试",
                SERVER: "模型服务端暂时异常",
                EMPTY_RESPONSE: "模型未返回有效内容",
                QUOTA: "账户额度不足或已用完",
                AUTH: "模型认证失败，请检查登录状态或 API Key",
                AUTHENTICATION: "模型认证失败，请检查登录状态或 API Key",
                UNAUTHORIZED: "模型认证失败，请检查登录状态或 API Key",
                ACCOUNT: "账户或登录状态异常",
                SIGN_IN: "账户或登录状态异常",
                SIGNIN: "账户或登录状态异常",
                BAD_REQUEST: "请求参数不被当前模型接受",
                INVALID_REQUEST: "请求参数不被当前模型接受",
                UNKNOWN: "未知模型请求错误"
            };
            return reasons[code] ?? "模型请求失败，请查看日志了解详情";
        }

        // Inline notice: one slim row above the composer. Data arrives from the
        // Host snapshot route, never from an internal event relay.
        function AutoContinueDock({ store, t, sessionId }) {
            const notices = React.useSyncExternalStore(store.subscribe, store.get, store.get);
            const relevant = sessionId === undefined ? notices : notices.filter((notice) => notice.sessionId === sessionId);
            const notice = relevant[relevant.length - 1];
            if (!notice) return null;
            const retry = notice.kind === "retry";
            const accent = retry ? THEME.warnText : notice.kind === "blocked" ? THEME.accent : THEME.dangerText;
            const title = retry ? t("noticeRetry") : notice.kind === "halt" ? t("noticeHalt") : t("noticeBlocked");
            const reason = chineseFailureReason(notice);
            const detail = notice.code
                ? [
                    t("failureCode") + " ",
                    h("span", { key: "code", style: { color: THEME.dangerText, fontWeight: 600 } }, notice.code),
                    "：" + reason
                ]
                : [reason];
            if (notice.attempt !== undefined && notice.attempt !== null) detail.unshift(t("attempt", { attempt: notice.attempt, max: notice.max }), " · ");
            return h("div", {
                role: "status",
                "aria-live": "polite",
                style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "min(100%, 760px)",
                    boxSizing: "border-box",
                    margin: "0 auto 6px",
                    padding: "6px 10px",
                    borderRadius: 8,
                    borderLeft: "3px solid " + accent,
                    background: THEME.surface,
                    color: THEME.text,
                    fontSize: 12,
                    lineHeight: "18px",
                    boxShadow: THEME.shadow
                }
            },
            h("span", { style: { flex: "none", width: 7, height: 7, borderRadius: 999, background: accent } }),
            h("strong", { style: { flex: "none", color: THEME.text, fontWeight: 600 } }, title),
            h("span", { style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, detail),
            h("button", {
                type: "button",
                "aria-label": t("close"),
                onClick: () => store.dismiss(notice.id),
                style: { flex: "none", border: "none", background: "transparent", color: THEME.textSecondary, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }
            }, "×")
            );
        }

        // -------------------------------------------------------------------
        // Settings page: settings.plugins.tab. Provider-level retry budgets
        // belong to the official provider policy; this form only configures
        // the extra provider-independent layer.
        // -------------------------------------------------------------------
        const NUMERIC_FIELDS = [
            ["providerRetryMaxRetries", 0, 10, 1],
            ["delayMs", 0, 60000, 100]
        ];

        function pickValues(value) {
            const source = value && typeof value === "object" ? value : {};
            return {
                enabled: source.enabled === true,
                providerRetryMaxRetries: Number.isFinite(source.providerRetryMaxRetries) ? source.providerRetryMaxRetries : 3,
                delayMs: Number.isFinite(source.delayMs) ? source.delayMs : 1500,
                emitProminentError: source.emitProminentError !== false
            };
        }

        function SettingsPage({ t, settings }) {
            const [state, setState] = React.useState({ phase: "loading", view: null, draft: pickValues(undefined), error: null, available: [] });
            const [saveState, setSaveState] = React.useState("idle");

            const load = React.useCallback(async () => {
                setSaveState("idle");
                setState((current) => ({ ...current, phase: "loading", error: null }));
                try {
                    if (!settings || typeof settings.describe !== "function") {
                        setState({ phase: "unavailable", view: null, draft: pickValues(undefined), error: null, available: [] });
                        return;
                    }
                    const response = await settings.describe();
                    const described = response && response.ok === true ? response.value : response;
                    if (response && response.ok === false) throw new Error(response.error?.message ?? "settings.describe failed");
                    const namespaces = described?.namespaces ?? [];
                    const view = namespaces.find((entry) => entry.ns === "cockpit")
                        ?? namespaces.find((entry) => entry.ns === "include:cockpit")
                        ?? null;
                    setState({
                        phase: view ? "ready" : "unavailable",
                        view,
                        draft: pickValues(view?.value),
                        error: null,
                        available: namespaces.map((entry) => entry.ns).filter((ns) => typeof ns === "string")
                    });
                } catch (error) {
                    setState({ phase: "error", view: null, draft: pickValues(undefined), error: error instanceof Error ? error.message : String(error), available: [] });
                }
            }, [settings]);

            React.useEffect(() => {
                load();
            }, [load]);

            const set = (key, value) => {
                setSaveState("idle");
                setState((current) => ({ ...current, draft: { ...current.draft, [key]: value } }));
            };

            const save = async () => {
                if (!state.view || !settings || NUMERIC_FIELDS.some(([key]) => state.draft?.[key] === "")) return;
                setSaveState("saving");
                try {
                    const ops = [];
                    const current = pickValues(state.view.value);
                    for (const key of ["enabled", "emitProminentError", "providerRetryMaxRetries", "delayMs"]) {
                        if (state.draft[key] !== current[key]) ops.push({ op: "set", path: [key], value: state.draft[key] });
                    }
                    if (ops.length === 0) {
                        setSaveState("saved");
                        return;
                    }
                    const response = await settings.mutate(state.view.ns, ops, state.view.revision);
                    if (response && response.ok === false) throw new Error(response.error?.message ?? "settings.mutate failed");
                    const returned = response && response.ok === true ? response.value : response;
                    const view = returned && typeof returned === "object" && typeof returned.ns === "string"
                        ? returned
                        : {
                            ...state.view,
                            value: { ...state.view.value, ...state.draft },
                            revision: typeof returned?.revision === "number" ? returned.revision : state.view.revision + 1
                        };
                    setState({ phase: "ready", view, draft: pickValues(view.value), error: null, available: state.available });
                    setSaveState("saved");
                } catch (error) {
                    setSaveState("idle");
                    setState((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
                }
            };

            const draft = state.draft ?? pickValues(undefined);
            const busy = saveState === "saving";
            const incomplete = NUMERIC_FIELDS.some(([key]) => draft[key] === "");

            return h("section", { style: { maxWidth: 760, padding: "4px 2px 32px" } },
                h("h2", { style: { fontSize: 20, margin: "0 0 6px" } }, t("title")),
                h("p", { style: { margin: "0 0 18px", fontSize: 13, color: THEME.textSecondary } }, t("description")),
                state.phase === "loading" ? h("div", { style: { fontSize: 13 } }, t("loading")) : null,
                state.phase === "unavailable"
                    ? h("div", { style: { fontSize: 13, color: THEME.warnText, marginBottom: 8 } },
                        t("unavailable"),
                        state.available.length > 0
                            ? h("div", { style: { marginTop: 4, fontSize: 12, color: THEME.textSecondary } },
                                "已注册：" + state.available.join(", "))
                            : null)
                    : null,
                state.error ? h("div", { style: { fontSize: 13, color: THEME.dangerText, marginBottom: 12 } },
                    (state.phase === "error" ? t("loadFailed") : t("saveFailed")) + state.error) : null,
                state.phase === "ready" || state.phase === "unavailable"
                    ? h("div", { style: { ...cardBase, padding: "16px 18px", boxShadow: "none" } },
                        h("label", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 16, cursor: "pointer" } },
                            h("input", { type: "checkbox", checked: draft.enabled, onChange: (event) => set("enabled", event.target.checked) }),
                            h("span", { style: { fontSize: 14 } }, t("enabled"))
                        ),
                        h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 16 } },
                            NUMERIC_FIELDS.map(([key, min, max, step]) => h("label", { key, style: { display: "block" } },
                                h("div", { style: labelStyle }, t(key)),
                                h("input", {
                                    type: "number",
                                    min,
                                    max,
                                    step,
                                    value: draft[key],
                                    disabled: !draft.enabled,
                                    onChange: (event) => {
                                        const raw = event.target.value;
                                        set(key, raw === "" ? "" : Math.max(min, Math.min(max, Number(raw))));
                                    },
                                    onBlur: () => {
                                        if (draft[key] === "") set(key, min);
                                    },
                                    style: inputStyle
                                })
                            ))
                        ),
                        h("label", { style: { display: "flex", alignItems: "center", gap: 10, cursor: "pointer" } },
                            h("input", { type: "checkbox", checked: draft.emitProminentError, onChange: (event) => set("emitProminentError", event.target.checked) }),
                            h("span", { style: { fontSize: 13 } }, t("prominent"))
                        ),
                        h("div", { style: { marginTop: 14, fontSize: 12, lineHeight: 1.6, color: THEME.textSecondary } },
                            t("retryHint", { max: draft.providerRetryMaxRetries, delay: draft.delayMs }))
                    )
                    : null,
                h("div", { style: { display: "flex", gap: 10, marginTop: 16, alignItems: "center" } },
                    h("button", { type: "button", onClick: save, disabled: busy || incomplete || state.phase !== "ready", style: { ...buttonStyle, opacity: busy || incomplete || state.phase !== "ready" ? 0.55 : 1 } },
                        busy ? t("saving") : t("save")),
                    h("button", { type: "button", onClick: load, style: ghostButtonStyle }, t("reload")),
                    saveState === "saved" ? h("span", { style: { fontSize: 12, color: THEME.successText } }, t("saved")) : null
                )
            );
        }

        function CleanTempButton({ t, send }) {
            const [phase, setPhase] = React.useState({ status: "idle", error: "" });
            React.useEffect(() => {
                if (phase.status !== "sent" && phase.status !== "error") return undefined;
                const timer = setTimeout(() => setPhase({ status: "idle", error: "" }), 4000);
                return () => clearTimeout(timer);
            }, [phase.status]);
            const click = async () => {
                if (phase.status === "sending") return;
                setPhase({ status: "sending", error: "" });
                try {
                    const result = await send();
                    if (result && result.ok === false) throw new Error(result.error?.message ?? "send failed");
                    setPhase({ status: "sent", error: "" });
                } catch (error) {
                    setPhase({ status: "error", error: error instanceof Error ? error.message : String(error) });
                }
            };
            const label = phase.status === "sending" ? t("sending") : phase.status === "sent" ? t("sent") : t("cleanTemp");
            return h("div", {
                style: {
                    display: "flex",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    gap: 8,
                    // Match the composer card's width so the button sits over the
                    // card's right edge instead of the full conversation column.
                    width: "calc(100% - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px))",
                    maxWidth: "calc(var(--dsh-composer-card-max-width, 760px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px))",
                    margin: "0 auto",
                    boxSizing: "border-box"
                }
            },
            phase.status === "error" ? h("span", {
                role: "alert",
                style: { fontSize: 11, color: THEME.dangerText, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
            }, t("sendFailed") + phase.error) : null,
            h("button", {
                type: "button",
                "aria-label": t("cleanTempHint"),
                disabled: phase.status === "sending",
                onClick: click,
                style: {
                    ...ghostButtonStyle,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 48,
                    padding: "0 16px",
                    fontSize: 12,
                    lineHeight: "16px",
                    borderRadius: 999,
                    boxSizing: "border-box",
                    opacity: phase.status === "sending" ? 0.6 : 1
                }
            }, label)
            );
        }

        // Settings section: the empty-session cleanup used to live above the
        // auto-continue form. It is a first-class section now.
        function CleanupSection({ t, getWorkspaceRegistry }) {
            return h("section", { style: { maxWidth: 760, padding: "4px 2px 32px" } },
                h("h2", { style: { fontSize: 20, margin: "0 0 6px" } }, t("cleanupTitle")),
                h("p", { style: { margin: "0 0 18px", fontSize: 13, color: THEME.textSecondary } }, t("cleanupDescription")),
                h("div", {
                    style: {
                        ...cardBase,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: 16,
                        padding: "14px 16px",
                        boxShadow: "none"
                    }
                },
                h("div", { style: { flex: "1 1 260px", minWidth: 0 } },
                    h("div", { style: { fontSize: 14, fontWeight: 600, marginBottom: 4 } }, t("emptyCleanupTitle")),
                    h("div", { style: { fontSize: 12, lineHeight: 1.5, color: THEME.textSecondary } }, t("emptyCleanupDescription"))
                ),
                h(EmptySessionCleanup, { t, getWorkspaceRegistry })
                )
            );
        }

        // -------------------------------------------------------------------
        // Mount the archive client and the cockpit UI.
        // -------------------------------------------------------------------
        const apply = (ctx) => {
            try {
                const mod = require("@michengai/dsh-archive-manager");
                const archive = typeof mod?.startArchiveClient === "function"
                    ? mod.startArchiveClient(require)
                    : mod;
                if (archive === undefined || typeof archive.apply !== "function") {
                    throw new Error("archive-manager client did not expose a Cordis plugin");
                }
                ctx.plugin(archive);
            } catch (error) {
                console.warn("[dsh-cockpit] archive-manager client skipped:", error);
            }

            try {
                const noticeStore = createNoticeStore();
                const downloadStore = createDownloadStore();
                const cockpitUi = {
                    name: "cockpit-ui",
                    inject: ["slots", "locale", "remote", "remote.settings", "sessions"],
                    apply(uiCtx) {
                        uiCtx.effect(() => uiCtx.locale.register(NS, { zh: DICTS.zh, en: DICTS.en }), "dsh-cockpit: dictionaries");
                        const t = uiCtx.locale.bind(NS);
                        const getWorkspaceRegistry = () => {
                            try {
                                return uiCtx.remote?.workspaceRegistry;
                            } catch {
                                return undefined;
                            }
                        };

                        uiCtx.slots.inject("conversation.session.header.utilities", () => uiCtx.slots.register({
                            name: "conversation.session.header.utilities",
                            id: "cockpit-download-activity",
                            order: -6,
                            locale: NS,
                            inject: () => ({ store: downloadStore })
                        }, DownloadActivityCard));

                        uiCtx.slots.inject("conversation.input.dock", () => uiCtx.slots.register({
                            name: "conversation.input.dock",
                            id: "cockpit-clean-temp",
                            order: 80,
                            locale: NS,
                            inject: (sessionId) => ({ t, send: () => sendUserText(uiCtx.sessions, sessionId, CLEAN_TEMP_MESSAGE) })
                        }, CleanTempButton));

                        uiCtx.slots.inject("settings.section", () => uiCtx.slots.register({
                            name: "settings.section",
                            id: "cockpit-cleanup",
                            order: 46,
                            label: () => t("cleanupSection"),
                            icon: "archive",
                            locale: NS,
                            inject: () => ({ t, getWorkspaceRegistry })
                        }, CleanupSection));

                        const settings = uiCtx.remote?.settings;

                        uiCtx.slots.inject("conversation.input.dock", () => uiCtx.slots.register({
                            name: "conversation.input.dock",
                            id: "cockpit-auto-continue-notice",
                            order: 90,
                            locale: NS,
                            inject: (sessionId) => ({ store: noticeStore, t, sessionId })
                        }, AutoContinueDock));

                        uiCtx.slots.inject("settings.plugins.tab", () => uiCtx.slots.register({
                            name: "settings.plugins.tab",
                            id: "auto-continue",
                            order: 100,
                            label: () => t("tab"),
                            locale: NS,
                            inject: () => ({ t, settings })
                        }, SettingsPage));

                        try {
                            uiCtx.effect(() => {
                                if (typeof document === "undefined" || typeof fetch !== "function") return;
                                let stopped = false;
                                let timer;
                                const poll = async () => {
                                    try {
                                        const response = await fetch(AUTO_CONTINUE_ROUTE, {
                                            method: "GET",
                                            cache: "no-store",
                                            headers: { accept: "application/json" }
                                        });
                                        if (response.ok) {
                                            const payload = await response.json();
                                            noticeStore.replace(payload?.value?.notices);
                                        }
                                    } catch {
                                        /* the host route may be unavailable during startup */
                                    }
                                    if (!stopped) timer = setTimeout(poll, 1200);
                                };
                                poll();
                                return () => {
                                    stopped = true;
                                    clearTimeout(timer);
                                    noticeStore.clear();
                                };
                            }, "dsh-cockpit: auto-continue polling");
                        } catch (error) {
                            console.warn("[dsh-cockpit] auto-continue polling skipped:", error);
                        }

                        try {
                            uiCtx.effect(() => {
                                if (typeof document === "undefined" || typeof fetch !== "function") return;
                                let stopped = false;
                                let timer;
                                const poll = async () => {
                                    let delay = 1500;
                                    try {
                                        const response = await fetch(DOWNLOAD_ROUTE, {
                                            method: "GET",
                                            cache: "no-store",
                                            headers: { accept: "application/json" }
                                        });
                                        if (response.ok) {
                                            const payload = await response.json();
                                            const downloads = Array.isArray(payload?.value) ? payload.value : [];
                                            downloadStore.replace(downloads);
                                            delay = downloads.length > 0 ? 500 : 1500;
                                        }
                                    } catch {
                                        /* the event relay remains as the fallback */
                                    }
                                    if (!stopped) timer = setTimeout(poll, delay);
                                };
                                poll();
                                return () => {
                                    stopped = true;
                                    clearTimeout(timer);
                                    downloadStore.clear();
                                };
                            }, "dsh-cockpit: download progress polling");
                        } catch (error) {
                            console.warn("[dsh-cockpit] download polling skipped:", error);
                        }
                    }
                };
                ctx.plugin(cockpitUi);
            } catch (error) {
                console.warn("[dsh-cockpit] cockpit UI skipped:", error);
            }
        };

        exports.name = "cockpit";
        exports.inject = [];
        exports.apply = apply;
        return module.exports;
    }
});
