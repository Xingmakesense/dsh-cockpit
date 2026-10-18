/**
 * Auto-continue half of dsh-cockpit.
 *
 * Responsibilities
 *  - `Config`: native volatile Schemastery schema exposed to `ctx.settings`.
 *  - `normalizeContinueConfig`: one place that turns raw/volatile config into
 *    a plain snapshot (exported for the unit tests).
 *  - `installAutoContinue`: the engine. It counts failures (`agent/error`),
 *    re-drives the agent once it is idle, and reports a compact notice through
 *    `api-session/error` (the client turns that into an inline strip).
 *
 * The retry is deliberately message-less from the transcript's point of view:
 * the inbox gets a `runtime-context` entry, the agent loop consumes it without
 * appending it, and the request is rebuilt from the existing surface.
 *
 * There is no compatibility surface left: `continueText`/`haltText` were
 * removed in 2.7.0 because neither is written anywhere any more.
 */
import { randomUUID } from "node:crypto";
import z from "./vendor/schemastery.mjs";

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

/**
 * Build the inbox entry that wakes the driver. The agent loop drops
 * `runtime-context` entries from the transcript, so the content is irrelevant;
 * the source kind is the whole contract.
 */
function continueMessage() {
    return freezeMessage({
        role: "user",
        content: [{ type: "text", text: "continue" }],
        source: { kind: "runtime-context" },
        id: randomUUID()
    });
}

/** Normalize an `agent/error` payload into `{code, message}`. */
function failureOf(error) {
    if (!error) return { code: "UNKNOWN", message: "(无详情)" };
    const failure = error.failure;
    if (failure && typeof failure === "object") {
        return { code: failure.code || "UNKNOWN", message: failure.message || String(failure.code || "") };
    }
    return { code: error.code || "UNKNOWN", message: error.message || String(error) };
}

/**
 * Install the engine on a host context.
 * @param {object} ctx host context
 * @param {unknown} config raw or volatile plugin config
 */
export function installAutoContinue(ctx, config) {
    const readConfig = configReader(config);

    // per-agent: attempts, pending retry, halt-notice latch, generation
    const state = new Map();
    const entryOf = (id) => {
        let entry = state.get(id);
        if (!entry) {
            entry = { attempts: 0, pending: null, haltNotified: false, generation: 0 };
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
                if (typeof ctx.emit === "function") ctx.emit("api-session/error", agentId, message);
            } catch {
                /* GUI relay unavailable */
            }
        }
        warn(message);
    };

    const onAgentError = (payload) => {
        try {
            const agent = payload && payload.agent;
            if (!agent) return;
            const cfg = readConfig();
            if (!cfg.enabled) return;
            const { code: rawCode, message } = failureOf(payload.error);
            const code = String(rawCode || "UNKNOWN").toUpperCase();
            const detail = message || "(无详情)";
            const entry = entryOf(agent.id);

            if (cfg.blockedCodes.includes(code)) {
                entry.pending = null;
                notify(cfg, agent.id, `【自动续轮·未启动】故障码 ${code} 属不可自愈错误，重试无意义。已交还给你处理。失败原因：${detail}`);
                return;
            }
            if (!cfg.retryableCodes.includes(code)) {
                entry.pending = null;
                notify(cfg, agent.id, `【自动续轮·未启动】故障码 ${code} 不在可重试清单内。已交还给你处理。失败原因：${detail}`);
                return;
            }
            if (entry.attempts >= cfg.maxAttempts) {
                entry.pending = null;
                if (!entry.haltNotified) {
                    entry.haltNotified = true;
                    notify(cfg, agent.id, `【自动续轮·已停止】连续失败 ${cfg.maxAttempts} 次，已交还给你处理。最后故障码 ${code}。请检查网络或服务状态后手动继续。失败原因：${detail}`);
                }
                return;
            }
            entry.pending = { code, detail };
            const attempt = Math.min(entry.attempts + 1, cfg.maxAttempts);
            notify(cfg, agent.id, `【自动续轮】第 ${attempt}/${cfg.maxAttempts} 次 · 故障码 ${code} · 正在自动重新发起请求（不写入对话）。失败原因：${detail}`);
        } catch (error) {
            warn(`处理 agent/error 时出错，已放行：${error?.message ?? error}`);
        }
    };

    const onAgentStatus = (payload) => {
        try {
            const agent = payload && payload.agent;
            if (!agent || payload.status !== "idle") return;
            const entry = state.get(agent.id);
            if (!entry || !entry.pending) return;
            const cfg = readConfig();
            if (!cfg.enabled) return;

            const pending = entry.pending;
            entry.pending = null;
            entry.attempts += 1;
            const attempt = entry.attempts;
            const generation = entry.generation;
            const send = () => {
                try {
                    if (state.get(agent.id) !== entry) return;
                    // The settings page can flip `enabled` during the delay.
                    if (!readConfig().enabled) {
                        entry.attempts = Math.max(0, entry.attempts - 1);
                        warn("投递前自动续轮已被关闭，放弃本次续轮");
                        return;
                    }
                    if (entry.generation !== generation) {
                        warn("期间已开始新一轮，放弃本次投递（让位给用户/上游）");
                        return;
                    }
                    if (agent.status !== "idle") {
                        warn("driver 非 idle，放弃本次投递");
                        return;
                    }
                    agent.followup(continueMessage());
                    warn(`第 ${attempt}/${cfg.maxAttempts} 次自动续轮（故障码 ${pending.code}：${pending.detail}）`);
                } catch (error) {
                    warn(`自动重新发起请求失败：${error?.message ?? error}`);
                }
            };
            if (cfg.delayMs > 0) {
                const timer = setTimeout(send, cfg.delayMs);
                if (typeof timer.unref === "function") timer.unref();
            } else {
                send();
            }
        } catch (error) {
            warn(`处理 agent/status 时出错，已放行：${error?.message ?? error}`);
        }
    };

    const onSessionEvent = (session, event) => {
        try {
            if (!session || !event) return;
            const entry = state.get(session.id);
            if (!entry) return;
            if (event.type === "turn/end") {
                const reason = event.data && event.data.reason;
                if (!reason || reason.kind !== "error") {
                    entry.attempts = 0;
                    entry.pending = null;
                    entry.haltNotified = false;
                }
                return;
            }
            if (event.type === "turn/start") {
                entry.pending = null;
                entry.generation += 1;
            }
        } catch {
            /* observation must not break the turn */
        }
    };

    const onDisposed = (payload) => {
        try {
            if (payload && payload.agent) state.delete(payload.agent.id);
        } catch {
            /* ignore */
        }
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
    });

    const cfg = readConfig();
    const perRequest = 1 + cfg.providerRetryMaxRetries;
    const totalBudget = perRequest * (1 + cfg.maxAttempts);
    try {
        ctx.logger.info(
            `[dsh-cockpit] auto-continue 已上线（续轮上限 ${cfg.maxAttempts} 次·延迟 ${cfg.delayMs}ms·` +
            `可重试码 ${cfg.retryableCodes.join("/")}·提示 ${cfg.emitProminentError ? "开" : "关"}）`
        );
        ctx.logger.info(`[dsh-cockpit] auto-continue 总请求预算：单次请求 ${perRequest} 次 × 共 ${1 + cfg.maxAttempts} 轮 = ${totalBudget} 次。`);
        if (!cfg.enabled) ctx.logger.info("[dsh-cockpit] auto-continue 当前未启用（enabled: false），可在 设置 → 插件 → 自动续轮 中开启。");
    } catch {
        /* logging must never block installation */
    }
}
