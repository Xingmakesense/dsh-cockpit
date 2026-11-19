// Client-bundle smoke test: evaluate client.js with a stub module loader and
// mount the cockpit UI against a fake Cordis client context. This catches
// registration mistakes (slot keys, ids, locale namespace) without a browser.
const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

function fakeReact() {
    return {
        createElement: (type, props, ...children) => ({
            type,
            props: { ...(props || {}), children: children.length <= 1 ? children[0] : children }
        }),
        useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
        useEffect: () => {},
        useCallback: (fn) => fn,
        useRef: (value) => ({ current: value }),
        useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot()
    };
}

function textOf(node) {
    if (node === null || node === void 0 || typeof node === "boolean") return "";
    if (Array.isArray(node)) return node.map(textOf).join("");
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (typeof node.type === "function") return textOf(node.type(node.props));
    return textOf(node.props?.children);
}

function findNode(node, predicate) {
    if (!node || typeof node !== "object") return undefined;
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findNode(child, predicate);
            if (found !== undefined) return found;
        }
        return undefined;
    }
    if (predicate(node)) return node;
    return findNode(node.props?.children, predicate);
}

function titledNodes(node, found = []) {
    if (!node || typeof node !== "object") return found;
    if (Array.isArray(node)) {
        for (const child of node) titledNodes(child, found);
        return found;
    }
    if (Object.hasOwn(node.props ?? {}, "title")) found.push(node);
    titledNodes(node.props?.children, found);
    return found;
}

function loadModules() {
    const modules = [];
    globalThis.window = { __ModuleLoader__: { load(mod) { modules.push(mod); } } };
    const code = readFileSync(join(__dirname, "client.js"), "utf8");
    vm.runInThisContext(code, { filename: "client.js" });
    return modules;
}

async function main() {
    const modules = loadModules();
    assert(modules.length === 2, `expected 2 client modules, got ${modules.length}`);
    assert(modules[0].id === "@michengai/dsh-archive-manager", "archive module id changed");
    assert(modules[1].id === "dsh-cockpit", "cockpit module id changed");

    const react = fakeReact();
    const archivePlugin = { name: "archive", inject: [], apply() {} };
    const requireStub = (id) => {
        if (id === "react") return react;
        if (id === "@michengai/dsh-archive-manager") {
            return { startArchiveClient: () => archivePlugin };
        }
        throw new Error(`unexpected require("${id}")`);
    };

    const mod = modules[1].factory(requireStub);
    assert(mod.name === "cockpit", "cockpit module must export its name");
    assert(typeof mod.apply === "function", "cockpit module must export apply");

    const plugins = [];
    const locales = [];
    const registrations = [];
    const prompts = [];
    const sessions = {
        binding(sessionId) {
            return {
                session: {
                    prompt: async (content, mode) => {
                        prompts.push({ sessionId, content, mode });
                        return { ok: true, value: { accepted: true } };
                    }
                }
            };
        }
    };
    const remote = {
        settings: {
            describe: async () => ({ namespaces: [] }),
            mutate: async () => ({ value: {}, revision: 1 })
        },
        workspaceRegistry: {
            previewEmptySessions: async () => ({ items: [], skipped: [] }),
            deleteEmptySessions: async () => ({ requestedSessionIds: [], deletedSessionIds: [], skippedSessionIds: [], failures: [] })
        }
    };
    const ctx = {
        plugin: (plugin) => plugins.push(plugin),
        remote,
        sessions,
        effect(fn) {
            const dispose = fn();
            return typeof dispose === "function" ? dispose : () => {};
        },
        locale: {
            register(ns, dicts) {
                locales.push({ ns, dicts });
                return () => {};
            },
            bind: (ns) => (key) => `${ns}.${key}`
        },
        slots: {
            inject(key, callback) {
                callback();
                return () => {};
            },
            register(definition, component) {
                registrations.push({ definition, component });
                return () => {};
            }
        },
        get(name) {
            return name === "remote" ? remote : name === "sessions" ? sessions : undefined;
        }
    };

    mod.apply(ctx);
    assert(plugins.length === 2, "cockpit must mount the archive plugin and the cockpit UI");
    assert(plugins[0] === archivePlugin, "archive plugin must be mounted first");

    const ui = plugins[1];
    assert(ui.name === "cockpit-ui", "cockpit UI plugin name changed");
    assert(
        Array.isArray(ui.inject)
        && ui.inject.includes("slots")
        && ui.inject.includes("remote")
        && ui.inject.includes("sessions"),
        "cockpit UI must inject slots/remote/sessions"
    );
    ui.apply(ctx);

    const locale = locales.find((entry) => entry.ns === "dsh-cockpit");
    assert(locale !== undefined, "cockpit locale namespace must be registered");
    for (const key of ["cleanupTitle", "cleanupDescription", "cleanTemp", "cleanTempHint", "emptyCleanup", "emptyDeleteConfirm", "tab", "noticeRetry", "noticeExtra", "noticeHalt", "noticeBlocked", "retryHint", "formulaTitle", "formula", "requestUnit", "maxAttempts", "providerRetryMaxRetries"]) {
        assert(typeof locale.dicts.zh[key] === "string" && typeof locale.dicts.en[key] === "string", `locale dictionaries need ${key}`);
    }


    // The retry notice shares the composer row; there is no separate dock row.
    assert(!registrations.some((entry) => entry.definition.id === "cockpit-auto-continue-notice"),
        "the notice must not register its own dock row");

    const settingsTab = registrations.find((entry) => entry.definition.name === "settings.plugins.tab");
    assert(settingsTab !== undefined, "auto-continue must register its settings tab");
    assert(settingsTab.definition.id === "auto-continue", "settings tab id changed");
    assert(settingsTab.definition.label() === "dsh-cockpit.tab", "settings tab label must be localized");
    const settingsProps = settingsTab.definition.inject();
    assert(typeof settingsProps.settings?.describe === "function", "settings tab must receive ctx.remote.settings");
    assert(titledNodes(settingsTab.component({ ...settingsProps, t: (key) => key })).length === 0, "the settings page must not use native title tooltips");
    assert(!registrations.some((entry) => entry.definition.name === "shell.overlay"), "the cockpit UI must not cover the frame");

    // Download card: same relay and theme tokens.
    const downloadCard = registrations.find((entry) => entry.definition.name === "conversation.session.header.utilities");
    assert(downloadCard !== undefined, "active downloads must register into the session header utilities");
    assert(downloadCard.definition.id === "cockpit-download-activity", "download card id changed");
    assert(downloadCard.definition.order === -6, "download card must stay left of the schedule catalog");
    const downloadStore = downloadCard.definition.inject().store;
    const progress = {
        id: "download-1",
        filename: "session.zip",
        extension: ".zip",
        receivedBytes: 512,
        totalBytes: 1024,
        state: "downloading",
        startedAt: 1,
        updatedAt: 1
    };
    downloadStore.replace([progress]);
    const cardTree = downloadCard.component({ store: downloadStore });
    for (const property of ["background", "color"]) {
        assert(String(cardTree.props.style[property]).startsWith("var(--dsw-"),
            `download card ${property} must come from a DSH theme token, got ${cardTree.props.style[property]}`);
    }
    assert(textOf(cardTree).includes("session"), "the download card must show the file stem");
    assert(titledNodes(cardTree).length === 0, "the download card must not use native title tooltips");
    downloadStore.clear();
    assert(downloadCard.component({ store: downloadStore }) === null, "cleared downloads must leave the active card");

    // Cleanup block: compact entry at the top of the archive page.
    const cleanup = registrations.find((entry) => entry.definition.name === "archive-manager.cleanup");
    assert(cleanup !== undefined, "empty-session cleanup must register into the archive page header");
    assert(cleanup.definition.id === "cockpit-cleanup", "cleanup block id changed");
    assert(!registrations.some((entry) => entry.definition.name === "settings.section"), "cleanup must not keep its own settings page");
    const cleanupProps = cleanup.definition.inject();
    assert(typeof cleanupProps.getWorkspaceRegistry === "function", "cleanup section must resolve the registry lazily");
    const cleanupTree = cleanup.component({ ...cleanupProps, t: (key) => key });
    assert(titledNodes(cleanupTree).length === 0, "the cleanup section must not use native title tooltips");
    const cleanupNode = findNode(cleanupTree, (node) => typeof node.type === "function" && node.type.name === "EmptySessionCleanup");
    assert(cleanupNode !== undefined, "cleanup component must be embedded in the archive page header");
    const cleanupView = cleanupNode.type(cleanupNode.props);
    const cleanupButton = findNode(cleanupView, (node) => node.type === "button" && textOf(node) === "emptyCleanup");
    assert(cleanupButton !== undefined, "cleanup button must be rendered");
    assert(!Object.hasOwn(cleanupButton.props, "title"), "cleanup button must not show a native hover tooltip");
    const realFetch = globalThis.fetch;
    let cleanupRequest;
    globalThis.fetch = async (url, init) => {
        cleanupRequest = { url, init };
        return { ok: true, status: 200, json: async () => ({ ok: true, value: { items: [], skipped: [] } }) };
    };
    try {
        await cleanupButton.props.onClick();
        assert(cleanupRequest?.url === "api/cockpit/empty-sessions" && cleanupRequest.init.method === "GET",
            "cleanup preview must use the same-origin GET route");
    } finally {
        globalThis.fetch = realFetch;
    }

    // Composer row: left-aligned button and the retry notice share one fixed-height row.
    const dock = registrations.find((entry) => entry.definition.name === "conversation.input.dock");
    assert(dock !== undefined, "the temporary-artifact button must register above the composer");
    assert(dock.definition.id === "cockpit-composer-bar", "composer row id changed");
    assert(dock.definition.order === 80, "composer row order changed");
    const dockProps = dock.definition.inject("session-1");
    assert(typeof dockProps.send === "function", "composer row must receive its send action");
    assert(dockProps.store !== undefined, "composer row must receive the notice store");
    dockProps.store.replace([{ id: "ac-1", sessionId: "session-1", kind: "retry", at: Date.now(), expiresAt: null, code: "TIMEOUT", detail: "timeout", attempt: 1, max: 2 }]);
    const buttonTree = dock.component({ ...dockProps, t: (key) => key });
    assert(titledNodes(buttonTree).length === 0, "the composer row must not use native title tooltips");
    assert(String(buttonTree.props.style?.maxWidth ?? "").includes("--dsh-composer-card-max-width"),
        "the composer row must match the composer card width");
    assert(buttonTree.props.style?.margin === "0 auto", "the composer row must be centered over the composer");
    assert(String(buttonTree.props.style?.justifyContent ?? "") === "flex-start", "the button must be left-aligned");
    assert(buttonTree.props.style?.height === 32, "the composer row must be 32px high (two thirds of 48px)");
    const dockButton = findNode(buttonTree, (node) => node.type === "button" && String(textOf(node)) === "cleanTemp");
    assert(dockButton !== undefined, "composer button must render");
    assert(dockButton.props.style?.height === 32, "the composer button height must be 32px");
    assert(dockButton.props.style?.padding === "0 12px", "the composer button must stay compact horizontally");
    assert(dockButton.props.style?.fontSize === 14, "the composer button label must stay readable at 14px");
    const noticeText = textOf(buttonTree);
    assert(noticeText.includes("TIMEOUT") && noticeText.includes("attempt"), "the retry notice must render inside the composer row");
    for (const property of ["border", "color"]) {
        assert(String(dockButton.props.style?.[property] ?? "").includes("var(--dsw-"),
            `composer button ${property} must come from a DSH theme token`);
    }
    await dockButton.props.onClick();
    assert(prompts.length === 1, "clicking the button must send exactly one user message");
    assert(prompts[0].sessionId === "session-1", "the message must target the current session");
    assert(prompts[0].mode === "queue", "the message must use the normal queue mode");
    assert(prompts[0].content.length === 1 && prompts[0].content[0].type === "text", "the message must be plain text");
    assert(prompts[0].content[0].text === "清理本项目的临时产物", "the message text must stay exact and unlocalized");

    console.log("all client UI checks passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
