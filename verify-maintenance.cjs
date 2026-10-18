// Maintenance checks: deletion audit file + orphan attachment sweep.
//
// Uses a temporary DSH home inside the workspace so nothing touches the real
// profile. Session transcripts are plain JSONL (and one zstd frame when the
// runtime supports it); attachments are content-addressed files.
const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

const { mkdir, readFile, rm, stat, utimes, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const zlib = require("node:zlib");

const ROOT = join(__dirname, ".tmp", "maintenance-test");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

async function putObject(home, hash, ageMs) {
    const path = join(home, "attachments", "v1", "objects", hash.slice(0, 2), hash);
    await mkdir(join(home, "attachments", "v1", "objects", hash.slice(0, 2)), { recursive: true });
    await writeFile(path, `object-${hash}`);
    if (ageMs > 0) {
        const old = new Date(Date.now() - ageMs);
        await utimes(path, old, old);
    }
}

async function main() {
    const maintenance = await import("./maintenance.js");
    await rm(ROOT, { recursive: true, force: true });
    const home = ROOT;
    const sessionDir = join(home, "sessions", "--F-AI-file--", "session-1");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "session.v4.jsonl"), `{"text":"file ${HASH_A} used"}\n`);

    const supportsZstd = typeof zlib.zstdCompressSync === "function";
    if (supportsZstd) {
        const session2 = join(home, "sessions", "--F-AI-file--", "session-2");
        await mkdir(session2, { recursive: true });
        await writeFile(join(session2, "session.v4.jsonl.zstd"), zlib.zstdCompressSync(Buffer.from(`{"text":"file ${HASH_C} used"}\n`)));
    }

    const HOUR = 3_600_000;
    await putObject(home, HASH_A, 48 * HOUR);   // referenced, old → keep
    await putObject(home, HASH_B, 48 * HOUR);   // orphan, old → delete
    await putObject(home, HASH_C, 48 * HOUR);   // referenced inside zstd → keep
    await putObject(home, HASH_D, 0);           // orphan, fresh → grace keeps

    const stats = await maintenance.cleanupOrphanAttachments({ home, minAgeMs: 24 * HOUR });
    assert(stats.referenced === (supportsZstd ? 2 : 1), `expected referenced objects, got ${stats.referenced}`);
    assert(stats.deleted === 1 && stats.failed === 0, `expected one orphan deleted, got ${JSON.stringify(stats)}`);
    assert(await exists(join(home, "attachments", "v1", "objects", HASH_A.slice(0, 2), HASH_A)), "referenced attachment must stay");
    assert(!await exists(join(home, "attachments", "v1", "objects", HASH_B.slice(0, 2), HASH_B)), "orphan attachment must be deleted");
    assert(await exists(join(home, "attachments", "v1", "objects", HASH_D.slice(0, 2), HASH_D)), "fresh orphan must survive the grace period");
    if (supportsZstd) {
        assert(await exists(join(home, "attachments", "v1", "objects", HASH_C.slice(0, 2), HASH_C)), "zstd-referenced attachment must stay");
    }

    // Safety: a home without any transcript must not purge anything.
    const emptyHome = join(ROOT, "empty-home");
    await mkdir(join(emptyHome, "attachments", "v1", "objects", "ee"), { recursive: true });
    await writeFile(join(emptyHome, "attachments", "v1", "objects", "ee", "e".repeat(64)), "x");
    const emptyStats = await maintenance.cleanupOrphanAttachments({ home: emptyHome, minAgeMs: 0 });
    assert(emptyStats.complete === false && emptyStats.deleted === 0, "an empty sessions root must never purge attachments");

    // Audit records: direct append and the event-driven path.
    await maintenance.appendAudit(home, { at: "2026-10-18T00:00:00.000Z", action: "test", deletedSessionIds: ["session-1"] });
    const handlers = new Map();
    const effects = [];
    const ctx = {
        logger: { info() {}, warn() {}, error() {} },
        on(event, handler) {
            if (!handlers.has(event)) handlers.set(event, []);
            handlers.get(event).push(handler);
            return () => {};
        },
        effect(setup) {
            const dispose = setup();
            effects.push(dispose);
        },
        get() {
            return undefined;
        }
    };
    maintenance.installMaintenance(ctx, { home, sweepDelayMs: 60_000, sweepIntervalMs: 60_000 });
    const listener = handlers.get("archive-manager/session-deleted")?.[0];
    assert(typeof listener === "function", "maintenance must listen for deletion audit events");
    listener({ action: "delete-session", requestedSessionIds: ["session-9"], deletedSessionIds: ["session-9"], skippedSessionIds: [], failures: [] });
    await new Promise((resolve) => setTimeout(resolve, 80));

    const log = (await readFile(join(home, "storages", "cockpit-audit", "session-deletions.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert(log.some((row) => row.action === "test"), "direct audit record missing");
    const deletion = log.find((row) => row.action === "delete-session");
    assert(deletion !== undefined, "event-driven audit record missing");
    assert(Array.isArray(deletion.deletedSessionIds) && deletion.deletedSessionIds[0] === "session-9", "audit record must carry the deleted id");
    assert(typeof deletion.at === "string" && deletion.actor && typeof deletion.actor.user === "string", "audit record must carry time and actor");

    for (const dispose of effects) {
        if (typeof dispose === "function") dispose();
    }
    await rm(ROOT, { recursive: true, force: true });
    console.log("all maintenance checks passed");
}

async function exists(path) {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
