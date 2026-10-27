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
//   2. the cockpit UI: a centered auto-continue notice plus the auto-continue
//      settings page (`settings.plugins.tab`).
// ---------------------------------------------------------------------------
window.__ModuleLoader__.load({
    id: "dsh-cockpit",
    factory: (require) => {
        const module = { exports: {} };
        const exports = module.exports;
        const React = require("react");
        const h = React.createElement;

        const NS = "dsh-cockpit";
        const NOTICE_PREFIX = "【自动续轮";
        const DOWNLOAD_PREFIX = "【下载】";
        const NOTICE_TIMEOUT_MS = 9000;

        const DICTS = {
            zh: {
                tab: "自动续轮",
                title: "自动续轮",
                description: "请求失败后自动重新发起，不写入任何用户消息。",
                enabled: "启用自动续轮",
                maxAttempts: "最大续轮次数",
                delayMs: "续轮延迟（毫秒）",
                providerRetry: "单次请求额外重试",
                prominent: "显示自动续轮提示",
                formulaTitle: "总请求次数",
                formula: "（1 + 单次请求额外重试）×（1 + 续轮次数）",
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
                attempt: "第 {attempt}/{max} 次",
                registered: "已注册：",
                requestUnit: "次",
                emptyCleanup: "清除空对话",
                emptyNone: "没有可清理的空对话",
                emptyConfirm: "发现 {count} 个空对话，将永久删除（跳过 {skipped} 项）。此操作不可恢复。",
                emptyDeleteConfirm: "确认删除",
                emptyDeleteResult: "已删除 {deleted}，跳过 {skipped}，失败 {failed}",
                emptyFailed: "操作失败：",
                cancel: "取消",
            },
            en: {
                tab: "Auto-continue",
                title: "Auto-continue",
                description: "Re-issues a failed request automatically without writing any user message.",
                enabled: "Enable auto-continue",
                maxAttempts: "Max continuations",
                delayMs: "Delay (ms)",
                providerRetry: "Extra retries per request",
                prominent: "Show auto-continue notices",
                formulaTitle: "Total requests",
                formula: "(1 + extra retries) × (1 + continuations)",
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
                attempt: "Attempt {attempt}/{max}",
                registered: "Registered: ",
                requestUnit: "requests",
                emptyCleanup: "Clear empty chats",
                emptyNone: "No empty chats to clear",
                emptyConfirm: "{count} empty chats will be permanently deleted ({skipped} skipped). This cannot be undone.",
                emptyDeleteConfirm: "Delete permanently",
                emptyDeleteResult: "Deleted {deleted}, skipped {skipped}, failed {failed}",
                emptyFailed: "Operation failed: ",
                cancel: "Cancel",
            }
        };

        // -------------------------------------------------------------------
        // Small external store for the centered notice.
        // -------------------------------------------------------------------
        function createNoticeStore() {
            let value = null;
            let timer;
            const listeners = new Set();
            const publish = () => {
                for (const listener of listeners) {
                    try {
                        listener();
                    } catch {
                        /* a bad listener must not break the relay */
                    }
                }
            };
            return {
                get: () => value,
                subscribe(listener) {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
                show(notice) {
                    value = notice;
                    publish();
                    clearTimeout(timer);
                    if (notice.kind === "retry") {
                        timer = setTimeout(() => {
                            value = null;
                            publish();
                        }, NOTICE_TIMEOUT_MS);
                    }
                },
                close() {
                    clearTimeout(timer);
                    value = null;
                    publish();
                }
            };
        }

        function parseDownloadMessage(raw) {
            if (typeof raw !== "string" || !raw.startsWith(DOWNLOAD_PREFIX)) return null;
            try {
                const record = JSON.parse(raw.slice(DOWNLOAD_PREFIX.length));
                return record && typeof record.id === "string" ? record : null;
            } catch {
                return null;
            }
        }

        /** Active-download snapshots with short-window, byte-based speeds. */
        function createDownloadStore() {
            const items = new Map();
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
                snapshot = Object.freeze([...items.values()]
                    .sort((left, right) => left.startedAt - right.startedAt)
                    .map((item) => Object.freeze({ ...item, speed: speedOf(item.id) })));
                for (const listener of listeners) {
                    try {
                        listener();
                    } catch {
                        /* one bad view must not break download observation */
                    }
                }
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
                        items.delete(record.id);
                        samples.delete(record.id);
                    } else {
                        const previous = items.get(record.id);
                        items.set(record.id, { ...previous, ...record });
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
                clear() {
                    items.clear();
                    samples.clear();
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
            const extension = item.extension || "文件";
            const stem = item.extension && item.filename.endsWith(item.extension)
                ? item.filename.slice(0, -item.extension.length)
                : item.filename;
            const percent = Number.isFinite(item.totalBytes) && item.totalBytes > 0
                ? Math.max(0, Math.min(100, item.receivedBytes * 100 / item.totalBytes))
                : null;
            return h("div", {
                role: "status",
                "aria-live": "polite",
                "aria-label": `${item.filename}，已下载 ${formatDownloadBytes(item.receivedBytes)}，${formatDownloadSpeed(item.speed)}`,
                style: {
                    boxSizing: "border-box",
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "min(360px, 44vw)",
                    minWidth: 240,
                    height: 34,
                    padding: "0 8px",
                    borderRadius: 8,
                    border: `1px solid ${token("--dsw-alias-border-l2", "#3a3a40")}`,
                    background: token("--dsw-alias-bg-elevated", "#1c1c20"),
                    color: token("--dsw-alias-label-secondary", "#a1a1aa"),
                    fontSize: 11,
                    lineHeight: "14px",
                    whiteSpace: "nowrap"
                }
            },
            h("style", null, "@keyframes cockpit-download-indeterminate{from{transform:translateX(-110%)}to{transform:translateX(240%)}}.cockpit-download-indeterminate{animation:cockpit-download-indeterminate 1.15s linear infinite}@media(prefers-reduced-motion:reduce){.cockpit-download-indeterminate{animation:none}}"),
            h("span", {
                title: item.filename,
                style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: token("--dsw-alias-label-primary", "#f4f4f5") }
            }, stem),
            h("span", { style: { flex: "none", fontSize: 10, color: token("--dsw-alias-label-secondary", "#a1a1aa") } }, extension),
            h("span", {
                title: Number.isFinite(item.totalBytes) ? `${item.receivedBytes} / ${item.totalBytes} bytes` : `${item.receivedBytes} bytes`,
                style: { flex: "none", width: 142, display: "flex", flexDirection: "column", alignItems: "stretch" }
            },
                h("span", { style: { height: 12, fontSize: 10, lineHeight: "12px", textAlign: "right", fontVariantNumeric: "tabular-nums" } }, `${formatDownloadBytes(item.receivedBytes)} · ${formatDownloadSpeed(item.speed)}`),
                h("span", { style: { display: "block", height: 4, marginTop: 2, borderRadius: 999, overflow: "hidden", background: token("--dsw-alias-bg-sunken", "#121215") } },
                    h("span", {
                        className: percent === null ? "cockpit-download-indeterminate" : "",
                        style: {
                            display: "block",
                            width: percent === null ? "45%" : `${percent}%`,
                            height: "100%",
                            borderRadius: 999,
                            background: token("--dsw-alias-state-business-primary", "#4f7cff"),
                            transition: percent === null ? "none" : "width 160ms ease-out"
                        }
                    })
                )
            ),
            active.length > 1 ? h("span", { style: { flex: "none", fontSize: 10 } }, `+${active.length - 1}`) : null
            );
        }

        function EmptySessionCleanup({ t, workspaceRegistry }) {
            const [state, setState] = React.useState({ phase: "idle", candidates: [], skipped: 0, error: "", result: null });

            const call = async (method, input) => {
                if (!workspaceRegistry || typeof workspaceRegistry[method] !== "function") throw new Error("workspaceRegistry unavailable");
                const response = input === void 0 ? await workspaceRegistry[method]() : await workspaceRegistry[method](input);
                if (response && response.ok === false) throw new Error(response.error?.message ?? `${method} failed`);
                return response && response.ok === true ? response.value : response;
            };
            const preview = async () => {
                setState({ phase: "loading", candidates: [], skipped: 0, error: "", result: null });
                try {
                    const value = await call("previewEmptySessions");
                    setState({ phase: value.items.length > 0 ? "confirm" : "empty", candidates: value.items, skipped: value.skipped.length, error: "", result: null });
                } catch (error) {
                    setState({ phase: "error", candidates: [], skipped: 0, error: error instanceof Error ? error.message : String(error), result: null });
                }
            };
            const remove = async () => {
                setState((current) => ({ ...current, phase: "deleting", error: "" }));
                try {
                    const result = await call("deleteEmptySessions", { sessionIds: state.candidates.map((item) => item.sessionId) });
                    setState({ phase: "done", candidates: [], skipped: 0, error: "", result });
                } catch (error) {
                    setState((current) => ({ ...current, phase: "error", error: error instanceof Error ? error.message : String(error) }));
                }
            };
            const close = () => setState({ phase: "idle", candidates: [], skipped: 0, error: "", result: null });
            const busy = state.phase === "loading" || state.phase === "deleting";
            return h("span", { style: { position: "relative", display: "inline-flex" } },
                h("button", {
                    type: "button",
                    disabled: busy,
                    onClick: preview,
                    style: { ...ghostButtonStyle, padding: "4px 10px", fontSize: 12, opacity: busy ? 0.55 : 1 },
                    title: t("emptyCleanup")
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
                        border: `1px solid ${token("--dsw-alias-border-l2", "#3a3a40")}`,
                        background: token("--dsw-alias-bg-elevated", "#1c1c20"),
                        boxShadow: "0 12px 32px rgba(0,0,0,.35)",
                        color: token("--dsw-alias-label-primary", "#f4f4f5"),
                        fontSize: 12,
                        lineHeight: 1.6
                    }
                },
                state.phase === "loading" ? h("span", null, "…") : null,
                state.phase === "empty" ? h("span", null, t("emptyNone")) : null,
                state.phase === "confirm" ? h("span", null, t("emptyConfirm", { count: state.candidates.length, skipped: state.skipped })) : null,
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

        function parseNotice(raw, sessionId) {
            if (typeof raw !== "string" || !raw.startsWith(NOTICE_PREFIX)) return null;
            const fraction = raw.match(/第\s*(\d+)\s*\/\s*(\d+)\s*次/);
            const code = raw.match(/故障码\s*([A-Z0-9_]+)/);
            const reason = raw.match(/失败原因：([\s\S]*)$/);
            const kind = raw.includes("已停止") ? "halt" : raw.includes("未启动") ? "blocked" : "retry";
            return {
                sessionId,
                kind,
                attempt: fraction ? Number(fraction[1]) : null,
                max: fraction ? Number(fraction[2]) : null,
                code: code ? code[1] : null,
                reason: reason ? reason[1].trim() : null
            };
        }

        /** User-facing Chinese reason shown immediately after the failure code. */
        function chineseFailureReason(notice) {
            const code = String(notice.code || "UNKNOWN").toUpperCase();
            const detail = String(notice.reason || "");
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

        // -------------------------------------------------------------------
        // Styles (inline; the harness theme tokens are used when present).
        // -------------------------------------------------------------------
        const token = (name, fallback) => `var(${name}, ${fallback})`;
        const cardBase = {
            background: token("--dsw-alias-bg-elevated", "#1c1c20"),
            color: token("--dsw-alias-label-primary", "#f4f4f5"),
            border: `1px solid ${token("--dsw-alias-border-l2", "#3a3a40")}`,
            borderRadius: 14,
            boxShadow: "0 24px 64px rgba(0, 0, 0, 0.45)"
        };
        const labelStyle = {
            fontSize: 12,
            color: token("--dsw-alias-label-secondary", "#a1a1aa"),
            marginBottom: 4
        };
        const inputStyle = {
            width: "100%",
            boxSizing: "border-box",
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid ${token("--dsw-alias-border-l2", "#3a3a40")}`,
            background: token("--dsw-alias-bg-sunken", "#121215"),
            color: token("--dsw-alias-label-primary", "#f4f4f5"),
            fontSize: 13
        };
        const buttonStyle = {
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            background: token("--dsw-alias-state-business-primary", "#4f7cff"),
            color: "#fff",
            fontSize: 13,
            cursor: "pointer"
        };
        const ghostButtonStyle = {
            ...buttonStyle,
            background: "transparent",
            border: `1px solid ${token("--dsw-alias-border-l2", "#3a3a40")}`,
            color: token("--dsw-alias-label-primary", "#f4f4f5")
        };

        // Inline notice: one slim row in the conversation column (above the
        // composer), not a page-covering modal. No tooltip: the row itself
        // carries the whole summary, so hovering shows nothing extra.
        function AutoContinueDock({ store, t, sessionId }) {
            const notice = React.useSyncExternalStore(store.subscribe, store.get, store.get);
            if (!notice) return null;
            if (notice.sessionId !== undefined && sessionId !== undefined && notice.sessionId !== sessionId) return null;
            const retry = notice.kind === "retry";
            const accent = retry ? "#e8a33d" : notice.kind === "blocked" ? "#9a72ff" : "#ef5f5f";
            const title = retry ? t("noticeRetry") : notice.kind === "halt" ? t("noticeHalt") : t("noticeBlocked");
            const detail = [
                notice.attempt !== null ? t("attempt", { attempt: notice.attempt, max: notice.max }) : null,
                notice.code ? `${t("failureCode")} ${notice.code}：${chineseFailureReason(notice)}` : chineseFailureReason(notice)
            ].filter(Boolean).join(" · ");
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
                    borderLeft: `3px solid ${accent}`,
                    background: token("--dsw-alias-bg-elevated", "#1c1c20"),
                    color: token("--dsw-alias-label-secondary", "#a1a1aa"),
                    fontSize: 12,
                    lineHeight: "18px"
                }
            },
            h("span", { style: { flex: "none", width: 7, height: 7, borderRadius: 999, background: accent } }),
            h("strong", { style: { flex: "none", color: token("--dsw-alias-label-primary", "#f4f4f5"), fontWeight: 600 } }, title),
            h("span", { style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, detail),
            h("button", {
                type: "button",
                "aria-label": t("close"),
                onClick: () => store.close(),
                style: { flex: "none", border: "none", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }
            }, "×")
            );
        }

        // -------------------------------------------------------------------
        // Settings page: settings.plugins.tab
        // -------------------------------------------------------------------
        const NUMERIC_FIELDS = [
            ["maxAttempts", 1, 50, 1],
            ["delayMs", 0, 60000, 100],
            ["providerRetryMaxRetries", 0, 10, 1]
        ];

        function pickValues(value) {
            const source = value && typeof value === "object" ? value : {};
            return {
                enabled: source.enabled === true,
                maxAttempts: Number.isFinite(source.maxAttempts) ? source.maxAttempts : 6,
                delayMs: Number.isFinite(source.delayMs) ? source.delayMs : 1500,
                providerRetryMaxRetries: Number.isFinite(source.providerRetryMaxRetries) ? source.providerRetryMaxRetries : 0,
                emitProminentError: source.emitProminentError !== false
            };
        }

        function SettingsPage({ t, settings, workspaceRegistry }) {
            const [state, setState] = React.useState({ phase: "loading", view: null, draft: null, error: null, available: [] });
            const [saveState, setSaveState] = React.useState("idle");

            const load = React.useCallback(async () => {
                setSaveState("idle");
                setState((current) => ({ ...current, phase: "loading", error: null }));
                try {
                    // `ctx.remote.settings` is the Remote namespace service; the
                    // raw `ctx.get("remote")` object only carries `$on/$mount`.
                    if (!settings || typeof settings.describe !== "function") {
                        setState({ phase: "unavailable", view: null, draft: pickValues(undefined), error: null, available: [] });
                        return;
                    }
                    // Remote namespace methods answer with a RemoteResult
                    // ({ ok: true, value } / { ok: false, error }), not the raw
                    // view. Accept a bare view too so a future API can simplify.
                    const response = await settings.describe();
                    const described = response && response.ok === true ? response.value : response;
                    if (response && response.ok === false) {
                        throw new Error(response.error?.message ?? "settings.describe failed");
                    }
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
                    for (const key of ["enabled", "emitProminentError", "maxAttempts", "delayMs", "providerRetryMaxRetries"]) {
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
                    setState({ phase: "ready", view, draft: pickValues(view.value), error: null });
                    setSaveState("saved");
                } catch (error) {
                    setSaveState("idle");
                    setState((current) => ({ ...current, error: error instanceof Error ? error.message : String(error) }));
                }
            };

            const draft = state.draft ?? pickValues(undefined);
            const total = (1 + Number(draft.providerRetryMaxRetries || 0)) * (1 + Number(draft.maxAttempts || 0));
            const busy = saveState === "saving";
            const numericIncomplete = NUMERIC_FIELDS.some(([key]) => draft[key] === "");

            return h("section", { style: { maxWidth: 760, padding: "4px 2px 32px" } },
                h("h2", { style: { fontSize: 20, margin: "0 0 6px" } }, t("title")),
                h("p", { style: { margin: "0 0 18px", fontSize: 13, color: token("--dsw-alias-label-secondary", "#a1a1aa") } }, t("description")),
                h("div", { style: { display: "flex", justifyContent: "flex-end", margin: "0 0 16px" } },
                    h(EmptySessionCleanup, { t, workspaceRegistry })
                ),
                state.phase === "loading" ? h("div", { style: { fontSize: 13 } }, t("loading")) : null,
                state.phase === "unavailable"
                    ? h("div", { style: { fontSize: 13, color: "#e8a33d", marginBottom: 8 } },
                        t("unavailable"),
                        state.available.length > 0
                            ? h("div", { style: { marginTop: 4, fontSize: 12, color: token("--dsw-alias-label-tertiary", "#7c7c85") } },
                                `${t("registered")}${state.available.join(", ")}`)
                            : null)
                    : null,
                state.error ? h("div", { style: { fontSize: 13, color: "#ef5f5f", marginBottom: 12 } }, `${state.phase === "error" ? t("loadFailed") : t("saveFailed")}${state.error}`) : null,
                state.phase === "ready" || state.phase === "unavailable"
                    ? h("div", { style: { ...cardBase, padding: "16px 18px", boxShadow: "none" } },
                        h("label", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 16, cursor: "pointer" } },
                            h("input", { type: "checkbox", checked: draft.enabled, onChange: (event) => set("enabled", event.target.checked) }),
                            h("span", { style: { fontSize: 14 } }, t("enabled"))
                        ),
                        h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 16 } },
                            NUMERIC_FIELDS.map(([key, min, max, step]) => h("label", { key, style: { display: "block" } },
                                h("div", { style: labelStyle }, t(key === "providerRetryMaxRetries" ? "providerRetry" : key)),
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
                    )
                    : null,
                h("div", { style: { ...cardBase, marginTop: 16, padding: "16px 18px", boxShadow: "none", background: token("--dsw-alias-bg-sunken", "#121215") } },
                    h("div", { style: { fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: token("--dsw-alias-label-tertiary", "#7c7c85"), marginBottom: 8 } }, t("formulaTitle")),
                    h("div", { style: { fontSize: 14, lineHeight: 1.7, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } },
                        h("div", null, t("formula")),
                        h("div", { style: { marginTop: 6, color: token("--dsw-alias-label-secondary", "#a1a1aa") } },
                            `= (1 + ${draft.providerRetryMaxRetries}) × (1 + ${draft.maxAttempts}) = ${total}`),
                        h("div", { style: { marginTop: 6, fontSize: 20, fontWeight: 700 } }, `${total} ${t("requestUnit")}`)
                    )
                ),
                h("div", { style: { display: "flex", gap: 10, marginTop: 16, alignItems: "center" } },
                    h("button", { type: "button", onClick: save, disabled: busy || numericIncomplete || state.phase !== "ready", style: { ...buttonStyle, opacity: busy || numericIncomplete || state.phase !== "ready" ? 0.55 : 1 } },
                        busy ? t("saving") : t("save")),
                    h("button", { type: "button", onClick: load, style: ghostButtonStyle }, t("reload")),
                    saveState === "saved" ? h("span", { style: { fontSize: 12, color: "#4fbf7a" } }, t("saved")) : null
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
                    inject: ["slots", "locale", "remote", "remote.settings"],
                    apply(uiCtx) {
                        uiCtx.effect(() => uiCtx.locale.register(NS, { zh: DICTS.zh, en: DICTS.en }), "dsh-cockpit: dictionaries");
                        const t = uiCtx.locale.bind(NS);
                        // `ctx.remote` resolves the dotted `remote.settings`
                        // namespace accessor; `ctx.get("remote")` would only
                        // return the carrier service (no `.settings`).
                        const remote = uiCtx.remote;
                        const settings = remote?.settings;

                        if (remote && typeof remote.$on === "function") {
                            uiCtx.effect(() => {
                                const offNotices = remote.$on("api-session/error", (sessionId, message) => {
                                    const notice = parseNotice(message, sessionId);
                                    if (notice) noticeStore.show(notice);
                                    const download = parseDownloadMessage(message);
                                    if (download) downloadStore.update(download);
                                });
                                return () => {
                                    if (typeof offNotices === "function") offNotices();
                                    downloadStore.clear();
                                };
                            }, "dsh-cockpit: notice and download relays");
                        }

                        uiCtx.slots.inject("conversation.session.header.utilities", () => uiCtx.slots.register({
                            name: "conversation.session.header.utilities",
                            id: "cockpit-download-activity",
                            order: -6,
                            locale: NS,
                            inject: () => ({ store: downloadStore })
                        }, DownloadActivityCard));
                        uiCtx.slots.inject("conversation.input.dock", () => uiCtx.slots.register({
                            name: "conversation.input.dock",
                            id: "cockpit-auto-continue-notice",
                            order: 90,
                            locale: NS,
                            inject: () => ({ store: noticeStore, t })
                        }, AutoContinueDock));

                        uiCtx.slots.inject("settings.plugins.tab", () => uiCtx.slots.register({
                            name: "settings.plugins.tab",
                            id: "auto-continue",
                            order: 100,
                            label: () => t("tab"),
                            locale: NS,
                            inject: () => ({ t, settings, workspaceRegistry: remote?.workspaceRegistry })
                        }, SettingsPage));
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
