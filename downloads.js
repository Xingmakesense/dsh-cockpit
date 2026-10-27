/**
 * Observe DSH Host attachment downloads without changing their bytes or save path.
 * A connection/request wrapper counts bytes as the Host sends them, while a
 * Typert Remote event source streams compact progress records to the Client.
 */
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { extname } from "node:path";

export const DOWNLOAD_EVENT = "cockpit/download";
const PROGRESS_INTERVAL_MS = 200;

function header(response, name) {
    try {
        const value = response.getHeader?.(name);
        return Array.isArray(value) ? value.join("; ") : typeof value === "string" ? value : void 0;
    } catch {
        return void 0;
    }
}

function safeFilename(value, fallback) {
    const normalized = String(value || fallback).replace(/[\\/\u0000-\u001f\u007f]/gu, "_").trim();
    return normalized && normalized !== "." && normalized !== ".." ? normalized : "download";
}

/** Parse RFC 5987 filename* and ordinary quoted/unquoted filename forms. */
export function downloadName(response, requestUrl = "") {
    const disposition = header(response, "content-disposition") ?? "";
    if (!/^\s*attachment\b/iu.test(disposition)) return null;
    let filename = "";
    const utf8 = disposition.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/u);
    if (utf8) {
        try {
            filename = decodeURIComponent(utf8[1].trim().replace(/^"|"$/gu, ""));
        } catch {
            filename = utf8[1].trim();
        }
    }
    if (!filename) {
        const quoted = disposition.match(/filename\s*=\s*"([^"]*)"/u);
        const plain = disposition.match(/filename\s*=\s*([^;]+)/u);
        filename = (quoted?.[1] ?? plain?.[1] ?? "").trim();
    }
    if (!filename) {
        try {
            const pathname = new URL(requestUrl, "http://localhost").pathname;
            filename = pathname.split("/").filter(Boolean).at(-1) || "download";
        } catch {
            filename = "download";
        }
    }
    filename = safeFilename(filename, "download");
    return { filename, extension: extname(filename) };
}

function byteCount(chunk, encoding) {
    if (chunk === void 0 || chunk === null || typeof chunk === "function") return 0;
    if (Buffer.isBuffer(chunk)) return chunk.length;
    if (ArrayBuffer.isView(chunk)) return chunk.byteLength;
    if (chunk instanceof ArrayBuffer) return chunk.byteLength;
    return Buffer.byteLength(String(chunk), typeof encoding === "string" ? encoding : "utf8");
}

/** A bounded, coalescing async queue consumed by the Remote event gateway. */
export function createRemoteEventQueue(signal, publish) {
    const frames = [];
    let waiter;
    let done = false;
    const wake = () => {
        const resolve = waiter;
        waiter = void 0;
        resolve?.();
    };
    const listener = (frame) => {
        if (done) return;
        const previous = frames.findIndex((item) => item.args[0].id === frame.args[0].id);
        if (previous >= 0) frames[previous] = frame;
        else frames.push(frame);
        // A slow Client must not create an unbounded progress backlog.
        if (frames.length > 120) frames.splice(0, frames.length - 120);
        wake();
    };
    publish.sources.add(listener);
    const stop = () => {
        if (done) return;
        done = true;
        publish.sources.delete(listener);
        wake();
    };
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
    return (async function* iterate() {
        try {
            while (!done) {
                while (frames.length > 0) yield frames.shift();
                if (done) break;
                await new Promise((resolve) => {
                    waiter = resolve;
                });
            }
        } finally {
            signal.removeEventListener("abort", stop);
            stop();
        }
    })();
}

/** Install Host response observation and the Client progress event source. */
export function installDownloads(ctx) {
    const active = new Map();
    const publish = {
        sources: new Set(),
        emit(record) {
            const frame = { event: DOWNLOAD_EVENT, args: [{ ...record }] };
            for (const source of this.sources) source(frame);
        }
    };
    let nextProgressId = 0;

    const finish = (record, state) => {
        if (!record || record.state !== "downloading") return;
        record.state = state;
        record.updatedAt = Date.now();
        publish.emit(record);
        active.delete(record.id);
    };

    const track = (request, response) => {
        if (String(request.method).toUpperCase() === "HEAD") return;
        let record;
        let lastPublished = 0;

        const ensure = () => {
            if (record) return;
            const named = downloadName(response, request.url);
            if (!named) return;
            const length = Number(header(response, "content-length"));
            const now = Date.now();
            record = {
                id: `${now.toString(36)}-${(nextProgressId++).toString(36)}-${randomUUID().slice(0, 8)}`,
                filename: named.filename,
                extension: named.extension,
                receivedBytes: 0,
                totalBytes: Number.isSafeInteger(length) && length >= 0 ? length : null,
                state: "downloading",
                startedAt: now,
                updatedAt: now
            };
            active.set(record.id, record);
            lastPublished = now;
            publish.emit(record);
        };

        const advance = (chunk, encoding) => {
            ensure();
            if (!record) return;
            record.receivedBytes += byteCount(chunk, encoding);
            const now = Date.now();
            record.updatedAt = now;
            if (now - lastPublished >= PROGRESS_INTERVAL_MS) {
                lastPublished = now;
                publish.emit(record);
            }
        };

        const originalWriteHead = response.writeHead;
        const originalWrite = response.write;
        const originalEnd = response.end;
        if (typeof originalWriteHead === "function") {
            response.writeHead = function (...args) {
                const result = Reflect.apply(originalWriteHead, this, args);
                ensure();
                return result;
            };
        }
        response.write = function (chunk, encoding, callback) {
            advance(chunk, encoding);
            return Reflect.apply(originalWrite, this, [chunk, encoding, callback]);
        };
        response.end = function (chunk, encoding, callback) {
            advance(chunk, encoding);
            return Reflect.apply(originalEnd, this, [chunk, encoding, callback]);
        };
        response.once?.("finish", () => finish(record, "completed"));
        response.once?.("close", () => finish(record, "aborted"));
    };

    ctx.effect(() => ctx.on("connection/request", (request, response, next) => {
        try {
            track(request, response);
        } catch (error) {
            try {
                ctx.logger.warn(`[dsh-cockpit] download observation skipped: ${error?.message ?? error}`);
            } catch {
                /* observation must never break a download */
            }
        }
        return next();
    }), "dsh-cockpit: download response observation");

    ctx.inject(["typertGateway"], (scope) => {
        const source = (signal) => createRemoteEventQueue(signal, publish);
        scope.effect(
            () => scope.typertGateway.registerRemoteEvents(source, { home: homedir() }),
            "dsh-cockpit: download Remote events"
        );
    });

    ctx.effect(() => () => {
        for (const record of active.values()) finish(record, "aborted");
        active.clear();
        publish.sources.clear();
    }, "dsh-cockpit: download lifecycle");
}
