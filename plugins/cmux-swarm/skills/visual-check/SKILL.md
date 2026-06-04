---
name: visual-check
description: >-
  Lightweight, deterministic browser/visual check via DIRECT Playwright — its own
  headed Chromium with a unique temp user-data-dir (never a shared browser or MCP
  profile). Navigate to the dev server, drive state, screenshot, run assertions,
  and return ONLY pass/fail, the failing screenshot path(s), and a one-line reason —
  not a wall of DOM. Use when the user says "visual-check", "check it in the
  browser", "does it render", "screenshot and verify", or when a swarm worker needs
  a self-contained browser check. For the full CI screenshot-review pipeline, use
  /visual-e2e instead — this is the quick, local, single-shot version.
compatibility: "Needs Playwright in the project (npm i -D playwright && npx playwright install chromium) and a running dev server. Headed by default; set HEADLESS=1 for CI/no-display. Each run gets a fresh user-data-dir so many workers can run concurrently. Runner lives in visual-check.mjs alongside this file; example config in example.config.json."
allowed-tools: Bash, Read, Write
---

# Visual Check

A fast, isolated browser check. Each run launches its **own** headed Chromium with a **unique
temp `user-data-dir`**, so it is safe for multiple swarm workers to run at once — a shared
browser/MCP profile would lock. It returns only signal: pass/fail, the screenshot(s) for any
failing step, and a one-line reason. No DOM dumps.

The runner lives in `visual-check.mjs` (bundled in this plugin at
`${CLAUDE_PLUGIN_ROOT}/skills/visual-check/visual-check.mjs` — the variable is substituted to
the plugin's install dir at runtime). It's distinct from `/visual-e2e`: that skill wires a CI
vision-review pipeline; this is the quick local check.

## Step 1 — Make sure the dev server is up

Start the project's dev server and note its URL (e.g. `http://localhost:5173`). The check
navigates a real browser to it. Two rules:

- **Bind it on all interfaces**, not just localhost (e.g. `npm run dev -- --host 0.0.0.0`;
  Vite: `--host`, Next.js: `-H 0.0.0.0`) — the user verifies changes on real mobile devices
  over the LAN, and the swarm dashboard's NETWORK column only lights up for exposed servers.
  In a swarm, use a unique port per worker so parallel servers don't collide.
- **Run it in the background and LEAVE IT RUNNING after the check** — do not kill it when
  the check passes. The user manually verifies visual changes (desktop + mobile) against
  the still-running server. Report both URLs (local and `http://<lan-ip>:<port>`) with your
  result; only stop the server when explicitly told to.

## Step 2 — Write a config

Copy `example.config.json` (alongside this file) and edit it to your scenario. Shape:

```json
{
  "baseURL": "http://localhost:5173",
  "viewport": { "width": 1280, "height": 800 },
  "steps": [
    {
      "id": "home",
      "goto": "/",
      "actions": [{ "click": "#open-planner" }, { "waitForSelector": ".planner" }],
      "waitFor": 600,
      "assert": [
        { "label": "planner opens", "js": "!!document.querySelector('.planner')" },
        { "label": "no error banner", "js": "!document.querySelector('.error')" }
      ]
    }
  ]
}
```

- `goto` — relative paths append to `baseURL`; absolute `http(s)://` URLs are used as-is.
- `actions` (in order): `click`, `fill: [sel, value]`, `press: [sel, key]`,
  `waitForSelector`, `eval: "<js>"` (to set state deterministically).
- `assert[].js` — a JS expression evaluated in the page; **truthy = pass**. Keep them about
  what the user can verify (element present, count, text, no error), not pixel values.
- One screenshot per step is saved as `<outDir>/<id>.png`.

## Step 3 — Run it

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/visual-check/visual-check.mjs" --config <your.json>
# overrides: --base <url>  --out <dir>
# CI / no display:  HEADLESS=1 node "${CLAUDE_PLUGIN_ROOT}/skills/visual-check/visual-check.mjs" --config ...
```

You can also pass the config inline: `--json '{"baseURL":"…","steps":[…]}'`.

## Step 4 — Read the filtered result

```
──────── visual-check ────────
FAIL  home · planner opens — /tmp/visual-check-AbC/home.png
      predicate falsy
──────────────────────────────
OVERALL: FAIL
```

- **Pass:** `PASS (n steps, m assertions)` + the screenshots dir. Report it in one line.
- **Fail:** one line per failing assertion / page error / navigation error, each with the
  screenshot path to inspect, and the reason. The script's **exit code** is 0/1, so it
  composes in swarm monitoring.

**Report back using only this block + the failing screenshot(s).** Don't paste page HTML.

## Swarm note

When dispatched to a worker, this is exactly the right tool: it spins up an isolated browser
the worker owns. Do **not** route workers through a single shared MCP browser — concurrent
agents would contend for one profile and stall.

## When NOT to use this

- You want CI to capture + a model to *judge* quality over time → `/visual-e2e`.
- Pure logic/no-UI change → `/cmux-swarm:code-check`.
- You need a full functional e2e suite with fixtures/retries → write proper Playwright specs.

## Pitfalls

- **No dev server running** → every step fails at navigation. Start it first.
- **Headed needs a display.** On a headless box/CI, set `HEADLESS=1`.
- **Flaky timing.** Prefer `waitForSelector` over a fixed `waitFor` where you can; add a small
  `waitFor` only to let animations settle.
- **Over-specific assertions.** Assert behaviour the user cares about, not brittle internals.
