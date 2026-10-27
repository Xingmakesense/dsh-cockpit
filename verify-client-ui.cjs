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
        createElement: () => null,
        useState: (initial) => [initial, () => {}],
        useEffect: () => {},
        useCallback: (fn) => fn,
        useSyncExternalStore: () => null
    };
}

function loadModules() {
    const modules = [];
    globalThis.window = { __ModuleLoader__: { load(mod) { modules.push(mod); } } };
    const code = readFileSync(join(__dirname, "client.js"), "utf8");
    vm.runInThisContext(code, { filename: "client.js" });
    return modules;
}

function main() {
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

    const emptyCleanup = registrations.find((entry) => entry.definition.name === "settings.action");
    assert(emptyCleanup !== undefined, "empty-session cleanup must register into settings.action");
    assert(emptyCleanup.definition.id === "cockpit-empty-session-cleanup", "empty-session cleanup id changed");
    assert(typeof emptyCleanup.component === "function", "empty-session cleanup must receive a component");
    assert(typeof emptyCleanup.definition.inject().workspaceRegistry === "object", "empty-session cleanup must receive the archive remote namespace");
    emptyCleanup.component({ t: (key) => key, workspaceRegistry: remote.workspaceRegistry, usePanelInfo: undefined });

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

try {
    main();
} catch (error) {
    console.error(error);
    process.exit(1);
}
