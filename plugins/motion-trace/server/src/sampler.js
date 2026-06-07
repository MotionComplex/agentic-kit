/**
 * Shared in-page sampler — used VERBATIM by both capture modes so they produce
 * identical resolved-state values:
 *   - deterministic (inpage.js): sampler + virtual clock + RNG
 *   - real-runtime  (realtime.js): sampler only, real rAF, no clock override
 *
 * Keeping this as one source of truth means the determinism golden also protects
 * the realtime sampler. `SAMPLER_BODY` defines `round`, `decompose`, `sampleEl`,
 * and `enumerateEl` as locals; `SAMPLER_API` exposes them on window.__motionTrace.
 */
export const SAMPLER_BODY = /* js */ `
  const round = (n, p = 4) => {
    if (!isFinite(n)) return n;
    const f = Math.pow(10, p);
    const r = Math.round(n * f) / f;
    return r === 0 ? 0 : r; // normalize -0 → 0 for byte-stable output
  };

  // 2D affine decomposition of a CSS transform string → LLM-friendly parts.
  function decompose(transform) {
    if (!transform || transform === 'none') {
      return { translate: [0, 0], scale: [1, 1], rotate: 0, skewX: 0, matrix: [1, 0, 0, 1, 0, 0] };
    }
    const m = new DOMMatrix(transform);
    const a = m.a, b = m.b, c = m.c, d = m.d, e = m.e, f = m.f;
    const RAD = 180 / Math.PI;
    const scaleX = Math.hypot(a, b);
    const det = a * d - b * c;
    const scaleY = scaleX ? det / scaleX : Math.hypot(c, d);
    const rotate = Math.atan2(b, a) * RAD;
    const skewX = Math.atan2(a * c + b * d, scaleX * scaleX) * RAD;
    return {
      translate: [round(e, 3), round(f, 3)],
      scale: [round(scaleX, 4), round(scaleY, 4)],
      rotate: round(rotate, 3),
      skewX: round(skewX, 3),
      matrix: [round(a, 5), round(b, 5), round(c, 5), round(d, 5), round(e, 3), round(f, 3)],
    };
  }

  // Resolved state of one element at the current instant (Layer 2).
  function sampleEl(el) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      opacity: round(parseFloat(cs.opacity), 4),
      transform: decompose(cs.transform),
      bbox: [round(r.x, 2), round(r.y, 2), round(r.width, 2), round(r.height, 2)],
      styles: {
        backgroundColor: cs.backgroundColor,
        filter: cs.filter === 'none' ? undefined : cs.filter,
        visibility: cs.visibility === 'visible' ? undefined : cs.visibility,
      },
    };
  }

  // Declared intent for one element (Layer 1) — from WAAPI + CSSOM.
  // Easing is read from per-keyframe easing and CSSOM timing-function, NOT
  // getComputedTiming().easing (which reports "linear" for CSS animations).
  function enumerateEl(el, selector) {
    const cs = getComputedStyle(el);
    return el.getAnimations().map((anim, i) => {
      const eff = anim.effect;
      const ct = eff.getComputedTiming();
      const kfs = eff.getKeyframes().map((k) => {
        const { offset, easing, composite, computedOffset, ...props } = k;
        return { offset: computedOffset ?? offset, easing, props };
      });
      const isTransition = anim.constructor.name === 'CSSTransition';
      return {
        id: selector + '#' + i,
        selector,
        type: anim.constructor.name === 'CSSAnimation' ? 'css-animation'
            : isTransition ? 'transition' : 'waapi',
        animationName: anim.animationName || anim.transitionProperty || undefined,
        duration_ms: ct.duration,
        delay_ms: ct.delay,
        iterations: ct.iterations === Infinity ? null : ct.iterations,
        direction: ct.direction,
        fill: ct.fill,
        easing: isTransition ? cs.transitionTimingFunction
                             : (cs.animationTimingFunction || kfs[0]?.easing || 'linear'),
        keyframes: kfs,
      };
    });
  }
`;

// Exposes sample()/enumerate() on an existing window.__motionTrace object.
export const SAMPLER_API = /* js */ `
  window.__motionTrace.sample = (selector) => {
    const el = document.querySelector(selector);
    return el ? sampleEl(el) : null;
  };
  window.__motionTrace.enumerate = (selectors) => {
    const out = [];
    for (const sel of selectors) { const el = document.querySelector(sel); if (el) out.push(...enumerateEl(el, sel)); }
    return out;
  };
`;

/**
 * Realtime sampler source: sampler only, NO clock override, NO RNG seeding.
 * The page's real requestAnimationFrame is left intact so JS/rAF motion runs.
 */
export const REALTIME_SAMPLER_SOURCE = /* js */ `
(() => {
  if (window.__motionTrace) return;
  ${SAMPLER_BODY}
  window.__motionTrace = {};
  ${SAMPLER_API}
})();
`;
