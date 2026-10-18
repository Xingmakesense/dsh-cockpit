// Rebuild client.js from the vendored archive-manager bundle plus the cockpit
// wrapper. `client.js` is a build product: never hand-edit it.
//
//   node scripts/build-client.mjs           # write client.js
//   node scripts/build-client.mjs --check   # fail if client.js is stale
//
// Keeping this reproducible matters because the profile installs a packed tgz,
// so the shipped client must always match vendor/archive-manager/lib/client.js.
import { readFileSync, writeFileSync } from "node:fs";

const checkOnly = process.argv.includes("--check");
const root = new URL("../", import.meta.url);
const vendorPath = new URL("vendor/archive-manager/lib/client.js", root);
const wrapperPath = new URL("scripts/client-wrapper.js", root);
const outputPath = new URL("client.js", root);

const vendor = readFileSync(vendorPath, "utf8");
const wrapper = readFileSync(wrapperPath, "utf8");

if (!vendor.includes('id: "@michengai/dsh-archive-manager"')) {
    throw new Error("vendor client no longer registers the archive-manager module id");
}
if (!wrapper.includes('id: "dsh-cockpit"')) {
    throw new Error("client wrapper no longer registers the cockpit module id");
}

const output = vendor + "\n" + wrapper;

if (checkOnly) {
    const current = readFileSync(outputPath, "utf8");
    if (current !== output) {
        console.error("client.js is stale: run `node scripts/build-client.mjs`");
        process.exit(1);
    }
    console.log(`client.js is up to date (${output.length} chars)`);
} else {
    writeFileSync(outputPath, output);
    console.log(`client.js written: ${output.length} chars (vendor ${vendor.length} + wrapper ${wrapper.length})`);
}
