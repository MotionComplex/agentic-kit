#!/usr/bin/env node
// Convert the design tokens in src/styles/tokens.css from oklch() to sRGB hex
// so they can be embedded in DESIGN.md YAML front matter (Stitch's Color type
// requires sRGB hex). Re-run after editing tokens.css.
//
//   node scripts/oklch-to-hex.mjs            # print a YAML-ready block
//   node scripts/oklch-to-hex.mjs --json     # print JSON instead
//
// Reference for the OKLCH→sRGB pipeline:
//   https://drafts.csswg.org/css-color/#color-conversion-code

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = resolve(HERE, "..", "src", "styles", "tokens.css");

// ── OKLCH → sRGB hex ────────────────────────────────────────────────────
function oklchToHex(l, c, h) {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);

  // OKLab → linear LMS
  const lp = l + 0.3963377774 * a + 0.2158037573 * b;
  const mp = l - 0.1055613458 * a - 0.0638541728 * b;
  const sp = l - 0.0894841775 * a - 1.291485548 * b;
  const L = lp ** 3;
  const M = mp ** 3;
  const S = sp ** 3;

  // Linear LMS → linear sRGB
  let r = +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  let g = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  let bl = -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S;

  // Linear → gamma-encoded sRGB
  const enc = (v) => {
    const s = Math.sign(v);
    const av = Math.abs(v);
    return av <= 0.0031308 ? s * 12.92 * av : s * (1.055 * av ** (1 / 2.4) - 0.055);
  };
  r = enc(r);
  g = enc(g);
  bl = enc(bl);

  const clamp = (v) => Math.max(0, Math.min(1, v));
  const to8 = (v) => Math.round(clamp(v) * 255);
  const hex = (n) => n.toString(16).padStart(2, "0");
  // Stitch's Color type is sRGB hex without alpha — emit 6-char only.
  // The alpha component (when present) is preserved in tokens.css and
  // surfaced through narrative in DESIGN.md, not the colors map.
  return `#${hex(to8(r))}${hex(to8(g))}${hex(to8(bl))}`;
}

// ── Parse tokens.css ────────────────────────────────────────────────────
// We extract `--name: oklch(L C H[ / A]);` lines, scoped by the nearest
// preceding selector block. Selectors of interest: `:root,` / `[data-theme="light"]`
// (light scope) and `.dark,` / `[data-theme="dark"]` (dark scope).
const OKLCH_RE =
  /--([a-z0-9-]+):\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/g;

function parseTokens(css) {
  const themes = { light: {}, dark: {} };
  let scope = "light";

  // Walk line by line so we can flip scope when we cross a selector block.
  const lines = css.split("\n");
  for (const line of lines) {
    if (/^\.dark,|^\[data-theme="dark"\]/.test(line.trim())) scope = "dark";
    else if (/^:root,|^\[data-theme="light"\]/.test(line.trim())) scope = "light";

    OKLCH_RE.lastIndex = 0;
    let m;
    while ((m = OKLCH_RE.exec(line)) != null) {
      const [, name, l, c, h] = m;
      const hex = oklchToHex(parseFloat(l), parseFloat(c), parseFloat(h));
      themes[scope][name] = hex;
    }
  }
  return themes;
}

// ── Token name → DESIGN.md YAML key ─────────────────────────────────────
// Stitch's `colors:` map is a flat string→hex object. We keep the existing
// lucide-zone token names verbatim (e.g. `primary-foreground`,
// `status-in-progress`) since they're already semantic. The dark-theme
// values are emitted as `*-dark` siblings so a single DESIGN.md can carry
// both palettes without violating the schema.
function emit(themes, format) {
  const light = themes.light;
  const dark = themes.dark;
  const keys = Object.keys(light).sort();

  if (format === "json") {
    const out = {};
    for (const k of keys) {
      out[k] = light[k];
      if (dark[k] && dark[k] !== light[k]) out[`${k}-dark`] = dark[k];
    }
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  // YAML — emit one key per line, two-space indent, quoted hex strings.
  for (const k of keys) {
    console.log(`  ${k}: "${light[k]}"`);
  }
  console.log();
  console.log("  # Dark-theme overrides (same semantic names + '-dark' suffix)");
  for (const k of keys) {
    if (dark[k] && dark[k] !== light[k]) {
      console.log(`  ${k}-dark: "${dark[k]}"`);
    }
  }
}

const css = readFileSync(TOKENS_PATH, "utf8");
const themes = parseTokens(css);
const format = process.argv.includes("--json") ? "json" : "yaml";
emit(themes, format);
