// Auto-continue checks: the official agent/request-error recovery layer.
const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

async function main() {
    const { Config, normalizeContinueConfig, classifyContinueFailure, installAutoContinue, AUTO_CONTINUE_ROUTE } = await import("./auto-continue.js");

    // Native volatile config: required for ctx.settings to see the plugin.
    assert(Reflect.get(Config, Symbol.for("schemastery")) === true, "Config must be a native Schemastery schema");
    assert(Config.meta?.volatile === true, "Config root must be volatile for live settings");

    const off = normalizeContinueConfig(undefined);
    assert(off.enabled === false, "auto-continue must stay disabled unless configured");
    assert(off.maxAttempts === 6 && off.delayMs === 1500, "defaults must stay stable");
    assert(off.retryableCodes.includes("TIMEOUT") && off.blockedCodes.includes("AUTH"), "code lists must match");

    const on = normalizeContinueConfig({
        enabled: true,
        maxAttempts: 2,
        delayMs: 0,
        emitProminentError: true,
        retryableCodes: ["timeout", "server", "empty_response"],
        blockedCodes: ["auth"],
        providerRetryMaxRetries: 9
    });
    assert(on.enabled === true && on.maxAttempts === 2 && on.delayMs === 0, "config must be normalized");
    assert(on.retryableCodes[0] === "TIMEOUT" && on.retryableCodes[1] === "SERVER" && on.blockedCodes[0] === "AUTH", "codes must be upper-cased");
    assert(!("providerRetryMaxRetries" in on), "the deprecated provider retry key belongs to the official policy and must be ignored");

    assert(classifyContinueFailure({ code: "ETIMEDOUT", message: "x" }).code === "TIMEOUT", "error aliases must classify");
    assert(classifyContinueFailure({ code: "X", message: "余额不足" }).code === "QUOTA", "hard quota wording must classify");

    // ---- fake host -------------------------------------------------------
    const handlers = new Map();
    const effects = [];
    let registeredRoute;
    const ctx = {
        logger: { warn() {}, info() {} },
        on(event, handler) {
            handlers.set(event, handler);
            return () => handlers.delete(event);
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
    const recover = handlers.get("agent/request-error");
    assert(typeof recover === "function", "auto-continue must register on agent/request-error");
    assert(typeof handlers.get("session/event") === "function", "turn resets must listen to session/event");
    assert(registeredRoute?.path === AUTO_CONTINUE_ROUTE, "auto-continue must expose the client snapshot route");

    const noticeSnapshot = async () => {
        const response = await registeredRoute.fetch(new Request("http://localhost" + AUTO_CONTINUE_ROUTE));
        return (await response.json()).value.notices;
    };
    const payload = (failure, turn = 1) => ({
        agent: { id: "agent-1", session: { id: "session-1" } },
        turn,
        step: 1,
        provider: "provider",
        failure,
        signal: new AbortController().signal
    });

    // The official provider policy runs first. When it retries, this layer
    // must not consume a budget or publish a notice.
    assert(JSON.stringify(await recover(payload({ code: "TIMEOUT", message: "x" }), async () => ({ kind: "retry" }))) === '{"kind":"retry"}',
        "a downstream official retry must pass through");
    assert((await noticeSnapshot()).length === 0, "a downstream retry must not publish a cockpit notice");

    // The official retryPolicy is never rewritten or replaced.
    const policy = Object.freeze({ mode: "normal", maxRetries: 3, retryableCodes: Object.freeze(["TIMEOUT"]), initialDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 });
    const policyPayload = { ...payload({ code: "TIMEOUT", message: "x" }, 9), retryPolicy: policy };
    await recover(policyPayload, async () => undefined);
    assert(policyPayload.retryPolicy === policy && policyPayload.retryPolicy.maxRetries === 3,
        "auto-continue must not rewrite the official retry policy");

    // Official policy declined: add the provider-independent attempt.
    let result = await recover(payload({ code: "TIMEOUT", message: "timeout" }), async () => undefined);
    assert(result?.kind === "retry", "the layer must return the official retry action");
    let notices = await noticeSnapshot();
    assert(notices.length === 1 && notices[0].kind === "retry" && notices[0].attempt === 1,
        "the first extra attempt must publish a retry notice");

    // Attempt two, then the cap.
    result = await recover(payload({ code: "SERVER", message: "server" }), async () => undefined);
    assert(result?.kind === "retry", "the second attempt must run");
    result = await recover(payload({ code: "SERVER", message: "server" }), async () => undefined);
    assert(result === undefined, "the cap must preserve the original error");
    notices = await noticeSnapshot();
    assert(notices.some((notice) => notice.kind === "halt" && notice.attempt === 2), "the cap must publish a halt notice");

    // A new turn resets the budget through session/event.
    handlers.get("session/event")({ id: "session-1" }, { type: "turn/start", data: { turn: 2 } });
    result = await recover(payload({ code: "TIMEOUT", message: "again" }, 2), async () => undefined);
    assert(result?.kind === "retry", "a new turn must reset the attempt budget");

    // Blocked codes never retry and explain why.
    result = await recover(payload({ code: "AUTH", message: "bad key" }, 3), async () => undefined);
    assert(result === undefined, "blocked codes must not retry");
    notices = await noticeSnapshot();
    assert(notices.some((notice) => notice.kind === "blocked" && notice.code === "AUTH"), "blocked codes must publish a blocked notice");

    // Unknown/non-listed codes stay silent and never retry.
    result = await recover(payload({ code: "SOMETHING_ELSE", message: "?" }, 3), async () => undefined);
    assert(result === undefined, "unlisted codes must not retry");

    // Aborting the turn during the delay cancels the retry.
    const slowCtx = {
        ...ctx,
        effect(setup) { const dispose = setup(); return dispose; }
    };
    installAutoContinue(slowCtx, { ...on, delayMs: 60_000, maxAttempts: 3 });
    const slowRecover = handlers.get("agent/request-error");
    const controller = new AbortController();
    const pending = slowRecover({
        agent: { id: "agent-2", session: { id: "session-2" } },
        turn: 1,
        step: 1,
        provider: "provider",
        failure: { code: "TIMEOUT", message: "slow" },
        signal: controller.signal
    }, async () => undefined);
    controller.abort();
    assert(await pending === undefined, "an aborted turn must cancel the delayed retry");

    assert(typeof handlers.get("agent/disposed") === "function", "disposed agents must be cleaned up");
    for (const dispose of effects) if (typeof dispose === "function") await dispose();

    console.log("all auto-continue checks passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
