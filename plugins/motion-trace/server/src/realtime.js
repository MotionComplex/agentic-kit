import { chromium } from 'playwright';
import { REALTIME_SAMPLER_SOURCE } from './sampler.js';
import { applyTrigger } from './capture.js';
import { launchChromium } from './launch.js';

/**
 * Real-runtime capture — the complement to deterministic capture().
 *
 * Deterministic mode owns the clock and steps CSS/WAAPI exactly, but it can't
 * see arbitrary JS-library motion (Framer Motion, GSAP, scroll-driven), because
 * that isn't exposed by getAnimations() and doesn't ride a controllable timeline.
 *
 * Real-runtime mode takes the opposite approach: it does NOT freeze time. It lets
 * the page run at real speed and SAMPLES the resolved DOM state on every real
 * animation frame — like a recorder, but capturing numbers, not pixels. So it
 * captures *any* motion that actually renders, and because it rides real frames
 * it also yields genuine performance signals (real fps, long frames, jank) that
 * the deterministic mode structurally cannot produce.
 *
 * Trade-off: not byte-deterministic (real frame timing jitters). Use deterministic
 * mode for regression/golden work; use this for JS-driven motion and perf.
 *
 * Output is shape-compatible with metrics()/diff()/analyze(); it adds a `perf` block.
 *
 * @param {object} opts { url, selectors, trigger?, duration?, viewport?, reducedMotion?, cdpEndpoint? }
 */
export async function captureRealtime(opts) {
  const {
    url, selectors, trigger = 'load', duration = 1000,
    viewport = [1280, 800], reducedMotion = 'no-preference', cdpEndpoint = null,
  } = opts;
  if (!url) throw new Error('captureRealtime: `url` is required');
  if (!selectors?.length) throw new Error('captureRealtime: `selectors` must be a non-empty array');

  const browser = cdpEndpoint ? await chromium.connectOverCDP(cdpEndpoint) : await launchChromium();
  const owns = !cdpEndpoint;
  try {
    const context = await browser.newContext({
      viewport: { width: viewport[0], height: viewport[1] },
      reducedMotion,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    // Sampler ONLY — no virtual clock, no rAF override. The page's real
    // requestAnimationFrame is left intact so JS/rAF motion actually runs, and
    // our recorder below rides those real frames.
    await page.addInitScript(REALTIME_SAMPLER_SOURCE);
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null));

    const timeline = await page.evaluate((sels) => window.__motionTrace.enumerate(sels), selectors);

    await applyTrigger(page, trigger);

    // Record real frames: on each rAF, sample every selector and log the frame delta.
    const rec = await page.evaluate(
      ({ sels, duration }) => new Promise((resolve) => {
        const buf = [];
        const deltas = [];
        const start = performance.now();
        let last = start;
        function frame(now) {
          const t = now - start;
          const samples = {};
          for (const sel of sels) samples[sel] = window.__motionTrace.sample(sel);
          buf.push({ t: +t.toFixed(2), samples });
          deltas.push(+(now - last).toFixed(3));
          last = now;
          if (t < duration) requestAnimationFrame(frame);
          else resolve({ buf, deltas });
        }
        requestAnimationFrame(frame);
      }),
      { sels: selectors, duration },
    );

    const tracks = selectors.map((selector) => ({
      selector,
      frames: rec.buf.filter((f) => f.samples[selector]).map((f) => ({ t: f.t, ...f.samples[selector] })),
    }));

    const perf = computePerf(rec.deltas, rec.buf);
    const vp = page.viewportSize() || { width: viewport[0], height: viewport[1] };

    return {
      meta: {
        url, viewport: [vp.width, vp.height],
        fps: perf.measuredFps,
        duration_ms: duration,
        frames: rec.buf.length,
        trigger: typeof trigger === 'string' ? trigger : trigger.action,
        reducedMotion,
        mode: 'realtime',
        engine: 'chromium',
        traceVersion: 1,
      },
      timeline,
      tracks,
      perf,
    };
  } finally {
    if (owns) await browser.close();
    else await browser.close().catch(() => {});
  }
}

// Real frame timing → performance signals. The first delta (startup) is dropped.
function computePerf(deltas, buf) {
  const budget = 1000 / 60; // 16.67ms
  const d = deltas.slice(1);
  const total = buf.length ? buf[buf.length - 1].t : 0;
  const measuredFps = total > 0 ? +((buf.length / total) * 1000).toFixed(1) : 0;
  const longFrameThreshold = budget * 2; // > ~33ms = at least one frame missed
  const longFrames = d.filter((x) => x > longFrameThreshold).length;
  const droppedFrames = d.reduce((n, x) => n + Math.max(0, Math.round(x / budget) - 1), 0);
  const maxFrameGap_ms = d.length ? +Math.max(...d).toFixed(2) : 0;
  return {
    measuredFps,
    frames: buf.length,
    budget_ms: +budget.toFixed(2),
    longFrames,
    longFrameThreshold_ms: +longFrameThreshold.toFixed(2),
    droppedFrames,
    maxFrameGap_ms,
  };
}

