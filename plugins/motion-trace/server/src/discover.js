import { launchChromium } from './launch.js';

/**
 * Discover what animates on a page, so callers don't have to guess selectors.
 *
 * Reports two kinds of motion:
 *   - 'animation' : elements with live CSS/WAAPI animations at load
 *     (getAnimations()), e.g. infinite spinners, keyframe entrances in flight.
 *   - 'transition': elements with a declared non-zero CSS transition. These only
 *     move when triggered, so they come with a suggested trigger (hover/click).
 *
 * Each entry includes a suggested selector and how many elements it matches, so
 * the result feeds straight into capture()/motion_review.
 *
 * @param {object} opts { url, viewport?, settleMs? }
 * @returns {Promise<{url:string, animated:Array, interactive:Array}>}
 */
export async function discover(opts) {
  const { url, viewport = [1280, 800], settleMs = 150 } = opts;
  if (!url) throw new Error('discover: `url` is required');

  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: viewport[0], height: viewport[1] } });
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null));
    if (settleMs) await page.waitForTimeout(settleMs);

    const found = await page.evaluate(() => {
      const suggest = (el) => {
        if (el.id) return '#' + CSS.escape(el.id);
        let s = el.tagName.toLowerCase();
        const cls = [...el.classList].filter(Boolean).slice(0, 2).map((c) => '.' + CSS.escape(c)).join('');
        return s + cls;
      };
      const animated = [];
      const interactive = [];
      const seenA = new Set();
      const seenT = new Set();
      for (const el of document.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue; // skip invisible
        const anims = el.getAnimations();
        if (anims.length) {
          const sel = suggest(el);
          if (!seenA.has(sel)) {
            seenA.add(sel);
            animated.push({
              selector: sel,
              matches: document.querySelectorAll(sel).length,
              animations: anims.map((a) => ({
                type: a.constructor.name,
                name: a.animationName || a.transitionProperty || null,
                playState: a.playState,
                duration_ms: a.effect?.getComputedTiming?.().duration ?? null,
              })),
            });
          }
        }
        const cs = getComputedStyle(el);
        const td = (cs.transitionDuration || '0s').split(',').map((d) => parseFloat(d) || 0);
        if (td.some((d) => d > 0) && cs.transitionProperty !== 'none') {
          const sel = suggest(el);
          if (!seenT.has(sel)) {
            seenT.add(sel);
            interactive.push({
              selector: sel,
              matches: document.querySelectorAll(sel).length,
              transitionProperty: cs.transitionProperty,
              transitionDuration: cs.transitionDuration,
              suggestedTrigger: { action: 'hover', selector: sel },
            });
          }
        }
      }
      return { animated: animated.slice(0, 50), interactive: interactive.slice(0, 50) };
    });

    return { url, ...found };
  } finally {
    await browser.close();
  }
}
