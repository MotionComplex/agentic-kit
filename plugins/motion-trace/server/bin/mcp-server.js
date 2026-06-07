#!/usr/bin/env node
/**
 * MotionTrace MCP server.
 *
 * Exposes motion capture/analysis as MCP tools so any MCP-capable agent (Claude,
 * Cursor, …) can review UI motion as DATA during a browsing/E2E session — no
 * video, no pixel-guessing.
 *
 * Tools:
 *   - motion_review   : capture a URL + run the rubric. The one-call workflow.
 *   - motion_capture  : capture a raw MotionTrace (trace JSON).
 *   - motion_analyze  : run the rubric on a trace you already have.
 *   - motion_diff     : compare two traces (motion regression).
 *
 * An agent that already drives a browser can also point `cdpEndpoint` at its own
 * running Chrome (chromium.connectOverCDP) to capture the very page it's on.
 *
 * Run:  node bin/mcp-server.js      (stdio transport)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { capture, captureRealtime, analyze, renderReport, diff, buildPrompt, discover } from '../src/index.js';

const server = new McpServer({ name: 'motion-trace', version: '0.1.0' });

// Trigger is expressed as FLAT scalar params (not a nested object): some MCP
// clients stringify nested objects, which breaks union/object schemas. Scalars
// always survive the wire. The object form is reassembled in normalize().
const captureShape = {
  url: z.string().describe('Page URL to capture (http(s):// or file://).'),
  selectors: z.array(z.string()).describe('CSS selectors of elements to track.'),
  triggerAction: z.enum(['hover', 'click', 'focus', 'addClass']).optional()
    .describe("Interaction that starts the motion. Omit for a load/entrance animation."),
  triggerSelector: z.string().optional()
    .describe('Element to trigger (required when triggerAction is set).'),
  triggerClassName: z.string().optional().describe("Class to add when triggerAction is 'addClass' (default 'active')."),
  fps: z.number().int().positive().optional().describe('Sample rate (default 30).'),
  duration: z.number().positive().optional().describe('Capture window in ms (default 1000).'),
  reducedMotion: z.enum(['no-preference', 'reduce']).optional(),
  realtime: z.boolean().optional()
    .describe('Observe real frames instead of stepping a frozen clock. Use for JS-library / scroll-driven motion (Framer Motion, GSAP) that getAnimations() does not expose; also yields real fps/jank signals.'),
  cdpEndpoint: z.string().optional().describe('Attach to a running browser via CDP instead of launching one.'),
};

const runCapture = (a) => (a.realtime ? captureRealtime(normalize(a)) : capture(normalize(a)));

const json = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }], structuredContent: obj });

server.tool(
  'motion_review',
  'Capture a page\'s motion and review it against a motion-quality rubric (easing, timing, overshoot, jank, prefers-reduced-motion). Returns a score, findings, and a markdown report. This is the one-call workflow for an agent reviewing UI motion.',
  captureShape,
  async (args) => {
    const trace = await runCapture(args);
    let reducedTrace;
    // If the page declares reduced-motion intent, also capture under reduce for the a11y rule.
    if (args.reducedMotion !== 'reduce') {
      try { reducedTrace = await runCapture({ ...args, reducedMotion: 'reduce' }); } catch { /* best effort */ }
    }
    const result = analyze(trace, { reducedTrace });
    return json({
      score: result.score,
      counts: result.counts,
      reducedMotionVerdict: result.meta.reducedMotionVerdict,
      findings: result.findings,
      report_markdown: renderReport(result),
    });
  },
);

server.tool('motion_capture', 'Capture a MotionTrace (per-frame resolved state + declarative timeline) for a URL. Deterministic by default; set realtime:true for JS-library/scroll motion + perf signals. Returns the trace JSON.', captureShape, async (args) => {
  const trace = await runCapture(args);
  return json(trace);
});

server.tool(
  'motion_analyze',
  'Run the motion-quality rubric on an existing MotionTrace (as returned by motion_capture). Optionally pass a reduced-motion trace for the accessibility check.',
  { trace: z.any(), reducedTrace: z.any().optional() },
  async ({ trace, reducedTrace }) => json(analyze(trace, { reducedTrace })),
);

server.tool(
  'motion_diff',
  'Compare two MotionTraces (e.g. before/after a change). Returns per-channel deltas and human-readable findings — motion regression as data.',
  { a: z.any(), b: z.any() },
  async ({ a, b }) => json(diff(a, b)),
);

server.tool(
  'motion_prompt',
  'Package a MotionTrace into a compact, LLM-ready payload + rubric, so a non-video model can review the motion from data.',
  { trace: z.any() },
  async ({ trace }) => json(buildPrompt(trace)),
);

server.tool(
  'motion_discover',
  'Scan a page and report which elements animate — live CSS/WAAPI animations (e.g. spinners, entrances) and elements with CSS transitions (which move on hover/click). Each result includes a suggested selector. Use this first when you don\'t know what to track.',
  {
    url: z.string().describe('Page URL to scan.'),
    viewport: z.array(z.number()).optional(),
  },
  async ({ url, viewport }) => json(await discover({ url, viewport: viewport && [viewport[0], viewport[1]] })),
);

function normalize(a) {
  const trigger = a.triggerAction
    ? { action: a.triggerAction, selector: a.triggerSelector, className: a.triggerClassName }
    : 'load';
  return {
    url: a.url,
    selectors: a.selectors,
    trigger,
    fps: a.fps ?? 30,
    duration: a.duration ?? 1000,
    reducedMotion: a.reducedMotion ?? 'no-preference',
    // Default to a remote browser if MOTION_TRACE_CDP is set; otherwise launch
    // (and self-provision) a local Chromium. Either way the user does nothing manual.
    cdpEndpoint: a.cdpEndpoint ?? process.env.MOTION_TRACE_CDP,
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('motion-trace MCP server running on stdio');
