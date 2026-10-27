// Download observation checks: real response bytes and the compatible relay.
const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

async function main() {
    const { installDownloads, downloadName, DOWNLOAD_PREFIX } = await import("./downloads.js");
    const handlers = new Map();
    const emitted = [];
    const effects = [];
    const ctx = {
        logger: { warn() {} },
        on(event, handler) {
            handlers.set(event, handler);
            return () => {};
        },
        effect(setup) {
            const dispose = setup();
            effects.push(dispose);
            return dispose;
        },
        emit(event, ...args) {
            emitted.push({ event, args });
        },
        inject() {}
    };
    installDownloads(ctx);
    const onRequest = handlers.get("connection/request");
    assert(typeof onRequest === "function", "download observation must wrap connection/request");

    const headers = {
        "content-disposition": 'attachment; filename="dsh-session-example.zip"',
        "content-length": "6"
    };
    const listeners = new Map();
    const response = {
        getHeader(name) {
            return headers[name.toLowerCase()];
        },
        writeHead() {
            return this;
        },
        write() {
            return true;
        },
        end() {
            listeners.get("finish")?.();
            listeners.get("close")?.();
        },
        once(event, listener) {
            listeners.set(event, listener);
            return this;
        }
    };
    let nextCalled = 0;
    await onRequest({ method: "GET", url: "/api/session.export?sessionId=example" }, response, async () => {
        nextCalled += 1;
    });
    assert(nextCalled === 1, "the original connection bridge must be called exactly once");
    response.writeHead(200);
    response.write("abc");
    response.end("def");

    assert(emitted.length === 2, "a small download must emit start and completion without redundant progress");
    const [start, completed] = emitted;
    assert(start.event === "api-session/error" && completed.event === "api-session/error", "download must use the compatible relay");
    const first = JSON.parse(start.args[1].slice(DOWNLOAD_PREFIX.length));
    const last = JSON.parse(completed.args[1].slice(DOWNLOAD_PREFIX.length));
    assert(first.filename === "dsh-session-example.zip" && first.extension === ".zip", "filename and extension must be preserved");
    assert(first.receivedBytes === 0 && first.totalBytes === 6 && first.state === "downloading", "start metadata is invalid");
    assert(last.receivedBytes === 6 && last.totalBytes === 6 && last.state === "completed", "completion must count exact bytes");
    assert(first.id === last.id, "one response must keep one download id");

    const named = downloadName({
        getHeader(name) {
            return name.toLowerCase() === "content-disposition" ? "attachment; filename*=UTF-8''hello%20world.jsonl" : undefined;
        }
    });
    assert(named.filename === "hello world.jsonl" && named.extension === ".jsonl", "RFC 5987 filenames must be decoded");

    for (const dispose of effects) if (typeof dispose === "function") dispose();
    console.log("all download checks passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
