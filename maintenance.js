/**
 * Cockpit maintenance: deletion audit + orphan attachment cleanup.
 *
 * The archive half emits `archive-manager/session-deleted` for every delete
 * attempt (success or failure); this module appends one JSONL record per
 * attempt under `<DSH_HOME>/storages/cockpit-audit/session-deletions.jsonl`.
 *
 * It also sweeps `<DSH_HOME>/attachments/v1/objects` for objects that no
 * remaining session log references. Attachment ids are content-addressed
 * SHA-256 names, so a hex scan over every session transcript is a conservative
 * reference test: anything mentioned by any surviving session is kept, and only
 * objects older than the grace period are removed.
 */
import { appendFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";

const zstdDecompressSync = typeof zlib.zstdDecompressSync === "function" ? zlib.zstdDecompressSync : undefined;

const HOUR = 3_600_000;
const GRACE_MS = 24 * HOUR;
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const HASH_RE = /[0-9a-f]{64}/g;

/** Resolve the DSH home directory the same way the harness does. */
export function dshHome(override) {
    return override ?? process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

/** Append one JSON line; creates the audit directory on first use. */
export async function appendAudit(home, record) {
    const directory = join(dshHome(home), "storages", "cockpit-audit");
    await mkdir(directory, { recursive: true });
    await appendFile(join(directory, "session-deletions.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
}

function decodeZstd(buffer) {
    if (typeof zstdDecompressSync !== "function") return undefined;
    const starts = [];
    let at = 0;
    while ((at = buffer.indexOf(ZSTD_MAGIC, at)) !== -1) {
        starts.push(at);
        at += 4;
    }
    if (starts.length === 0) return undefined;
    const parts = [];
    for (let index = 0; index < starts.length; index += 1) {
        const end = index + 1 < starts.length ? starts[index + 1] : buffer.length;
        try {
            parts.push(zstdDecompressSync(buffer.subarray(starts[index], end)));
        } catch {
            /* a torn tail frame is expected while a session is being appended */
        }
    }
    return parts.length > 0 ? Buffer.concat(parts).toString("utf8") : undefined;
}

/** Read a session transcript as text, transparently handling zstd frames. */
async function readTranscript(path) {
    const buffer = await readFile(path);
    if (path.endsWith(".zstd")) {
        const decoded = decodeZstd(buffer);
        if (decoded === undefined) throw new Error(`cannot decode zstd transcript ${path}`);
        return decoded;
    }
    return buffer.toString("utf8");
}

async function listFiles(root, depth = 0) {
    if (depth > 4) return [];
    let entries;
    try {
        entries = await readdir(root, { withFileTypes: true });
    } catch {
        return [];
    }
    const files = [];
    for (const entry of entries) {
        const path = join(root, entry.name);
        if (entry.isDirectory()) files.push(...await listFiles(path, depth + 1));
        else if (entry.isFile() && /\.jsonl(\.zstd)?$/.test(entry.name)) files.push(path);
    }
    return files;
}

/** Collect every 64-hex token mentioned by any surviving session transcript. */
async function collectReferencedHashes(home) {
    const referenced = new Set();
    const files = await listFiles(join(dshHome(home), "sessions"));
    for (const file of files) {
        try {
            const text = await readTranscript(file);
            for (const match of text.matchAll(HASH_RE)) referenced.add(match[0]);
        } catch {
            /* unreadable transcript: keep everything rather than guess */
            return { referenced, complete: false, scanned: files.length };
        }
    }
    return { referenced, complete: true, scanned: files.length };
}

/**
 * Delete attachment objects that no surviving session references.
 * @param {{ home?: string, now?: number, minAgeMs?: number, logger?: object }} options
 * @returns cleanup statistics
 */
export async function cleanupOrphanAttachments(options = {}) {
    const home = dshHome(options.home);
    const now = options.now ?? Date.now();
    const minAgeMs = options.minAgeMs ?? GRACE_MS;
    const root = join(home, "attachments", "v1", "objects");
    const stats = { scannedSessions: 0, objects: 0, referenced: 0, deleted: 0, kept: 0, failed: 0, complete: true };

    const { referenced, complete, scanned } = await collectReferencedHashes(home);
    stats.scannedSessions = scanned;
    stats.complete = complete;
    // Safety: an empty or missing sessions root cannot prove anything, so never
    // treat every attachment as an orphan in that case.
    if (!complete || scanned === 0) {
        stats.complete = false;
        return stats;
    }

    let buckets = [];
    try {
        buckets = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory());
    } catch {
        return stats;
    }

    for (const bucket of buckets) {
        const directory = join(root, bucket.name);
        let names = [];
        try {
            names = await readdir(directory);
        } catch {
            continue;
        }
        let remaining = 0;
        for (const name of names) {
            stats.objects += 1;
            if (referenced.has(name)) {
                stats.referenced += 1;
                remaining += 1;
                continue;
            }
            const path = join(directory, name);
            try {
                const info = await stat(path);
                if (now - info.mtimeMs < minAgeMs) {
                    stats.kept += 1;
                    remaining += 1;
                    continue;
                }
                await rm(path, { force: true });
                stats.deleted += 1;
            } catch {
                stats.failed += 1;
                remaining += 1;
            }
        }
        if (remaining === 0) {
            try {
                await rm(directory, { recursive: true, force: true });
            } catch {
                /* an empty bucket left behind is harmless */
            }
        }
    }
    return stats;
}

function actorOf(ctx) {
    let agentId = null;
    try {
        agentId = ctx.get?.("agents")?.currentInitiator?.()?.id ?? null;
    } catch {
        /* no initiator in this call chain */
    }
    return {
        user: process.env.USERNAME ?? process.env.USER ?? userInfo().username,
        pid: process.pid,
        agentId
    };
}

/**
 * Install the audit listener and the periodic orphan sweep on a host context.
 * @param {object} ctx host context
 * @param {{ home?: string, sweepDelayMs?: number, sweepIntervalMs?: number, logger?: object }} options
 */
export function installMaintenance(ctx, options = {}) {
    const home = dshHome(options.home);
    const logger = options.logger ?? ctx.logger;
    let sweeping = false;

    const appendDeletion = async (payload) => {
        try {
            await appendAudit(home, {
                at: new Date().toISOString(),
                action: payload?.action ?? "delete-session",
                actor: actorOf(ctx),
                requestedSessionIds: payload?.requestedSessionIds ?? [],
                deletedSessionIds: payload?.deletedSessionIds ?? [],
                skippedSessionIds: payload?.skippedSessionIds ?? [],
                failures: payload?.failures ?? [],
                ...payload?.error === undefined ? {} : { error: payload.error }
            });
        } catch (error) {
            try {
                logger?.warn?.(`[dsh-cockpit] deletion audit append failed: ${String(error)}`);
            } catch {
                /* logging must not break the operation */
            }
        }
    };

    ctx.effect(
        () => ctx.on("archive-manager/session-deleted", (payload) => {
            void appendDeletion(payload);
        }),
        "dsh-cockpit: deletion audit"
    );

    const sweep = async () => {
        if (sweeping) return;
        sweeping = true;
        try {
            const stats = await cleanupOrphanAttachments({ home, logger });
            await appendAudit(home, {
                at: new Date().toISOString(),
                action: "cleanup-orphan-attachments",
                actor: actorOf(ctx),
                ...stats
            });
            if (stats.deleted > 0) logger?.info?.(`[dsh-cockpit] removed ${stats.deleted} orphan attachment(s)`);
        } catch (error) {
            try {
                logger?.warn?.(`[dsh-cockpit] attachment cleanup failed: ${String(error)}`);
            } catch {
                /* ignore */
            }
        } finally {
            sweeping = false;
        }
    };

    const delay = options.sweepDelayMs ?? 90_000;
    const interval = options.sweepIntervalMs ?? 6 * HOUR;
    const timer = setTimeout(() => {
        void sweep();
    }, delay);
    if (typeof timer.unref === "function") timer.unref();
    const repeater = setInterval(() => {
        void sweep();
    }, interval);
    if (typeof repeater.unref === "function") repeater.unref();
    ctx.effect(() => () => {
        clearTimeout(timer);
        clearInterval(repeater);
    }, "dsh-cockpit: maintenance timers");

    return { sweep };
}
