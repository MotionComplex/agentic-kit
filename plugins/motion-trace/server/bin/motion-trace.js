#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { capture, captureRealtime, metrics, diff, analyze, renderReport, buildPrompt, buildViewer, discover, serialize } from '../src/index.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

const argv = process.argv.slice(2);
const sub = argv[0];

const USAGE = `usage:
  motion-trace <url> --select ".a,.b" [--trigger load] [--fps 30] [--duration 1200] [--metrics] [--filmstrip <dir>] [--viewer <file.html>] [--out trace.json]
  motion-trace discover <url>                         # list what animates + suggested selectors
  motion-trace metrics <trace.json> [--out metrics.json]
  motion-trace diff <a.json> <b.json> [--out diff.json]
  motion-trace analyze <trace.json> [--reduced <reduce-trace.json>] [--out report.md|report.json]
  motion-trace prompt <trace.json> [--out prompt.json]`;

if (sub === 'discover') {
  const a = parseArgs(argv.slice(1));
  const url = a._[0];
  if (!url) { console.error(USAGE); process.exit(1); }
  const r = await discover({ url });
  if (a.out) writeFileSync(a.out, serialize(r));
  console.error(`animated (${r.animated.length}):`);
  for (const x of r.animated) console.error(`  ${x.selector}  [${x.animations.map((an) => an.name || an.type).join(', ')}]${x.matches > 1 ? `  ×${x.matches}` : ''}`);
  console.error(`interactive / transitions (${r.interactive.length}) — capture with --trigger hover:`);
  for (const x of r.interactive) console.error(`  ${x.selector}  (${x.transitionProperty} ${x.transitionDuration})${x.matches > 1 ? `  ×${x.matches}` : ''}`);
} else if (sub === 'metrics') {
  const a = parseArgs(argv.slice(1));
  const trace = JSON.parse(readFileSync(a._[0], 'utf8'));
  const out = a.out || a._[0].replace(/\.json$/, '') + '.metrics.json';
  writeFileSync(out, serialize(metrics(trace)));
  console.error(`wrote ${out}`);
} else if (sub === 'diff') {
  const a = parseArgs(argv.slice(1));
  const A = JSON.parse(readFileSync(a._[0], 'utf8'));
  const B = JSON.parse(readFileSync(a._[1], 'utf8'));
  const d = diff(A, B);
  if (a.out) writeFileSync(a.out, serialize(d));
  console.error(d.identical ? 'identical' : `${d.findings.length} finding(s):`);
  for (const f of d.findings) console.error('  - ' + f);
} else if (sub === 'analyze') {
  const a = parseArgs(argv.slice(1));
  const trace = JSON.parse(readFileSync(a._[0], 'utf8'));
  const reducedTrace = a.reduced ? JSON.parse(readFileSync(a.reduced, 'utf8')) : undefined;
  const result = analyze(trace, { reducedTrace });
  const out = a.out || a._[0].replace(/\.json$/, '') + '.report.md';
  const isJson = out.endsWith('.json');
  writeFileSync(out, isJson ? serialize(result) : renderReport(result));
  console.error(`score ${result.score}/100 — ${result.counts.fail} fail, ${result.counts.warn} warn, ${result.counts.info} info → ${out}`);
} else if (sub === 'prompt') {
  const a = parseArgs(argv.slice(1));
  const trace = JSON.parse(readFileSync(a._[0], 'utf8'));
  const out = a.out || a._[0].replace(/\.json$/, '') + '.prompt.json';
  writeFileSync(out, serialize(buildPrompt(trace)));
  console.error(`wrote ${out}`);
} else {
  const a = parseArgs(argv);
  const url = a._[0];
  if (!url) { console.error(USAGE); process.exit(1); }
  // a viewer needs a filmstrip; default one next to the viewer output if asked.
  const filmstripDir = a.filmstrip || (a.viewer ? (a.viewer.replace(/\.html?$/, '') + '_frames') : null);
  const trigger = a.trigger && a.trigger !== 'load'
    ? { action: a.trigger, selector: a['trigger-selector'], className: a['trigger-class'] }
    : 'load';
  const common = {
    url,
    selectors: (a.select || '').split(',').map((s) => s.trim()).filter(Boolean),
    trigger,
    duration: a.duration ? Number(a.duration) : 1000,
  };
  // --realtime: observe real frames (captures JS/rAF/scroll motion + perf signals)
  const trace = 'realtime' in a
    ? await captureRealtime(common)
    : await capture({ ...common, fps: a.fps ? Number(a.fps) : 30, filmstripDir });
  const out = a.out || 'trace.json';
  writeFileSync(out, serialize(trace));
  const perfNote = trace.perf ? `, ${trace.perf.measuredFps}fps, ${trace.perf.longFrames} long frame(s)` : '';
  console.error(`wrote ${out} [${trace.meta.mode}] — ${trace.tracks.length} track(s), ${trace.meta.frames} frames, ${trace.timeline.length} declared animation(s)${perfNote}`);
  if (trace.filmstrip) console.error(`wrote ${trace.filmstrip.frames.length} frame(s) → ${filmstripDir}/`);
  if ('metrics' in a) {
    const mOut = out.replace(/\.json$/, '') + '.metrics.json';
    writeFileSync(mOut, serialize(metrics(trace)));
    console.error(`wrote ${mOut}`);
  }
  if (a.viewer && trace.filmstrip) {
    const frames = trace.filmstrip.frames.map((fr) => ({
      t: fr.t,
      dataURI: 'data:image/png;base64,' + readFileSync(join(filmstripDir, fr.file)).toString('base64'),
    }));
    writeFileSync(a.viewer, buildViewer(trace, frames));
    console.error(`wrote ${a.viewer} (self-contained)`);
  }
}
