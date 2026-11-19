// Auto-continue checks: official retry-policy override and notice snapshot.
const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

async function main() {
    const { Config, normalizeContinueConfig, classifyContinueFailure, resolveRetryPolicy, installAutoContinue, AUTO_CONTINUE_ROUTE } = await import("./auto-continue.js");

    assert(Reflect.get(Config, Symbol.for("schemastery")) === true, "Config must be a native Schemastery schema");
    assert(Config.meta?.volatile === true, "Config root must be volatile for live settings");

    const off = normalizeContinueConfig(undefined);
    assert(off.enabled === false, "auto-continue must stay disabled unless configured");
    assert(off.maxAttempts === 6 && off.delayMs === 1500, "defaults must stay stable");
    assert(off.retryableCodes.includes("TIMEOUT") && off.blockedCodes.includes("AUTH"), "code lists must match");

    const on = normalizeContinueConfig({
        enabled: true,
        maxAttempts: 3,
        delayMs: 250,
        emitProminentError: true,
        retryableCodes: ["timeout", "auth", "server"],
        blockedCodes: ["auth"]
    });
    assert(on.enabled === true && on.maxAttempts === 3 && on.delayMs === 250, "config must be normalized");
    assert(on.retryableCodes[0] === "TIMEOUT", "codes must be upper-cased");

    assert(classifyContinueFailure({ code: "ETIMEDOUT", message: "x" }).code === "TIMEOUT", "error aliases must classify");
    assert(classifyContinueFailure({ code: "X", message: "余额不足" }).code === "QUOTA", "hard quota wording must classify");

    const policy = resolveRetryPolicy(on, { mode: "normal", maxRetries: 9, retryableCodes: ["TIMEOUT"], initialDelayMs: 1, maxDelayMs: 7000, jitterRatio: 0.2 });
    assert(policy.mode === "normal" && policy.maxRetries === 3, "the policy must carry the configured retry budget");
    assert(policy.initialDelayMs === 250 && policy.maxDelayMs === 7000 && policy.jitterRatio === 0.2, "backoff must be configured and preserved");
    assert(!policy.retryableCodes.includes("AUTH"), "blocked codes must be removed from the retryable set");

    // ---- fake host -------------------------------------------------------
    const listeners = new Map();
    const effects = [];
    let registeredRoute;
    const ctx = {
        logger: { warn() {}, info() {} },
        on(event, handler, options) {
            listeners.set(event, { handler, options });
            return () => listeners.delete(event);
        },
        effect(setup) {
            const dispose = setup();
            effects.push(dispose);
            return dispose;
        },
        get(name) {
            if (name !== "connection") return undefined;
            return {
                fetch: {
                    register(route) {
                        registeredRoute = route;
                        return () => {};
                    }
                }
            };
        },
        inject() {}
    };
    installAutoContinue(ctx, on);
    const recover = listeners.get("agent/request-error");
    assert(recover !== undefined, "auto-continue must register on agent/request-error");
    assert(recover.options?.prepend === true, "the override must run before the official retry listener");
    const sessionEvents = listeners.get("session/event").handler;
    const enabledRoute = registeredRoute;
    assert(registeredRoute?.path === AUTO_CONTINUE_ROUTE, "auto-continue must expose the client snapshot route");

    const noticeSnapshot = async () => {
        const response = await enabledRoute.fetch(new Request("http://localhost" + AUTO_CONTINUE_ROUTE));
        return (await response.json()).value.notices;
    };

    // Override: the provider policy is replaced and the official executor is
    // still invited through next().
    const original = { mode: "normal", maxRetries: 9, retryableCodes: ["TIMEOUT"], initialDelayMs: 1, maxDelayMs: 7000, jitterRatio: 0.2 };
    const payload = {
        agent: { id: "agent-1", session: { id: "session-1" } },
        turn: 1,
        step: 1,
        provider: "provider",
        failure: { code: "TIMEOUT", message: "timeout" },
        retryPolicy: original,
        signal: new AbortController().signal
    };
    let nextCalls = 0;
    await recover.handler(payload, async () => { nextCalls += 1; return undefined; });
    assert(nextCalls === 1, "the official retry executor must still be delegated to");
    assert(payload.retryPolicy !== original, "the provider policy must be replaced by the cockpit policy");
    assert(payload.retryPolicy.maxRetries === 3 && payload.retryPolicy.initialDelayMs === 250,
        "the replacement policy must carry the configured budget and delay");
    assert(!payload.retryPolicy.retryableCodes.includes("AUTH"), "blocked codes must not retry");

    // Disabled: the official policy is untouched.
    const disabledCtx = {
        ...ctx,
        on(event, handler, options) {
            listeners.set(event, { handler, options });
            return () => {};
        },
        effect(setup) { const dispose = setup(); return dispose; }
    };
    installAutoContinue(disabledCtx, { ...on, enabled: false });
    const disabledRecover = listeners.get("agent/request-error").handler;
    const disabledPayload = { ...payload, retryPolicy: original };
    await disabledRecover(disabledPayload, async () => { nextCalls += 1; return undefined; });
    assert(disabledPayload.retryPolicy === original, "a disabled plugin must leave the official policy alone");

    // Notices come from official durable session events.
    sessionEvents({ id: "session-1" }, {
        type: "llm/retry",
        data: { retry: 2, maxRetries: 3, failure: { code: "TIMEOUT", message: "timeout" } }
    });
    let notices = await noticeSnapshot();
    const retryNotice = notices.find((notice) => notice.kind === "retry");
    assert(retryNotice !== undefined && retryNotice.attempt === 2 && retryNotice.max === 3 && retryNotice.code === "TIMEOUT",
        "llm/retry must publish a retry notice");

    sessionEvents({ id: "session-1" }, { type: "turn/end", data: { reason: { kind: "error", error: { code: "TIMEOUT", message: "timeout" } } } });
    notices = await noticeSnapshot();
    assert(notices.some((notice) => notice.kind === "halt" && notice.code === "TIMEOUT"), "an exhausted retryable failure must publish a halt notice");

    sessionEvents({ id: "session-1" }, { type: "turn/end", data: { reason: { kind: "error", error: { code: "AUTH", message: "bad key" } } } });
    notices = await noticeSnapshot();
    assert(notices.some((notice) => notice.kind === "blocked" && notice.code === "AUTH"), "a blocked failure must publish a blocked notice");

    // A successful turn end must not publish anything new.
    const before = (await noticeSnapshot()).length;
    sessionEvents({ id: "session-1" }, { type: "turn/end", data: { reason: { kind: "completed" } } });
    assert((await noticeSnapshot()).length === before, "a successful turn must not publish a notice");

    for (const dispose of effects) if (typeof dispose === "function") await dispose();

    console.log("all auto-continue checks passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
