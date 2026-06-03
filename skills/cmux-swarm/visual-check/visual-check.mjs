#!/usr/bin/env node
// visual-check.mjs — lightweight, deterministic browser check via DIRECT Playwright.
//
// Launches its OWN headed Chromium with a UNIQUE temp user-data-dir (never a shared
// browser / shared MCP profile — those lock across concurrent swarm workers). Navigates,
// optionally drives the UI, screenshots each step, and runs JS assertions. Prints ONLY:
//   - PASS  (n steps, m assertions)            on success
//   - FAIL <step> · <label> — <screenshot>     per failing assertion / page error
//   - OVERALL: PASS|FAIL                        + exit code 0/1
// No DOM dumps.
//
// Usage:
//   node visual-check.mjs --config <file.json>
//   node visual-check.mjs --json '<inline json>'
//   [--base <url>] [--out <dir>]    # override config baseURL / output dir
//   HEADLESS=1 node visual-check.mjs ...   # force headless (CI / no display); default headed
//
// Config shape:
// {
//   "baseURL": "http://localhost:5173",
//   "outDir":  "/tmp/visual-check",            // optional; default a temp dir
//   "viewport": { "width": 1280, "height": 800 },
//   "steps": [{
//     "id": "home",                            // screenshot is <outDir>/<id>.png
//     "goto": "/",                             // relative → baseURL+goto, or absolute URL
//     "waitFor": 800,                          // ms settle after actions (optional)
//     "actions": [                             // optional, run in order:
//       { "click": "#start" },
//       { "fill":  ["#q", "hello"] },
//       { "press": ["#q", "Enter"] },
//       { "waitForSelector": ".result" },
//       { "eval":  "window.__setDate('2026-06-03')" }
//     ],
//     "assert": [                              // js returning truthy = pass:
//       { "label": "hero renders", "js": "!!document.querySelector('h1')" },
//       { "label": "no error banner", "js": "!document.querySelector('.error')" }
//     ]
//   }]
// }

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
function opt(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const configPath = opt("--config");
const inlineJson = opt("--json");
const baseOverride = opt("--base");
const outOverride = opt("--out");
const headless = process.env.HEADLESS === "1";

if (!configPath && !inlineJson) {
  console.error("visual-check: provide --config <file.json> or --json '<inline>'. See header for shape.");
  process.exit(2);
}

let config;
try {
  config = JSON.parse(inlineJson ?? fs.readFileSync(configPath, "utf8"));
} catch (e) {
  console.error(`visual-check: bad config JSON — ${e.message}`);
  process.exit(2);
}

const baseURL = baseOverride ?? config.baseURL ?? "http://localhost:3000";
const outDir = outOverride ?? config.outDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "visual-check-"));
const viewport = config.viewport ?? { width: 1280, height: 800 };
const steps = Array.isArray(config.steps) ? config.steps : [];
if (steps.length === 0) {
  console.error("visual-check: config has no steps.");
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

// ---- playwright (dynamic import so a missing dep gives a clean message) ------
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    console.error("visual-check: Playwright not found. Install it in the project:");
    console.error("  npm i -D playwright && npx playwright install chromium");
    process.exit(2);
  }
}

const abs = (goto) => (/^https?:\/\//.test(goto) ? goto : baseURL.replace(/\/$/, "") + (goto.startsWith("/") ? goto : "/" + goto));

// ---- run --------------------------------------------------------------------
const failures = []; // { step, label, shot, reason }
let assertionCount = 0;

// UNIQUE user-data-dir → isolated browser, safe to run many in parallel.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "visual-check-profile-"));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless,
  viewport,
  args: ["--no-first-run", "--no-default-browser-check"],
});
const page = context.pages()[0] ?? (await context.newPage());

// Capture hard page errors per step.
let pageErrors = [];
page.on("pageerror", (err) => pageErrors.push(err.message));

async function runAction(a) {
  if (a.click) return page.click(a.click, { timeout: 10000 });
  if (a.fill) return page.fill(a.fill[0], a.fill[1], { timeout: 10000 });
  if (a.press) return page.press(a.press[0], a.press[1], { timeout: 10000 });
  if (a.waitForSelector) return page.waitForSelector(a.waitForSelector, { timeout: 10000 });
  if (a.eval) return page.evaluate(a.eval);
  console.error(`visual-check: unknown action ${JSON.stringify(a)} — skipped`);
}

try {
  for (const step of steps) {
    const id = step.id ?? `step-${steps.indexOf(step) + 1}`;
    const shot = path.join(outDir, `${id}.png`);
    pageErrors = [];
    try {
      if (step.goto) await page.goto(abs(step.goto), { waitUntil: "domcontentloaded", timeout: 30000 });
      for (const a of step.actions ?? []) await runAction(a);
      if (step.waitFor) await page.waitForTimeout(step.waitFor);
    } catch (e) {
      await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      failures.push({ step: id, label: "navigation/action", shot, reason: e.message.split("\n")[0] });
      continue;
    }

    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});

    for (const err of pageErrors) {
      failures.push({ step: id, label: "page error", shot, reason: err.split("\n")[0] });
    }

    for (const a of step.assert ?? []) {
      assertionCount++;
      let ok = false, reason = "";
      try {
        ok = await page.evaluate(a.js);
      } catch (e) {
        reason = `assert threw: ${e.message.split("\n")[0]}`;
      }
      if (!ok) failures.push({ step: id, label: a.label ?? a.js, shot, reason: reason || "predicate falsy" });
    }
  }
} finally {
  await context.close().catch(() => {});
}

// ---- report (signal only) ---------------------------------------------------
console.log("──────── visual-check ────────");
if (failures.length === 0) {
  console.log(`PASS  (${steps.length} steps, ${assertionCount} assertions)`);
  console.log(`screenshots: ${outDir}`);
  console.log("──────────────────────────────");
  console.log("OVERALL: PASS");
  process.exit(0);
} else {
  for (const f of failures) {
    console.log(`FAIL  ${f.step} · ${f.label} — ${f.shot}`);
    if (f.reason) console.log(`      ${f.reason}`);
  }
  console.log("──────────────────────────────");
  console.log("OVERALL: FAIL");
  process.exit(1);
}
