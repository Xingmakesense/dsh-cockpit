// Statistics + diagnostics checks.
//  1. the watcher insights engine/presentation/calendar are vendored verbatim,
//  2. stats.js installs the projection lazily (only on the first request) and
//     serves the merged summary through the same-origin route,
//  3. the generated Client carries the statistics page and the diagnostics tab.
const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createHash } = require("node:crypto");

const VENDOR_HASHES = {
    "engine.mjs": "4b2aaea4099b0571eb043de31f065b4e46862f52c54eab12abc119899dc93688",
    "presentation.mjs": "484715c45554183ace9b357115d1ab236e02b14795acd2f8770087c2e5706137",
    "calendar.mjs": "f23d295fe6c7096d80cce9c43920b7ae624241c8848332858bc3a2a313f477bf"
};

function read(relative) {
    return readFileSync(join(__dirname, relative), "utf8");
}

function checkVendorParity() {
    for (const [name, expected] of Object.entries(VENDOR_HASHES)) {
        const bytes = readFileSync(join(__dirname, "vendor", "watcher-insights", name));
        const actual = createHash("sha256").update(bytes).digest("hex");
        assert(actual === expected, "vendor/watcher-insights/" + name + " must stay byte-for-byte identical to dsh-watcher");
    }
    const engine = read("vendor/watcher-insights/engine.mjs");
    assert(engine.includes("export const KEY = 'watcherInsights'"), "engine key must stay watcherInsights");
    assert(engine.includes("export const SLOT_CAP = 8640"), "engine slot cap changed");
    assert(engine.includes("export function initialState"), "engine initialState must stay exported");
    assert(engine.includes("export function reduceEvent"), "engine reduceEvent must stay exported");
    assert(engine.includes("export function viewOf"), "engine viewOf must stay exported");
}

function buildFixtureSession() {
    const base = Date.now() - 60_000;
    const events = [];
    const push = (type, data) => {
        events.push({ type, seq: events.length, time: base + events.length * 1000, data });
    };
    push("request/header", { header: { config: { provider: "deepseek", model: "deepseek-chat", reasoningEffort: "high" }, tools: [] } });
    push("turn/start", { turn: 1 });
    push("user/message", { source: { kind: "user" }, content: [{ type: "text", text: "hello" }] });
    push("step/start", { turn: 1, step: 1 });
    push("assistant/message", {
        turn: 1,
        step: 1,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        message: { source: { provider: "deepseek", model: "deepseek-chat" }, content: [{ type: "text", text: "hi" }] }
    });
    push("tool/call", { turn: 1, step: 1, callId: "call-1", name: "read", arguments: { path: "a.txt" } });
    push("tool/result", {
        turn: 1,
        step: 1,
        message: {
            source: { callId: "call-1" },
            content: [{ type: "tool-result", toolCallId: "call-1", content: [{ type: "text", text: "ok" }], isError: false }]
        }
    });
    push("step/end", { turn: 1, step: 1 });
    push("turn/end", { turn: 1 });
    return {
        id: "session-1",
        seq: events.length,
        header: { id: "session-1", cwd: "/workspace/demo", createdAt: base },
        events
    };
}

async function checkHostRoute() {
    const { installStats, STATS_ROUTE, STATS_KEY, STATS_STATE_VERSION, createProjectionDefinition } = await import("./stats.js");
    assert(STATS_ROUTE === "/api/cockpit/stats", "statistics route path changed");
    assert(STATS_KEY === "cockpitInsights", "cockpit must use its own projection key to coexist with dsh-watcher");
    assert(STATS_STATE_VERSION === 5, "statistics stateVersion must stay 5");

    const definition = createProjectionDefinition();
    assert(definition.key === "cockpitInsights" && definition.stateVersion === 5, "projection definition key/version changed");
    assert(typeof definition.init === "function" && typeof definition.apply === "function", "projection must expose init/apply");
    const initial = definition.init({ id: "session-1", cwd: "/workspace/demo" }, 0);
    assert(initial.version === 5 && initial.sessionId === "session-1", "initial state must be version 5 with the session id");
    assert(initial.surface && initial.totals, "initial state must carry surface and totals");

    const session = buildFixtureSession();
    const routes = [];
    const eventListeners = [];
    const projection = {
        registered: [],
        definition: null,
        register(unit) {
            this.registered.push(unit);
            this.definition = unit;
            return () => {};
        },
        snapshot(target, keys) {
            const unit = this.definition;
            let state = unit.init(target.header, 0);
            for (const event of target.events) state = unit.apply(state, event);
            const value = unit.wire.viewSchema.parse(unit.wire.view(state));
            const values = {};
            for (const key of keys ?? [unit.key]) values[key] = value;
            return { asOfSeq: target.seq - 1, values };
        }
    };
    const connection = {
        fetch: {
            register(route) {
                routes.push(route);
                return () => {};
            }
        }
    };
    let listCalls = 0;
    const sessions = {
        list() {
            listCalls += 1;
            return [session];
        }
    };
    const ctx = {
        logger: { warn() {} },
        get(name) {
            if (name === "connection") return connection;
            if (name === "sessionProjections") return projection;
            if (name === "sessions") return sessions;
            return undefined;
        },
        inject(_dependencies, callback) {
            callback({
                sessionProjections: projection,
                sessions,
                connection,
                on(type, listener) {
                    eventListeners.push({ type, listener });
                    return () => {};
                },
                effect: () => () => {},
                get: ctx.get
            });
            return () => {};
        },
        effect(fn) {
            const dispose = fn();
            return typeof dispose === "function" ? dispose : () => {};
        }
    };

    installStats(ctx);
    assert(routes.length === 1, "installStats must register exactly one route");
    assert(projection.registered.length === 0, "installation must not register (and thus replay) the projection eagerly");
    assert(listCalls === 0, "installation must not scan sessions at Host start-up");

    const first = await routes[0].fetch(new Request("http://localhost/api/cockpit/stats?range=7&fields=full"));
    assert(first.status === 200, "first statistics request must succeed, got HTTP " + first.status);
    assert(listCalls >= 1, "the first statistics request must scan the live sessions");
    const payload = await first.json();
    assert(payload.ok === true, "statistics response must be ok");
    assert(projection.registered.length === 1, "the first request must install the projection exactly once");
    assert(payload.value.rows.length === 1, "the route must return one row for one live session");
    const view = payload.value.rows[0].value;
    assert(view !== null && view.version === 5, "the route must return a version 5 wire view");
    assert(view.sessionId === "session-1", "wire view session id changed");
    assert(view.totals.calls >= 1, "the folded view must count the assistant call");
    assert(view.totals.tokens >= 150, "the folded view must count reported tokens");
    assert(view.toolStats.some((tool) => tool.name === "read" && tool.calls === 1), "tool statistics must fold tool calls");
    for (const key of ["pending", "findings", "context", "requests", "cwd", "preset", "prompts", "models", "days", "toolStats", "skillStats", "turns"]) {
        assert(Object.hasOwn(view, key), "wire view lost the watcher field: " + key);
    }
    const summary = payload.value.summary;
    assert(summary && summary.validCount === 1, "summary must cover the requestable session");
    assert(summary.totalTokens >= 150, "summary must aggregate tokens");
    assert(summary.sessions.length === 1 && summary.sessions[0].sessionId === "session-1", "summary must list sessions");
    assert(summary.models.length === 1, "summary must merge model rows");
    const model = summary.models[0];
    assert(model.provider === "deepseek" && model.model === "deepseek/deepseek-chat", "summary must label provider/model");
    assert(model.calls === 1 && model.tokens >= 150, "summary must aggregate model usage");
    assert(model.effort === "high", "summary must keep the reasoning effort");
    assert(summary.daySeries.length === 7, "the 7-day range must produce 7 calendar buckets");
    assert(summary.daySeries.reduce((sum, day) => sum + day.total, 0) > 0, "the day series must carry tokens");
    assert(summary.activeRangeModels.length === 1, "the day series legend must list active models");
    assert(summary.toolRank.some((tool) => tool.name === "read" && tool.calls === 1), "summary must rank tools");
    assert(summary.toolRank[0].name === "read" && summary.toolTokensSum >= 150, "the tool ranking must carry step tokens");
    assert(summary.workspaceRank.length === 1 && summary.workspaceRank[0].label === "demo", "summary must group workspaces");
    assert(summary.workspaceRank[0].sessions === 1, "the workspace ranking must count sessions");
    assert(summary.sessions[0].status === "ok" && summary.sessions[0].turns === 1, "the session list must carry status and turns");
    assert(summary.totalTurns === 1, "the summary must count settled turns");
    assert(summary.weekdayTokens.reduce((sum, value) => sum + value, 0) > 0, "weekday distribution must carry tokens");
    assert(summary.shapeBuckets.reduce((sum, value) => sum + value, 0) === 1, "session shape must count the turn");
    assert(Array.isArray(summary.skillRank) && Array.isArray(summary.errorSessions) && Array.isArray(summary.findings), "summary must carry every ranking/error list");

    // The diagnostics surface records model failure reasons from the same
    // durable events auto-continue observes (it never touches the engine fold).
    const eventListener = eventListeners.find((entry) => entry.type === "session/event");
    assert(eventListener !== undefined, "installing the statistics projection must observe session events for failure reasons");
    eventListener.listener({ id: "session-1" }, {
        type: "turn/end",
        time: Date.now(),
        data: { reason: { kind: "error", error: { code: "TIMEOUT", message: "request timed out" } } }
    });

    const second = await routes[0].fetch(new Request("http://localhost/api/cockpit/stats?range=30&fields=summary"));
    assert(second.status === 200, "second statistics request must succeed");
    const secondPayload = await second.json();
    assert(projection.registered.length === 1, "later requests must not register the projection again");
    assert(secondPayload.value.rows === undefined, "fields=summary must omit raw rows");
    assert(secondPayload.value.summary.daySeries.length === 30, "the 30-day range must produce 30 calendar buckets");
    assert(secondPayload.value.failures.length === 1, "the route must expose observed model failures");
    assert(secondPayload.value.failures[0].code === "TIMEOUT" && secondPayload.value.failures[0].sessionId === "session-1",
        "model failure reasons must keep the failure code and session");

    const invalid = await routes[0].fetch(new Request("http://localhost/api/cockpit/stats?range=999"));
    assert(invalid.status === 400, "an unsupported range must be rejected");
}

function checkClientSurface() {
    const pkg = JSON.parse(read("package.json"));
    assert(pkg.name === "dsh-cockpit", "package name must stay dsh-cockpit");
    assert(pkg.files.includes("stats.js"), "package.json files must pack stats.js");
    assert(pkg.files.includes("vendor"), "package.json files must pack the vendored insights");
    assert(read("host.js").includes("installStats"), "host.js must install the statistics module");
    const bundle = read("client.js");
    for (const needle of [
        "api/cockpit/stats",
        'id: "cockpit-statistics"',
        'name: "settings.section"',
        "createDiagnosticsSidebar",
        "cockpit-diagnostics",
        "diagnoseSession",
        "repairSession",
        "sessionDetails",
        "rankTools",
        "rankSkills",
        "rankWorkspaces"
    ]) {
        assert(bundle.includes(needle), "client.js lost statistics/diagnostics surface: " + needle);
    }
    for (const [file, needle] of [
        ["scripts/client/60-statistics.js", 'gridTemplateColumns: "1fr"'],
        ["scripts/client/60-statistics.js", 'overflowWrap: "anywhere"'],
        ["scripts/client/70-sidebar.js", "registerTab"]
    ]) {
        assert(read(file).includes(needle), file + " lost required layout/registration: " + needle);
    }
}

async function main() {
    checkVendorParity();
    await checkHostRoute();
    checkClientSurface();
    console.log("all statistics and diagnostics checks passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
