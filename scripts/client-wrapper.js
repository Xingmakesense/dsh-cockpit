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
                emptyCleanup: "查看会话差异",
                emptyCleanupTitle: "会话差异诊断",
                emptyCleanupDescription: "只读列出磁盘日志、界面可见性和归档状态，不删除任何会话。",
                emptyNone: "没有发现磁盘会话日志",
                emptySummary: "共 {total} 条：未归档空白 {empty}，已归档空白 {archived}，其他受保护 {protected}。",
                emptyGhosts: "未归档、非当前的空白日志",
                emptyArchived: "已归档的空白会话",
                emptyProtected: "受保护或不可判定的会话",
                emptyReadonly: "以下均为只读诊断，不会删除或修改会话。",
                emptyCreated: "创建：",
                emptyEvents: "事件：",
                emptyWorkspace: "工作区：",
                emptyNoWorkspace: "未记录工作区路径",
                emptyUnknownTime: "时间未知",
                emptyFlags: "状态：",
                emptyCurrent: "当前打开",
                emptyCurrentUnknown: "当前状态未知",
                emptyLive: "已挂载",
                emptyRunning: "运行中",
                emptyArchivedFlag: "已归档",
                emptyNoSummary: "无 Host 摘要",
                emptyHidden: "界面可见性：",
                emptyVisible: "符合当前显示条件",
                "emptyReason.empty": "只有初始化事件",
                "emptyReason.content": "含真实内容或未知事件",
                "emptyReason.activity": "存在后台活动",
                "emptyReason.lineage": "fork、subagent 或继承日志",
                "emptyReason.live": "正在运行",
                "emptyReason.not-blank-summary": "摘要显示非空或运行中",
                "emptyReason.read-failed": "日志读取失败",
                "emptyReason.summary-missing": "没有 Host 摘要",
                "emptyReason.subagent": "子代理会话",
                "emptyReason.archived": "已归档且当前筛选不显示",
                "emptyReason.archived-filter": "当前筛选只显示已归档会话",
                "emptyReason.current": "当前打开的空会话",
                "emptyReason.blank": "非当前空会话，被主界面隐藏",
                "emptyReason.workspace-membership": "未通过工作区成员筛选",
                "emptyReason.visible": "符合当前显示条件",
                emptyFailed: "操作失败：",
                cancel: "关闭",
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
                emptyCleanup: "Inspect session differences",
                emptyCleanupTitle: "Session difference diagnostics",
                emptyCleanupDescription: "Read-only inventory of stored logs, UI visibility and archive state. Nothing is deleted.",
                emptyNone: "No stored session logs found",
                emptySummary: "{total} logs: {empty} unarchived blank, {archived} archived blank, {protected} protected or other.",
                emptyGhosts: "Unarchived, non-current blank logs",
                emptyArchived: "Archived blank sessions",
                emptyProtected: "Protected or indeterminate sessions",
                emptyReadonly: "Read-only diagnostics. No session is deleted or modified.",
                emptyCreated: "Created: ",
                emptyEvents: "Events: ",
                emptyWorkspace: "Workspace: ",
                emptyNoWorkspace: "No workspace path recorded",
                emptyUnknownTime: "Unknown time",
                emptyFlags: "State: ",
                emptyCurrent: "Current",
                emptyCurrentUnknown: "Current state unknown",
                emptyLive: "Attached",
                emptyRunning: "Running",
                emptyArchivedFlag: "Archived",
                emptyNoSummary: "No Host summary",
                emptyHidden: "UI visibility: ",
                emptyVisible: "Matches current visibility rules",
                "emptyReason.empty": "Initialization events only",
                "emptyReason.content": "Real content or unknown events",
                "emptyReason.activity": "Background activity",
                "emptyReason.lineage": "Fork, subagent or inherited log",
                "emptyReason.live": "Running",
                "emptyReason.not-blank-summary": "Summary is non-blank or running",
                "emptyReason.read-failed": "Log read failed",
                "emptyReason.summary-missing": "No Host summary",
                "emptyReason.subagent": "Subagent session",
                "emptyReason.archived": "Archived and excluded by the current filter",
                "emptyReason.archived-filter": "The current filter shows archived sessions only",
                "emptyReason.current": "Current blank session",
                "emptyReason.blank": "Non-current blank session hidden by the main UI",
                "emptyReason.workspace-membership": "Excluded by workspace membership",
                "emptyReason.visible": "Matches current visibility rules",
                emptyFailed: "Operation failed: ",
                cancel: "Close",
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
                title: item.filename,
                style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: THEME.text, fontWeight: 500 }
            }, stem),
            h("span", { style: { flex: "none", fontSize: 11, color: THEME.textSecondary } }, extension),
            h("span", {
                title: Number.isFinite(item.totalBytes) ? `${item.receivedBytes} / ${item.totalBytes} bytes` : `${item.receivedBytes} bytes`,
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

        function currentSessionFrom(services, id) {
            const sessions = services?.sessions;
            const list = services?.sessionList;
            if ((list?.byId?.[id]?.retainedBy?.mainView ?? 0) > 0) return true;
            try {
                const source = sessions?.retainInfo?.(id);
                const value = source && typeof source.getSnapshot === "function" ? source.getSnapshot() : source;
                if ((value?.retainedBy?.mainView ?? 0) > 0) return true;
            } catch {
                // A missing optional visibility service must not fail the inventory.
            }
            return list?.current === id ? true : services?.currentKnown === true ? false : null;
        }

        function diagnosticVisibility(item, services) {
            const current = currentSessionFrom(services, item.sessionId);
            const archivedFilter = services?.archivedFilter ?? "default";
            const showsArchived = archivedFilter === "show" || item.archived && archivedFilter === "only";
            const hidesUnarchived = archivedFilter === "only";
            const subagent = item.origin === "subagent";
            const workspaceVisible = !services?.workspaceFilterKnown
                || services.accountedSessionIds.has(item.sessionId) !== true
                || services.visibleWorkspaceSessionIds.has(item.sessionId) === true;
            const hiddenReason = current === true ? "current"
                : !item.hasSummary ? "summary-missing"
                : subagent ? "subagent"
                : item.archived ? showsArchived ? null : "archived"
                : hidesUnarchived ? "archived-filter"
                : !workspaceVisible ? "workspace-membership"
                : item.blank === true ? "blank"
                : null;
            const protectedReason = item.reason === "content" || item.reason === "lineage"
                || item.reason === "activity" || item.reason === "live" || item.reason === "not-blank-summary";
            const category = current !== false ? "protected"
                : item.empty && !item.archived ? "ghost"
                : item.empty && item.archived ? "archived"
                : "protected";
            return {
                ...item,
                current,
                category,
                hiddenReason,
                displayVisible: hiddenReason === null && item.hasSummary,
                classification: protectedReason ? item.reason : hiddenReason ?? item.reason
            };
        }

        function formatDiagnosticTime(value, locale) {
            return Number.isFinite(value) ? new Date(value).toLocaleString(locale === "en" ? "en-US" : "zh-CN") : null;
        }

        function DiagnosticRow({ item, t, locale }) {
            const flags = [
                item.current === true ? t("emptyCurrent") : item.current === null ? t("emptyCurrentUnknown") : null,
                item.live ? t("emptyLive") : null,
                item.running ? t("emptyRunning") : null,
                item.archived ? t("emptyArchivedFlag") : null,
                !item.hasSummary ? t("emptyNoSummary") : null
            ].filter(Boolean).join(" · ");
            const time = formatDiagnosticTime(item.createdAt, locale) ?? t("emptyUnknownTime");
            const reason = t(`emptyReason.${item.classification}`) === `dsh-cockpit.emptyReason.${item.classification}`
                ? item.classification : t(`emptyReason.${item.classification}`);
            return h("article", { style: { padding: "9px 0", borderBottom: `1px solid ${THEME.border}`, overflowWrap: "anywhere" } },
                h("div", { style: { color: THEME.text, fontWeight: 600 } }, reason),
                h("div", { style: { color: THEME.textSecondary, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", userSelect: "text" } }, item.sessionId),
                h("div", { style: { color: THEME.textSecondary } }, `${t("emptyCreated")}${time} · ${t("emptyEvents")}${item.eventCount ?? "?"}`),
                h("div", { style: { color: THEME.textSecondary, userSelect: "text" } }, `${t("emptyWorkspace")}${item.cwd ?? t("emptyNoWorkspace")}`),
                h("div", { style: { color: THEME.textSecondary } }, `${t("emptyFlags")}${flags || "—"}`),
                h("div", { style: { color: THEME.textSecondary } },
                    `${t("emptyHidden")}${item.hiddenReason ? t(`emptyReason.${item.hiddenReason}`) : t("emptyVisible")}`),
                item.parentSessionId ? h("div", { style: { color: THEME.textSecondary, userSelect: "text" } }, `parentSession: ${item.parentSessionId}`) : null,
                item.origin ? h("div", { style: { color: THEME.textSecondary } }, `origin: ${item.origin}`) : null,
                item.error ? h("div", { style: { color: THEME.dangerText } }, item.error) : null
            );
        }

        function EmptySessionCleanup({ t, getWorkspaceRegistry, getDiagnosticServices, locale }) {
            const [state, setState] = React.useState({ phase: "idle", diagnostics: [], error: "" });

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
                setState({ phase: "loading", diagnostics: [], error: "" });
                try {
                    const value = await call("previewEmptySessions");
                    let services = {};
                    try {
                        services = getDiagnosticServices?.() ?? {};
                    } catch {
                        // The Host inventory remains useful if optional UI stores are absent.
                    }
                    const diagnostics = (value.diagnostics ?? []).map((item) => diagnosticVisibility(item, services));
                    setState({ phase: diagnostics.length > 0 ? "ready" : "empty", diagnostics, error: "" });
                } catch (error) {
                    setState({ phase: "error", diagnostics: [], error: error instanceof Error ? error.message : String(error) });
                }
            };
            const close = () => setState({ phase: "idle", diagnostics: [], error: "" });
            const busy = state.phase === "loading";
            const groups = [
                ["ghost", t("emptyGhosts")],
                ["archived", t("emptyArchived")],
                ["protected", t("emptyProtected")]
            ].map(([category, label]) => ({ category, label, items: state.diagnostics.filter((item) => item.category === category) }));
            const ghosts = groups[0].items.length;
            const archived = groups[1].items.length;
            const other = groups[2].items.length;
            return h("span", { style: { position: "relative", display: "inline-flex" } },
                h("button", {
                    type: "button",
                    disabled: busy,
                    onClick: preview,
                    style: { ...ghostButtonStyle, padding: "4px 10px", fontSize: 12, opacity: busy ? 0.55 : 1 }
                }, busy ? "…" : t("emptyCleanup")),
                state.phase !== "idle" ? h("span", {
                    role: "dialog",
                    "aria-label": t("emptyCleanupTitle"),
                    style: {
                        position: "absolute",
                        zIndex: 100,
                        top: "calc(100% + 8px)",
                        right: 0,
                        width: "min(680px, calc(100vw - 40px))",
                        maxHeight: "min(720px, calc(100vh - 100px))",
                        overflowY: "auto",
                        boxSizing: "border-box",
                        padding: 14,
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
                state.phase === "ready" ? h("div", null,
                    h("p", { style: { margin: "0 0 8px", color: THEME.textSecondary } }, t("emptySummary", { total: state.diagnostics.length, empty: ghosts, archived, protected: other })),
                    h("p", { style: { margin: "0 0 12px", color: THEME.textSecondary } }, t("emptyReadonly")),
                    groups.filter((group) => group.items.length > 0).map((group) => h("section", { key: group.category, style: { marginBottom: 16 } },
                        h("h3", { style: { margin: "0 0 4px", fontSize: 14, color: THEME.text } }, `${group.label}（${group.items.length}）`),
                        group.items.map((item) => h(DiagnosticRow, { key: item.sessionId, item, t, locale }))
                    ))
                ) : null,
                state.phase === "error" ? h("span", null, `${t("emptyFailed")}${state.error}`) : null,
                h("span", { style: { display: "flex", justifyContent: "flex-end", marginTop: 10 } },
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
            border: `1px solid ${THEME.border}`,
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

        // Inline notice: one slim row in the conversation column (above the
        // composer), not a page-covering modal. No tooltip: the row itself
        // carries the whole summary, so hovering shows nothing extra.
        function AutoContinueDock({ store, t, sessionId }) {
            const notice = React.useSyncExternalStore(store.subscribe, store.get, store.get);
            if (!notice) return null;
            if (notice.sessionId !== undefined && sessionId !== undefined && notice.sessionId !== sessionId) return null;
            const retry = notice.kind === "retry";
            const accent = retry ? THEME.warnText : notice.kind === "blocked" ? THEME.accent : THEME.dangerText;
            const title = retry ? t("noticeRetry") : notice.kind === "halt" ? t("noticeHalt") : t("noticeBlocked");
            const reason = chineseFailureReason(notice);
            const detail = notice.code
                ? [
                    `${t("failureCode")} `,
                    h("span", { key: "code", style: { color: THEME.dangerText, fontWeight: 600 } }, notice.code),
                    `：${reason}`
                ]
                : [reason];
            if (notice.attempt !== null) detail.unshift(t("attempt", { attempt: notice.attempt, max: notice.max }), " · ");
            // The notice follows the DSH theme instead of pinning black on
            // white: a fixed black bar was unreadable-on-dark and clashed with
            // the light theme. The accent stripe/dot still marks severity.
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
                onClick: () => store.close(),
                style: { flex: "none", border: "none", background: "transparent", color: THEME.textSecondary, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }
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

        function SettingsPage({ t, settings, getWorkspaceRegistry, getDiagnosticServices, locale }) {
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
                h("p", { style: { margin: "0 0 18px", fontSize: 13, color: THEME.textSecondary } }, t("description")),
                h("div", {
                    style: {
                        ...cardBase,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: 16,
                        marginBottom: 16,
                        padding: "14px 16px",
                        boxShadow: "none"
                    }
                },
                h("div", { style: { flex: "1 1 260px", minWidth: 0 } },
                    h("div", { style: { fontSize: 14, fontWeight: 600, marginBottom: 4 } }, t("emptyCleanupTitle")),
                    h("div", { style: { fontSize: 12, lineHeight: 1.5, color: THEME.textSecondary } }, t("emptyCleanupDescription"))
                ),
                h(EmptySessionCleanup, { t, getWorkspaceRegistry, getDiagnosticServices, locale })
                ),
                state.phase === "loading" ? h("div", { style: { fontSize: 13 } }, t("loading")) : null,
                state.phase === "unavailable"
                    ? h("div", { style: { fontSize: 13, color: THEME.warnText, marginBottom: 8 } },
                        t("unavailable"),
                        state.available.length > 0
                            ? h("div", { style: { marginTop: 4, fontSize: 12, color: THEME.textSecondary } },
                                `${t("registered")}${state.available.join(", ")}`)
                            : null)
                    : null,
                state.error ? h("div", { style: { fontSize: 13, color: THEME.dangerText, marginBottom: 12 } }, `${state.phase === "error" ? t("loadFailed") : t("saveFailed")}${state.error}`) : null,
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
                h("div", { style: { ...cardBase, marginTop: 16, padding: "16px 18px", boxShadow: "none", background: THEME.sunken } },
                    h("div", { style: { fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: THEME.textSecondary, marginBottom: 8 } }, t("formulaTitle")),
                    h("div", { style: { fontSize: 14, lineHeight: 1.7, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } },
                        h("div", null, t("formula")),
                        h("div", { style: { marginTop: 6, color: THEME.textSecondary } },
                            `= (1 + ${draft.providerRetryMaxRetries}) × (1 + ${draft.maxAttempts}) = ${total}`),
                        h("div", { style: { marginTop: 6, fontSize: 20, fontWeight: 700 } }, `${total} ${t("requestUnit")}`)
                    )
                ),
                h("div", { style: { display: "flex", gap: 10, marginTop: 16, alignItems: "center" } },
                    h("button", { type: "button", onClick: save, disabled: busy || numericIncomplete || state.phase !== "ready", style: { ...buttonStyle, opacity: busy || numericIncomplete || state.phase !== "ready" ? 0.55 : 1 } },
                        busy ? t("saving") : t("save")),
                    h("button", { type: "button", onClick: load, style: ghostButtonStyle }, t("reload")),
                    saveState === "saved" ? h("span", { style: { fontSize: 12, color: THEME.successText } }, t("saved")) : null
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
                        const getWorkspaceRegistry = () => {
                            try {
                                return uiCtx.remote?.workspaceRegistry;
                            } catch {
                                return undefined;
                            }
                        };
                        const getDiagnosticServices = () => {
                            let sessions;
                            let workspaces;
                            let sessionList;
                            let workspaceSnapshot;
                            let currentKnown = false;
                            try {
                                sessions = uiCtx.get("sessions");
                                sessionList = sessions?.list?.getSnapshot?.();
                                currentKnown = sessionList !== void 0;
                            } catch {
                                // Unknown current-session state must stay protected.
                            }
                            try {
                                workspaces = uiCtx.get("workspaces");
                                workspaceSnapshot = workspaces?.list?.getSnapshot?.();
                            } catch {
                                // Workspace bookkeeping is optional diagnostic evidence.
                            }
                            let archivedFilter = "default";
                            try {
                                const registration = uiCtx.slots.entries("sidebar.workspaces")
                                    .find((entry) => entry.store && typeof entry.store.create === "function");
                                archivedFilter = registration?.store.create().getSnapshot()?.archivedFilter ?? "default";
                            } catch {
                                // Use DSH's default archived visibility when the view store is unavailable.
                            }
                            return {
                                sessions,
                                sessionList,
                                archivedFilter,
                                workspaceFilterKnown: workspaceSnapshot !== void 0,
                                currentKnown,
                                accountedSessionIds: new Set((workspaceSnapshot?.items ?? []).flatMap((workspace) => workspace.sessionIds ?? [])),
                                visibleWorkspaceSessionIds: new Set((workspaceSnapshot?.items ?? []).flatMap((workspace) => workspace.sessionIds ?? []))
                            };
                        };

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
                            inject: () => ({ t, settings, getWorkspaceRegistry, getDiagnosticServices, locale: typeof document !== "undefined" && document.documentElement.lang.toLowerCase().startsWith("en") ? "en" : "zh" })
                        }, SettingsPage));

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
