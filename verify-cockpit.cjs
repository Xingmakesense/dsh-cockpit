// Cockpit checks.
//  1. auto-continue config normalization (host half),
//  2. client artifact guards: client.js must be vendor client + wrapper, and
//     must not contain the upstream-only features removed in 2.3.0.
const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const read = (relative) => readFileSync(join(__dirname, relative), "utf8");

async function checkAutoContinue() {
    const { name, inject, apply } = await import("./host.js");
    const { normalizeContinueConfig } = await import("./auto-continue.js");
    assert(name === "cockpit", "host plugin name must stay cockpit");
    assert(Array.isArray(inject), "host inject must be an array");
    assert(typeof apply === "function", "host apply must be exported");

    const off = normalizeContinueConfig(undefined);
    assert(off.enabled === false, "auto-continue must stay disabled unless configured");
    assert(off.maxAttempts === 6 && off.delayMs === 1500, "defaults must match dsh-auto-continue 1.0.3");
    assert(off.retryableCodes.includes("TRANSPORT") && off.blockedCodes.includes("AUTH"), "code lists must match");

    const on = normalizeContinueConfig({
        enabled: true,
        maxAttempts: 3.9,
        delayMs: 0,
        providerRetryMaxRetries: 2,
        emitProminentError: false,
        retryableCodes: ["timeout"]
    });
    assert(on.enabled === true && on.maxAttempts === 3 && on.delayMs === 0, "numbers must be coerced");
    assert(on.providerRetryMaxRetries === 2 && on.emitProminentError === false, "switches must survive");
    assert(on.retryableCodes[0] === "TIMEOUT", "codes must be upper-cased");
    assert(!("continueText" in on) && !("haltText" in on), "removed compatibility keys must stay gone");
    assert(normalizeContinueConfig("bad").enabled === false, "non-object config must be safe");
    assert(normalizeContinueConfig({ maxAttempts: 0 }).maxAttempts === 6, "invalid attempts must fall back");
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

    // Cockpit UI (2.4.x): inline notice + auto-continue settings tab.
    for (const needle of [
        'id: "cockpit-auto-continue-notice"',
        'name: "conversation.input.dock"',
        'id: "auto-continue"',
        'name: "settings.plugins.tab"',
        '"api-session/error"',
        'id: "cockpit-download-activity"',
        '【下载】',
        'api/cockpit/downloads',
        'api/cockpit/empty-sessions',
        'emptyCleanupTitle'
    ]) {
        assert(client.includes(needle), `client.js lost cockpit UI surface: ${needle}`);
    }

    // The three locale dictionaries must still carry the archive page strings.
    for (const key of ['"archives.title"', '"archives.deleteSelected"', '"archives.restore"']) {
        const count = client.split(key).length - 1;
        assert(count >= 3, `expected ${key} in zh/en/ru dictionaries, found ${count}`);
    }
}

function checkHostArtifact() {
    const index = read("./vendor/archive-manager/lib/index.js");
    assert(!index.includes('from "./plugin-updater.js"'), "vendored index.js must not import the removed updater");
    assert(!index.includes("/api/michengai"), "vendored index.js must not mount an update route");
    assert(index.includes("host-install.js"), "vendored index.js must still export the archive host");

    let updaterPresent = true;
    try {
        read("./vendor/archive-manager/lib/plugin-updater.js");
    } catch {
        updaterPresent = false;
    }
    assert(!updaterPresent, "vendor/archive-manager/lib/plugin-updater.js must stay deleted");
}

function checkLocaleMeta() {
    for (const locale of ["zh", "en"]) {
        const meta = JSON.parse(read(`./locale/${locale}.json`));
        assert(typeof meta.meta?.description === "string", `${locale} locale needs a description`);
        assert(!/滑条|slider/i.test(meta.meta.description), `${locale} locale must not advertise the standalone slider`);
    }
}

function checkManifest() {
    const pkg = JSON.parse(read("./package.json"));
    assert(pkg.name === "dsh-cockpit", "package name must stay dsh-cockpit");
    assert(pkg.dsh?.bundle?.patch === "./cordis.patch.yml", "dsh.bundle.patch must point at cordis.patch.yml");
    assert(pkg.dsh?.client?.platform === "web", "dsh.client.platform must stay web");

    // Everything the host/client load at runtime has to be packed.
    for (const required of ["host.js", "auto-continue.js", "archive.js", "maintenance.js", "downloads.js", "client.js", "vendor", "cordis.patch.yml", "locale/*.json", "icon.svg"]) {
        assert(pkg.files.includes(required), `package.json files is missing ${required}`);
    }

    const patch = read("./cordis.patch.yml");
    assert(/-\s*insert:/.test(patch), "cordis.patch.yml must insert the cockpit row");
    assert(/id:\s*cockpit\b/.test(patch), "cordis.patch.yml must use id: cockpit");
    assert(/name:\s*dsh-cockpit\b/.test(patch), "cordis.patch.yml must mount the dsh-cockpit package");

    // A misspelled config key is silently ignored at runtime; reject it here.
    const known = new Set([
        "enabled", "maxAttempts", "delayMs",
        "retryableCodes", "blockedCodes", "emitProminentError", "providerRetryMaxRetries"
    ]);
    const configBlock = patch.slice(patch.indexOf("config:"));
    for (const match of configBlock.matchAll(/^\s{8}([A-Za-z][\w]*):/gm)) {
        assert(known.has(match[1]), `cordis.patch.yml has an unknown auto-continue key: ${match[1]}`);
    }
}

function checkDeletionSemantics() {
    const workspace = read("./vendor/archive-manager/lib/workspace.js");
    assert(!workspace.includes("请先归档会话，再执行永久删除"), "single-session deletion must allow archived and unarchived targets");
    assert(workspace.includes("purgeSessionRegistryTraces"), "all deletion paths must share registry-trace cleanup");
}

function checkProjectionMigrationSource() {
    const source = read("./vendor/archive-manager/lib/projcache.js");
    assert(source.includes("const official = currentTable"), "official migration must have a single source");
    assert(!source.includes("readSourceRecords(ctx, legacyProjectionCacheDomainSpec"), "legacy official data must not be read a second time");
    assert(source.includes('importMissingRecords(ctx, target, official.records, "official", stillExists)'),
        "the single official source must be imported exactly once");
}

async function main() {
    await checkAutoContinue();
    checkProjectionMigrationSource();
    checkClientArtifact();
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
