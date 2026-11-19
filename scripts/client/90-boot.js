        // -------------------------------------------------------------------
        // Mount the archive client and the cockpit UI.
        // -------------------------------------------------------------------
        /** Whether the GUI tab currently runs in the background. */
        const tabHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

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
                            id: "cockpit-composer-bar",
                            order: 80,
                            locale: NS,
                            inject: (sessionId) => ({
                                t,
                                store: noticeStore,
                                sessionId,
                                send: () => sendUserText(uiCtx.sessions, sessionId, CLEAN_TEMP_MESSAGE)
                            })
                        }, ComposerBar));

                        // The archive page owns this child slot and renders it
                        // with its own props, including a translator bound to the
                        // archive namespace. Owner props win over the injected
                        // props, so cockpit copy is injected as "ct" to keep the
                        // cockpit dictionary; naming it "t" made the block fall
                        // back to raw keys such as "cleanupTitle".
                        uiCtx.slots.inject("archive-manager.cleanup", () => uiCtx.slots.register({
                            name: "archive-manager.cleanup",
                            id: "cockpit-cleanup",
                            locale: NS,
                            inject: () => ({ ct: t, getWorkspaceRegistry })
                        }, CleanupBlock));

                        const settings = uiCtx.remote?.settings;


                        uiCtx.slots.inject("settings.plugins.tab", () => uiCtx.slots.register({
                            name: "settings.plugins.tab",
                            id: "auto-continue",
                            order: 100,
                            label: () => t("tab"),
                            locale: NS,
                            inject: () => ({ t, settings })
                        }, SettingsPage));

                        // Full statistics page (host-side projection + aggregation).
                        uiCtx.slots.inject("settings.section", () => uiCtx.slots.register({
                            name: "settings.section",
                            id: "cockpit-statistics",
                            order: 120,
                            label: () => t("statsTab"),
                            locale: NS,
                            inject: () => ({ t })
                        }, StatisticsSection));

                        // Better Sidebar diagnostics tab. The peer is optional:
                        // the tab only appears when ctx.betterSidebar exists.
                        try {
                            uiCtx.inject(["betterSidebar"], (sidebarCtx) => {
                                const service = sidebarCtx.betterSidebar;
                                if (!service || typeof service.registerTab !== "function") return;
                                sidebarCtx.effect(() => service.registerTab(createDiagnosticsSidebar({ t, noticeStore, getWorkspaceRegistry })), "dsh-cockpit: diagnostics sidebar tab");
                            });
                        } catch (error) {
                            console.warn("[dsh-cockpit] diagnostics sidebar skipped:", error);
                        }

                        try {
                            uiCtx.effect(() => {
                                if (typeof document === "undefined" || typeof fetch !== "function") return;
                                let stopped = false;
                                let inFlight = false;
                                let timer;
                                const schedule = (delay) => {
                                    if (!stopped && !tabHidden()) timer = setTimeout(poll, delay);
                                };
                                const poll = async () => {
                                    timer = undefined;
                                    if (stopped || tabHidden()) return;
                                    inFlight = true;
                                    try {
                                        const response = await fetch(AUTO_CONTINUE_ROUTE, {
                                            method: "GET",
                                            cache: "no-store",
                                            headers: { accept: "application/json" }
                                        });
                                        if (stopped) return;
                                        if (response.ok) {
                                            const payload = await response.json();
                                            if (stopped) return;
                                            noticeStore.replace(payload?.value?.notices);
                                        }
                                    } catch {
                                        /* the host route may be unavailable during startup */
                                    } finally {
                                        inFlight = false;
                                    }
                                    schedule(1200);
                                };
                                // A background tab does no polling at all; becoming
                                // visible again fetches immediately.
                                const onVisibility = () => {
                                    if (tabHidden() || stopped || inFlight) return;
                                    if (timer !== undefined) clearTimeout(timer);
                                    poll();
                                };
                                document.addEventListener("visibilitychange", onVisibility);
                                poll();
                                return () => {
                                    stopped = true;
                                    clearTimeout(timer);
                                    document.removeEventListener("visibilitychange", onVisibility);
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
                                let inFlight = false;
                                let timer;
                                const schedule = (delay) => {
                                    if (!stopped && !tabHidden()) timer = setTimeout(poll, delay);
                                };
                                const poll = async () => {
                                    timer = undefined;
                                    if (stopped || tabHidden()) return;
                                    let delay = 1500;
                                    inFlight = true;
                                    try {
                                        const response = await fetch(DOWNLOAD_ROUTE, {
                                            method: "GET",
                                            cache: "no-store",
                                            headers: { accept: "application/json" }
                                        });
                                        if (stopped) return;
                                        if (response.ok) {
                                            const payload = await response.json();
                                            if (stopped) return;
                                            const downloads = Array.isArray(payload?.value) ? payload.value : [];
                                            downloadStore.replace(downloads);
                                            delay = downloads.length > 0 ? 500 : 1500;
                                        }
                                    } catch {
                                        /* the event relay remains as the fallback */
                                    } finally {
                                        inFlight = false;
                                    }
                                    schedule(delay);
                                };
                                // A background tab does no polling at all; becoming
                                // visible again fetches immediately.
                                const onVisibility = () => {
                                    if (tabHidden() || stopped || inFlight) return;
                                    if (timer !== undefined) clearTimeout(timer);
                                    poll();
                                };
                                document.addEventListener("visibilitychange", onVisibility);
                                poll();
                                return () => {
                                    stopped = true;
                                    clearTimeout(timer);
                                    document.removeEventListener("visibilitychange", onVisibility);
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
