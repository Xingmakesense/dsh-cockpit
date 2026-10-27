# Local modifications to `@michengai/dsh-archive-manager` 1.0.20

This directory vendors the upstream package (Apache-2.0, see `LICENSE`) into
`dsh-cockpit`. The following changes were made locally; everything else is the
upstream 1.0.20 build.

1. `lib/client.js`
   - Removed the settings-header links to the upstream GitHub repository and
     its issue tracker (`archives.viewProject` / `archives.feedback`, all three
     locales). The archive page is now a cockpit feature without outbound
     project links.
   - Removed the plugin-update UI: the `observePluginUpdate` call in the
     workspace-browser `apply()`, the whole update cluster it depended on
     (update-copy tables, `createUpdateFlow`, `UpdateDialog`, the `mpi-*` CSS
     and the version badge), and the corresponding locale keys.
   - Dropped the dead `/api/michengai/dsh-archive-manager/update` endpoint
     reference: cockpit never mounted that route, so the check could only fail.
2. `lib/index.js` — now a thin re-export of `lib/host-install.js`; the update
   route registration is gone.
3. `lib/plugin-updater.js` — deleted (the host-side update installer).

The archive, restore, favorite, preview, delete and repair behaviour otherwise
retains the upstream implementation. `dsh-cockpit` regenerates the shipped
`client.js` from `lib/client.js` with `node scripts/build-client.mjs`.
4. `lib/client.js` — archive confirm/delete dialogs now pass `centered` to the modal so they open in the middle of the viewport instead of the default top offset.
5. `lib/workspace.js` — `deleteSession` / `deleteArchivedSessions` now emit `archive-manager/session-deleted` with the per-attempt outcome so dsh-cockpit can persist a deletion audit (the vendor itself writes no files).
6. `lib/projcache.js` — migration skips records whose Session is conclusively absent, startup prunes confirmed orphans, and deletion purges every current/legacy cache domain with domain-specific keys. Compatible official records are read only once per migration. Active domains are borrowed, never closed by a read or purge.
7. `lib/workspace.js` — normal and unknown-session deletion share registry-trace cleanup for archived/pinned ids, favorites, workspace membership, spill and client removal notifications. Workspace updates iterate the complete table and tolerate a void `update()` result. Public single-session deletion supports both archived and unarchived targets.
8. `lib/archive-discovery.js` — missing/invalid legacy `seq` falls back to the event index, and preview truncation covers both front and back slices. `lib/workspace.js` returns only artifact basenames instead of host absolute paths.
9. `lib/workspace.js` — adds `previewEmptySessions` and `deleteEmptySessions`: a read-only conservative preview followed by revalidated deletion through the same registry/audit path.
10. `lib/session-repair.js` — exports the strict single-frame decoder for cockpit's frame-by-frame attachment-reference scan, avoiding whole-transcript JSON parsing and duplicate serialization.
