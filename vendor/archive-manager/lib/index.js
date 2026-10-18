// Host entry kept so the vendored package keeps its upstream shape.
//
// Upstream also mounted a plugin-update HTTP route here; dsh-cockpit does not:
// the suite ships the archive code itself, installs through the profile tgz,
// and has no update channel of its own. The updater implementation
// (plugin-updater.js) was removed together with that route.
export { apply, inject } from "./host-install.js";
