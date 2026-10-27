/**
 * Observe DSH Host attachment downloads without changing their bytes or save path.
 * A connection/request wrapper counts bytes as the Host sends them, while a
 * compact api-session/error relay carries progress records to the Client.
 */
import { randomUUID } from "node:crypto";
import { extname } from "node:path";

export const DOWNLOAD_PREFIX = "【下载】";
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

function requestSessionId(requestUrl) {
    try {
        const value = new URL(requestUrl, "http://localhost").searchParams.get("sessionId");
        return value && value.trim() ? value.trim() : null;
    } catch {
        return null;
    }
}

/** Install Host response observation and the Client progress event source. */
export function installDownloads(ctx) {
    const active = new Map();
    const publish = {
        emit(record) {
            if (typeof ctx.emit === "function") {
                // api-session/error is resource-scoped: an invented download id
                // is filtered before it reaches the Client. Session-log routes
                // carry the real session id, which makes the relay deliverable.
                ctx.emit("api-session/error", record.sessionId ?? record.id, `${DOWNLOAD_PREFIX}${JSON.stringify(record)}`);
            }
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
                sessionId: requestSessionId(request.url),
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

    ctx.effect(() => () => {
        for (const record of active.values()) finish(record, "aborted");
        active.clear();
    }, "dsh-cockpit: download lifecycle");
}
