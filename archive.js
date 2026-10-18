/**
 * Session-management half of dsh-cockpit: mount the vendored archive host.
 *
 * The vendored package (@michengai/dsh-archive-manager 1.0.20, Apache-2.0,
 * see vendor/archive-manager/) owns the workspace-registry overlay, archive
 * bookkeeping, deletion and the typert remotes consumed by the archive page.
 * This module only wires it into the cockpit plugin with the services it needs.
 */
const ARCHIVE_INJECT = ["workspaceRegistry", "sessionProjectionCache", "typert"];

/**
 * Install the archive host through an inject fork.
 * @param {object} ctx host context
 */
export function installArchiveHost(ctx) {
    try {
        ctx.inject(ARCHIVE_INJECT, (scope) => {
            const pending = import("./vendor/archive-manager/lib/host-install.js")
                .then((mod) => mod.apply(scope));
            scope.effect(() => () => {
                pending.then((dispose) => dispose()).catch(() => {});
            }, "dsh-cockpit: archive-manager host");
            pending.catch((error) => {
                try {
                    ctx.logger.warn(`dsh-cockpit: archive host skipped: ${error?.message ?? String(error)}`);
                } catch {
                    /* ignore */
                }
            });
        });
    } catch (error) {
        try {
            ctx.logger.warn(`dsh-cockpit: archive host unavailable: ${error?.message ?? String(error)}`);
        } catch {
            /* ignore */
        }
    }
}
