/**
 * dsh-cockpit auto-continue half.
 *
 * Provider-independent terminal-failure retry engine. `agent/error` is the
 * fast path; a committed `turn/end` with reason.kind === "error" is the
 * durable fallback for providers that do not publish the former. One Turn is
 * armed at most once, and attempts are charged only after followup() actually
 * accepts the retry, never when a delayed delivery is merely queued.
 *
 * The retry message uses source.kind = "runtime-context". The agent loop
 * consumes it without appending a user message and rebuilds the request from
 * the existing conversation surface.
 */
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import z from "./vendor/schemastery.mjs";
import { createRemoteEventQueue } from "./downloads.js";

/** Defaults mirroring dsh-auto-continue 1.0.3. */
const CONTINUE_DEFAULTS = {
    enabled: false,
    maxAttempts: 6,
    delayMs: 1_500,
    retryableCodes: ["TRANSPORT", "TIMEOUT", "RATE_LIMIT", "SERVER", "EMPTY_RESPONSE", "UNKNOWN"],
    blockedCodes: ["AUTH", "AUTHENTICATION", "UNAUTHORIZED", "QUOTA", "ACCOUNT", "SIGN_IN", "SIGNIN", "BAD_REQUEST", "INVALID_REQUEST"],
    emitProminentError: true,
    providerRetryMaxRetries: 0
};

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
    providerRetryMaxRetries: z.number().min(0).max(10).default(CONTINUE_DEFAULTS.providerRetryMaxRetries),
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
        maxAttempts: typeof c.maxAttempts === "number" && c.maxAttempts >= 1 ? Math.floor(c.maxAttempts) : CONTINUE_DEFAULTS.maxAttempts,
        delayMs: typeof c.delayMs === "number" && c.delayMs >= 0 ? c.delayMs : CONTINUE_DEFAULTS.delayMs,
        retryableCodes: strArr(c.retryableCodes, CONTINUE_DEFAULTS.retryableCodes).map((code) => String(code).toUpperCase()),
        blockedCodes: strArr(c.blockedCodes, CONTINUE_DEFAULTS.blockedCodes).map((code) => String(code).toUpperCase()),
        emitProminentError: c.emitProminentError !== false,
        providerRetryMaxRetries: typeof c.providerRetryMaxRetries === "number" && c.providerRetryMaxRetries >= 0
            ? Math.floor(c.providerRetryMaxRetries)
            : CONTINUE_DEFAULTS.providerRetryMaxRetries
    };
}

/** Read the live config on every event (volatile refs update in place). */
function configReader(config) {
    return () => normalizeContinueConfig(isVolatileRef(config) ? config.get() : config);
}

/** Freeze a message graph the way dsh-llm does. */
function freezeMessage(message) {
    const clone = structuredClone(message);
    const walk = (value) => {
        if (value && typeof value === "object" && !Object.isFrozen(value)) {
            Object.freeze(value);
            for (const child of Object.values(value)) walk(child);
        }
        return value;
    };
    return walk(clone);
}

/** Build the inbox entry that wakes the driver without creating transcript prose. */
function continueMessage() {
    return freezeMessage({
        role: "user",
        content: [{ type: "text", text: "continue" }],
        source: { kind: "runtime-context" },
        id: randomUUID()
    });
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

/** Normalize either an `agent/error` error or a `turn/end` LlmFailure. */
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

/**
 * Install the provider-independent engine on a host context.
 * @param {object} ctx host context
 * @param {unknown} config raw or volatile plugin config
 */
export function installAutoContinue(ctx, config) {
    const readConfig = configReader(config);
    const state = new Map();
    const noticeEvents = {
        sources: new Set(),
        emit(agentId, message) {
            const frame = { event: "cockpit/auto-continue", args: [agentId, message] };
            for (const source of this.sources) source(frame);
        }
    };
    let customNoticeChannel = false;
    ctx.inject(["typertGateway"], (scope) => {
        customNoticeChannel = true;
        scope.effect(
            () => scope.typertGateway.registerRemoteEvents((signal) => createRemoteEventQueue(signal, noticeEvents), { home: homedir() }),
            "dsh-cockpit: auto-continue Remote notices"
        );
    });

    const entryOf = (id) => {
        let entry = state.get(id);
        if (!entry) {
            entry = {
                attempts: 0,
                pending: null,
                scheduled: null,
                armedTurn: null,
                haltNotified: false,
                generation: 0,
                timers: new Set()
            };
            state.set(id, entry);
        }
        return entry;
    };

    const warn = (message) => {
        try {
            ctx.logger.warn(`[dsh-cockpit] ${message}`);
        } catch {
            /* logging must never break the turn */
        }
    };

    const notify = (cfg, agentId, message) => {
        if (cfg.emitProminentError) {
            try {
                if (customNoticeChannel) noticeEvents.emit(agentId, message);
                else if (typeof ctx.emit === "function") ctx.emit("api-session/error", agentId, message);
            } catch {
                /* GUI relay unavailable */
            }
        }
        warn(message);
    };

    const clearTimers = (entry) => {
        for (const timer of entry.timers) clearTimeout(timer);
        entry.timers.clear();
    };

    /** Cancel pending and scheduled work without charging an attempt. */
    const cancelWork = (entry) => {
        entry.pending = null;
        entry.scheduled = null;
        clearTimers(entry);
    };

    const agentFor = (id) => {
        try {
            return ctx.get?.("agents")?.get(id) ?? ctx.agents?.get(id);
        } catch {
            return void 0;
        }
    };

    /** Schedule one pending failure after the driver reaches idle. */
    const schedule = (agent) => {
        const entry = state.get(agent.id);
        if (!entry || !entry.pending || entry.scheduled || agent.status !== "idle") return;
        const cfg = readConfig();
        if (!cfg.enabled) {
            cancelWork(entry);
            return;
        }

        const pending = entry.pending;
        entry.pending = null;
        const generation = entry.generation;
        const task = { timer: null };
        entry.scheduled = task;
        const delayMs = Math.max(cfg.delayMs, pending.retryAfterMs ?? 0);

        const send = () => {
            if (task.timer !== null) {
                entry.timers.delete(task.timer);
                task.timer = null;
            }
            if (entry.scheduled !== task) return;
            entry.scheduled = null;
            if (state.get(agent.id) !== entry) return;
            const current = readConfig();
            if (!current.enabled) {
                warn("投递前自动续轮已被关闭，放弃本次续轮（未消耗次数）");
                return;
            }
            if (entry.generation !== generation) {
                warn("期间已开始新一轮，放弃本次投递（未消耗次数）");
                return;
            }
            if (agent.status !== "idle") {
                warn("driver 非 idle，放弃本次投递（未消耗次数）");
                return;
            }
            if (entry.attempts >= current.maxAttempts) {
                if (!entry.haltNotified) {
                    entry.haltNotified = true;
                    notify(current, agent.id, `【自动续轮·已停止】连续失败 ${current.maxAttempts} 次，已交还给你处理。最后故障码 ${pending.code}。失败原因：${pending.detail}`);
                }
                return;
            }
            try {
                agent.followup(continueMessage());
                entry.attempts += 1;
                warn(`第 ${entry.attempts}/${current.maxAttempts} 次自动续轮（故障码 ${pending.code}：${pending.detail}）`);
            } catch (error) {
                warn(`自动重新发起请求失败（未消耗次数）：${error?.message ?? error}`);
            }
        };

        if (delayMs > 0) {
            task.timer = setTimeout(send, delayMs);
            entry.timers.add(task.timer);
            if (typeof task.timer.unref === "function") task.timer.unref();
        } else {
            send();
        }
    };

    /** Arm one terminal failure. Duplicate reports for the same Turn are ignored. */
    const armFailure = (agent, failure, turn, deliverIfIdle = false) => {
        try {
            if (!agent) return;
            const cfg = readConfig();
            if (!cfg.enabled) return;
            const turnKey = Number.isSafeInteger(turn) ? turn : null;
            const entry = entryOf(agent.id);
            if (turnKey !== null && entry.armedTurn === turnKey) return;
            entry.armedTurn = turnKey;
            cancelWork(entry);

            const code = String(failure.code || "UNKNOWN").toUpperCase();
            const detail = failure.message || "(无详情)";
            if (cfg.blockedCodes.includes(code)) {
                notify(cfg, agent.id, `【自动续轮·未启动】故障码 ${code} 属不可自愈错误，重试无意义。已交还给你处理。失败原因：${detail}`);
                return;
            }
            if (!cfg.retryableCodes.includes(code)) {
                notify(cfg, agent.id, `【自动续轮·未启动】故障码 ${code} 不在可重试清单内。已交还给你处理。失败原因：${detail}`);
                return;
            }
            if (entry.attempts >= cfg.maxAttempts) {
                if (!entry.haltNotified) {
                    entry.haltNotified = true;
                    notify(cfg, agent.id, `【自动续轮·已停止】连续失败 ${cfg.maxAttempts} 次，已交还给你处理。最后故障码 ${code}。失败原因：${detail}`);
                }
                return;
            }

            entry.pending = { code, detail, retryAfterMs: failure.retryAfterMs };
            const attempt = Math.min(entry.attempts + 1, cfg.maxAttempts);
            notify(cfg, agent.id, `【自动续轮】第 ${attempt}/${cfg.maxAttempts} 次 · 故障码 ${code} · 正在自动重新发起请求（不写入对话）。失败原因：${detail}`);
            if (deliverIfIdle) schedule(agent);
        } catch (error) {
            warn(`记录模型失败时出错，已放行：${error?.message ?? error}`);
        }
    };

    const onAgentError = (payload) => {
        const agent = payload?.agent;
        if (!agent) return;
        armFailure(agent, classifyContinueFailure(payload.error), payload.turn);
    };

    const onAgentStatus = (payload) => {
        try {
            const agent = payload?.agent;
            if (!agent || payload.status !== "idle") return;
            schedule(agent);
        } catch (error) {
            warn(`处理 agent/status 时出错，已放行：${error?.message ?? error}`);
        }
    };

    const onSessionEvent = (session, event) => {
        try {
            if (!session || !event) return;
            if (event.type === "turn/end") {
                const reason = event.data?.reason;
                if (reason?.kind === "error") {
                    armFailure(agentFor(session.id), classifyContinueFailure(reason.error), event.data?.turn, true);
                    return;
                }
                const entry = state.get(session.id);
                if (!entry) return;
                cancelWork(entry);
                entry.attempts = 0;
                entry.haltNotified = false;
                entry.armedTurn = null;
                return;
            }
            if (event.type === "turn/start") {
                const entry = state.get(session.id);
                if (!entry) return;
                cancelWork(entry);
                entry.armedTurn = null;
                entry.generation += 1;
            }
        } catch (error) {
            warn(`观察会话事件时出错，已放行：${error?.message ?? error}`);
        }
    };

    const onDisposed = (payload) => {
        const entry = payload?.agent ? state.get(payload.agent.id) : void 0;
        if (!entry) return;
        cancelWork(entry);
        state.delete(payload.agent.id);
    };

    const disposers = [
        ctx.on("agent/error", onAgentError),
        ctx.on("agent/status", onAgentStatus),
        ctx.on("session/event", onSessionEvent),
        ctx.on("agent/disposed", onDisposed)
    ];
    ctx.effect(() => () => {
        for (const dispose of disposers) {
            try {
                if (typeof dispose === "function") dispose();
            } catch {
                /* ignore */
            }
        }
        for (const entry of state.values()) clearTimers(entry);
        state.clear();
        noticeEvents.sources.clear();
    }, "dsh-cockpit: auto-continue lifecycle");

    const cfg = readConfig();
    const perRequest = 1 + cfg.providerRetryMaxRetries;
    const totalBudget = perRequest * (1 + cfg.maxAttempts);
    try {
        ctx.logger.info(
            `[dsh-cockpit] auto-continue 已上线（续轮上限 ${cfg.maxAttempts} 次·延迟 ${cfg.delayMs}ms·` +
            `可重试码 ${cfg.retryableCodes.join("/")}·提示 ${cfg.emitProminentError ? "开" : "关"}）`
        );
        ctx.logger.info(`[dsh-cockpit] auto-continue 总请求预算（展示口径，实际内层重试由 provider 决定）：单次请求 ${perRequest} 次 × 共 ${1 + cfg.maxAttempts} 轮 = ${totalBudget} 次。`);
        if (!cfg.enabled) ctx.logger.info("[dsh-cockpit] auto-continue 当前未启用（enabled: false），可在 设置 → 插件 → 自动续轮 中开启。");
    } catch {
        /* logging must never block installation */
    }
}
