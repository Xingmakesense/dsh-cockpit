// Archive-layer checks for the vendored archive-manager pure helpers.
//
// These modules only depend on ./contracts.js, so they can be exercised in
// plain Node without a Cordis host. They cover the read-only paths the UI uses
// for preview, search snippets and error diagnosis.
const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

async function main() {
    const lib = await import("./vendor/archive-manager/lib/archive-discovery.js");

    // --- countConversationTurns -------------------------------------------------
    const turnEvents = [
        { type: "user/message", data: { message: { source: { kind: "user" }, content: "a" } } },
        { type: "user/message", data: { message: { source: { kind: "agent" }, content: "b" } } },
        { type: "user/message", data: { message: { content: "no-source counts" } } },
        { type: "assistant/message", data: { message: { content: "assistant" } } },
        { type: "turn/end", data: {} }
    ];
    assert(lib.countConversationTurns(turnEvents) === 2, "turn count must skip agent-sourced user messages");

    // --- extractConversation ----------------------------------------------------
    const conversation = lib.extractConversation([
        { type: "user/message", seq: 1, data: { message: { content: "你好" } } },
        {
            type: "assistant/message",
            seq: 2,
            data: {
                message: {
                    content: [
                        { type: "text", text: "第一段" },
                        { type: "tool_use", id: "t1" },
                        { type: "text", text: "第二段" }
                    ]
                }
            }
        },
        { type: "user/message", seq: 3, data: { message: { source: { kind: "agent" }, content: "内部" } } },
        { type: "turn/end", seq: 4, data: {} }
    ]);
    assert(conversation.length === 2, "only real user/assistant text must be extracted");
    assert(conversation[0].role === "user" && conversation[0].text === "你好", "user text lost");
    assert(conversation[1].text === "第一段\n第二段", "text blocks must be joined with newlines");
    assert(conversation[1].seq === 2, "sequence must be preserved");
    const legacyConversation = lib.extractConversation([
        { type: "user/message", data: { message: { content: "missing seq" } } },
        { type: "assistant/message", seq: 8, data: { message: { content: "present seq" } } }
    ]);
    assert(legacyConversation.length === 2 && legacyConversation[0].seq === 0 && legacyConversation[1].seq === 8,
        "missing legacy seq must fall back to the event index without dropping the session");

    // --- findTextRange ----------------------------------------------------------
    assert(JSON.stringify(lib.findTextRange("Hello World", "world")) === JSON.stringify({ start: 6, end: 11 }),
        "case-insensitive ASCII range must be exact");
    assert(JSON.stringify(lib.findTextRange("会话日志ABC", "abc")) === JSON.stringify({ start: 4, end: 7 }),
        "CJK prefix must not shift the match offset");
    assert(lib.findTextRange("abc", "  ") === null, "blank query must not match");
    assert(lib.findTextRange("abc", "zzz") === null, "missing query must return null");
    assert(JSON.stringify(lib.findTextRange("xİy", "i\u0307y")) === JSON.stringify({ start: 1, end: 3 }),
        "Unicode lowercase expansion must map back to the original character range");

    // --- findContentMatch -------------------------------------------------------
    const snippet = lib.findContentMatch(
        [{ seq: 7, role: "user", text: "x".repeat(500) + "needle" + "y".repeat(500) }],
        "needle"
    );
    assert(snippet !== null && snippet.seq === 7, "snippet must point at the matching message");
    assert(snippet.snippet.startsWith("…") && snippet.snippet.endsWith("…"), "long snippet must be elided on both sides");
    assert(snippet.snippet.length <= 302, "snippet must stay bounded");

    // --- previewConversation ----------------------------------------------------
    const messages = Array.from({ length: 10 }, (_, index) => ({
        seq: index + 1,
        role: index % 2 === 0 ? "user" : "assistant",
        text: `msg ${index + 1}`
    }));
    const hit = lib.previewConversation(messages, "msg 5");
    assert(hit.messages.length === 8, "preview must return at most 8 messages");
    assert(hit.hasEarlier === true && hit.hasLater === false, "window bounds around a hit must be reported");
    const tail = lib.previewConversation(messages, "missing");
    assert(tail.messages[0].seq === 3 && tail.hasEarlier === true, "no hit must fall back to the latest 8 messages");

    const emoji = "a" + "😀".repeat(1001);
    const truncated = lib.previewConversation([{ seq: 1, role: "user", text: emoji }], "");
    const lastCode = truncated.messages[0].text.charCodeAt(truncated.messages[0].text.length - 1);
    assert(truncated.messages[0].truncated === true, "long preview text must be flagged as truncated");
    assert(!(lastCode >= 0xd800 && lastCode <= 0xdbff), "preview must not cut a surrogate pair in half");
    const middle = lib.previewConversation([{ seq: 1, role: "user", text: "x".repeat(2000) + "needle" }], "needle");
    assert(middle.messages[0].truncated === true && middle.messages[0].text.length < 2000 && middle.messages[0].text.endsWith("needle"),
        "a match after the 2000-character boundary must retain its truncated marker");

    // --- date range helpers -----------------------------------------------------
    assert(lib.validUpdatedRange("2026-10-02", "2026-10-01") === false, "reversed range must be invalid");
    assert(lib.validUpdatedRange("2026-02-30", undefined) === false, "impossible date must be invalid");
    assert(lib.validUpdatedRange("2026-10-01", undefined) === true, "valid single bound must pass");
    const sameDay = new Date(2026, 9, 1, 23, 59, 0).getTime();
    assert(lib.matchesUpdatedRange(sameDay, "2026-10-01", "2026-10-01") === true, "the `to` bound must be inclusive by day");
    assert(lib.matchesUpdatedRange(new Date(2026, 9, 2, 0, 0, 1).getTime(), "2026-10-01", "2026-10-01") === false,
        "the day after `to` must be excluded");

    // --- classifySessionError ---------------------------------------------------
    assert(lib.classifySessionError(Object.assign(new Error("gone"), { code: "ENOENT" })).code === "missing",
        "ENOENT must classify as missing");
    const formatError = Object.assign(new Error("bad frame"), { name: "SessionFormatError" });
    assert(lib.classifySessionError(formatError).code === "corrupt", "SessionFormatError must classify as corrupt");
    assert(lib.classifySessionError(new Error("weird")).code === "unknown", "unknown errors must stay unknown");

    // --- schema guards ----------------------------------------------------------
    const parsed = lib.searchInputSchema.parse({ sessionIds: ["a", "a", "b"], query: "  x  " });
    assert(parsed.sessionIds.length === 2 && parsed.query === "x", "search input must dedupe ids and trim the query");
    let rejected = false;
    try {
        lib.searchInputSchema.parse({ sessionIds: Array.from({ length: 21 }, (_, i) => `s${i}`), query: "x" });
    } catch {
        rejected = true;
    }
    assert(rejected, "more than 20 sessions per search must be rejected");
    assert(lib.previewInputSchema.parse({ sessionId: "s1" }).query === "", "preview query must default to empty");

    // --- empty-session HTTP route ---------------------------------------------
    const { cleanupRoute } = await import("./archive.js");
    const cleanupCalls = [];
    const route = cleanupRoute({
        workspaceRegistry: {
            async previewEmptySessions() {
                return { items: [{ sessionId: "empty-1" }], skipped: [{ sessionId: "kept-1", reason: "active" }] };
            },
            async deleteEmptySessions(input) {
                cleanupCalls.push(input);
                return { requestedSessionIds: input.sessionIds, deletedSessionIds: input.sessionIds, skippedSessionIds: [], failures: [] };
            }
        }
    });
    assert(route.path === "/api/cockpit/empty-sessions", "cleanup route path changed");
    const previewResponse = await route.fetch(new Request("http://localhost/api/cockpit/empty-sessions"));
    const previewBody = await previewResponse.json();
    assert(previewResponse.status === 200 && previewBody.ok === true && previewBody.value.items[0].sessionId === "empty-1",
        "cleanup GET must preview candidates through the archive host");
    const deleteResponse = await route.fetch(new Request("http://localhost/api/cockpit/empty-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionIds: ["empty-1"] })
    }));
    const deleteBody = await deleteResponse.json();
    assert(deleteBody.ok === true && cleanupCalls.length === 1 && cleanupCalls[0].sessionIds[0] === "empty-1",
        "cleanup POST must call deleteEmptySessions with the requested ids");
    const invalid = await route.fetch(new Request("http://localhost/api/cockpit/empty-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionIds: [1] })
    }));
    assert(invalid.status === 400, "cleanup POST must reject non-string session ids");

    // --- empty-session pre-screen ---------------------------------------------
    const { emptySessionPrescreen } = await import("./vendor/archive-manager/lib/empty-session-policy.js");
    const fresh = { blank: true, running: false, agentAvailable: true };
    assert(emptySessionPrescreen({ live: true, header: { id: "fresh" }, summary: fresh }) === null,
        "a fresh blank Session with an attached idle Agent must remain a cleanup candidate");
    assert(emptySessionPrescreen({ live: false, header: { id: "fresh" }, summary: fresh }) === null,
        "agentAvailable alone must not mark a cold blank Session as non-empty");
    assert(emptySessionPrescreen({ live: true, header: { id: "running" }, summary: { ...fresh, running: true } }) === "live",
        "a running live Session must stay protected");
    assert(emptySessionPrescreen({ live: true, header: { id: "no-summary" }, summary: undefined }) === null,
        "a live Session without a list summary must reach content and activity checks");
    assert(emptySessionPrescreen({ live: true, header: { id: "content" }, summary: { ...fresh, blank: false } }) === null,
        "persisted events, not a possibly stale blank flag, must decide content");
    assert(emptySessionPrescreen({ live: false, header: { id: "cold-running" }, summary: { ...fresh, running: true } }) === "not-blank-summary",
        "a cold summary that reports a running turn must stay protected");
    assert(emptySessionPrescreen({ live: false, header: { id: "child", parentSession: "parent" }, summary: fresh }) === "lineage",
        "fork and subagent Sessions must stay protected");

    const { hasOnlyInitializationEvents } = await import("./vendor/archive-manager/lib/empty-session-policy.js");
    const initializationEvents = [
        "agent-preset/selected",
        "model/selection",
        "permission/preset",
        "sandbox/mode",
        "approval/policy",
        "subagent/model-selection-policy",
        "session/end-seed"
    ].map((type) => ({ type }));
    assert(hasOnlyInitializationEvents(initializationEvents) === true,
        "new-Session configuration events must not be mistaken for conversation content");
    assert(hasOnlyInitializationEvents([...initializationEvents, { type: "user/message" }]) === false,
        "a real user message must preserve the Session");
    assert(hasOnlyInitializationEvents([{ type: "session/title" }]) === false,
        "unknown or metadata events must remain conservative");

    console.log("all archive-layer checks passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
