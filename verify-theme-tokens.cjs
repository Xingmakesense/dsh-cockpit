// Theme-token audit for the cockpit UI.
//
// The UI is plain inline CSS, so a token DSH does not define silently falls
// back — and a dark fallback on the light theme used to render dark-on-dark
// text in the download card and the cleanup section. This check does two
// things:
//
//   1. every `var(--dsw-…)` referenced by scripts/client modules must exist
//      in the token snapshot below (taken from DSH 0.2.2-rc.3);
//   2. the colours that actually end up next to each other must keep WCAG
//      contrast: text >= 4.5:1, non-text UI (progress fill vs. track) >= 3:1,
//      on both the light and the dark theme.
//
// Refresh the snapshot when DSH changes its theme tokens.
const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

// --- token snapshot (light / dark) -----------------------------------------
const TOKENS = {
    "--dsw-alias-bg-base": { light: "#ffffff", dark: "#151517" },
    "--dsw-alias-bg-module-platform": { light: "#f5f6f7", dark: "#353638" },
    "--dsw-alias-bg-layer-2": { light: "#ffffff", dark: "#2c2c2e" },
    "--dsw-alias-interactive-bg-hover": { light: "#2631480f", dark: "#ffffff14" },
    "--dsw-alias-interactive-bg-active": { light: "#2631481a", dark: "#ffffff24" },
    "--dsw-alias-border-l2": { light: "#0000001a", dark: "#ffffff1f" },
    "--dsw-alias-label-primary": { light: "#0f1115", dark: "#f9fafb" },
    "--dsw-alias-label-secondary": { light: "#61666b", dark: "#cfd3d6" },
    "--dsw-alias-label-tertiary": { light: "#81858c", dark: "#adb2b8" },
    "--dsw-alias-label-primary-foreground": { light: "#ffffff", dark: "#0f1115" },
    "--dsw-alias-state-business-primary": { light: "#4176e6", dark: "#7aaaff" },
    "--dsw-alias-state-warn-primary": { light: "#f59e0b", dark: "#f59e0b" },
    "--dsw-alias-state-error-primary": { light: "#ec1313", dark: "#f25a5a" },
    "--dsw-alias-state-success-primary": { light: "#22c55e", dark: "#22c55e" },
    "--dsw-alias-button-primary-fill": { light: "#0f1115", dark: "#f9fafb" },
    "--dsw-specific-input-major": { light: "#ffffff", dark: "#2c2c2e" },
    "--dsw-shadow-lv3": { light: "0 0 1px #0003, 0 12px 32px #00000014", dark: "0 0 1px #0003, 0 12px 32px #00000014" }
};
// Tokens that were referenced by older releases but do not exist in DSH; they
// must never come back.
const REMOVED = ["--dsw-alias-bg-elevated", "--dsw-alias-bg-sunken"];

// --- colour helpers ---------------------------------------------------------
function parse(color) {
    const value = String(color).trim();
    const hex = value.replace("#", "");
    if (/^[0-9a-f]{3,8}$/i.test(hex)) {
        const full = hex.length <= 4
            ? hex.split("").map((c) => c + c).join("")
            : hex;
        const channels = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
        const alpha = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
        return [...channels, alpha];
    }
    throw new Error(`unsupported colour: ${value}`);
}
const toHex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
function composite(foreground, background) {
    const [r, g, b, a] = parse(foreground);
    const [br, bg, bb] = parse(background);
    return toHex([r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)]);
}
function luminance(color) {
    const [r, g, b] = parse(color).slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(foreground, background) {
    const a = luminance(foreground);
    const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
// Same 55/45 mix the client modules apply to state colours for small text.
function stateText(stateColor, labelColor) {
    const s = parse(stateColor);
    const l = parse(labelColor);
    return toHex([0, 1, 2].map((i) => s[i] * 0.55 + l[i] * 0.45));
}

// --- 1. every referenced token exists --------------------------------------
const clientDir = join(__dirname, "scripts", "client");
const wrapper = readdirSync(clientDir)
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => readFileSync(join(clientDir, name), "utf8"))
    .join("\n");
// Comments explain the old trap and mention the dead token names; drop them
// before scanning so only real style references are audited.
const code = wrapper.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const referenced = new Set(code.match(/--dsw-[a-z0-9-]+/g) ?? []);
for (const token of REMOVED) {
    assert(!referenced.has(token), `${token} does not exist in DSH and must not be referenced again`);
}
for (const token of referenced) {
    assert(Object.hasOwn(TOKENS, token), `the client modules reference ${token}, which is missing from the DSH token snapshot`);
}

// --- 2. contrast on both themes --------------------------------------------
const results = [];
for (const theme of ["light", "dark"]) {
    const value = (name) => TOKENS[name][theme];
    const surface = value("--dsw-alias-bg-module-platform");
    const canvases = {
        surface,
        base: value("--dsw-alias-bg-base")
    };
    const track = composite(value("--dsw-alias-interactive-bg-active"), surface);
    for (const [name, background] of Object.entries(canvases)) {
        results.push([`${theme}/${name}: label-primary`, contrast(value("--dsw-alias-label-primary"), background), 4.5]);
        results.push([`${theme}/${name}: label-secondary`, contrast(value("--dsw-alias-label-secondary"), background), 4.5]);
        results.push([`${theme}/${name}: warn text`, contrast(stateText(value("--dsw-alias-state-warn-primary"), value("--dsw-alias-label-primary")), background), 4.5]);
        results.push([`${theme}/${name}: error text`, contrast(stateText(value("--dsw-alias-state-error-primary"), value("--dsw-alias-label-primary")), background), 4.5]);
        results.push([`${theme}/${name}: success text`, contrast(stateText(value("--dsw-alias-state-success-primary"), value("--dsw-alias-label-primary")), background), 4.5]);
    }
    results.push([`${theme}: label-primary on input fill`, contrast(value("--dsw-alias-label-primary"), value("--dsw-specific-input-major")), 4.5]);
    results.push([`${theme}: button label on button fill`, contrast(value("--dsw-alias-label-primary-foreground"), value("--dsw-alias-button-primary-fill")), 4.5]);
    results.push([`${theme}: progress fill vs. track`, contrast(value("--dsw-alias-state-business-primary"), track), 3]);
    results.push([`${theme}: progress track vs. surface`, contrast(track, surface), 1.05]);
}

const failures = results.filter(([, ratio, minimum]) => ratio < minimum);
for (const [name, ratio, minimum] of results) {
    console.log(`${ratio.toFixed(2).padStart(5)} (>= ${minimum}) ${name}`);
}
assert(failures.length === 0, `theme contrast regressions:\n${failures.map(([name, ratio, minimum]) => `  ${name}: ${ratio.toFixed(2)} < ${minimum}`).join("\n")}`);

console.log(`theme token check passed (${referenced.size} tokens, ${results.length} contrast pairs)`);
