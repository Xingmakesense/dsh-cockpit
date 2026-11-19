        // One fixed-height row above the composer card: the left-aligned action
        // button and the current retry notice share the row, so a notice never
        // changes the stack height and can never push this row (or the official
        // scroll-to-bottom control) upward.
        function ComposerBar({ t, send, store, sessionId }) {
            const [phase, setPhase] = React.useState({ status: "idle", error: "" });
            const notices = React.useSyncExternalStore(store.subscribe, store.get, store.get);
            const relevant = sessionId === undefined ? notices : notices.filter((notice) => notice.sessionId === sessionId);
            const notice = relevant[relevant.length - 1];

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
            const retry = notice?.kind === "retry";
            const accent = retry ? THEME.warnText : notice?.kind === "blocked" ? THEME.accent : THEME.dangerText;
            const title = retry ? (notice?.phase === "extra" ? t("noticeExtra") : t("noticeRetry")) : notice?.kind === "halt" ? t("noticeHalt") : t("noticeBlocked");
            const reason = notice ? chineseFailureReason(notice) : "";
            const detail = notice && notice.code
                ? [
                    t("failureCode") + " ",
                    h("span", { key: "code", style: { color: THEME.dangerText, fontWeight: 600 } }, notice.code),
                    "：" + reason
                ]
                : [reason];
            if (notice && notice.attempt !== undefined && notice.attempt !== null) {
                detail.unshift(t("attempt", { attempt: notice.attempt, max: notice.max }), " · ");
            }

            const status = phase.status === "error"
                ? h("span", {
                    role: "alert",
                    style: {
                        flex: "1 1 auto",
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 11,
                        color: THEME.dangerText
                    }
                }, t("sendFailed") + phase.error)
                : notice
                    ? h("div", {
                        role: "status",
                        "aria-live": "polite",
                        style: {
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            flex: "1 1 auto",
                            minWidth: 0,
                            height: 26,
                            boxSizing: "border-box",
                            padding: "0 10px",
                            borderRadius: 999,
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
                    h("span", { style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" } }, detail),
                    h("button", {
                        type: "button",
                        "aria-label": t("close"),
                        onClick: () => store.dismiss(notice.id),
                        style: { flex: "none", border: "none", background: "transparent", color: THEME.textSecondary, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }
                    }, "×")
                    )
                    : null;

            return h("div", {
                style: {
                    display: "flex",
                    justifyContent: "flex-start",
                    alignItems: "center",
                    gap: 10,
                    // Match the composer card width so the row starts at the
                    // dialog's left edge instead of the conversation column.
                    width: "calc(100% - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-side-clearance, 16px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px))",
                    maxWidth: "calc(var(--dsh-composer-card-max-width, 760px) - var(--dsh-composer-dock-inset, 8px) - var(--dsh-composer-dock-inset, 8px))",
                    margin: "0 auto",
                    height: 32,
                    minHeight: 32,
                    boxSizing: "border-box"
                }
            },
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
                    height: 32,
                    padding: "0 12px",
                    fontSize: 14,
                    lineHeight: "20px",
                    fontWeight: 500,
                    borderRadius: 999,
                    boxSizing: "border-box",
                    flex: "none",
                    opacity: phase.status === "sending" ? 0.6 : 1
                }
            }, label),
            status
            );
        }
