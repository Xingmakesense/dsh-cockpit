/**
 * Conservative pre-screen for empty-session candidates.
 *
 * A newly created blank Session is reported as
 * `{ blank: true, running: false, agentAvailable: true }`: the idle Agent is
 * still attached, but the Session contains no turn or content. `agentAvailable`
 * therefore says nothing about emptiness and must not exclude the Session.
 * Only a non-blank or running live Session is refused here; content and activity
 * checks follow after the stored log is read.
 *
 * @param {object} input
 * @param {boolean} input.live - whether an Agent or Session is currently attached
 * @param {object} input.header - stored Session header
 * @param {object|undefined} input.summary - Host sessionController.list() row
 * @returns {string|null} a skip reason, or null when later content checks may run
 */
export function emptySessionPrescreen({ live, header, summary }) {
    if (header?.origin === "subagent" || header?.parentSession || header?.isSeeded) return "lineage";
    if (live) {
        if (summary === undefined || summary.blank !== true || summary.running === true) return "live";
        return null;
    }
    if (summary !== undefined && (summary.blank !== true || summary.running === true)) return "not-blank-summary";
    return null;
}
