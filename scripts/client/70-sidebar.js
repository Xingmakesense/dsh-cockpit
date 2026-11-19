        // -------------------------------------------------------------------
        // Better Sidebar tab: diagnostics only. The statistics page owns the
        // full picture; this tab answers "what went wrong" for one fix surface:
        // error sessions, tool errors, model failure reasons and the archive
        // layer's own session diagnosis/repair commands.
        // -------------------------------------------------------------------
        const SIDEBAR_TAB_ID = "cockpit-diagnostics";
        const SIDEBAR_EMPTY = Object.freeze([]);
        const sidebarSubscribeNone = () => () => {};
        const sidebarGetEmpty = () => SIDEBAR_EMPTY;

        function sidebarPanel(title, children, extra) {
            return h("div", { style: { ...cardBase, padding: "12px 14px", boxShadow: "none", marginBottom: 10 } },
                h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 } },
                    h("span", { style: { fontSize: 13, fontWeight: 700, color: THEME.text } }, title),
                    extra ?? null
                ),
                children
            );
        }

        function DiagnosticsTab({ scope, visible, t, noticeStore, getWorkspaceRegistry }) {
            const [stats, setStats] = React.useState({ phase: "idle", data: null, error: "" });
            const [target, setTarget] = React.useState(scope?.sessionId ?? "");
            const [diagnosis, setDiagnosis] = React.useState({ phase: "idle", value: null, error: "" });
            const [details, setDetails] = React.useState({ phase: "idle", value: null, error: "" });
            const [repair, setRepair] = React.useState({ phase: "idle", value: null, error: "" });
            const [reloadToken, setReloadToken] = React.useState(0);
            const notices = React.useSyncExternalStore(
                noticeStore?.subscribe ?? sidebarSubscribeNone,
                noticeStore?.get ?? sidebarGetEmpty,
                noticeStore?.get ?? sidebarGetEmpty
            );

            React.useEffect(() => {
                setTarget(scope?.sessionId ?? "");
            }, [scope?.sessionId]);

            React.useEffect(() => {
                if (!visible) return undefined;
                let active = true;
                setStats((current) => ({ ...current, phase: current.data ? "refreshing" : "loading", error: "" }));
                fetchCockpitStats({ range: "30", fields: "summary" })
                    .then((value) => {
                        if (active) setStats({ phase: "ready", data: value, error: "" });
                    })
                    .catch((error) => {
                        if (active) setStats({ phase: "error", data: null, error: error instanceof Error ? error.message : String(error) });
                    });
                return () => { active = false; };
            }, [visible, reloadToken]);

            const registry = () => {
                try {
                    return getWorkspaceRegistry?.();
                } catch {
                    return undefined;
                }
            };
            const callRegistry = async (method, input) => {
                const service = registry();
                if (!service || typeof service[method] !== "function") throw new Error(t("sidebarRegistryMissing"));
                const response = input === void 0 ? await service[method]() : await service[method](input);
                if (response && response.ok === false) throw new Error(response.error?.message ?? method + " failed");
                return response && response.ok === true ? response.value : response;
            };
            const runDiagnosis = async (sessionId) => {
                const id = String(sessionId ?? target ?? "").trim();
                if (!id) {
                    setDiagnosis({ phase: "error", value: null, error: t("diagNoTarget") });
                    return;
                }
                if (id !== target) setTarget(id);
                setDiagnosis({ phase: "running", value: null, error: "" });
                setRepair({ phase: "idle", value: null, error: "" });
                try {
                    const value = await callRegistry("diagnoseSession", { sessionId: id });
                    setDiagnosis({ phase: "ready", value, error: "" });
                } catch (error) {
                    setDiagnosis({ phase: "error", value: null, error: error instanceof Error ? error.message : String(error) });
                }
            };
            const runRepair = async () => {
                const value = diagnosis.value;
                if (!value?.sessionId || !value.token) return;
                setRepair({ phase: "running", value: null, error: "" });
                try {
                    const repaired = await callRegistry("repairSession", { sessionId: value.sessionId, token: value.token });
                    setRepair({ phase: "ready", value: repaired, error: "" });
                    setDiagnosis({ phase: "ready", value: { ...value, token: "", repairable: false, repaired: repaired?.repaired === true }, error: "" });
                } catch (error) {
                    setRepair({ phase: "error", value: null, error: error instanceof Error ? error.message : String(error) });
                }
            };
            const runDetails = async () => {
                const id = String(target ?? "").trim();
                if (!id) {
                    setDetails({ phase: "error", value: null, error: t("diagNoTarget") });
                    return;
                }
                setDetails({ phase: "running", value: null, error: "" });
                try {
                    const value = await callRegistry("sessionDetails", { sessionIds: [id] });
                    setDetails({ phase: "ready", value, error: "" });
                } catch (error) {
                    setDetails({ phase: "error", value: null, error: error instanceof Error ? error.message : String(error) });
                }
            };

            if (!visible) {
                return h("div", { style: { padding: 12, fontSize: 12, color: THEME.textSecondary } }, t("sidebarHidden"));
            }

            const summary = stats.data?.summary ?? null;
            const hostFailures = (Array.isArray(stats.data?.failures) ? stats.data.failures : []).map((failure) => ({
                id: failure.id,
                sessionId: failure.sessionId,
                kind: failure.kind === "retry" ? "retry" : "halt",
                code: failure.code,
                detail: failure.detail,
                at: failure.at
            }));
            const noticeFailures = (Array.isArray(notices) ? notices : [])
                .filter((notice) => notice && (notice.kind === "blocked" || notice.kind === "halt"))
                .map((notice) => ({
                    id: notice.id,
                    sessionId: notice.sessionId,
                    kind: notice.kind,
                    code: notice.code,
                    detail: notice.detail,
                    at: notice.at
                }));
            const seenFailures = new Set();
            const failureRows = [...hostFailures, ...noticeFailures]
                .filter((failure) => {
                    const key = String(failure.sessionId ?? "") + ":" + String(failure.code ?? "");
                    if (seenFailures.has(key)) return false;
                    seenFailures.add(key);
                    return true;
                })
                .sort((left, right) => (right.at ?? 0) - (left.at ?? 0))
                .slice(0, 10);

            return h("div", { style: { padding: "10px 10px 24px", color: THEME.text } },
                h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 } },
                    h("span", { style: { fontSize: 14, fontWeight: 700 } }, t("sidebarTitle")),
                    h("button", {
                        type: "button",
                        style: { ...ghostButtonStyle, padding: "3px 8px", fontSize: 11 },
                        onClick: () => setReloadToken((value) => value + 1)
                    }, stats.phase === "refreshing" ? t("refreshing") : t("refresh"))
                ),

                // Session diagnosis / repair: the archive layer owns both commands.
                sidebarPanel(t("diagTitle"), h("div", null,
                    h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" } },
                        h("input", {
                            type: "text",
                            value: target,
                            placeholder: t("diagPlaceholder"),
                            onChange: (event) => setTarget(event.target.value),
                            style: { ...inputStyle, flex: "1 1 180px", minWidth: 120, ...statsMono, fontSize: 11.5 }
                        }),
                        h("button", { type: "button", style: { ...buttonStyle, padding: "6px 10px", fontSize: 11.5 }, onClick: () => runDiagnosis(), disabled: diagnosis.phase === "running" },
                            diagnosis.phase === "running" ? t("diagRunning") : t("diagRun")),
                        h("button", { type: "button", style: { ...ghostButtonStyle, padding: "6px 10px", fontSize: 11.5 }, onClick: runDetails, disabled: details.phase === "running" },
                            details.phase === "running" ? "…" : t("diagDetailsButton"))
                    ),
                    h("div", { style: { marginTop: 5, fontSize: 11, color: THEME.textSecondary, lineHeight: 1.55 } }, t("diagHint")),
                    diagnosis.phase === "error" ? h("div", { role: "alert", style: { marginTop: 6, fontSize: 11.5, color: THEME.dangerText } }, diagnosis.error) : null,
                    diagnosis.phase === "ready" && diagnosis.value ? h("div", { style: { marginTop: 8, padding: "8px 10px", borderRadius: 8, background: THEME.sunken, fontSize: 11.5, lineHeight: 1.7 } },
                        h("div", null, t("diagCode") + "：" + String(diagnosis.value.code ?? "-") + (diagnosis.value.repairable ? " · " + t("diagRepairable") : "")),
                        diagnosis.value.reason ? h("div", null, t("diagReason") + "：" + diagnosis.value.reason) : null,
                        diagnosis.value.advice ? h("div", { style: { color: THEME.textSecondary } }, t("diagAdvice") + "：" + diagnosis.value.advice) : null,
                        diagnosis.value.count ? h("div", null, t("diagCount", { count: diagnosis.value.count })) : null,
                        diagnosis.value.token ? h("button", { type: "button", style: { ...buttonStyle, marginTop: 6, padding: "5px 10px", fontSize: 11.5 }, onClick: runRepair, disabled: repair.phase === "running" },
                            repair.phase === "running" ? t("diagRepairing") : t("diagRepair")) : null,
                        repair.phase === "error" ? h("div", { role: "alert", style: { marginTop: 6, color: THEME.dangerText } }, repair.error) : null,
                        repair.phase === "ready" && repair.value ? h("div", { style: { marginTop: 6, color: repair.value.repaired ? THEME.successText : THEME.warnText } },
                            t("diagRepairResult", { code: String(repair.value.code ?? "-") }) + (repair.value.reason ? "：" + repair.value.reason : "")) : null
                    ) : null,
                    details.phase === "error" ? h("div", { role: "alert", style: { marginTop: 6, fontSize: 11.5, color: THEME.dangerText } }, details.error) : null,
                    details.phase === "ready" && details.value?.items ? h("div", { style: { marginTop: 8, padding: "8px 10px", borderRadius: 8, background: THEME.sunken, fontSize: 11.5, lineHeight: 1.7 } },
                        details.value.items.map((item) => h("div", { key: item.sessionId },
                            h("div", { style: { ...statsMono, overflowWrap: "anywhere" } }, item.sessionId),
                            h("div", null, t("diagTurnCount", { count: item.turnCount ?? "-" }) + " · " + (item.path ? t("diagArtifact", { path: item.path }) : t("diagNoPath"))),
                            item.error ? h("div", { style: { color: THEME.dangerText } }, item.error) : null
                        ))
                    ) : null
                )),

                // Error sessions from the projection summary.
                sidebarPanel(t("errorSessionsTitle"), stats.phase === "loading"
                    ? h("div", { style: { fontSize: 12, color: THEME.textSecondary } }, t("statsLoading"))
                    : stats.phase === "error"
                        ? h("div", { role: "alert", style: { fontSize: 12, color: THEME.dangerText } }, stats.error)
                        : !summary?.errorSessions?.length
                            ? h("div", { style: { fontSize: 12, color: THEME.textSecondary } }, t("errorSessionsEmpty"))
                            : summary.errorSessions.map((row) => h("div", { key: row.sessionId, style: { padding: "6px 0", borderBottom: "1px solid " + THEME.border } },
                                h("div", { style: { ...statsMono, fontSize: 11, overflowWrap: "anywhere" } }, row.sessionId),
                                h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginTop: 3 } },
                                    h("span", { style: { fontSize: 11.5, color: THEME.textSecondary, whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" } }, row.model),
                                    h("span", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" } },
                                        row.toolErrors > 0 ? h("span", { style: { fontSize: 11, color: THEME.dangerText } }, t("statusErrors", { errors: row.toolErrors })) : null,
                                        row.retries > 0 ? h("span", { style: { fontSize: 11, color: THEME.warnText } }, t("statusRetry", { retries: row.retries })) : null,
                                        h("button", { type: "button", style: { ...ghostButtonStyle, padding: "2px 7px", fontSize: 10.5 }, onClick: () => runDiagnosis(row.sessionId) }, t("diagRun"))
                                    )
                                )
                            ))
                ),

                // Tool errors aggregated across sessions.
                sidebarPanel(t("toolErrorsTitle"), !summary?.toolErrors?.length
                    ? h("div", { style: { fontSize: 12, color: THEME.textSecondary } }, stats.phase === "ready" ? t("toolErrorsEmpty") : t("statsLoading"))
                    : summary.toolErrors.map((tool) => h("div", { key: tool.name, style: { padding: "5px 0", borderBottom: "1px solid " + THEME.border } },
                        h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8 } },
                            h("span", { style: { ...statsMono, fontSize: 11.5, whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" } }, tool.name),
                            h("span", { style: { flex: "none", fontSize: 11, color: THEME.dangerText } }, t("toolErrorCount", { errors: tool.errors }))
                        ),
                        h("div", { style: { fontSize: 11, color: THEME.textSecondary } }, t("toolCallsLine", { calls: tool.calls, sessions: tool.sessions }))
                    ))
                ),

                // Model failure reasons observed by the auto-continue layer.
                sidebarPanel(t("modelFailuresTitle"), failureRows.length === 0
                    ? h("div", { style: { fontSize: 12, color: THEME.textSecondary } }, t("modelFailuresEmpty"))
                    : failureRows.map((failure) => h("div", { key: failure.id, style: { padding: "6px 0", borderBottom: "1px solid " + THEME.border } },
                        h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8 } },
                            h("span", { style: { fontSize: 11.5, fontWeight: 600, color: failure.kind === "halt" ? THEME.dangerText : THEME.warnText } }, String(failure.code || "UNKNOWN")),
                            h("span", { style: { fontSize: 10.5, color: THEME.textSecondary } }, failure.kind === "halt" ? t("noticeHalt") : t("noticeRetry"))
                        ),
                        h("div", { style: { fontSize: 11.5, color: THEME.text, marginTop: 2 } }, chineseFailureReason(failure)),
                        failure.detail ? h("div", { style: { fontSize: 10.5, color: THEME.textSecondary, whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" } }, String(failure.detail).slice(0, 220)) : null,
                        failure.sessionId ? h("div", { style: { ...statsMono, fontSize: 10, color: THEME.textSecondary, overflowWrap: "anywhere" } }, failure.sessionId) : null
                    ))
                ),

                // Repeated-failure evidence recorded by the engine fold.
                sidebarPanel(t("findingsTitle"), !summary?.findings?.length
                    ? h("div", { style: { fontSize: 12, color: THEME.textSecondary } }, stats.phase === "ready" ? t("findingsEmpty") : t("statsLoading"))
                    : summary.findings.slice(0, 8).map((finding) => h("div", { key: finding.sessionId + ":" + finding.id, style: { padding: "5px 0", borderBottom: "1px solid " + THEME.border } },
                        h("div", { style: { fontSize: 11.5, fontWeight: 600, whiteSpace: "normal", overflowWrap: "anywhere" } }, finding.title),
                        h("div", { style: { fontSize: 10.5, color: THEME.textSecondary, whiteSpace: "normal", overflowWrap: "anywhere", wordBreak: "break-word" } }, finding.detail),
                        h("div", { style: { ...statsMono, fontSize: 10, color: THEME.textSecondary, overflowWrap: "anywhere" } }, finding.sessionId)
                    ))
                )
            );
        }

        /** Descriptor for ctx.betterSidebar.registerTab. */
        function createDiagnosticsSidebar({ t, noticeStore, getWorkspaceRegistry }) {
            return {
                id: SIDEBAR_TAB_ID,
                title: t("sidebarTitle"),
                single: true,
                order: 120,
                component: (props) => h(DiagnosticsTab, {
                    ...props,
                    t,
                    noticeStore,
                    getWorkspaceRegistry
                })
            };
        }
