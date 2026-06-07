/**
 * Analysis layer (spec §8) — turn a numeric MotionTrace into motion-quality
 * judgments.
 *
 * This is a DETERMINISTIC rubric engine: it applies computable heuristics to the
 * derived metrics and emits structured findings. It is not an LLM call — it is
 * the layer that makes the trace reviewable, and `buildPrompt()` packages the
 * same data for a model when you want qualitative judgment too.
 *
 * Each finding: { rule, severity: 'info'|'warn'|'fail', selector, message, evidence }
 * Thresholds are motion-design heuristics, deliberately conservative; tune to taste.
 */
import { metrics } from './metrics.js';

const round = (n, p = 2) => (n == null || !isFinite(n) ? n : Math.round(n * 10 ** p) / 10 ** p);

// Does a track actually move (translate, scale, rotate, or fade)?
function animates(tm) {
  const c = tm.channels;
  return (
    tm.summary.pathLength > 1 ||
    Math.abs(c.opacity.travel) > 0.05 ||
    Math.abs(c.scaleX.travel) > 0.02 || Math.abs(c.scaleY.travel) > 0.02 ||
    Math.abs(c.rotate.travel) > 1
  );
}

// Coefficient of variation of the non-trivial speed samples — low ⇒ near-constant
// velocity ⇒ "linear/robotic"; higher ⇒ eased.
function speedCoV(series) {
  const v = series.map((s) => s.speed_px_s).filter((s) => s > 1);
  if (v.length < 3) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  if (mean === 0) return 0;
  const variance = v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length;
  return Math.sqrt(variance) / mean;
}

const SEVERITY_COST = { info: 0, warn: 8, fail: 25 };

export function analyze(trace, opts = {}) {
  const m = metrics(trace);
  const reduced = opts.reducedTrace ? metrics(opts.reducedTrace) : null;
  const declaredDuration = declaredDurations(trace);
  const findings = [];
  const add = (f) => findings.push(f);

  for (const tm of m.tracks) {
    const sel = tm.selector;
    if (!animates(tm)) continue;
    const s = tm.summary;
    const c = tm.channels;
    const dur = declaredDuration.get(sel) ?? s.activeDuration_ms;

    // 1. Duration sanity (entrance/transition feel).
    if (dur != null && dur > 0 && dur < 100)
      add({ rule: 'duration', severity: 'warn', selector: sel,
        message: `very fast (${dur}ms) — may read as an abrupt cut rather than motion`, evidence: { duration_ms: dur } });
    else if (dur != null && dur > 1200)
      add({ rule: 'duration', severity: 'warn', selector: sel,
        message: `slow (${dur}ms) — can feel sluggish for an entrance/transition`, evidence: { duration_ms: dur } });

    // 2. Easing quality — flag near-linear motion on a real move.
    if (s.pathLength > 20) {
      const cov = speedCoV(tm.series);
      if (cov != null && cov < 0.22)
        add({ rule: 'easing', severity: 'warn', selector: sel,
          message: `motion is nearly linear (constant velocity) — eased motion usually feels more natural`,
          evidence: { speedCoV: round(cov, 3) } });
    }

    // 3. Overshoot / bounce — report; large overshoot may be jarring.
    for (const ch of ['tx', 'ty', 'scaleX', 'scaleY', 'rotate']) {
      const pct = c[ch].overshootPct;
      if (pct >= 40)
        add({ rule: 'overshoot', severity: 'warn', selector: sel,
          message: `${ch} overshoots ${pct}% past its final value — strong bounce, verify it's intentional`,
          evidence: { channel: ch, overshoot: c[ch].overshoot, overshootPct: pct } });
      else if (pct >= 5)
        add({ rule: 'overshoot', severity: 'info', selector: sel,
          message: `${ch} has a ${pct}% overshoot (spring/bounce)`,
          evidence: { channel: ch, overshootPct: pct } });
    }

    // 4. Opacity jank — a fade that isn't monotonic flickers.
    if (Math.abs(c.opacity.travel) > 0.1 && !c.opacity.monotonic)
      add({ rule: 'opacity-jank', severity: 'warn', selector: sel,
        message: `opacity is non-monotonic during a fade (${c.opacity.reversals} reversal(s)) — looks like a flicker`,
        evidence: { reversals: c.opacity.reversals } });

    // 6. Reduced-motion compliance (needs a reduce-capture).
    if (reduced) {
      const rt = reduced.tracks.find((x) => x.selector === sel);
      // Positional/scale/rotate motion should be suppressed under reduce; opacity
      // fades are generally acceptable, so they don't fail.
      const stillMoves = rt && (
        rt.summary.pathLength > 2 ||
        Math.abs(rt.channels.scaleX.travel) > 0.02 ||
        Math.abs(rt.channels.rotate.travel) > 1
      );
      if (stillMoves)
        add({ rule: 'reduced-motion', severity: 'fail', selector: sel,
          message: `still animates motion under prefers-reduced-motion (path ${round(rt.summary.pathLength)}px) — accessibility violation`,
          evidence: { reducedPathLength: round(rt.summary.pathLength) } });
    }
  }

  // 7. Real-runtime jank (only present on realtime traces with a perf block).
  if (trace.perf) {
    const lf = trace.perf.longFrames || 0;
    if (lf > 0)
      add({ rule: 'jank', severity: lf > 3 ? 'warn' : 'info', selector: '*',
        message: `${lf} long frame(s) over ${trace.perf.longFrameThreshold_ms}ms during capture (measured ${trace.perf.measuredFps}fps, ~${trace.perf.droppedFrames} dropped) — possible jank`,
        evidence: trace.perf });
  }

  // 5. Stagger coherence (cross-track).
  const movingTracks = m.tracks.filter(animates);
  if (movingTracks.length > 1 && reduced == null) {
    if (m.cross.maxStagger_ms === 0)
      add({ rule: 'stagger', severity: 'info', selector: '*',
        message: `${movingTracks.length} elements animate simultaneously (no stagger) — staggering can improve perceived order`,
        evidence: { maxStagger_ms: 0 } });
  }

  // reduced-motion summary verdict
  let reducedMotionVerdict = null;
  if (reduced) {
    const fails = findings.filter((f) => f.rule === 'reduced-motion');
    reducedMotionVerdict = fails.length === 0 ? 'pass' : 'fail';
  }

  let score = 100;
  for (const f of findings) score -= SEVERITY_COST[f.severity] ?? 0;
  score = Math.max(0, score);

  return {
    meta: { ...trace.meta, analyzedBy: 'motion-trace/analyze@1', reducedMotionVerdict },
    score,
    counts: {
      fail: findings.filter((f) => f.severity === 'fail').length,
      warn: findings.filter((f) => f.severity === 'warn').length,
      info: findings.filter((f) => f.severity === 'info').length,
    },
    findings,
  };
}

function declaredDurations(trace) {
  const map = new Map();
  for (const a of trace.timeline || []) {
    const prev = map.get(a.selector) ?? 0;
    map.set(a.selector, Math.max(prev, (a.duration_ms || 0) + (a.delay_ms || 0)));
  }
  return map;
}

/** Render an analysis as a human-readable markdown report. */
export function renderReport(analysis) {
  const lines = [];
  lines.push(`# Motion review — score ${analysis.score}/100`);
  lines.push('');
  lines.push(`${analysis.counts.fail} fail · ${analysis.counts.warn} warn · ${analysis.counts.info} info`);
  if (analysis.meta.reducedMotionVerdict)
    lines.push(`\nprefers-reduced-motion: **${analysis.meta.reducedMotionVerdict.toUpperCase()}**`);
  lines.push('');
  if (analysis.findings.length === 0) {
    lines.push('No issues found.');
  } else {
    const icon = { fail: '🔴', warn: '🟡', info: '🔵' };
    for (const f of analysis.findings)
      lines.push(`- ${icon[f.severity] || ''} **${f.rule}** \`${f.selector}\` — ${f.message}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * LLM adapter — package a trace (+ metrics) into a compact, token-efficient
 * payload plus a rubric, so a non-video model can review motion from data.
 * This is the core thesis: feed structured motion, not pixels.
 */
export function buildPrompt(trace, opts = {}) {
  const m = metrics(trace);
  const compactTracks = m.tracks.map((t) => ({
    selector: t.selector,
    summary: t.summary,
    channels: t.channels,
    // downsample the per-frame speed curve so the model sees the shape cheaply
    speedCurve: downsample(t.series.map((s) => s.speed_px_s), opts.curvePoints ?? 8).map((n) => round(n, 1)),
  }));
  const payload = {
    meta: trace.meta,
    declared: (trace.timeline || []).map((a) => ({
      selector: a.selector, type: a.type, duration_ms: a.duration_ms,
      delay_ms: a.delay_ms, easing: a.easing, iterations: a.iterations,
    })),
    metrics: compactTracks,
    cross: m.cross,
  };
  const rubric = [
    'You are reviewing UI motion from DATA (not video). For each element judge:',
    '- easing quality: does the velocity curve match the declared easing and feel natural?',
    '- timing: too fast/slow; sensible stagger across elements?',
    '- entrance/exit coherence and distance traveled;',
    '- overshoot/bounce: intentional spring or jarring?',
    '- jank: non-monotonic motion where it should be smooth;',
    '- prefers-reduced-motion compliance and motion-only information.',
    'Use the numeric deltas/velocities to justify each point. Return findings with severity.',
  ].join('\n');
  return { rubric, payload };
}

function downsample(arr, n) {
  if (arr.length <= n) return arr;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
  return out;
}
