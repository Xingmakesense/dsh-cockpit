/**
 * dsh-cockpit host entry.
 *
 * Five responsibilities, one file each:
 *  - `auto-continue.js`  — official `agent/request-error` recovery layer.
 *  - `archive.js`        — mounts the vendored session-archive host.
 *  - `maintenance.js`    — deletion audit + orphan attachment sweep.
 *  - `downloads.js`      — passive download progress observation and events.
 *  - `stats.js`          — lazy watcher-insights projection + statistics route.
 *
 * Auto-continue is implemented only on documented seams: the
 * `agent/request-error` waterfall, the native Config/settings service and a
 * same-origin snapshot route for the Client. It never fabricates runtime
 * context messages or borrows an internal event relay.
 */
import { Config, installAutoContinue } from "./auto-continue.js";
import { installArchiveHost } from "./archive.js";
import { installMaintenance } from "./maintenance.js";
import { installDownloads } from "./downloads.js";
import { installStats } from "./stats.js";

export { Config };
export const name = "cockpit";
export const inject = [];

function warn(ctx, message) {
    try {
        ctx.logger.warn(`dsh-cockpit: ${message}`);
    } catch {
        /* logging must never block installation */
    }
}

/**
 * @param {object} ctx host context
 * @param {unknown} config raw or volatile plugin config
 */
export function apply(ctx, config) {
    try {
        installAutoContinue(ctx, config);
    } catch (error) {
        warn(ctx, `auto-continue skipped: ${error?.message ?? String(error)}`);
    }

    installArchiveHost(ctx);

    try {
        installMaintenance(ctx);
    } catch (error) {
        warn(ctx, `maintenance skipped: ${error?.message ?? String(error)}`);
    }

    try {
        installDownloads(ctx);
    } catch (error) {
        warn(ctx, `download observation skipped: ${error?.message ?? String(error)}`);
    }

    try {
        installStats(ctx);
    } catch (error) {
        warn(ctx, `statistics skipped: ${error?.message ?? String(error)}`);
    }
}
