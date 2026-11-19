// Download observation checks: real response bytes and the polling snapshot.
const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

async function main() {
    const { installDownloads, downloadName } = await import("./downloads.js");
    const handlers = new Map();
    const effects = [];
    let registeredRoute;
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
    installDownloads(ctx);
    const onRequest = handlers.get("connection/request");
    assert(typeof onRequest === "function", "download observation must wrap connection/request");
    assert(registeredRoute?.path === "/api/cockpit/downloads", "downloads must expose the polling snapshot route");

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
    const liveSnapshot = await registeredRoute.fetch(new Request("http://localhost/api/cockpit/downloads"));
    const liveBody = await liveSnapshot.json();
    assert(liveSnapshot.headers.get("cache-control") === "no-store", "download snapshots must not be cached");
    assert(liveBody.ok === true && liveBody.value.length === 1 && liveBody.value[0].receivedBytes === 3,
        "polling must expose live bytes before completion");
    response.end("def");
    const completedSnapshot = await registeredRoute.fetch(new Request("http://localhost/api/cockpit/downloads"));
    const completedBody = await completedSnapshot.json();
    assert(completedBody.value.length === 1 && completedBody.value[0].state === "completed" && completedBody.value[0].receivedBytes === 6,
        "completed downloads must remain discoverable in the recent snapshot");

    const first = liveBody.value[0];
    const last = completedBody.value[0];
    assert(first.filename === "dsh-session-example.zip" && first.extension === ".zip", "filename and extension must be preserved");
    assert(first.receivedBytes === 3 && first.totalBytes === 6 && first.state === "downloading", "live metadata is invalid");
    assert(last.receivedBytes === 6 && last.totalBytes === 6 && last.state === "completed", "completion must count exact bytes");
    assert(first.id === last.id, "one response must keep one download id");
    assert(first.sessionId === "example" && first.sessionId !== first.id, "the progress record must retain its real session id");

    // A streamed ZIP has no Content-Length: the snapshot must expose live bytes
    // without inventing a percentage.
    const realNow = Date.now;
    let now = 5000;
    Date.now = () => now;
    try {
        const streamHeaders = { "content-disposition": 'attachment; filename="streamed.zip"' };
        const streamListeners = new Map();
        const streamed = {
            getHeader(name) {
                return streamHeaders[name.toLowerCase()];
            },
            writeHead() {
                return this;
            },
            write() {
                return true;
            },
            end() {
                streamListeners.get("finish")?.();
                streamListeners.get("close")?.();
            },
            once(event, listener) {
                streamListeners.set(event, listener);
                return this;
            }
        };
        await onRequest({ method: "GET", url: "/api/session.export?sessionId=streamed" }, streamed, async () => {});
        streamed.writeHead(200);
        streamed.write(Buffer.from([1, 2]));
        now += 250;
        streamed.write(Buffer.from([3, 4, 5]));
        const streamSnapshot = await registeredRoute.fetch(new Request("http://localhost/api/cockpit/downloads"));
        const streamBody = await streamSnapshot.json();
        const progress = streamBody.value.find((record) => record.sessionId === "streamed");
        assert(progress !== undefined && progress.state === "downloading", "streamed downloads must stay visible in the snapshot");
        assert(progress.receivedBytes === 5, "live progress must count every streamed byte");
        assert(progress.totalBytes === null, "an unknown stream length must stay null instead of inventing a percentage");
        streamed.end();
    } finally {
        Date.now = realNow;
    }

    const named = downloadName({
        getHeader(name) {
            return name.toLowerCase() === "content-disposition" ? "attachment; filename*=UTF-8''hello%20world.jsonl" : undefined;
        }
    });
    assert(named.filename === "hello world.jsonl" && named.extension === ".jsonl", "RFC 5987 filenames must be decoded");

    // Ordinary responses must not re-parse the content-disposition header on
    // every written chunk: one negative decision per response is final.
    let ordinaryHeaderReads = 0;
    const ordinary = {
        getHeader() {
            ordinaryHeaderReads += 1;
            return undefined;
        },
        writeHead() {
            return this;
        },
        write() {
            return true;
        },
        end() {},
        once() {
            return this;
        }
    };
    await onRequest({ method: "GET", url: "/api/not-a-download" }, ordinary, async () => {});
    ordinary.writeHead(200);
    for (let index = 0; index < 200; index += 1) ordinary.write("x");
    assert(ordinaryHeaderReads === 1,
        "a non-attachment response must read its headers once, got " + ordinaryHeaderReads);
    const ordinaryBody = await (await registeredRoute.fetch(new Request("http://localhost/api/cockpit/downloads"))).json();
    assert(!ordinaryBody.value.some((record) => record.filename === "not-a-download"),
        "ordinary responses must not create download records");

    for (const dispose of effects) if (typeof dispose === "function") dispose();
    console.log("all download checks passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
