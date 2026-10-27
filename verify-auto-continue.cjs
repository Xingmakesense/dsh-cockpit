// Auto-continue engine checks with a fake Cordis context.
//
// `apply()` installs the merged dsh-auto-continue handlers on the context, so a
// tiny mock drives the real event order without a host:
//   agent/error -> agent/status(idle) -> hidden runtime-context retry, plus
//   turn/end re-arming and live (volatile) config reads.
const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");

function makeContext() {
    const handlers = new Map();
    const emitted = [];
    const logs = [];
    const disposers = [];

    const ctx = {
        on(event, handler) {
            if (!handlers.has(event)) handlers.set(event, []);
            handlers.get(event).push(handler);
            return () => {
                const list = handlers.get(event) ?? [];
                const index = list.indexOf(handler);
                if (index >= 0) list.splice(index, 1);
            };
        },
        emit(event, ...args) {
            emitted.push({ event, args });
        },
        logger: {
            info: (message) => logs.push({ level: "info", message }),
            warn: (message) => logs.push({ level: "warn", message }),
            error: (message) => logs.push({ level: "error", message })
        },
        effect(setup) {
            const dispose = setup();
            if (typeof dispose === "function") disposers.push(dispose);
        },
        // The archive half waits for host services; the mock never provides
        // them, so no archive handler is installed here.
        inject() {}
    };

    const fire = (event, ...args) => {
        for (const handler of handlers.get(event) ?? []) handler(...args);
    };

    return { ctx, fire, emitted, logs, disposers };
}

function makeAgent(id = "a1") {
    const delivered = [];
    const agent = {
        id,
        status: "idle",
        followup(message) {
            delivered.push(message);
        }
    };
    return { agent, delivered };
}

function volatileConfig(initial) {
    let current = { ...initial };
    return {
        get: () => current,
        [VOLATILE_WRITE]: (next) => {
            current = next;
        },
        replace: (next) => {
            current = next;
        }
    };
}

const failure = (code, message = `${code} failure`) => ({ failure: { code, message } });

async function main() {
    const { apply } = await import("./host.js");
    const { Config, normalizeContinueConfig, overrideRetryPolicyForAllModels } = await import("./auto-continue.js");

    // --- config schema ---------------------------------------------------------
    assert(
        (typeof Config === "object" || typeof Config === "function") && Config !== null,
        "Config must stay exported for the harness"
    );
    assert(
        Reflect.get(Config, Symbol.for("schemastery")) === true && Config.type === "object" && Config.meta?.volatile === true,
        "Config must be a native volatile Schemastery schema (settings projection depends on it)"
    );
    assert(normalizeContinueConfig({ maxAttempts: 0 }).maxAttempts === 6, "invalid attempts must fall back");

    // --- providerRetryMaxRetries actually overrides every provider's policy ---
    {
        const overridden = overrideRetryPolicyForAllModels({
            retryPolicy: {
                mode: "normal",
                maxRetries: 5,
                retryableCodes: ["TRANSPORT"],
                initialDelayMs: 1000,
                maxDelayMs: 30000,
                jitterRatio: 0.2
            }
        }, normalizeContinueConfig({ providerRetryMaxRetries: 3 }));
        assert(overridden.mode === "normal" && overridden.maxRetries === 3, "system maxRetries=5 must become 3");
        assert(overridden.retryableCodes.length === 1 && overridden.initialDelayMs === 1000 && overridden.maxDelayMs === 30000 && overridden.jitterRatio === 0.2,
            "provider-specific retry codes and backoff must be preserved");
        const always = overrideRetryPolicyForAllModels({
            retryPolicy: { mode: "always", initialDelayMs: 100, maxDelayMs: 1000, jitterRatio: 0 }
        }, normalizeContinueConfig({ providerRetryMaxRetries: 3 }));
        assert(always.mode === "normal" && always.maxRetries === 3, "an uncapped always policy must also become capped at 3");
        const fallback = overrideRetryPolicyForAllModels({ retryPolicy: undefined }, normalizeContinueConfig({ providerRetryMaxRetries: 3 }));
        assert(fallback.maxRetries === 3 && fallback.retryableCodes.includes("TIMEOUT"), "an absent provider policy must receive a complete default");
    }
    {
        const { ctx, fire } = makeContext();
        await apply(ctx, { enabled: true, providerRetryMaxRetries: 3 });
        const { agent } = makeAgent();
        const payload = {
            agent,
            turn: 1,
            step: 1,
            provider: "kimi",
            failure: failure("TRANSPORT"),
            retryPolicy: { mode: "normal", maxRetries: 5, retryableCodes: ["TRANSPORT"], initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 },
            signal: new AbortController().signal
        };
        fire("agent/request-error", payload, () => Promise.resolve({ kind: "retry" }));
        assert(payload.retryPolicy.maxRetries === 3, "agent/request-error must apply the override to Kimi and every other provider");
    }

    // --- retryable failure -> one hidden retry, never a user message ----------
    {
        const { ctx, fire, emitted } = makeContext();
        await apply(ctx, { enabled: true, delayMs: 0 });
        const { agent, delivered } = makeAgent();
        fire("agent/error", { agent, error: failure("TRANSPORT"), turn: 1 });
        fire("agent/status", { agent, status: "idle" });
        assert(delivered.length === 1, "a retryable failure must schedule exactly one retry");
        assert(delivered[0].role === "user", "retry message must be a user-role message");
        assert(
            delivered[0].source && delivered[0].source.kind === "runtime-context",
            "retry must ride the hidden runtime-context source, not the user channel"
        );
        assert(delivered[0].content[0].type === "text", "retry message must carry text content");
        assert(emitted.length === 1, "a retry must report one notice to the client overlay");
        assert(emitted[0].event === "api-session/error", "the notice must ride api-session/error");
        const notice = String(emitted[0].args[1]);
        assert(notice.includes("【自动续轮】") && notice.includes("第 1/6 次"), "notice must name the attempt");
        assert(notice.includes("TRANSPORT"), "notice must carry the failure code");

        // A successful turn re-arms the counter.
        fire("session/event", { id: agent.id }, { type: "turn/end", data: { reason: { kind: "completed" } } });
        fire("agent/error", { agent, error: failure("TIMEOUT"), turn: 2 });
        fire("agent/status", { agent, status: "idle" });
        assert(delivered.length === 2, "counter must reset after a successful turn");
        assert(String(emitted[1].args[1]).includes("第 1/6 次"), "re-armed chain restarts at attempt 1");
    }

    // --- emitProminentError: false silences the notice, not the retry --------
    {
        const { ctx, fire, emitted } = makeContext();
        await apply(ctx, { enabled: true, delayMs: 0, emitProminentError: false });
        const { agent, delivered } = makeAgent();
        fire("agent/error", { agent, error: failure("TRANSPORT"), turn: 1 });
        fire("agent/status", { agent, status: "idle" });
        assert(delivered.length === 1, "the retry must still happen with notices disabled");
        assert(emitted.length === 0, "no notice may be emitted when emitProminentError is false");
    }

    // --- blocked / non-retryable codes never continue --------------------------
    for (const code of ["AUTH", "SOMETHING_NEW"]) {
        const { ctx, fire, emitted } = makeContext();
        await apply(ctx, { enabled: true, delayMs: 0 });
        const { agent, delivered } = makeAgent();
        fire("agent/error", { agent, error: failure(code), turn: 1 });
        fire("agent/status", { agent, status: "idle" });
        assert(delivered.length === 0, `${code} must never auto-continue`);
        assert(emitted.length === 1 && emitted[0].event === "api-session/error", `${code} must raise one notice`);
        const notice = String(emitted[0].args[1]);
        assert(notice.includes("【自动续轮·未启动】"), "blocked codes must be labelled as not started");
        assert(notice.includes(code), "notice must name the failure code");
    }

    // --- attempt cap: no message, one halt notice ------------------------------
    {
        const { ctx, fire, emitted } = makeContext();
        await apply(ctx, { enabled: true, delayMs: 0, maxAttempts: 2 });
        const { agent, delivered } = makeAgent();
        for (let turn = 1; turn <= 2; turn += 1) {
            fire("agent/error", { agent, error: failure("RATE_LIMIT"), turn });
            fire("agent/status", { agent, status: "idle" });
        }
        assert(delivered.length === 2, "maxAttempts retries must be scheduled");

        const beforeCap = emitted.length;
        fire("agent/error", { agent, error: failure("RATE_LIMIT"), turn: 3 });
        assert(emitted.length === beforeCap + 1, "reaching the cap must raise the halt notice");
        assert(String(emitted[emitted.length - 1].args[1]).includes("【自动续轮·已停止】"), "halt notice must be labelled stopped");
        fire("agent/status", { agent, status: "idle" });
        assert(delivered.length === 2, "the halt notice must not be delivered as a message");

        // Further failures keep the chain halted without repeating the notice.
        const afterHalt = emitted.length;
        fire("agent/error", { agent, error: failure("RATE_LIMIT"), turn: 4 });
        fire("agent/status", { agent, status: "idle" });
        assert(emitted.length === afterHalt, "halt notice must be emitted once per failure chain");
    }

    // --- disabled config: handler stays installed but does nothing ------------
    {
        const { ctx, fire, logs } = makeContext();
        await apply(ctx, { enabled: false });
        const { agent, delivered } = makeAgent();
        fire("agent/error", { agent, error: failure("TRANSPORT"), turn: 1 });
        fire("agent/status", { agent, status: "idle" });
        assert(delivered.length === 0, "disabled auto-continue must not retry");
        assert(
            logs.some((entry) => entry.level === "info" && entry.message.includes("未启用")),
            "disabled auto-continue must log that it is off"
        );
    }

    // --- live config: enabling without remount --------------------------------
    {
        const { ctx, fire } = makeContext();
        const config = volatileConfig({ enabled: false, delayMs: 0 });
        await apply(ctx, config);
        const { agent, delivered } = makeAgent();
        fire("agent/error", { agent, error: failure("SERVER"), turn: 1 });
        fire("agent/status", { agent, status: "idle" });
        assert(delivered.length === 0, "volatile config must gate the handler");

        config.replace({ enabled: true, delayMs: 0 });
        fire("agent/error", { agent, error: failure("SERVER"), turn: 2 });
        fire("agent/status", { agent, status: "idle" });
        assert(delivered.length === 1, "enabling the volatile config must take effect without remount");
    }

    // --- delay + generation guard ---------------------------------------------
    {
        const { ctx, fire } = makeContext();
        await apply(ctx, { enabled: true, delayMs: 20 });
        const { agent, delivered } = makeAgent();
        fire("agent/error", { agent, error: failure("SERVER"), turn: 1 });
        fire("agent/status", { agent, status: "idle" });
        fire("session/event", { id: agent.id }, { type: "turn/start", data: {} });
        await sleep(60);
        assert(delivered.length === 0, "a new turn must cancel a pending delayed retry");
        fire("agent/error", { agent, error: failure("SERVER"), turn: 2 });
        fire("agent/status", { agent, status: "idle" });
        await sleep(60);
        assert(delivered.length === 1, "cancelling a delayed retry must not consume the attempt budget");
    }

    // --- turn/end fallback and per-Turn dedupe --------------------------------
    {
        const { ctx, fire, emitted } = makeContext();
        const { agent, delivered } = makeAgent();
        ctx.agents = { get: (id) => id === agent.id ? agent : undefined };
        await apply(ctx, { enabled: true, delayMs: 0 });
        fire("session/event", { id: agent.id }, {
            type: "turn/end",
            data: { turn: 1, reason: { kind: "error", error: { code: "TIMEOUT", message: "pi-ai stream idle timeout" } } }
        });
        assert(delivered.length === 1, "a terminal turn/end error must arm continuation without agent/error");
        assert(emitted.length === 1, "the turn/end fallback must publish one notice");
    }
    {
        const { ctx, fire, emitted } = makeContext();
        const { agent, delivered } = makeAgent();
        ctx.agents = { get: () => agent };
        await apply(ctx, { enabled: true, delayMs: 0 });
        fire("agent/error", { agent, error: failure("TRANSPORT"), turn: 1 });
        fire("session/event", { id: agent.id }, {
            type: "turn/end",
            data: { turn: 1, reason: { kind: "error", error: { code: "TRANSPORT", message: "TRANSPORT failure" } } }
        });
        fire("agent/status", { agent, status: "idle" });
        assert(delivered.length === 1, "agent/error and turn/end for the same Turn must charge once");
        assert(emitted.length === 1, "the same Turn must not emit duplicate notices");
    }

    // --- explicit quota is never retried, including a rate-limit-shaped report -
    for (const failureValue of [
        { code: "QUOTA", message: "TeamoRouter 钱包余额不足，请充值后继续使用" },
        { code: "RATE_LIMIT", message: "You've reached your 5-hour usage limit. Please purchase extra usage." }
    ]) {
        const { ctx, fire, emitted } = makeContext();
        const { agent, delivered } = makeAgent();
        ctx.agents = { get: () => agent };
        await apply(ctx, { enabled: true, delayMs: 0 });
        fire("session/event", { id: agent.id }, {
            type: "turn/end",
            data: { turn: 1, reason: { kind: "error", error: failureValue } }
        });
        assert(delivered.length === 0, "hard quota must never be retried");
        assert(emitted.length === 1 && emitted[0].args[1].includes("QUOTA"), "hard quota must be reported as QUOTA");
    }

    // --- disposal cancels a delayed retry --------------------------------------
    {
        const { ctx, fire, disposers } = makeContext();
        await apply(ctx, { enabled: true, delayMs: 20 });
        const { agent, delivered } = makeAgent();
        fire("agent/error", { agent, error: failure("SERVER"), turn: 1 });
        fire("agent/status", { agent, status: "idle" });
        for (const dispose of disposers) dispose();
        await sleep(60);
        assert(delivered.length === 0, "plugin disposal must clear every delayed retry timer");
    }

    // --- agent disposal forgets the counter -----------------------------------
    {
        const { ctx, fire } = makeContext();
        await apply(ctx, { enabled: true, delayMs: 0, maxAttempts: 1 });
        const { agent, delivered } = makeAgent();
        fire("agent/error", { agent, error: failure("EMPTY_RESPONSE"), turn: 1 });
        fire("agent/disposed", { agent });
        fire("agent/status", { agent, status: "idle" });
        assert(delivered.length === 0, "a disposed agent must not receive a retry");
    }

    console.log("all auto-continue engine checks passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
