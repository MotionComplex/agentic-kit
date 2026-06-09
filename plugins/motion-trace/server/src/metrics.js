/**
 * Derived-metrics layer.
 *
 * A MotionTrace is numeric, so we can compute motion *qualities* — not just
 * coordinates — directly, and hand them to a model. This is what lets a
 * non-video model reason about easing, overshoot, and timing the way a person
 * watching a clip would.
 *
 * `metrics(trace)` is a pure function: trace in, analysis out. It does not
 * mutate the trace. Values come from the deterministic resolved curve, so the
 * kinematics describe the *intended* motion (easing quality), not real-runtime
 * jank — frame-drop/jank detection needs real rAF timing and is a later layer.
 */

const round = (n, p = 4) => {
  if (n == null || !isFinite(n)) return n;
  const f = 10 ** p;
  const r = Math.round(n * f) / f;
  return r === 0 ? 0 : r;
};

// Channels we track as scalar time series. `center` (rendered bbox centre) is
// the ground-truth position; the rest are per-property for overshoot/monotonicity.
function channelsOf(frames) {
  const t = frames.map((f) => f.t);
  const get = (fn) => frames.map(fn);
  return {
    t,
    cx: get((f) => f.bbox[0] + f.bbox[2] / 2),
    cy: get((f) => f.bbox[1] + f.bbox[3] / 2),
    tx: get((f) => f.transform.translate[0]),
    ty: get((f) => f.transform.translate[1]),
    opacity: get((f) => f.opacity),
    scaleX: get((f) => f.transform.scale[0]),
    scaleY: get((f) => f.transform.scale[1]),
    rotate: get((f) => f.transform.rotate),
  };
}

// Central-difference derivative; units are (value units) per ms.
function derivative(ts, ys) {
  const n = ys.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) out[i] = (ys[1] - ys[0]) / (ts[1] - ts[0] || 1);
    else if (i === n - 1) out[i] = (ys[n - 1] - ys[n - 2]) / (ts[n - 1] - ts[n - 2] || 1);
    else out[i] = (ys[i + 1] - ys[i - 1]) / (ts[i + 1] - ts[i - 1] || 1);
  }
  return out;
}

// Per-channel descriptive stats: travel, overshoot (motion past the final value
// in the direction of travel), and monotonicity (reversals beyond noise floor).
function channelSummary(ts, ys, eps) {
  const start = ys[0];
  const end = ys[ys.length - 1];
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const travel = end - start;
  const dir = Math.sign(travel);
  let overshoot = 0;
  if (dir > 0) overshoot = Math.max(0, max - end);
  else if (dir < 0) overshoot = Math.max(0, end - min);
  // direction reversals in the first difference, ignoring sub-eps noise
  let reversals = 0;
  let lastSign = 0;
  for (let i = 1; i < ys.length; i++) {
    const d = ys[i] - ys[i - 1];
    if (Math.abs(d) < eps) continue;
    const s = Math.sign(d);
    if (lastSign !== 0 && s !== lastSign) reversals++;
    lastSign = s;
  }
  return {
    start: round(start), end: round(end), min: round(min), max: round(max),
    travel: round(travel),
    overshoot: round(overshoot),
    overshootPct: Math.abs(travel) > eps ? round((overshoot / Math.abs(travel)) * 100, 1) : 0,
    reversals,
    monotonic: reversals === 0,
  };
}

function trackMetrics(track) {
  const frames = track.frames;
  const ch = channelsOf(frames);
  const ts = ch.t;
  const duration = ts[ts.length - 1] - ts[0];

  // kinematics of the rendered centre
  const vx = derivative(ts, ch.cx);
  const vy = derivative(ts, ch.cy);
  const speed = ts.map((_, i) => Math.hypot(vx[i], vy[i])); // px/ms
  const accel = derivative(ts, speed);
  const jerk = derivative(ts, accel);

  // path length & displacement
  let pathLength = 0;
  for (let i = 1; i < ts.length; i++) {
    pathLength += Math.hypot(ch.cx[i] - ch.cx[i - 1], ch.cy[i] - ch.cy[i - 1]);
  }
  const netDisplacement = Math.hypot(
    ch.cx[ch.cx.length - 1] - ch.cx[0],
    ch.cy[ch.cy.length - 1] - ch.cy[0],
  );

  // motion window: frames where the element is actually animating.
  // Centre speed catches positional motion; but an element can morph IN PLACE
  // (a hamburger rotating to an ✕, a panel fading, a box scaling) without its
  // centre moving at all — so also count any tracked channel changing between
  // frames. Without this, motionStart/activeDuration read null for in-place
  // morphs even though there's clearly motion.
  const MOVE_EPS = 0.15; // px/ms ~ 150px/s (centre)
  const CHAN_EPS = { tx: 0.05, ty: 0.05, opacity: 0.005, scaleX: 0.002, scaleY: 0.002, rotate: 0.05 };
  const morphingAt = (i) => {
    if (i === 0) return false;
    for (const k of ['tx', 'ty', 'opacity', 'scaleX', 'scaleY', 'rotate']) {
      if (Math.abs(ch[k][i] - ch[k][i - 1]) > CHAN_EPS[k]) return true;
    }
    return false;
  };
  let motionStartT = null;
  let motionEndT = null;
  for (let i = 0; i < ts.length; i++) {
    if (speed[i] > MOVE_EPS || morphingAt(i)) {
      if (motionStartT == null) motionStartT = ts[i];
      motionEndT = ts[i];
    }
  }

  let peakSpeed = 0;
  let peakSpeedT = ts[0];
  speed.forEach((s, i) => { if (s > peakSpeed) { peakSpeed = s; peakSpeedT = ts[i]; } });

  const channels = {};
  for (const name of ['tx', 'ty', 'opacity', 'scaleX', 'scaleY', 'rotate']) {
    const eps = name === 'opacity' ? 0.005 : name === 'rotate' ? 0.05 : 0.05;
    channels[name] = channelSummary(ts, ch[name], eps);
  }

  const opDelta = channels.opacity.end - channels.opacity.start;
  const opacityFade = opDelta > 0.05 ? 'in' : opDelta < -0.05 ? 'out' : 'none';

  return {
    selector: track.selector,
    summary: {
      pathLength: round(pathLength, 2),
      netDisplacement: round(netDisplacement, 2),
      peakSpeed_px_s: round(peakSpeed * 1000, 1),
      peakSpeedAt_ms: peakSpeedT,
      motionStart_ms: motionStartT,
      motionEnd_ms: motionEndT,
      activeDuration_ms: motionStartT == null ? 0 : motionEndT - motionStartT,
      settleFromEnd_ms: motionEndT == null ? null : duration - motionEndT,
      peakJerk: round(Math.max(...jerk.map(Math.abs)) * 1e6, 2), // px/ms^3 ×1e6
      opacityFade,
    },
    channels,
    series: frames.map((f, i) => ({
      t: f.t,
      speed_px_s: round(speed[i] * 1000, 2),
      accel: round(accel[i], 6),
      jerk: round(jerk[i], 8),
    })),
  };
}

export function metrics(trace) {
  const tracks = trace.tracks.map(trackMetrics);

  // cross-track stagger: offsets between when each track starts moving
  const starts = tracks
    .map((t) => ({ selector: t.selector, motionStart_ms: t.summary.motionStart_ms }))
    .filter((s) => s.motionStart_ms != null)
    .sort((a, b) => a.motionStart_ms - b.motionStart_ms);
  const maxStagger_ms = starts.length
    ? starts[starts.length - 1].motionStart_ms - starts[0].motionStart_ms
    : 0;

  return {
    meta: { ...trace.meta, derivedFrom: 'motion-trace/metrics@1' },
    tracks,
    cross: { staggerOrder: starts, maxStagger_ms },
  };
}
