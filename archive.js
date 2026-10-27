/**
 * Session-management half of dsh-cockpit: mount the vendored archive host.
 *
 * The vendored package (@michengai/dsh-archive-manager 1.0.20, Apache-2.0,
 * see vendor/archive-manager/) owns the workspace-registry overlay, archive
 * bookkeeping, deletion and the typert remotes consumed by the archive page.
 * This module only wires it into the cockpit plugin with the services it needs.
 */
const ARCHIVE_INJECT = ["workspaceRegistry", "sessionProjectionCache", "typert"];
const CLEANUP_ROUTE = "/api/cockpit/empty-sessions";

function jsonResponse(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store"
        }
    });
}

export function cleanupRoute(scope) {
    return {
        path: CLEANUP_ROUTE,
        methods: ["GET", "POST"],
        requestBody: "buffered",
        fetch: async (request) => {
            const registry = scope.workspaceRegistry;
            try {
                if (request.method === "GET") {
                    if (typeof registry?.previewEmptySessions !== "function") throw new Error("previewEmptySessions unavailable");
                    return jsonResponse(200, { ok: true, value: await registry.previewEmptySessions() });
                }
                if (typeof registry?.deleteEmptySessions !== "function") throw new Error("deleteEmptySessions unavailable");
                const input = await request.json();
                if (!Array.isArray(input?.sessionIds) || input.sessionIds.some((id) => typeof id !== "string")) {
                    return jsonResponse(400, { ok: false, error: { message: "sessionIds must be a string array" } });
                }
                return jsonResponse(200, { ok: true, value: await registry.deleteEmptySessions({ sessionIds: input.sessionIds }) });
            } catch (error) {
                return jsonResponse(500, { ok: false, error: { message: error instanceof Error ? error.message : String(error) } });
            }
        }
    };
}

/**
 * Install the archive host through an inject fork.
 * @param {object} ctx host context
 */
export function installArchiveHost(ctx) {
    try {
        ctx.inject(ARCHIVE_INJECT, (scope) => {
            const pending = import("./vendor/archive-manager/lib/host-install.js")
                .then(async (mod) => {
                    const dispose = await mod.apply(scope);
                    let unregister = () => {};
                    try {
                        const connection = typeof scope.get === "function" ? scope.get("connection") : scope.connection;
                        if (typeof connection?.fetch?.register === "function") {
                            const registered = connection.fetch.register(cleanupRoute(scope));
                            if (typeof registered === "function") unregister = registered;
                        }
                    } catch (error) {
                        try {
                            ctx.logger.warn(`dsh-cockpit: empty-session route skipped: ${error?.message ?? String(error)}`);
                        } catch {
                            /* ignore */
                        }
                    }
                    return async () => {
                        try {
                            unregister();
                        } finally {
                            await dispose();
                        }
                    };
                });
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
