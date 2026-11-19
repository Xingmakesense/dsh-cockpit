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

        // Compact cleanup block rendered at the top of the archive page.
        function CleanupBlock({ t, getWorkspaceRegistry }) {
            return h("div", {
                style: {
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    padding: "0 0 10px",
                    marginBottom: 10,
                    borderBottom: "1px solid " + THEME.border
                }
            },
            h("div", { style: { flex: "1 1 240px", minWidth: 0 } },
                h("div", { style: { fontSize: 13, fontWeight: 600, color: THEME.text, marginBottom: 2 } }, t("cleanupTitle")),
                h("div", { style: { fontSize: 12, lineHeight: 1.5, color: THEME.textSecondary } }, t("cleanupDescription"))
            ),
            h(EmptySessionCleanup, { t, getWorkspaceRegistry })
            );
        }
