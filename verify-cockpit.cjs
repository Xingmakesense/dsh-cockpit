// Cockpit checks.
//  1. host entry scope (auto-continue runs on the official recovery seam),
//  2. client artifact guards: client.js must be vendor client + wrapper and
//     must keep the official-only surfaces,
//  3. the Session menu probe and the vendored deletion semantics.
const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const read = (relative) => readFileSync(join(__dirname, relative), "utf8");
const readOrNull = (relative) => {
    try {
        return read(relative);
    } catch {
        return null;
    }
};

async function checkHostEntry() {
    const { name, inject, apply } = await import("./host.js");
    assert(name === "cockpit", "host plugin name must stay cockpit");
    assert(Array.isArray(inject), "host inject must be an array");
    assert(typeof apply === "function", "host apply must be exported");

    // Auto-continue must use the documented agent/request-error recovery
    // waterfall. Hidden inbox injection and internal relays stay forbidden.
    const host = read("./host.js");
    assert(host.includes("installAutoContinue"), "host.js must install auto-continue");
    assert(host.includes("export { Config }"), "host.js must export the native Config");
    const engine = readOrNull("./auto-continue.js");
    assert(engine !== null, "auto-continue.js must exist");
    assert(engine.includes('ctx.on("agent/request-error"'), "auto-continue must hook agent/request-error");
    assert(engine.includes("payload.retryPolicy = resolveRetryPolicy"), "auto-continue must override the official retry policy on the payload");
    assert(engine.includes("prepend: true"), "the override must run before the official retry listener");
    assert(engine.includes('"llm/retry"'), "notices must observe the official retry event");
    for (const needle of ["runtime-context", "api-session/error", "followup("]) {
        assert(!engine.includes(needle), `auto-continue must not use the non-public surface: ${needle}`);
    }
    assert(readOrNull("./verify-auto-continue.cjs") !== null, "verify-auto-continue.cjs must exist");
}

function checkClientArtifact() {
    const vendor = read("./vendor/archive-manager/lib/client.js");
    const wrapper = read("./scripts/client-wrapper.js");
    const client = read("./client.js");

    assert(
        client === `${vendor}\n${wrapper}`,
        "client.js must be vendor client + wrapper (run `node scripts/build-client.mjs`)"
    );

    // Upstream-only surfaces removed in 2.3.0: project links, issue feedback,
    // and the update checker (its host route never existed in cockpit).
    const removed = [
        "github.com/MichengAI",
        "archives.viewProject",
        "archives.feedback",
        "observePluginUpdate",
        "createUpdateFlow",
        "UpdateDialog",
        "/api/michengai",
        "michengai-plugin-update"
    ];
    for (const needle of removed) {
        assert(!client.includes(needle), `client.js still contains removed upstream feature: ${needle}`);
    }

    // The archive settings page itself must survive the surgery.
    for (const needle of [
        "dsham_settingsTitleRow",
        "dsham_settingsIntro",
        "startArchiveClient",
        'id: "@michengai/dsh-archive-manager"',
        'id: "dsh-cockpit"'
    ]) {
        assert(client.includes(needle), `client.js lost required surface: ${needle}`);
    }

    // Cockpit UI: download card, cleanup settings section and the
    // right-aligned composer button that sends an ordinary user message.
    for (const needle of [
        'id: "cockpit-download-activity"',
        'name: "conversation.session.header.utilities"',
        'id: "cockpit-clean-temp"',
        'name: "conversation.input.dock"',
        'id: "cockpit-cleanup"',
        'name: "settings.section"',
        "api/cockpit/downloads",
        "api/cockpit/empty-sessions",
        "emptyCleanupTitle",
        "清理本项目的临时产物",
        "binding.session.prompt",
        'id: "cockpit-auto-continue-notice"',
        'id: "auto-continue"',
        'name: "settings.plugins.tab"',
        "api/cockpit/auto-continue",
        "noticeRetry"
    ]) {
        assert(client.includes(needle), `client.js lost cockpit UI surface: ${needle}`);
    }

    // Non-public carriers must not leak back into the generated client.
    for (const needle of ["【自动续轮", "agent/request-error", "runtime-context", "api-session/error"]) {
        assert(!client.includes(needle), `client.js still contains a non-public surface: ${needle}`);
    }

    // The three locale dictionaries must still carry the archive page strings.
    for (const key of ['"archives.title"', '"archives.deleteSelected"', '"archives.restore"']) {
        const count = client.split(key).length - 1;
        assert(count >= 3, `expected ${key} in zh/en/ru dictionaries, found ${count}`);
    }
}

// The Session menu moved from a sidebar child slot to ctx.contextMenus in
// DSH 0.2.2: the legacy row slot is declared by the contextMenu.content owner.
// The probe must accept both layouts, otherwise the plugin drops to its own
// vendored sidebar and the "delete session" row disappears from the menu.
function checkSessionMenuDetection() {
    const client = read("./client.js");
    const start = client.indexOf("function To(){");
    const end = client.indexOf('o(To,"hostSidebarDeclaresSessionMenu")', start);
    assert(start !== -1 && end !== -1, "the Session-menu mode probe must stay in client.js");
    const source = client.slice(start, end);
    assert(source.endsWith("}"), "unexpected Session-menu probe boundaries");
    const detect = new Function("P", "Fr", `${source}; return To();`);
    const slotName = "sidebar.workspaces.session.menu.item";
    const host = (entries) => ({ slots: { entries: (name) => entries[name] ?? [] } });

    assert(
        detect(host({ "contextMenu.content": [{ name: "contextMenu.content", key: "session", children: { [slotName]: { kind: "list" } } }] }), slotName) === true,
        "the probe must accept the DSH 0.2.2+ contextMenu.content owner"
    );
    assert(
        detect(host({ "sidebar.workspaces": [{ name: "sidebar.workspaces", children: { [slotName]: { kind: "single" } } }] }), slotName) === true,
        "the probe must keep accepting hosts that declare the slot under sidebar.workspaces"
    );
    assert(
        detect(host({}), slotName) === false,
        "a host that does not declare the slot must keep the vendored sidebar fallback"
    );
    assert(detect({ slots: {} }, slotName) === false, "a host without slots.entries must not throw");
}

function checkHostArtifact() {
    const index = read("./vendor/archive-manager/lib/index.js");
    assert(!index.includes('from "./plugin-updater.js"'), "vendored index.js must not import the removed updater");
    assert(!index.includes("/api/michengai"), "vendored index.js must not mount an update route");
    assert(index.includes("host-install.js"), "vendored index.js must still export the archive host");

    assert(readOrNull("./vendor/archive-manager/lib/plugin-updater.js") === null, "vendor/archive-manager/lib/plugin-updater.js must stay deleted");
}

function checkLocaleMeta() {
    for (const locale of ["zh", "en"]) {
        const meta = JSON.parse(read(`./locale/${locale}.json`));
        assert(typeof meta.meta?.description === "string", `${locale} locale needs a description`);
        assert(!/滑条|slider/i.test(meta.meta.description), `${locale} locale must not advertise the standalone slider`);
        assert(/自动续轮|auto-continue/i.test(meta.meta.description), `${locale} locale must advertise auto-continue`);
    }
}

function checkManifest() {
    const pkg = JSON.parse(read("./package.json"));
    assert(pkg.name === "dsh-cockpit", "package name must stay dsh-cockpit");
    assert(pkg.version === "3.1.2", "package.json version must stay 3.1.2");
    assert(pkg.dsh?.bundle?.patch === "./cordis.patch.yml", "dsh.bundle.patch must point at cordis.patch.yml");
    assert(pkg.dsh?.client?.platform === "web", "dsh.client.platform must stay web");

    // Everything the host/client load at runtime has to be packed.
    for (const required of ["host.js", "archive.js", "maintenance.js", "downloads.js", "client.js", "vendor", "cordis.patch.yml", "locale/*.json", "icon.svg"]) {
        assert(pkg.files.includes(required), `package.json files is missing ${required}`);
    }
    assert(pkg.files.includes("auto-continue.js"), "package.json must pack auto-continue.js");

    const patch = read("./cordis.patch.yml");
    assert(/-\s*insert:/.test(patch), "cordis.patch.yml must insert the cockpit row");
    assert(/id:\s*cockpit\b/.test(patch), "cordis.patch.yml must use id: cockpit");
    assert(/name:\s*dsh-cockpit\b/.test(patch), "cordis.patch.yml must mount the dsh-cockpit package");
    assert(/^\s+config:/m.test(patch), "cordis.patch.yml must configure auto-continue");
    assert(/enabled:\s*true/.test(patch), "cordis.patch.yml must enable auto-continue");
}

function checkDeletionSemantics() {
    const workspace = read("./vendor/archive-manager/lib/workspace.js");
    assert(!workspace.includes("请先归档会话，再执行永久删除"), "single-session deletion must allow archived and unarchived targets");
    assert(workspace.includes("purgeSessionRegistryTraces"), "all deletion paths must share registry-trace cleanup");
    assert(workspace.includes("collectSubagentDescendants"), "deleting a parent must enumerate every subagent descendant");
    assert(workspace.includes("cascadedSessionIds"), "deletion results must report cascaded child sessions");
}

function checkProjectionMigrationSource() {
    const source = read("./vendor/archive-manager/lib/projcache.js");
    assert(source.includes("const official = currentTable"), "official migration must have a single source");
    assert(!source.includes("readSourceRecords(ctx, legacyProjectionCacheDomainSpec"), "legacy official data must not be read a second time");
    assert(source.includes('importMissingRecords(ctx, target, official.records, "official", stillExists)'),
        "the single official source must be imported exactly once");
}

async function main() {
    await checkHostEntry();
    checkProjectionMigrationSource();
    checkClientArtifact();
    checkSessionMenuDetection();
    checkHostArtifact();
    checkDeletionSemantics();
    checkLocaleMeta();
    checkManifest();
    console.log("all cockpit checks passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
