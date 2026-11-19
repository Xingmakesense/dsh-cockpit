/**
 * dsh-cockpit auto-continue half.
 *
 * Built only on the official model-request recovery seam:
 * `agent/request-error` (a documented waterfall). DSH's own llm-retry plugin
 * owns provider-configured retries, so this listener delegates with `next()`
 * first and only adds provider-independent attempts after that policy gives
 * up. A retry reuses the open step and the already-prepared request assembly:
 * it writes no transcript message, needs no synthetic runtime context and
 * uses no internal event relay.
 */
import z from "./vendor/schemastery.mjs";

/** Defaults mirror the previous user-visible behaviour. */
const CONTINUE_DEFAULTS = {
    enabled: false,
    maxAttempts: 6,
    delayMs: 1_500,
    retryableCodes: ["TRANSPORT", "TIMEOUT", "RATE_LIMIT", "SERVER", "EMPTY_RESPONSE", "UNKNOWN"],
    blockedCodes: ["AUTH", "AUTHENTICATION", "UNAUTHORIZED", "QUOTA", "ACCOUNT", "SIGN_IN", "SIGNIN", "BAD_REQUEST", "INVALID_REQUEST"],
    emitProminentError: true
};

/** Same-origin route the Client polls for the current notice snapshot. */
export const AUTO_CONTINUE_ROUTE = "/api/cockpit/auto-continue";

/** Cosmokit's volatile-config reference protocol (shared across ESM/CJS copies). */
const VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");

/** Whether `value` is the live config reference handed to the plugin runtime. */
function isVolatileRef(value) {
    return typeof value === "object" && value !== null && VOLATILE_WRITE in value;
}

/**
 * Native Schemastery schema, imported from the vendored copy so Cordis and
 * `ctx.settings` always recognize it. Root `volatile()` lets the settings page
 * edit fields without remounting; the engine reads `config.get()` per event.
 */
export const Config = z.object({
    enabled: z.boolean().default(CONTINUE_DEFAULTS.enabled),
    maxAttempts: z.number().min(1).max(50).default(CONTINUE_DEFAULTS.maxAttempts),
    delayMs: z.number().min(0).max(60_000).default(CONTINUE_DEFAULTS.delayMs),
    emitProminentError: z.boolean().default(CONTINUE_DEFAULTS.emitProminentError),
    retryableCodes: z.array(z.string()).default(CONTINUE_DEFAULTS.retryableCodes),
    blockedCodes: z.array(z.string()).default(CONTINUE_DEFAULTS.blockedCodes),
    /**
     * Deprecated compatibility key: provider-level retry budgets are owned by
     * the official provider `retryPolicy` and `dsh-llm-retry`. Accepted so old
     * profile patches keep parsing, then ignored.
     */
    providerRetryMaxRetries: z.number().min(0).max(10).default(0)
}).volatile();

/**
 * Normalize the merged row config.
 * @param {unknown} config raw plugin config
 * @returns normalized auto-continue config
 */
export function normalizeContinueConfig(config) {
    const c = config !== null && typeof config === "object" ? config : {};
    const strArr = (value, fallback) => (Array.isArray(value) && value.length > 0 ? value : fallback);
    return {
        enabled: c.enabled === true,
        maxAttempts: typeof c.maxAttempts === "number" && c.maxAttempts >= 1 ? Math.floor(c.maxAttempts) : CONTINUE_DEFAULTS.maxAttempts,
        delayMs: typeof c.delayMs === "number" && c.delayMs >= 0 ? c.delayMs : CONTINUE_DEFAULTS.delayMs,
        retryableCodes: strArr(c.retryableCodes, CONTINUE_DEFAULTS.retryableCodes).map((code) => String(code).toUpperCase()),
        blockedCodes: strArr(c.blockedCodes, CONTINUE_DEFAULTS.blockedCodes).map((code) => String(code).toUpperCase()),
        emitProminentError: c.emitProminentError !== false
    };
}

/** Read the live config on every event (volatile refs update in place). */
function configReader(config) {
    return () => normalizeContinueConfig(isVolatileRef(config) ? config.get() : config);
}

const FAILURE_CODE_ALIASES = {
    ECONNRESET: "TRANSPORT",
    ECONNREFUSED: "TRANSPORT",
    ENETUNREACH: "TRANSPORT",
    EAI_AGAIN: "TRANSPORT",
    ETIMEDOUT: "TIMEOUT",
    DEADLINE_EXCEEDED: "TIMEOUT",
    UNAVAILABLE: "SERVER",
    INTERNAL: "SERVER",
    RESOURCE_EXHAUSTED: "RATE_LIMIT",
    PERMISSION_DENIED: "AUTH",
    INVALID_ARGUMENT: "BAD_REQUEST"
};

const HTTP_FAILURE_CODES = {
    401: "AUTH",
    403: "AUTH",
    408: "TIMEOUT",
    429: "RATE_LIMIT",
    500: "SERVER",
    502: "SERVER",
    503: "SERVER",
    504: "SERVER"
};

/** Explicitly non-recoverable quota wording, independent of provider/model. */
const HARD_QUOTA_RE = /insufficient[ _-]?(?:balance|funds)|quota\s+(?:is\s+)?exhausted|usage\s+limit|free\s+quota|recharge|wallet|余额不足|额度(?:不足|耗尽|已用完)|钱包余额|充值后继续使用/iu;

/** Normalize one official `LlmFailure` into the code/message pair used by the engine. */
export function classifyContinueFailure(error) {
    const failure = error && typeof error === "object" && error.failure && typeof error.failure === "object"
        ? error.failure
        : error;
    const rawCode = failure && typeof failure === "object" && "code" in failure ? failure.code : void 0;
    const rawMessage = failure && typeof failure === "object" && "message" in failure
        ? failure.message
        : failure === void 0 || failure === null
            ? "(无详情)"
            : String(failure);
    const message = typeof rawMessage === "string" && rawMessage.trim() ? rawMessage : "(无详情)";
    const textCode = String(rawCode || "UNKNOWN").toUpperCase();
    let code = FAILURE_CODE_ALIASES[textCode] ?? HTTP_FAILURE_CODES[textCode] ?? textCode;
    if (HARD_QUOTA_RE.test(message)) code = "QUOTA";
    const retryAfter = failure && typeof failure === "object" ? failure.providerRetryAfterMs : void 0;
    return {
        code,
        message,
        retryAfterMs: typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : void 0
    };
}

/** Resolve true when the delay elapsed, false when the turn signal aborted it. */
function cancellableDelay(delayMs, signal) {
    if (delayMs <= 0) return Promise.resolve(!signal?.aborted);
    if (!signal) return new Promise((resolve) => { const timer = setTimeout(resolve, delayMs); timer.unref?.(); });
    if (signal.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve(true);
        }, delayMs);
        function onAbort() {
            clearTimeout(timer);
            resolve(false);
        }
        signal.addEventListener("abort", onAbort, { once: true });
    });
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

/**
 * Install the provider-independent recovery layer on a host context.
 * @param {object} ctx host context
 * @param {unknown} config raw or volatile plugin config
 */
export function installAutoContinue(ctx, config) {
    const readConfig = configReader(config);
    const turnAttempts = new Map();
    const notices = new Map();
    let noticeSeq = 0;

    const sessionIdOf = (agent) => agent?.session?.id ?? agent?.id ?? null;

    const warn = (message) => {
        try {
            ctx.logger?.warn?.("[dsh-cockpit] " + message);
        } catch {
            /* logging must never break the turn */
        }
    };

    const pruneNotices = () => {
        const now = Date.now();
        for (const [id, notice] of notices) {
            if (notice.expiresAt !== null && notice.expiresAt <= now) notices.delete(id);
        }
    };

    const publishNotice = (agent, kind, details) => {
        const sessionId = sessionIdOf(agent);
        if (sessionId === null) return;
        const at = Date.now();
        notices.set(sessionId, {
            id: "ac-" + String(++noticeSeq),
            sessionId,
            kind,
            at,
            expiresAt: kind === "retry" ? at + 12_000 : at + 120_000,
            ...details
        });
        if (notices.size > 256) notices.delete(notices.keys().next().value);
    };

    const notify = (cfg, agent, kind, details) => {
        if (!cfg.emitProminentError) return;
        publishNotice(agent, kind, details);
    };

    const turnKeyOf = (agent, turn) => {
        const sessionId = sessionIdOf(agent);
        return sessionId === null ? null : sessionId + ":" + String(Number.isSafeInteger(turn) ? turn : "?");
    };

    /** The official waterfall: delegate first, add attempts only after it declines. */
    const recover = async (payload, next) => {
        let downstream;
        try {
            downstream = typeof next === "function" ? await next() : void 0;
        } catch (error) {
            /* A downstream recovery failure stays downstream's to report. */
            throw error;
        }
        if (downstream && downstream.kind === "retry") return downstream;
        const cfg = readConfig();
        if (!cfg.enabled) return downstream;
        const agent = payload?.agent;
        const failure = payload?.failure;
        const signal = payload?.signal;
        if (!agent || !failure || signal?.aborted) return downstream;

        const classified = classifyContinueFailure(failure);
        if (cfg.blockedCodes.includes(classified.code)) {
            notify(cfg, agent, "blocked", {
                code: classified.code,
                detail: classified.message.slice(0, 300),
                max: cfg.maxAttempts
            });
            return downstream;
        }
        if (!cfg.retryableCodes.includes(classified.code)) return downstream;

        const key = turnKeyOf(agent, payload.turn);
        if (key === null) return downstream;
        const entry = turnAttempts.get(key) ?? { attempts: 0, halted: false };
        if (entry.attempts >= cfg.maxAttempts) {
            if (!entry.halted) {
                entry.halted = true;
                turnAttempts.set(key, entry);
                notify(cfg, agent, "halt", {
                    code: classified.code,
                    detail: classified.message.slice(0, 300),
                    attempt: entry.attempts,
                    max: cfg.maxAttempts
                });
            }
            return downstream;
        }

        entry.attempts += 1;
        turnAttempts.set(key, entry);
        if (turnAttempts.size > 512) turnAttempts.delete(turnAttempts.keys().next().value);
        notify(cfg, agent, "retry", {
            code: classified.code,
            detail: classified.message.slice(0, 300),
            attempt: entry.attempts,
            max: cfg.maxAttempts
        });
        warn("第 " + entry.attempts + "/" + cfg.maxAttempts + " 次自动续轮（故障码 " + classified.code + "）");
        const delayMs = Math.max(cfg.delayMs, classified.retryAfterMs ?? 0);
        if (!await cancellableDelay(delayMs, signal)) return downstream;
        if (signal?.aborted) return downstream;
        return { kind: "retry" };
    };

    const disposers = [
        ctx.on("agent/request-error", (payload, next) => recover(payload, next)),
        ctx.on("session/event", (session, event) => {
            if (!session || !event) return;
            if (event.type !== "turn/start" && event.type !== "turn/end") return;
            const prefix = String(session.id) + ":";
            for (const key of turnAttempts.keys()) {
                if (key.startsWith(prefix)) turnAttempts.delete(key);
            }
        }),
        ctx.on("agent/disposed", ({ agent } = {}) => {
            const sessionId = sessionIdOf(agent);
            if (sessionId === null) return;
            const prefix = String(sessionId) + ":";
            for (const key of turnAttempts.keys()) {
                if (key.startsWith(prefix)) turnAttempts.delete(key);
            }
            notices.delete(sessionId);
        })
    ];

    ctx.effect(() => () => {
        for (const dispose of disposers) {
            try {
                if (typeof dispose === "function") dispose();
            } catch {
                /* ignore */
            }
        }
        turnAttempts.clear();
        notices.clear();
    }, "dsh-cockpit: auto-continue lifecycle");

    // Client snapshot route (official same-origin HTTP surface).
    try {
        const connection = typeof ctx.get === "function" ? ctx.get("connection") : ctx.connection;
        const route = {
            path: AUTO_CONTINUE_ROUTE,
            methods: ["GET"],
            requestBody: "buffered",
            fetch: async () => {
                pruneNotices();
                return jsonResponse(200, { ok: true, value: { notices: [...notices.values()] } });
            }
        };
        if (typeof connection?.fetch?.register === "function") {
            const registered = connection.fetch.register(route);
            if (typeof registered === "function") {
                ctx.effect(() => registered, "dsh-cockpit: auto-continue route");
            }
        } else if (typeof ctx.inject === "function") {
            ctx.inject(["connection"], (scope) => {
                scope.effect(() => scope.connection.fetch.register(route), "dsh-cockpit: auto-continue route");
            });
        }
    } catch (error) {
        warn("auto-continue route skipped: " + (error?.message ?? String(error)));
    }

    const cfg = readConfig();
    try {
        ctx.logger?.info?.(
            "[dsh-cockpit] auto-continue 已上线（官方 agent/request-error 重试钩子；额外续轮上限 " +
            cfg.maxAttempts + " 次·延迟 " + cfg.delayMs + "ms·提示 " + (cfg.emitProminentError ? "开" : "关") + "）"
        );
        if (!cfg.enabled) ctx.logger?.info?.("[dsh-cockpit] auto-continue 当前未启用（enabled: false），可在 设置 → 插件 → 自动续轮 中开启。");
    } catch {
        /* logging must never block installation */
    }
}
