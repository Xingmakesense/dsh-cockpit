/**
 * Conservative pre-screen for empty-session candidates.
 *
 * `agentAvailable` only means an idle Agent is attached, and a list summary can
 * be absent or stale while the persisted log is authoritative. This screen
 * therefore refuses only known lineage and explicitly running Sessions; the
 * caller flushes live Sessions and then decides from stored events and activity.
 *
 * @param {object} input
 * @param {boolean} input.live - whether an Agent or Session is currently attached
 * @param {object} input.header - stored Session header
 * @param {object|undefined} input.summary - Host sessionController.list() row
 * @returns {string|null} a skip reason, or null when later content checks may run
 */
export function emptySessionPrescreen({ live, header, summary }) {
    if (header?.origin === "subagent" || header?.parentSession || header?.isSeeded) return "lineage";
    if (summary?.running === true) return live ? "live" : "not-blank-summary";
    return null;
}

/**
 * Events a freshly created Session writes while configuring itself. They carry
 * no conversation content, so they must not disqualify an empty Session.
 */
export const EMPTY_SESSION_INITIALIZATION_EVENTS = new Set([
    "agent-preset/selected",
    "model/selection",
    "permission/preset",
    "sandbox/mode",
    "approval/policy",
    "subagent/model-selection-policy",
    "session/end-seed"
]);

/**
 * @param {readonly {type: string}[]} events - committed Session events
 * @returns {boolean} whether the log contains initialization/configuration only
 */
export function hasOnlyInitializationEvents(events) {
    return Array.isArray(events) && !events.some((event) => !EMPTY_SESSION_INITIALIZATION_EVENTS.has(event.type));
}
