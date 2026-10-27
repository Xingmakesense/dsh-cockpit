/**
 * dsh-cockpit host entry.
 *
 * Four responsibilities, one file each:
 *  - `auto-continue.js`  — failure counting, hidden retry, inline notices.
 *  - `archive.js`        — mounts the vendored session-archive host.
 *  - `maintenance.js`    — deletion audit + orphan attachment sweep.
 *  - `downloads.js`      — passive download progress observation and events.
 *
 * The independent `dsh-effort-slider` package owns the reasoning-effort
 * slider; this plugin never touches `llm-pi-ai` or the model selector.
 */
import { Config, installAutoContinue } from "./auto-continue.js";
import { installArchiveHost } from "./archive.js";
import { installMaintenance } from "./maintenance.js";
import { installDownloads } from "./downloads.js";

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
}
