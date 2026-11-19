/**
 * dsh-cockpit statistics half.
 *
 * Native port of dsh-watcher's replayable insights projection:
 *  - the fold and wire view stay byte-for-byte in vendor/watcher-insights/
 *    (engine.mjs), with the same key and stateVersion 5;
 *  - registration is lazy: the projection is installed on the first
 *    GET /api/cockpit/stats request, never at Host start-up, and registering
 *    it replays nothing on its own;
 *  - a request lists the live sessions, snapshots only those sessions and
 *    merges the resulting views into one range-scoped summary.
 *
 * No new transport, no model-facing writes, no JSONL re-derivation: the
 * numbers are the projection's own fold of committed session events.
 */
import { initialState, reduceEvent, viewOf } from "./vendor/watcher-insights/engine.mjs";
import { buildAnalytics, RANGES } from "./vendor/watcher-insights/analytics.mjs";

/** Exact same-origin route the Client reads statistics from. */
export const STATS_ROUTE = "/api/cockpit/stats";
/** Projection key shared with dsh-watcher (wire-compatible as well). */
export const STATS_KEY = "cockpitInsights";
/** State version shared with dsh-watcher; a mismatch refuses to share cells. */
export const STATS_STATE_VERSION = 5;
const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 500;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Minimal state validation: the engine stays the only source of the fold. */
const stateSchema = {
    parse(value) {
        if (!isRecord(value) || value.version !== STATS_STATE_VERSION || typeof value.sessionId !== "string") {
            throw new TypeError("cockpitInsights state must be version 5 with a sessionId");
        }
        if (!isRecord(value.totals) || !Array.isArray(value.models) || !Array.isArray(value.days) || !isRecord(value.surface)) {
            throw new TypeError("cockpitInsights state is missing totals/models/days/surface");
        }
        return value;
    }
};

/** Minimal wire validation; the wire shape itself comes from engine.viewOf. */
const viewSchema = {
    parse(value) {
        if (!isRecord(value) || value.version !== STATS_STATE_VERSION || typeof value.sessionId !== "string") {
            throw new TypeError("cockpitInsights view must be version 5 with a sessionId");
        }
        if (!isRecord(value.totals) || !Array.isArray(value.models) || !Array.isArray(value.days)) {
            throw new TypeError("cockpitInsights view is missing totals/models/days");
        }
        for (const key of ["findings", "requests", "toolStats", "skillStats", "turns"]) {
            if (!Array.isArray(value[key])) throw new TypeError("cockpitInsights view is missing " + key);
        }
        return value;
    }
};

/**
 * The projection unit. init/apply/wire are the vendored engine functions; no
 * fold semantics are reimplemented here.
 */
export function createProjectionDefinition() {
    return {
        key: STATS_KEY,
        stateVersion: STATS_STATE_VERSION,
        stateSchema,
        init: (header, inherited) => initialState(header, inherited),
        apply: (state, event) => reduceEvent(state, event),
        wire: { viewSchema, view: (state) => viewOf(state) }
    };
}

function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store"
        }
    });
}

function readNumber(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(1, Math.min(MAX_LIMIT, Math.floor(number)));
}

/**
 * List the live sessions a statistics request may read. Cold sessions are not
 * activated: they appear after the Host attaches them (for example when the
 * workspace is opened), which keeps the statistics route free of replay work
 * for sessions nobody asked about.
 */
function listLiveSessions(scope) {
    const sessions = scope.sessions;
    if (typeof sessions?.list !== "function") return [];
    try {
        const listed = sessions.list();
        return Array.isArray(listed) ? listed.filter((session) => session !== null && typeof session?.id === "string") : [];
    } catch {
        return [];
    }
}

/**
 * Snapshot the projection for the selected sessions only.
 * @param {object} scope injected services (sessionProjections + sessions)
 * @param {{sessionId?:string|null, limit?:number}} options
 */
function scanSessions(scope, { sessionId = null, limit = DEFAULT_LIMIT } = {}) {
    const all = listLiveSessions(scope);
    let candidates = all;
    if (typeof sessionId === "string" && sessionId.length > 0) {
        candidates = all.filter((session) => session.id === sessionId);
    } else {
        candidates = all.filter((session) => session.seq > 0 && session.header?.origin !== "subagent");
    }
    const picked = candidates.slice(0, limit);
    const rows = picked.map((session) => {
        const base = {
            sessionId: session.id,
            value: null,
            error: "",
            updatedAt: Number.isFinite(session.header?.createdAt) ? session.header.createdAt : 0,
            cwd: typeof session.header?.cwd === "string" && session.header.cwd ? session.header.cwd : null
        };
        try {
            const snapshot = scope.sessionProjections.snapshot(session, [STATS_KEY]);
            const candidate = snapshot?.values?.[STATS_KEY] ?? null;
            if (candidate === null || candidate === undefined) {
                return { ...base, error: "尚无统计缓存；该会话没有可折叠的事件，或统计投影尚未就绪" };
            }
            if (candidate.version !== STATS_STATE_VERSION || candidate.sessionId !== session.id) {
                return { ...base, error: "统计缓存版本或会话身份不匹配，已忽略" };
            }
            return {
                ...base,
                value: candidate,
                updatedAt: Number.isFinite(candidate.updatedAt) && candidate.updatedAt > 0 ? candidate.updatedAt : base.updatedAt,
                cwd: typeof candidate.cwd === "string" && candidate.cwd ? candidate.cwd : base.cwd
            };
        } catch (error) {
            return { ...base, error: error instanceof Error ? error.message : String(error) };
        }
    });
    return { rows, total: all.length, selected: picked.length, source: "projection" };
}

/**
 * Install the statistics module: lazy projection plus the same-origin route.
 * @param {object} ctx host context
 */
export function installStats(ctx) {
    const warn = (message) => {
        try {
            ctx.logger?.warn?.("[dsh-cockpit] " + message);
        } catch {
            /* logging must never break the Host */
        }
    };

    let installation = null;
    /** Latest model failure per session, observed from official durable events. */
    const modelFailures = new Map();

    /**
     * Install the projection on first use. Registration itself only adds a
     * unit to the registry; it does not fold any existing log (cells build on
     * the first snapshot/drive for that session).
     */
    const ensureProjection = () => {
        if (installation !== null) return installation;
        const registry = typeof ctx.get === "function" ? ctx.get("sessionProjections") : ctx.sessionProjections;
        const sessions = typeof ctx.get === "function" ? ctx.get("sessions") : ctx.sessions;
        if (registry === undefined || sessions === undefined) {
            warn("statistics projection unavailable: sessionProjections/sessions services are not mounted");
            installation = Promise.resolve(null);
            return installation;
        }
        installation = new Promise((resolve) => {
            let settled = false;
            const finish = (scope) => {
                if (settled) return;
                settled = true;
                resolve(scope);
            };
            // The registry may be mounted after this route's first request in
            // unusual compositions; never leave the request hanging forever.
            const timer = setTimeout(() => finish(null), 15_000);
            timer.unref?.();
            try {
                ctx.inject(["sessionProjections", "sessions"], (scope) => {
                    let registration;
                    try {
                        registration = scope.sessionProjections.register(createProjectionDefinition());
                    } catch (error) {
                        clearTimeout(timer);
                        warn("statistics projection registration failed: " + (error?.message ?? String(error)));
                        finish(null);
                        return;
                    }
                    // register() is asynchronous: snapshots taken before its
                    // ready promise settles would miss the new unit. Wait for
                    // that handoff (the 15s guard covers a stuck registry).
                    Promise.resolve(registration).then(
                        () => {
                            clearTimeout(timer);
                            finish(scope);
                        },
                        (error) => {
                            clearTimeout(timer);
                            warn("statistics projection registration failed: " + (error?.message ?? String(error)));
                            finish(null);
                        }
                    );
                    // Failure reasons are observed from the same official durable
                    // events auto-continue reads; they never feed the engine fold.
                    try {
                        if (typeof scope.on === "function") {
                            const disposeFailure = scope.on("session/event", (session, event) => {
                                if (!session || typeof session.id !== "string" || !event) return;
                                let failure = null;
                                let kind = "blocked";
                                if (event.type === "llm/retry" && event.data?.failure) {
                                    failure = event.data.failure;
                                    kind = "retry";
                                } else if (event.type === "turn/end" && event.data?.reason?.kind === "error") {
                                    failure = event.data.reason.error;
                                }
                                if (failure === null) return;
                                const code = String(failure?.code ?? "UNKNOWN").toUpperCase();
                                const detail = String(failure?.message ?? failure ?? "").slice(0, 300);
                                modelFailures.set(session.id, {
                                    id: "mf-" + Date.now().toString(36) + "-" + code,
                                    sessionId: session.id,
                                    kind,
                                    code,
                                    detail,
                                    at: Number.isFinite(event.time) ? event.time : Date.now()
                                });
                                if (modelFailures.size > 200) modelFailures.delete(modelFailures.keys().next().value);
                            });
                            if (typeof disposeFailure === "function") {
                                scope.effect(() => disposeFailure, "dsh-cockpit: statistics failure observation");
                            }
                        }
                    } catch (error) {
                        warn("statistics failure observation skipped: " + (error?.message ?? String(error)));
                    }
                });
            } catch (error) {
                clearTimeout(timer);
                warn("statistics projection could not be injected: " + (error?.message ?? String(error)));
                finish(null);
            }
        });
        return installation;
    };

    const route = {
        path: STATS_ROUTE,
        methods: ["GET"],
        requestBody: "buffered",
        fetch: async (request) => {
            let url;
            try {
                url = new URL(request?.url ?? STATS_ROUTE, "http://localhost");
            } catch {
                url = new URL(STATS_ROUTE, "http://localhost");
            }
            const range = url.searchParams.get("range") ?? "7";
            const fields = url.searchParams.get("fields") ?? "full";
            const sessionId = url.searchParams.get("sessionId");
            const sessionSort = url.searchParams.get("sort") ?? "tokens";
            const limit = readNumber(url.searchParams.get("limit"), DEFAULT_LIMIT);
            if (!RANGES.includes(range)) {
                return jsonResponse(400, { ok: false, error: { message: "range must be one of " + RANGES.join(", ") } });
            }
            try {
                const scope = await ensureProjection();
                if (scope === null) {
                    return jsonResponse(503, { ok: false, error: { message: "统计投影服务不可用（sessionProjections/sessions 未挂载）" } });
                }
                const result = scanSessions(scope, { sessionId, limit });
                const summary = buildAnalytics(result.rows, {
                    now: Date.now(),
                    range,
                    sessionSort,
                    total: result.total
                });
                const failures = [...modelFailures.values()].sort((left, right) => right.at - left.at).slice(0, 20);
                const value = { ...result, range, sessionSort, generatedAt: Date.now(), failures, summary };
                if (fields === "summary") delete value.rows;
                return jsonResponse(200, { ok: true, value });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                warn("statistics request failed: " + message);
                return jsonResponse(500, { ok: false, error: { message } });
            }
        }
    };

    try {
        const connection = typeof ctx.get === "function" ? ctx.get("connection") : ctx.connection;
        if (connection !== undefined && typeof connection?.fetch?.register === "function") {
            const registered = connection.fetch.register(route);
            if (typeof registered === "function") {
                ctx.effect(() => registered, "dsh-cockpit: statistics route");
            }
        } else if (typeof ctx.inject === "function") {
            ctx.inject(["connection"], (scope) => {
                scope.effect(() => scope.connection.fetch.register(route), "dsh-cockpit: statistics route");
            });
        }
    } catch (error) {
        warn("statistics route skipped: " + (error?.message ?? String(error)));
    }
}

export { buildAnalytics };
