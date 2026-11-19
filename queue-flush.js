/**
 * dsh-cockpit queue-flush feature.
 *
 * After a turn stops, if the setting is enabled and the Agent is idle while its
 * durable inbox still has next-turn prompts, wake the official driver once.
 * The Agent then claims the queued prompt in FIFO order — this module never
 * edits, reorders, removes or re-sends queue items.
 *
 * The delays retry the check; the normal Agent loop may already wake on its own.
 * In that case status is "running" and every attempt is a no-op.
 */
const FLUSH_DELAYS = [0, 200, 600];

/** Wake one idle Agent when it still has queued next-turn input. */
export function installQueueFlush(ctx, readConfig) {
    const warn = (message) => {
        try {
            ctx.logger?.warn?.("[dsh-cockpit] " + message);
        } catch {
            /* logging must never break the turn */
        }
    };
    const timers = new Set();

    try {
        ctx.inject(["agents"], (scope) => {
            const flush = (sessionId) => {
                try {
                    if (readConfig?.()?.autoFlushQueue !== true) return;
                    const agent = scope.agents?.get?.(sessionId);
                    if (!agent || agent.status !== "idle") return;
                    const inbox = agent.inbox;
                    if (!inbox || !Array.isArray(inbox.nextTurn) || inbox.nextTurn.length === 0) return;
                    agent.wakeDriver();
                } catch (error) {
                    warn("queue flush skipped: " + (error?.message ?? String(error)));
                }
            };

            scope.on("session/event", (session, event) => {
                if (!session || typeof session.id !== "string" || event?.type !== "turn/end") return;
                if (readConfig?.()?.autoFlushQueue !== true) return;
                for (const delay of FLUSH_DELAYS) {
                    const timer = setTimeout(() => {
                        timers.delete(timer);
                        flush(session.id);
                    }, delay);
                    timer.unref?.();
                    timers.add(timer);
                }
            });

            scope.effect(() => () => {
                for (const timer of timers) clearTimeout(timer);
                timers.clear();
            }, "dsh-cockpit: queue flush timers");
        });
    } catch (error) {
        warn("queue flush skipped: " + (error?.message ?? String(error)));
    }
}
