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
/** Bound on the snapshot-reuse cache (one entry per live session). */
const MAX_SNAPSHOT_CACHE = 1000;
/** Longest a single request waits for the projection hand-off. */
const INSTALL_TIMEOUT_MS = 15_000;
/** Cooldown before a failed projection installation is retried. */
const INSTALL_RETRY_MS = 5_000;

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
    // A missing query parameter arrives as null, and Number(null) is 0: without
    // this guard every default request would silently clamp the limit to 1.
    if (value === null || value === undefined || value === "") return fallback;
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

/** Whether one session id may be served from the snapshot cache for this seq. */
function cacheableSnapshot(entry, session) {
    if (entry === undefined) return null;
    // Without a committed-event watermark there is no way to prove the cached
    // view is current, so such a session is always snapshotted again.
    if (!Number.isSafeInteger(session.seq) || entry.seq !== session.seq) return null;
    // Re-validate on the way out: a projection upgrade bumps the state version
    // and must never be masked by a cached view.
    if (!isRecord(entry.value) || entry.value.version !== STATS_STATE_VERSION || entry.value.sessionId !== session.id) return null;
    return entry.value;
}

/**
 * Snapshot the projection for the selected sessions only.
 * @param {object} scope injected services (sessionProjections + sessions)
 * @param {{sessionId?:string|null, limit?:number, cache?:Map|null}} options
 */
function scanSessions(scope, { sessionId = null, limit = DEFAULT_LIMIT, cache = null } = {}) {
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
            // The projection is a pure fold of committed events, so an unchanged
            // session.seq cannot yield a different view: reuse the last snapshot
            // instead of folding the same session again on every request.
            let candidate = cache === null ? null : cacheableSnapshot(cache.get(session.id), session);
            if (candidate === null) {
                const snapshot = scope.sessionProjections.snapshot(session, [STATS_KEY]);
                candidate = snapshot?.values?.[STATS_KEY] ?? null;
                if (candidate !== null && candidate !== undefined
                    && candidate.version === STATS_STATE_VERSION && candidate.sessionId === session.id
                    && Number.isSafeInteger(session.seq)) {
                    cache?.set(session.id, { seq: session.seq, value: candidate });
                }
            }
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
    if (cache !== null && cache.size > MAX_SNAPSHOT_CACHE) {
        const live = new Set(all.map((session) => session.id));
        for (const id of cache.keys()) if (!live.has(id)) cache.delete(id);
    }
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

    /** In-flight (single-flight) projection installation. */
    let attempt = null;
    /** Scope resolved by a successful registration; cached for the Host lifetime. */
    let installed = null;
    /** Earliest time a failed installation may be retried. */
    let retryAfter = 0;
    /** A register() hand-off is still open; retry would register a second unit. */
    let registrationPending = false;
    /** One entry per live session: the projection is a pure fold of events. */
    const snapshotCache = new Map();
    /** Latest model failure per session, observed from official durable events. */
    const modelFailures = new Map();
    let failureSeq = 0;

    /**
     * Register the projection once. Registration itself only adds a unit to the
     * registry; it does not fold any existing log (cells build on the first
     * snapshot/drive for that session).
     */
    const registerProjection = () => {
        const registry = typeof ctx.get === "function" ? ctx.get("sessionProjections") : ctx.sessionProjections;
        const sessions = typeof ctx.get === "function" ? ctx.get("sessions") : ctx.sessions;
        if (registry === undefined || sessions === undefined) {
            warn("statistics projection unavailable: sessionProjections/sessions services are not mounted");
            return Promise.resolve(null);
        }
        return new Promise((resolve) => {
            let settled = false;
            let stopFork = null;
            let callbackFired = false;
            const finish = (scope, disposeFork = false) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                // A failed attempt must not leave its inject fork behind: the
                // next request retries with a fresh one.
                if (disposeFork && stopFork !== null) {
                    try {
                        stopFork();
                    } catch {
                        /* a failed fork must never break the request */
                    }
                }
                resolve(scope);
            };
            // The registry may be mounted after this route's first request in
            // unusual compositions; never leave the request hanging forever.
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                // The dependency never mounted: drop the idle fork so a later
                // request starts from a clean scope.
                if (!callbackFired && stopFork !== null) {
                    try {
                        stopFork();
                    } catch {
                        /* a failed fork must never break the request */
                    }
                }
                resolve(null);
            }, INSTALL_TIMEOUT_MS);
            timer.unref?.();
            try {
                stopFork = ctx.inject(["sessionProjections", "sessions"], (scope) => {
                    callbackFired = true;
                    let registration;
                    try {
                        registration = scope.sessionProjections.register(createProjectionDefinition());
                    } catch (error) {
                        warn("statistics projection registration failed: " + (error?.message ?? String(error)));
                        finish(null, true);
                        return;
                    }
                    // register() is asynchronous: snapshots taken before its
                    // ready promise settles would miss the new unit. Wait for
                    // that handoff (the timeout guard covers a stuck registry).
                    registrationPending = true;
                    Promise.resolve(registration).then(
                        () => {
                            registrationPending = false;
                            // A registration that lands after the guard still
                            // counts: remember the scope so the next request
                            // reuses it instead of adding a second unit.
                            if (settled) installed = scope;
                            else finish(scope);
                        },
                        (error) => {
                            registrationPending = false;
                            warn("statistics projection registration failed: " + (error?.message ?? String(error)));
                            finish(null, true);
                        }
                    );
                });
            } catch (error) {
                warn("statistics projection could not be injected: " + (error?.message ?? String(error)));
                finish(null, true);
            }
        });
    };

    /**
     * Resolve the projection lazily. A failed attempt must not poison the route
     * for the rest of the Host run: it is retried after a short cooldown.
     */
    const ensureProjection = () => {
        if (installed !== null) return Promise.resolve(installed);
        // Never start a second registration while one hand-off is still open:
        // two units for the same key would both fold the same sessions.
        if (registrationPending) return Promise.resolve(null);
        if (attempt !== null) return attempt;
        if (Date.now() < retryAfter) return Promise.resolve(null);
        attempt = registerProjection().then((scope) => {
            attempt = null;
            if (scope === null) {
                retryAfter = Date.now() + INSTALL_RETRY_MS;
                return null;
            }
            installed = scope;
            return scope;
        });
        return attempt;
    };

    // Failure reasons are observed from the same official durable events
    // auto-continue reads; they never feed the engine fold. Registered once at
    // install time so retrying the projection cannot stack observers.
    try {
        const disposeFailure = typeof ctx.on === "function"
            ? ctx.on("session/event", (session, event) => {
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
                    // A counter keeps ids unique when two events share a millisecond.
                    id: "mf-" + Date.now().toString(36) + "-" + (++failureSeq).toString(36) + "-" + code,
                    sessionId: session.id,
                    kind,
                    code,
                    detail,
                    at: Number.isFinite(event.time) ? event.time : Date.now()
                });
                if (modelFailures.size > 200) modelFailures.delete(modelFailures.keys().next().value);
            })
            : null;
        if (typeof disposeFailure === "function") {
            ctx.effect(() => disposeFailure, "dsh-cockpit: statistics failure observation");
        }
    } catch (error) {
        warn("statistics failure observation skipped: " + (error?.message ?? String(error)));
    }

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
                const result = scanSessions(scope, { sessionId, limit, cache: snapshotCache });
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
