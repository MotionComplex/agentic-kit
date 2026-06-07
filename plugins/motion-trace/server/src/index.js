export { capture, captureOnPage } from './capture.js';
export { captureRealtime } from './realtime.js';
export { discover } from './discover.js';
export { metrics } from './metrics.js';
export { diff } from './diff.js';
export { analyze, renderReport, buildPrompt } from './analyze.js';
export { buildViewer } from './viewer.js';

/**
 * Canonical, stable serialization of a MotionTrace (or any derived artifact).
 * Determinism contract: identical (page + config) ⇒ byte-identical output.
 * `meta.createdAt` is intentionally NOT part of the trace so output stays stable;
 * add it at the call site if you want a timestamp.
 */
export function serialize(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}
