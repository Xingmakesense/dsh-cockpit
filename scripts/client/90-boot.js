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

                        uiCtx.slots.inject("archive-manager.cleanup", () => uiCtx.slots.register({
                            name: "archive-manager.cleanup",
                            id: "cockpit-cleanup",
                            locale: NS,
                            inject: () => ({ t, getWorkspaceRegistry })
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
