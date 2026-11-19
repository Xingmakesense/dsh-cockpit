// Rebuild client.js from the vendored archive-manager bundle plus the
// per-feature cockpit client modules in scripts/client/.
//
//   node scripts/build-client.mjs           # write client.js
//   node scripts/build-client.mjs --check   # fail if client.js is stale
//
// Each feature owns one module file; the factory scope is shared because the
// modules are concatenated inside the same loader factory.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const MODULES = [
    "00-shell.js",
    "10-downloads.js",
    "20-cleanup.js",
    "30-theme.js",
    "40-auto-continue.js",
    "50-composer.js",
    "60-statistics.js",
    "70-sidebar.js",
    "90-boot.js"
];

/** Compose the shipped client bundle from the vendor bundle and feature modules. */
export function composeClient() {
    const vendor = readFileSync(new URL("vendor/archive-manager/lib/client.js", root), "utf8");
    const parts = MODULES.map((name) => readFileSync(new URL(`scripts/client/${name}`, root), "utf8").replace(/\n+$/, ""));
    const wrapper = parts.join("\n\n") + "\n";
    if (!vendor.includes('id: "@michengai/dsh-archive-manager"')) {
        throw new Error("vendor client no longer registers the archive-manager module id");
    }
    if (!wrapper.includes('id: "dsh-cockpit"')) {
        throw new Error("client modules no longer register the cockpit module id");
    }
    return vendor + "\n" + wrapper;
}

function main() {
    const checkOnly = process.argv.includes("--check");
    const output = composeClient();
    const outputPath = new URL("client.js", root);
    if (checkOnly) {
        const current = readFileSync(outputPath, "utf8");
        if (current !== output) {
            console.error("client.js is stale: run `node scripts/build-client.mjs`");
            process.exit(1);
        }
        console.log(`client.js is up to date (${output.length} chars)`);
        return;
    }
    writeFileSync(outputPath, output);
    const vendorLength = readFileSync(new URL("vendor/archive-manager/lib/client.js", root), "utf8").length;
    console.log(`client.js written: ${output.length} chars (vendor ${vendorLength} + modules ${output.length - vendorLength - 1})`);
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) main();
