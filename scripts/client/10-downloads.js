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
