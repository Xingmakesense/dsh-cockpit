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

/**
 * Attach stable display/diagnostic fields without trusting a summary as proof
 * of emptiness. Unknown summary bits remain null rather than becoming false.
 *
 * @param {object} input
 * @param {object} input.header - stored Session header
 * @param {object|undefined} input.summary - Host list row, when available
 * @param {boolean} input.summariesAvailable - whether the Host list was read
 * @param {boolean} input.archived - registry archive membership
 * @param {boolean} input.live - attached Session or Agent
 */
export function emptySessionDiagnosticDetails({
    header,
    summary,
    summariesAvailable,
    archived,
    live
}) {
    const origin = typeof header.origin === "string" && header.origin.length > 0
        ? header.origin
        : summary?.origin === "subagent" ? "subagent" : null;
    const parentSessionId = typeof header.parentSession === "string"
        ? header.parentSession
        : typeof summary?.parentSessionId === "string" ? summary.parentSessionId : null;
    const hasSummary = summary !== void 0;
    const blank = typeof summary?.blank === "boolean" ? summary.blank : null;
    const running = typeof summary?.running === "boolean" ? summary.running : null;
    return {
        createdAt: Number.isFinite(header.createdAt) ? header.createdAt : null,
        cwd: typeof header.cwd === "string" && header.cwd.length > 0 ? header.cwd : null,
        origin,
        parentSessionId,
        archived,
        live,
        hasSummary,
        blank,
        running,
        summariesAvailable
    };
}
