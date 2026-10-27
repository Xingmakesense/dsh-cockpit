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
import { appendFile, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { decompressFrame } from "./vendor/archive-manager/lib/session-repair.js";

const HOUR = 3_600_000;
const GRACE_MS = 24 * HOUR;
const HASH_RE = /[0-9a-f]{64}/g;
const AUDIT_MAX_BYTES = 2 * 1024 * 1024;
const TRANSCRIPT_MAX_BYTES = 32 * 1024 * 1024;

/** Resolve the DSH home directory the same way the harness does. */
export function dshHome(override) {
    return override ?? process.env.DSH_HOME ?? join(homedir(), ".dsh");
}

/** Append one JSON line; retain at most the current file and one 2 MiB generation. */
export async function appendAudit(home, record) {
    const directory = join(dshHome(home), "storages", "cockpit-audit");
    await mkdir(directory, { recursive: true });
    const path = join(directory, "session-deletions.jsonl");
    try {
        const info = await stat(path);
        if (info.size >= AUDIT_MAX_BYTES) {
            await rm(`${path}.1`, { force: true });
            await rename(path, `${path}.1`);
        }
    } catch (error) {
        if (error?.code !== "ENOENT") throw error;
    }
    await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

/** Scan hashes frame-by-frame without parsing or materializing a whole JSONL transcript. */
async function collectTranscriptHashes(path, referenced) {
    const buffer = await readFile(path);
    if (buffer.length > TRANSCRIPT_MAX_BYTES) throw new Error(`transcript exceeds ${TRANSCRIPT_MAX_BYTES} bytes: ${path}`);
    let carry = "";
    const scan = (text) => {
        const combined = carry + text;
        for (const match of combined.matchAll(HASH_RE)) referenced.add(match[0]);
        carry = combined.slice(-63);
    };
    if (!path.endsWith(".zstd")) {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        if (!text.endsWith("\n")) throw new Error(`transcript has a torn tail: ${path}`);
        scan(text);
        return;
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let offset = 0, size = 0;
    while (offset < buffer.length) {
        const result = decompressFrame(buffer.subarray(offset), TRANSCRIPT_MAX_BYTES - size);
        if (!result.engine.bytesWritten) throw new Error(`transcript has an incomplete zstd frame: ${path}`);
        offset += result.engine.bytesWritten;
        size += result.buffer.length;
        scan(decoder.decode(result.buffer, { stream: true }));
    }
    const tail = carry + decoder.decode();
    if (!tail.endsWith("\n")) throw new Error(`transcript has a torn tail: ${path}`);
    for (const match of tail.matchAll(HASH_RE)) referenced.add(match[0]);
}

async function listFiles(root, depth = 0) {
    if (depth > 4) throw new Error(`session transcript nesting exceeds the supported layout: ${root}`);
    // A missing/unreadable directory is not an empty directory: the caller must
    // abort the sweep rather than infer that its attachments are unreferenced.
    const entries = await readdir(root, { withFileTypes: true });
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
    let files;
    try {
        files = await listFiles(join(dshHome(home), "sessions"));
    } catch {
        return { referenced, complete: false, scanned: 0 };
    }
    for (const file of files) {
        try {
            await collectTranscriptHashes(file, referenced);
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
