/**
 * In-page helpers, serialized into the browser context.
 *
 * Everything here runs inside the page (no Node APIs). It is exposed as a single
 * string (`INPAGE_SOURCE`) that capture.js injects via addInitScript, so the same
 * functions are installed on every navigation BEFORE any app code runs.
 *
 * Jobs:
 *   1. Virtual clock — we OWN time in-page. requestAnimationFrame / performance.now
 *      / Date.now are overridden so JS/rAF motion is a pure function of a timestamp
 *      we control. This is deterministic by construction (no dependence on the
 *      host's frame cadence), which Playwright's clock.fastForward is not.
 *   2. Deterministic RNG — seed Math.random so RNG-driven motion is reproducible.
 *   3. Sampling + Layer-1 enumeration — read resolved state and declared intent
 *      from the live DOM / WAAPI / CSSOM.
 *
 * Dual-clock model: CSS/WAAPI animations are advanced separately via
 * `seekAll` (animation.currentTime); JS/rAF animations via `tickTo`. Each capture
 * frame advances BOTH to the same instant, then samples once.
 *
 * The sampler (decompose/sampleEl/enumerateEl) is shared with the realtime mode
 * via sampler.js, so both modes report identical resolved-state values.
 */
import { SAMPLER_BODY, SAMPLER_API } from './sampler.js';

export const INPAGE_SOURCE = /* js */ `
(() => {
  if (window.__motionTrace) return;

  // --- 1. Virtual clock (we own rAF + time) --------------------------------
  let now = 0;
  let rafQueue = [];
  let rafId = 0;
  window.requestAnimationFrame = (cb) => { const id = ++rafId; rafQueue.push({ id, cb }); return id; };
  window.cancelAnimationFrame = (id) => { rafQueue = rafQueue.filter((x) => x.id !== id); };
  try { performance.now = () => now; } catch (e) {}
  try { Date.now = () => now; } catch (e) {}

  // Advance virtual time to t and run exactly one logical animation frame.
  // Standard rAF semantics: callbacks queued before this tick run now; any they
  // reschedule run on the next tick. State at t is well-defined for time-based
  // animations (position = f(elapsed)), which is what a sampler wants.
  function tickTo(t) {
    now = t;
    const q = rafQueue;
    rafQueue = [];
    for (const { cb } of q) { try { cb(t); } catch (e) {} }
  }

  // --- 2. Deterministic RNG (mulberry32), seeded ---------------------------
  function installSeededRandom(seed) {
    let a = seed >>> 0;
    Math.random = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // --- shared sampler (decompose / sampleEl / enumerateEl) -----------------
  ${SAMPLER_BODY}

  window.__motionTrace = {
    tickTo,
    installSeededRandom,
    // pause + seek every animation on the tracked selectors to absolute time t (ms)
    seekAll: (selectors, t) => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        for (const anim of el.getAnimations()) {
          try { anim.pause(); anim.currentTime = t; } catch (e) {}
        }
      }
    },
  };
  ${SAMPLER_API}

  installSeededRandom(0x9e3779b9);
})();
`;
