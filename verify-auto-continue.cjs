// Auto-continue checks: official retry-policy override, extra continuations,
// and the notice snapshot.
const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

async function main() {
    const { Config, normalizeContinueConfig, classifyContinueFailure, resolveRetryPolicy, installAutoContinue, AUTO_CONTINUE_ROUTE } = await import("./auto-continue.js");

    assert(Reflect.get(Config, Symbol.for("schemastery")) === true, "Config must be a native Schemastery schema");
    assert(Config.meta?.volatile === true, "Config root must be volatile for live settings");

    const off = normalizeContinueConfig(undefined);
    assert(off.enabled === false, "auto-continue must stay disabled unless configured");
    assert(off.providerRetryMaxRetries === 3 && off.maxAttempts === 6 && off.delayMs === 1500, "defaults must stay stable");
    assert(off.retryableCodes.includes("TIMEOUT") && off.blockedCodes.includes("AUTH"), "code lists must match");

    const on = normalizeContinueConfig({
        enabled: true,
        providerRetryMaxRetries: 3,
        maxAttempts: 3,
        delayMs: 250,
        emitProminentError: true,
        retryableCodes: ["timeout", "auth", "server"],
        blockedCodes: ["auth"]
    });
    assert(on.enabled === true && on.providerRetryMaxRetries === 3 && on.maxAttempts === 3 && on.delayMs === 250, "config must be normalized");
    assert(on.retryableCodes[0] === "TIMEOUT", "codes must be upper-cased");

    assert(classifyContinueFailure({ code: "ETIMEDOUT", message: "x" }).code === "TIMEOUT", "error aliases must classify");
    assert(classifyContinueFailure({ code: "X", message: "余额不足" }).code === "QUOTA", "hard quota wording must classify");

    const policy = resolveRetryPolicy(on, { mode: "normal", maxRetries: 9, retryableCodes: ["TIMEOUT"], initialDelayMs: 1, maxDelayMs: 7000, jitterRatio: 0.2 });
    assert(policy.mode === "normal" && policy.maxRetries === 3, "the policy must carry the configured provider budget");
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
    const behavior = { ...on, delayMs: 0, maxAttempts: 2 };
    installAutoContinue(ctx, behavior);
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
    const payload = (code = "TIMEOUT", turn = 1) => ({
        agent: { id: "agent-1", session: { id: "session-1" } },
        turn,
        step: 1,
        provider: "provider",
        failure: { code, message: code },
        retryPolicy: { mode: "normal", maxRetries: 9, retryableCodes: ["TIMEOUT"], initialDelayMs: 1, maxDelayMs: 7000, jitterRatio: 0.2 },
        signal: new AbortController().signal
    });

    // The official policy is replaced first and its retry decision passes through.
    const passPayload = payload();
    const officialRetry = await recover.handler(passPayload, async () => ({ kind: "retry" }));
    assert(officialRetry?.kind === "retry", "an official retry decision must pass through");
    assert(passPayload.retryPolicy.maxRetries === 3 && passPayload.retryPolicy.initialDelayMs === 0,
        "the replacement policy must carry the configured provider budget");
    assert((await noticeSnapshot()).length === 0, "an official retry must not publish an extra notice");

    // Official executor declined: add extra continuations up to maxAttempts.
    const first = payload();
    const extra1 = await recover.handler(first, async () => undefined);
    assert(extra1?.kind === "retry", "the first extra continuation must use the official retry action");
    let notices = await noticeSnapshot();
    assert(notices.some((notice) => notice.kind === "retry" && notice.phase === "extra" && notice.attempt === 1),
        "the first extra continuation needs a notice");

    const second = payload();
    assert((await recover.handler(second, async () => undefined))?.kind === "retry", "the second extra continuation must run");
    const third = payload();
    assert(await recover.handler(third, async () => undefined) === undefined, "the extra budget must stop the retry");
    notices = await noticeSnapshot();
    assert(notices.some((notice) => notice.kind === "halt" && notice.phase === "extra" && notice.attempt === 2),
        "the extra budget cap needs a halt notice");

    // A new turn resets the extra budget.
    sessionEvents({ id: "session-1" }, { type: "turn/start", data: { turn: 2 } });
    assert((await recover.handler(payload("TIMEOUT", 2), async () => undefined))?.kind === "retry",
        "a new turn must reset the extra continuation budget");

    // Blocked codes keep the official error and are reported from turn/end.
    const blocked = payload("AUTH");
    assert(await recover.handler(blocked, async () => undefined) === undefined, "blocked codes must not retry");
    sessionEvents({ id: "session-1" }, { type: "turn/end", data: { reason: { kind: "error", error: { code: "AUTH", message: "bad key" } } } });
    notices = await noticeSnapshot();
    assert(notices.some((notice) => notice.kind === "blocked" && notice.code === "AUTH"), "blocked codes need a blocked notice");

    // Official retry progress is reported with the provider phase.
    sessionEvents({ id: "session-1" }, { type: "llm/retry", data: { retry: 2, maxRetries: 3, failure: { code: "TIMEOUT", message: "timeout" } } });
    notices = await noticeSnapshot();
    assert(notices.some((notice) => notice.kind === "retry" && notice.phase === "provider" && notice.attempt === 2),
        "official llm/retry events need a provider notice");

    // A successful turn publishes nothing and clears the budget.
    const before = (await noticeSnapshot()).length;
    sessionEvents({ id: "session-1" }, { type: "turn/end", data: { reason: { kind: "completed" } } });
    assert((await noticeSnapshot()).length === before, "a successful turn must not publish a notice");

    assert(typeof listeners.get("agent/disposed").handler === "function", "disposed agents must be cleaned up");

    for (const dispose of effects) if (typeof dispose === "function") await dispose();
    console.log("all auto-continue checks passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
