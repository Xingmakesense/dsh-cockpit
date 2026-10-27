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
        useState: (initial) => [initial, () => {}],
        useEffect: () => {},
        useCallback: (fn) => fn,
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
    const effects = [];
    const locales = [];
    const registrations = [];
    const subscribed = [];
    const remote = {
        settings: {
            describe: async () => ({ namespaces: [] }),
            mutate: async () => ({ value: {}, revision: 1 })
        },
        workspaceRegistry: {
            previewEmptySessions: async () => ({ items: [], skipped: [] }),
            deleteEmptySessions: async () => ({ requestedSessionIds: [], deletedSessionIds: [], skippedSessionIds: [], failures: [] })
        },
        $on(event, handler) {
            subscribed.push({ event, handler });
            return () => {};
        }
    };
    const ctx = {
        plugin: (plugin) => plugins.push(plugin),
        remote,
        effect(fn, label) {
            const dispose = fn();
            effects.push({ label, dispose });
            return dispose;
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
            return name === "remote" ? remote : undefined;
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
        && ui.inject.includes("remote.settings"),
        "cockpit UI must inject slots/remote/remote.settings"
    );
    ui.apply(ctx);

    const locale = locales.find((entry) => entry.ns === "dsh-cockpit");
    assert(locale !== undefined, "cockpit locale namespace must be registered");
    assert(typeof locale.dicts.zh.tab === "string" && typeof locale.dicts.en.tab === "string", "locale dictionaries need both languages");

    const dock = registrations.find((entry) => entry.definition.name === "conversation.input.dock");
    assert(dock !== undefined, "inline notice must register into conversation.input.dock");
    assert(dock.definition.id === "cockpit-auto-continue-notice", "inline notice id changed");
    assert(!registrations.some((entry) => entry.definition.name === "shell.overlay"), "the notice must not cover the frame");

    const downloadCard = registrations.find((entry) => entry.definition.name === "conversation.session.header.utilities");
    assert(downloadCard !== undefined, "active downloads must register into the session header utilities");
    assert(downloadCard.definition.id === "cockpit-download-activity", "download card id changed");
    assert(downloadCard.definition.order === -6, "download card must stay left of the schedule catalog");
    assert(typeof downloadCard.component === "function", "download card must receive a component");
    const downloadStore = downloadCard.definition.inject().store;
    const liveProgress = {
        id: "download-live",
        filename: "live.zip",
        extension: ".zip",
        receivedBytes: 1536,
        totalBytes: null,
        state: "downloading",
        startedAt: 1000,
        updatedAt: 1000
    };
    downloadStore.replace([liveProgress]);
    downloadStore.replace([{ ...liveProgress, receivedBytes: 3072, updatedAt: 2000 }]);
    const downloadText = textOf(downloadCard.component({ store: downloadStore }));
    assert(downloadText.includes("3.0 KB · 1.5 KB/s"), `download card must show live bytes and speed, got: ${downloadText}`);
    downloadStore.replace([]);
    assert(downloadCard.component({ store: downloadStore }) === null, "completed downloads must leave the active card");

    assert(!registrations.some((entry) => entry.definition.name === "settings.action"), "empty-session cleanup must not depend on the global settings header");

    const tab = registrations.find((entry) => entry.definition.name === "settings.plugins.tab");
    assert(tab !== undefined, "auto-continue settings page must register into settings.plugins.tab");
    assert(tab.definition.id === "auto-continue", "settings tab id changed");
    assert(tab.definition.label() === "dsh-cockpit.tab", "settings tab label must come from the cockpit dictionary");
    assert(typeof tab.component === "function", "settings tab must receive a component");
    const tabProps = tab.definition.inject();
    assert(
        tabProps.settings !== undefined && typeof tabProps.settings.describe === "function",
        "settings page must receive ctx.remote.settings (a carrier-only remote has no .settings)"
    );
    assert(typeof tabProps.getWorkspaceRegistry === "function", "settings page cleanup must resolve its remote lazily, never during registration");
    const settingsTree = tab.component({ ...tabProps, t: (key) => key });
    const settingsText = textOf(settingsTree);
    assert(settingsText.includes("emptyCleanupTitle"), "the auto-continue page must render the visible empty-session cleanup section");
    assert(settingsText.includes("emptyCleanup"), "the auto-continue page must render the empty-session cleanup button");

    const cleanupNode = findNode(settingsTree, (node) => typeof node.type === "function" && node.type.name === "EmptySessionCleanup");
    assert(cleanupNode !== undefined, "cleanup component must be embedded in the auto-continue page");
    const cleanupView = cleanupNode.type(cleanupNode.props);
    const cleanupButton = findNode(cleanupView, (node) => node.type === "button" && node.props?.title === "emptyCleanup");
    assert(cleanupButton !== undefined, "cleanup button must be rendered");
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

    const relay = subscribed.find((entry) => entry.event === "api-session/error");
    assert(relay !== undefined, "cockpit must subscribe to the compatible api-session/error relay");
    assert(relay.handler("s1", "unrelated error") === undefined, "unrelated errors must not throw");

    const downloadRelay = subscribed.find((entry) => entry.event === "api-session/error");
    assert(downloadRelay !== undefined, "cockpit must use the same relay for download progress");
    const progress = { id: "download-1", filename: "session.zip", extension: ".zip", receivedBytes: 512, totalBytes: 1024, state: "downloading", startedAt: 1, updatedAt: 1 };
    downloadRelay.handler(progress.id, `【下载】${JSON.stringify(progress)}`);
    downloadRelay.handler(progress.id, `【下载】${JSON.stringify({ ...progress, receivedBytes: 1024, state: "completed", updatedAt: 2 })}`);

    console.log("all client UI checks passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
