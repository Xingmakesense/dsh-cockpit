/**
 * dsh-cockpit auto-continue half.
 *
 * Overrides the official provider retry policy through the documented
 * `agent/request-error` waterfall: the listener runs first (`prepend`),
 * replaces `payload.retryPolicy` with this plugin's resolved policy, and
 * delegates with `next()`. The shipped `dsh-llm-retry` plugin then performs
 * the retries with that policy, so all recovery and backoff stay on official
 * controls while the budget, codes and delay belong to this plugin.
 *
 * Progress and terminal states are observed from the official durable
 * `llm/retry` / `turn/end` session events and exposed to the Client through
 * one same-origin snapshot route.
 */
import z from "./vendor/schemastery.mjs";

/** Defaults. */
const CONTINUE_DEFAULTS = {
    enabled: false,
    providerRetryMaxRetries: 3,
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
    /**
     * Forced provider retry budget: replaces the official retryPolicy maxRetries
     * for every provider, matching the old plugin's override key.
     */
    providerRetryMaxRetries: z.number().min(0).max(10).default(CONTINUE_DEFAULTS.providerRetryMaxRetries),
    /** Extra provider-independent continuations after the official budget is spent. */
    maxAttempts: z.number().min(1).max(50).default(CONTINUE_DEFAULTS.maxAttempts),
    delayMs: z.number().min(0).max(60_000).default(CONTINUE_DEFAULTS.delayMs),
    emitProminentError: z.boolean().default(CONTINUE_DEFAULTS.emitProminentError),
    retryableCodes: z.array(z.string()).default(CONTINUE_DEFAULTS.retryableCodes),
    blockedCodes: z.array(z.string()).default(CONTINUE_DEFAULTS.blockedCodes)
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
        providerRetryMaxRetries: typeof c.providerRetryMaxRetries === "number" && c.providerRetryMaxRetries >= 0
            ? Math.floor(c.providerRetryMaxRetries)
            : CONTINUE_DEFAULTS.providerRetryMaxRetries,
        maxAttempts: typeof c.maxAttempts === "number" && c.maxAttempts >= 1
            ? Math.floor(c.maxAttempts)
            : CONTINUE_DEFAULTS.maxAttempts,
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

/** Normalize one official `LlmFailure` into the code/message pair used by notices. */
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
    return { code, message };
}

/**
 * Build the official `ResolvedRetryPolicy` that replaces the provider policy.
 * @param {ReturnType<typeof normalizeContinueConfig>} cfg normalized config
 * @param {object | undefined} incoming the provider-resolved policy
 */
export function resolveRetryPolicy(cfg, incoming, round = 0) {
    const blocked = new Set(cfg.blockedCodes);
    const retryableCodes = [...new Set(cfg.retryableCodes.map((code) => String(code).toUpperCase()))]
        .filter((code) => !blocked.has(code));
    const fallback = incoming && typeof incoming === "object" ? incoming : {};
    const baseJitter = Number.isFinite(fallback.jitterRatio) ? fallback.jitterRatio : 0.1;
    return {
        mode: "normal",
        maxRetries: cfg.providerRetryMaxRetries,
        retryableCodes,
        initialDelayMs: cfg.delayMs,
        maxDelayMs: Math.max(cfg.delayMs, Number.isFinite(fallback.maxDelayMs) ? fallback.maxDelayMs : 10_000),
        // Each continuation must look like a fresh official policy: the
        // official retry executor keys its counter by this policy fingerprint,
        // so this negligible jitter delta restores the per-round provider
        // budget and reproduces the old (1 + provider) x (1 + extra) total.
        jitterRatio: baseJitter + round * 1e-9
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

/**
 * Install the official-policy override and the Client snapshot route.
 * @param {object} ctx host context
 * @param {unknown} config raw or volatile plugin config
 */
export function installAutoContinue(ctx, config) {
    const readConfig = configReader(config);
    const notices = new Map();
    let noticeSeq = 0;

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

    const publish = (sessionId, kind, details) => {
        if (!sessionId) return;
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

    /** Override first, then let the official retry executor enforce the policy. */
    /** Wait for the extra-continuation delay, cancelling with the turn signal. */
    const cancellableDelay = (delayMs, signal) => {
        if (delayMs <= 0) return Promise.resolve(!signal?.aborted);
        if (!signal) {
            return new Promise((resolve) => {
                const timer = setTimeout(resolve, delayMs);
                timer.unref?.();
            });
        }
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
    };

    const turnRounds = new Map();
    const sessionIdOf = (agent) => agent?.session?.id ?? agent?.id ?? null;

    /**
     * Force the official retry policy first, then add extra continuations after
     * the official executor declines. This keeps the old maxAttempts knob
     * meaningful without hidden messages: every extra round is an official
     * retry action on the same step.
     */
    const recover = async (payload, next) => {
        if (!payload || typeof payload !== "object" || typeof next !== "function") return next?.();
        const cfg = readConfig();
        if (!cfg.enabled) return next();
        const agent = payload.agent;
        const sessionId = sessionIdOf(agent);
        const turnKey = sessionId === null
            ? null
            : sessionId + ":" + String(Number.isSafeInteger(payload.turn) ? payload.turn : "?");
        const roundEntry = turnKey === null ? { round: 0 } : (turnRounds.get(turnKey) ?? { round: 0 });
        payload.retryPolicy = resolveRetryPolicy(cfg, payload.retryPolicy, roundEntry.round);
        const downstream = await next();
        if (downstream && downstream.kind === "retry") return downstream;
        if (payload.signal?.aborted) return downstream;
        const failure = payload.failure;
        if (!failure || !agent || sessionId === null || turnKey === null) return downstream;

        const classified = classifyContinueFailure(failure);
        if (cfg.blockedCodes.includes(classified.code) || !cfg.retryableCodes.includes(classified.code)) return downstream;

        if (roundEntry.round >= cfg.maxAttempts) {
            if (!roundEntry.halted) {
                roundEntry.halted = true;
                turnRounds.set(turnKey, roundEntry);
                if (cfg.emitProminentError) {
                    publish(sessionId, "halt", {
                        phase: "extra",
                        attempt: roundEntry.round,
                        max: cfg.maxAttempts,
                        code: classified.code,
                        detail: classified.message.slice(0, 300)
                    });
                }
            }
            return downstream;
        }

        roundEntry.round += 1;
        turnRounds.set(turnKey, roundEntry);
        if (turnRounds.size > 512) turnRounds.delete(turnRounds.keys().next().value);
        if (cfg.emitProminentError) {
            publish(sessionId, "retry", {
                phase: "extra",
                attempt: roundEntry.round,
                max: cfg.maxAttempts,
                code: classified.code,
                detail: classified.message.slice(0, 300)
            });
        }
        if (!await cancellableDelay(cfg.delayMs, payload.signal)) return downstream;
        if (payload.signal?.aborted) return downstream;
        return { kind: "retry" };
    };

    const disposers = [
        ctx.on("agent/request-error", recover, { prepend: true }),
        ctx.on("session/event", (session, event) => {
            if (!session || !event) return;
            const prefix = String(session.id) + ":";
            if (event.type === "turn/start" || event.type === "turn/end") {
                for (const key of turnRounds.keys()) {
                    if (key.startsWith(prefix)) turnRounds.delete(key);
                }
            }
            const cfg = readConfig();
            if (!cfg.enabled || !cfg.emitProminentError) return;
            if (event.type === "llm/retry") {
                const data = event.data;
                if (!data || !data.failure) return;
                const failure = classifyContinueFailure(data.failure);
                publish(session.id, "retry", {
                    phase: "provider",
                    attempt: data.retry,
                    max: data.maxRetries,
                    code: failure.code,
                    detail: failure.message.slice(0, 300)
                });
                return;
            }
            if (event.type !== "turn/end" || event.data?.reason?.kind !== "error") return;
            const failure = classifyContinueFailure(event.data.reason.error);
            if (!cfg.blockedCodes.includes(failure.code) && cfg.retryableCodes.includes(failure.code)) return;
            publish(session.id, "blocked", {
                code: failure.code,
                detail: failure.message.slice(0, 300),
                max: cfg.providerRetryMaxRetries
            });
        }),
        ctx.on("agent/disposed", ({ agent } = {}) => {
            const sessionId = sessionIdOf(agent);
            if (sessionId === null) return;
            const prefix = String(sessionId) + ":";
            for (const key of turnRounds.keys()) {
                if (key.startsWith(prefix)) turnRounds.delete(key);
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
            "[dsh-cockpit] auto-continue 已上线（覆盖官方 retryPolicy：上限 " +
            cfg.providerRetryMaxRetries + " 次·初始延迟 " + cfg.delayMs + "ms·提示 " + (cfg.emitProminentError ? "开" : "关") + "）"
        );
        if (!cfg.enabled) ctx.logger?.info?.("[dsh-cockpit] auto-continue 当前未启用（enabled: false），可在 设置 → 插件 → 自动续轮 中开启。");
    } catch {
        /* logging must never block installation */
    }
}
