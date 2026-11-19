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



        // -------------------------------------------------------------------
        // Settings page: settings.plugins.tab. Provider-level retry budgets
        // belong to the official provider policy; this form only configures
        // the extra provider-independent layer.
        // -------------------------------------------------------------------
        const NUMERIC_FIELDS = [
            ["providerRetryMaxRetries", 0, 10, 1],
            ["maxAttempts", 1, 50, 1],
            ["delayMs", 0, 60000, 100]
        ];

        function pickValues(value) {
            const source = value && typeof value === "object" ? value : {};
            return {
                enabled: source.enabled === true,
                providerRetryMaxRetries: Number.isFinite(source.providerRetryMaxRetries) ? source.providerRetryMaxRetries : 3,
                maxAttempts: Number.isFinite(source.maxAttempts) ? source.maxAttempts : 6,
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
                    for (const key of ["enabled", "emitProminentError", "providerRetryMaxRetries", "maxAttempts", "delayMs"]) {
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
            const total = (1 + Number(draft.providerRetryMaxRetries || 0)) * (1 + Number(draft.maxAttempts || 0));

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
                            t("retryHint", { provider: draft.providerRetryMaxRetries, max: draft.maxAttempts }))
                    )
                    : null,
                h("div", { style: { ...cardBase, marginTop: 16, padding: "16px 18px", boxShadow: "none", background: THEME.sunken } },
                    h("div", { style: { fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: THEME.textSecondary, marginBottom: 8 } }, t("formulaTitle")),
                    h("div", { style: { fontSize: 14, lineHeight: 1.7, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } },
                        h("div", null, t("formula", { provider: draft.providerRetryMaxRetries, max: draft.maxAttempts })),
                        h("div", { style: { marginTop: 6, color: THEME.textSecondary } },
                            "= (1 + " + draft.providerRetryMaxRetries + ") × (1 + " + draft.maxAttempts + ") = " + total),
                        h("div", { style: { marginTop: 6, fontSize: 20, fontWeight: 700 } }, total + " " + t("requestUnit"))
                    )
                ),
                h("div", { style: { display: "flex", gap: 10, marginTop: 16, alignItems: "center" } },
                    h("button", { type: "button", onClick: save, disabled: busy || incomplete || state.phase !== "ready", style: { ...buttonStyle, opacity: busy || incomplete || state.phase !== "ready" ? 0.55 : 1 } },
                        busy ? t("saving") : t("save")),
                    h("button", { type: "button", onClick: load, style: ghostButtonStyle }, t("reload")),
                    saveState === "saved" ? h("span", { style: { fontSize: 12, color: THEME.successText } }, t("saved")) : null
                )
            );
        }
