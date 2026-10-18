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

The archive, restore, favorite, preview, delete and repair behaviour is
unchanged. `dsh-cockpit` regenerates the shipped `client.js` from
`lib/client.js` with `node scripts/build-client.mjs`.
4. `lib/client.js` — archive confirm/delete dialogs now pass `centered` to the modal so they open in the middle of the viewport instead of the default top offset.
5. `lib/workspace.js` — `deleteSession` / `deleteArchivedSessions` now emit `archive-manager/session-deleted` with the per-attempt outcome so dsh-cockpit can persist a deletion audit (the vendor itself writes no files).
