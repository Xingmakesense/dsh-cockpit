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

    // --- findTextRange ----------------------------------------------------------
    assert(JSON.stringify(lib.findTextRange("Hello World", "world")) === JSON.stringify({ start: 6, end: 11 }),
        "case-insensitive ASCII range must be exact");
    assert(JSON.stringify(lib.findTextRange("会话日志ABC", "abc")) === JSON.stringify({ start: 4, end: 7 }),
        "CJK prefix must not shift the match offset");
    assert(lib.findTextRange("abc", "  ") === null, "blank query must not match");
    assert(lib.findTextRange("abc", "zzz") === null, "missing query must return null");

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

    console.log("all archive-layer checks passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
