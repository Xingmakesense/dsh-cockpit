// Queue-flush checks: after turn/end, only an enabled, idle Agent with
// pending next-turn input is woken; queue items are never rewritten.
const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
    const { installQueueFlush } = await import("./queue-flush.js");
    const listeners = new Map();
    const disposers = [];
    let agent;
    const scope = {
        agents: { get: (id) => (id === "session-1" ? agent : undefined) },
        on(event, handler) {
            listeners.set(event, handler);
            return () => listeners.delete(event);
        },
        effect(setup) {
            const dispose = setup();
            disposers.push(dispose);
            return dispose;
        }
    };
    const ctx = {
        logger: { warn() {} },
        inject(services, fn) {
            assert(Array.isArray(services) && services.length === 1 && services[0] === "agents",
                "queue flush must inject the agents service");
            fn(scope);
        }
    };
    const event = { type: "turn/end", data: { reason: { kind: "completed" } } };
    const fire = () => listeners.get("session/event")({ id: "session-1" }, event);

    // Enabled + idle + pending: wake exactly once.
    let wakes = 0;
    agent = {
        status: "idle",
        inbox: { nextTurn: [{ id: "q1" }] },
        wakeDriver() {
            wakes += 1;
            this.status = "running";
        }
    };
    installQueueFlush(ctx, () => ({ autoFlushQueue: true }));
    fire();
    await sleep(40);
    assert(wakes === 1, "an idle agent with queued input must be woken once, got " + wakes);
    await sleep(250);
    assert(wakes === 1, "later retries must not wake the now-running agent again, got " + wakes);

    // Disabled: never wake.
    listeners.clear();
    wakes = 0;
    agent = { status: "idle", inbox: { nextTurn: [{ id: "q2" }] }, wakeDriver() { wakes += 1; } };
    installQueueFlush(ctx, () => ({ autoFlushQueue: false }));
    fire();
    await sleep(40);
    assert(wakes === 0, "a disabled toggle must not touch the queue");

    // Busy, then idle: the retry window still flushes.
    listeners.clear();
    wakes = 0;
    agent = {
        status: "running",
        inbox: { nextTurn: [{ id: "q3" }] },
        wakeDriver() { wakes += 1; this.status = "running"; }
    };
    installQueueFlush(ctx, () => ({ autoFlushQueue: true }));
    fire();
    await sleep(40);
    assert(wakes === 0, "a running agent must not be woken");
    agent.status = "idle";
    await sleep(220);
    assert(wakes === 1, "the retry window must wake the agent once it becomes idle, got " + wakes);

    // Empty inbox: never wake.
    listeners.clear();
    wakes = 0;
    agent = { status: "idle", inbox: { nextTurn: [] }, wakeDriver() { wakes += 1; } };
    installQueueFlush(ctx, () => ({ autoFlushQueue: true }));
    fire();
    await sleep(40);
    assert(wakes === 0, "an empty queue must not be woken");

    for (const dispose of disposers) if (typeof dispose === "function") dispose();
    console.log("all queue-flush checks passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
