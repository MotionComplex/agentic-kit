/**
 * diff(traceA, traceB) — motion regression as numeric data.
 *
 * This is the thing visual-regression tools structurally cannot do: they freeze
 * motion to compare stills. Because a MotionTrace is the resolved motion over
 * time, two traces can be compared frame-by-frame to answer "did this code
 * change alter how things move?" — and express the answer numerically plus as
 * human-readable findings.
 *
 * Frames are aligned on A's time grid (B is linearly interpolated onto it), so
 * differing fps/duration still compare sensibly. Channel-level deltas catch
 * value changes; metric-level deltas catch timing/shape changes (slower entrance,
 * overshoot added/removed, etc.).
 */
import { metrics } from './metrics.js';

const round = (n, p = 4) => {
  if (n == null || !isFinite(n)) return n;
  const f = 10 ** p;
  const r = Math.round(n * f) / f;
  return r === 0 ? 0 : r;
};

const channelValue = {
  tx: (f) => f.transform.translate[0],
  ty: (f) => f.transform.translate[1],
  opacity: (f) => f.opacity,
  scaleX: (f) => f.transform.scale[0],
  scaleY: (f) => f.transform.scale[1],
  rotate: (f) => f.transform.rotate,
  cx: (f) => f.bbox[0] + f.bbox[2] / 2,
  cy: (f) => f.bbox[1] + f.bbox[3] / 2,
};

// Linear interpolation of a channel value at time t over a frame array.
function valueAt(frames, t, getter) {
  if (t <= frames[0].t) return getter(frames[0]);
  const last = frames[frames.length - 1];
  if (t >= last.t) return getter(last);
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].t >= t) {
      const a = frames[i - 1];
      const b = frames[i];
      const u = (t - a.t) / (b.t - a.t || 1);
      return getter(a) + u * (getter(b) - getter(a));
    }
  }
  return getter(last);
}

function channelDelta(framesA, framesB, getter) {
  let maxAbs = 0;
  let sumSq = 0;
  let sumAbs = 0;
  let n = 0;
  for (const f of framesA) {
    const va = getter(f);
    const vb = valueAt(framesB, f.t, getter);
    const d = va - vb;
    maxAbs = Math.max(maxAbs, Math.abs(d));
    sumSq += d * d;
    sumAbs += Math.abs(d);
    n++;
  }
  return { maxAbs: round(maxAbs), rms: round(Math.sqrt(sumSq / n)), meanAbs: round(sumAbs / n) };
}

export function diff(traceA, traceB, opts = {}) {
  const eps = opts.eps ?? 0.5;            // px / unit noise floor for "changed"
  const timingEps = opts.timingEps ?? 8;  // ms
  const mA = metrics(traceA);
  const mB = metrics(traceB);
  const bBySel = new Map(traceB.tracks.map((t) => [t.selector, t]));
  const mBBySel = new Map(mB.tracks.map((t) => [t.selector, t]));
  const mABySel = new Map(mA.tracks.map((t) => [t.selector, t]));

  const trackDiffs = [];
  const findings = [];

  for (const ta of traceA.tracks) {
    const tb = bBySel.get(ta.selector);
    if (!tb) {
      findings.push(`track "${ta.selector}" present in A but missing in B`);
      continue;
    }
    const channelDeltas = {};
    let trackMaxAbs = 0;
    for (const [name, getter] of Object.entries(channelValue)) {
      const d = channelDelta(ta.frames, tb.frames, getter);
      channelDeltas[name] = d;
      trackMaxAbs = Math.max(trackMaxAbs, d.maxAbs);
    }

    const sa = mABySel.get(ta.selector).summary;
    const sb = mBBySel.get(ta.selector).summary;
    const ca = mABySel.get(ta.selector).channels;
    const cb = mBBySel.get(ta.selector).channels;

    const timing = {
      motionStartDelta_ms: nullableDelta(sa.motionStart_ms, sb.motionStart_ms),
      motionEndDelta_ms: nullableDelta(sa.motionEnd_ms, sb.motionEnd_ms),
      activeDurationDelta_ms: sa.activeDuration_ms - sb.activeDuration_ms,
      peakSpeedDelta_px_s: round(sa.peakSpeed_px_s - sb.peakSpeed_px_s, 1),
      pathLengthDelta: round(sa.pathLength - sb.pathLength, 2),
    };

    trackDiffs.push({ selector: ta.selector, changed: trackMaxAbs > eps, maxAbs: round(trackMaxAbs), channelDeltas, timing });

    // ---- human-readable findings -----------------------------------------
    const sel = ta.selector;
    if (timing.activeDurationDelta_ms > timingEps)
      findings.push(`${sel}: motion is ${timing.activeDurationDelta_ms}ms slower (A vs B)`);
    else if (timing.activeDurationDelta_ms < -timingEps)
      findings.push(`${sel}: motion is ${-timing.activeDurationDelta_ms}ms faster (A vs B)`);

    if (timing.motionEndDelta_ms != null && Math.abs(timing.motionEndDelta_ms) > timingEps)
      findings.push(`${sel}: settles ${Math.abs(timing.motionEndDelta_ms)}ms ${timing.motionEndDelta_ms > 0 ? 'later' : 'sooner'} in A`);

    if (Math.abs(timing.pathLengthDelta) > eps)
      findings.push(`${sel}: travels ${Math.abs(timing.pathLengthDelta)}px ${timing.pathLengthDelta > 0 ? 'farther' : 'less'} in A`);

    for (const name of ['tx', 'ty', 'scaleX', 'scaleY', 'rotate', 'opacity']) {
      const oa = ca[name].overshoot, ob = cb[name].overshoot;
      const oEps = name === 'opacity' ? 0.02 : 0.5;
      if (oa > oEps && ob <= oEps) findings.push(`${sel}: ${name} overshoot present in A, absent in B (${oa})`);
      else if (ob > oEps && oa <= oEps) findings.push(`${sel}: ${name} overshoot absent in A, present in B (${ob})`);
    }
    if (Math.abs(ca.opacity.end - cb.opacity.end) > 0.02)
      findings.push(`${sel}: final opacity ${ca.opacity.end} in A vs ${cb.opacity.end} in B`);
  }

  for (const tb of traceB.tracks) {
    if (!traceA.tracks.find((t) => t.selector === tb.selector))
      findings.push(`track "${tb.selector}" present in B but missing in A`);
  }

  const maxAbsOverall = trackDiffs.reduce((m, t) => Math.max(m, t.maxAbs), 0);

  return {
    meta: {
      a: { url: traceA.meta.url, fps: traceA.meta.fps, duration_ms: traceA.meta.duration_ms },
      b: { url: traceB.meta.url, fps: traceB.meta.fps, duration_ms: traceB.meta.duration_ms },
      comparedOn: 'A time grid',
    },
    identical: maxAbsOverall <= eps && findings.length === 0,
    maxAbsOverall: round(maxAbsOverall),
    tracks: trackDiffs,
    findings,
  };
}

function nullableDelta(a, b) {
  if (a == null || b == null) return null;
  return a - b;
}
