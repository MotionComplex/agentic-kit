import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { INPAGE_SOURCE } from './inpage.js';
import { launchChromium } from './launch.js';

/**
 * Capture a MotionTrace: resolved, deterministic, per-frame state of the motion
 * on a page, plus the declarative timeline behind it.
 *
 * The reliable base is the DUAL-CLOCK LOCKSTEP loop. Two independent timelines
 * drive web motion and they are NOT linked:
 *   - CSS / WAAPI animations advance only when you set `animation.currentTime`.
 *   - JS / requestAnimationFrame motion advances only when the rAF clock moves.
 * So every frame we advance BOTH to the same instant `t`, then sample once.
 *
 * Time is owned in-page (see inpage.js): requestAnimationFrame / performance.now /
 * Date.now are overridden and ticked to an exact timestamp per frame. This is
 * deterministic by construction — it does not depend on any host frame cadence.
 *
 * Two entry points:
 *   - capture(opts)            — owns the browser (launch or connect over CDP).
 *   - captureOnPage(page, opts) — runs on an EXISTING Playwright Page, so it
 *                                 plugs into a Playwright test or an agent's
 *                                 live browser session.
 */

/**
 * Run the stepping + sampling on an already-open Playwright Page.
 *
 * Modes:
 *  - Deterministic (default): the page was navigated by `capture()` with the
 *    in-page virtual clock installed before load → CSS/WAAPI AND JS/rAF are
 *    captured deterministically.
 *  - Attach (`opts.attached: true`): the page was already loaded/driven by the
 *    caller (a test, or an agent). We inject the sampling helpers after the fact
 *    and step CSS/WAAPI via currentTime. JS/rAF motion can't be retro-controlled
 *    in this mode, so the trace covers declarative + WAAPI motion.
 *
 * @param {import('playwright').Page} page
 * @param {object} opts  { selectors, fps?, duration?, filmstripDir?, attached?, meta? }
 */
export async function captureOnPage(page, opts) {
  const { selectors, fps = 30, duration = 1000, filmstripDir = null, attached = false } = opts;
  if (!selectors?.length) throw new Error('captureOnPage: `selectors` must be a non-empty array');

  // Idempotent: installs window.__motionTrace if it isn't there yet (attach mode).
  await page.evaluate(INPAGE_SOURCE);

  const timeline = await page.evaluate((sels) => window.__motionTrace.enumerate(sels), selectors);

  const stepMs = 1000 / fps;
  const times = [];
  for (let t = 0; t <= duration + 1e-6; t += stepMs) times.push(Math.round(t));

  if (filmstripDir) mkdirSync(filmstripDir, { recursive: true });
  const filmstrip = filmstripDir ? [] : undefined;

  const bySelector = new Map(selectors.map((s) => [s, []]));
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    await page.evaluate(
      ({ sels, t }) => {
        window.__motionTrace.tickTo(t);        // JS / rAF clock
        window.__motionTrace.seekAll(sels, t); // CSS / WAAPI clock
      },
      { sels: selectors, t },
    );
    for (const sel of selectors) {
      const s = await page.evaluate((sel) => window.__motionTrace.sample(sel), sel);
      if (s) bySelector.get(sel).push({ t, ...s });
    }
    if (filmstripDir) {
      const name = `frame_${String(i).padStart(3, '0')}.png`;
      writeFileSync(join(filmstripDir, name), await page.screenshot({ animations: 'disabled' }));
      filmstrip.push({ t, file: name });
    }
  }

  const vp = page.viewportSize() || { width: 1280, height: 800 };
  const m = opts.meta || {};
  return {
    meta: {
      url: m.url ?? page.url(),
      viewport: m.viewport ?? [vp.width, vp.height],
      fps,
      duration_ms: duration,
      frames: times.length,
      trigger: m.trigger ?? (attached ? 'attached' : 'load'),
      reducedMotion: m.reducedMotion ?? 'no-preference',
      mode: attached ? 'attached' : 'deterministic',
      engine: 'chromium',
      traceVersion: 1,
    },
    timeline,
    tracks: selectors.map((selector) => ({ selector, frames: bySelector.get(selector) })),
    ...(filmstrip ? { filmstrip: { dir: filmstripDir, frames: filmstrip } } : {}),
  };
}

/**
 * Owned-browser capture. Launches Chromium (or connects to a running browser via
 * `cdpEndpoint`), navigates, triggers, and runs captureOnPage.
 *
 * @param {object} opts
 * @param {string} opts.url
 * @param {string[]} opts.selectors
 * @param {object|string} [opts.trigger]
 * @param {number} [opts.fps=30]
 * @param {number} [opts.duration=1000]
 * @param {[number,number]} [opts.viewport=[1280,800]]
 * @param {'no-preference'|'reduce'} [opts.reducedMotion]
 * @param {string|null} [opts.filmstripDir]
 * @param {string} [opts.cdpEndpoint]  attach to a running browser (e.g. an agent's)
 * @returns {Promise<object>} MotionTrace artifact
 */
export async function capture(opts) {
  const {
    url, selectors, trigger = 'load', fps = 30, duration = 1000,
    viewport = [1280, 800], reducedMotion = 'no-preference', filmstripDir = null,
    cdpEndpoint = null,
  } = opts;

  if (!url) throw new Error('capture: `url` is required');
  if (!selectors?.length) throw new Error('capture: `selectors` must be a non-empty array');

  const browser = cdpEndpoint ? await chromium.connectOverCDP(cdpEndpoint) : await launchChromium();
  const owns = !cdpEndpoint;
  try {
    const context = await browser.newContext({
      viewport: { width: viewport[0], height: viewport[1] },
      reducedMotion,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    // Virtual clock + determinism shims must be installed before any app code runs.
    await page.addInitScript(INPAGE_SOURCE);
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null));
    await applyTrigger(page, trigger);

    return await captureOnPage(page, {
      selectors, fps, duration, filmstripDir,
      meta: { url, viewport, trigger: typeof trigger === 'string' ? trigger : trigger.action, reducedMotion },
    });
  } finally {
    if (owns) await browser.close();
    else await browser.close().catch(() => {}); // CDP: detach, don't kill the agent's browser
  }
}

export async function applyTrigger(page, trigger) {
  if (!trigger || trigger === 'load') return; // already loaded
  const { action, selector, className = 'active' } = trigger;
  switch (action) {
    case 'hover': await page.hover(selector); break;
    case 'click': await page.click(selector); break;
    case 'focus': await page.focus(selector); break;
    case 'addClass': await page.$eval(selector, (el, c) => el.classList.add(c), className); break;
    default: throw new Error(`capture: unknown trigger action "${action}"`);
  }
}
