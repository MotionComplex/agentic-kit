#!/usr/bin/env node
'use strict';

// SpecLever CLI — see docs/SCHEMA.md "CLI surface".
// Exit codes: 0 ok, 1 user error (EUSER), 2 internal.

const fs = require('node:fs');
const path = require('node:path');
const ledger = require('./ledger');

const GLYPH = { blocker: '◆', major: '▲', minor: '●', info: '○' };
const SEV_ORDER = { blocker: 0, major: 1, minor: 2, info: 3 };

const USAGE = `SpecLever — spec-readiness cockpit

Usage: node src/cli.js <command> [args]

  feature add <id> --title "..." [--kind spec|pr-review|pr-respond]   Create a workspace
  feature list [--json]                  List features (with readiness)
  feature show <id> [--json]             Show one feature in detail
  source add <featureId> --type confluence|ado|figma --id <id> [--title "..."] [--url <url>]
  ingest <featureId> --file findings.json [--reopen-resolved] [--note "..."]
                                         Ingest an audit round + reconcile ledger
  finding list <featureId> [--status open] [--dimension x] [--severity y] [--json]
  finding edit <featureId> <fp> [--detail "..."] [--suggestion "..."] [--severity blocker|major|minor|info] [--note "..."]
                                         Refine a finding's text/severity (fingerprint stays stable)
  finding set <featureId> <fp> --status open|reworking|resolved|waived
                               [--reason "..."] [--pin|--unpin]
  readiness <featureId> [--json]         Print score + gate + open blockers
  report <featureId> [--out report.md]   Generate markdown report
  coverage set <featureId> --file coverage.json
  requests list [--status queued|running|done|error] [--json]   List UI-triggered job requests
  requests set <id> --status running|done|error [--note "..."] [--wsId <id>]
                                         Update a request (the runner skill uses this)
  start [--port N] [--no-open]           Launch the cockpit server + open it in the browser
  demo                                   Seed demo feature
  help                                   Show this help

Severity glyphs: ◆ blocker  ▲ major  ● minor  ○ info`;

function userError(msg) {
  const err = new Error(msg);
  err.code = 'EUSER';
  return err;
}

// ---------- arg parsing (hand-rolled) ----------

const BOOL_FLAGS = new Set(['json', 'reopen-resolved', 'pin', 'unpin', 'no-open']);

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { pos.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (BOOL_FLAGS.has(body)) {
        flags[body] = true;
      } else {
        const next = argv[i + 1];
        if (next === undefined) throw userError(`Flag --${body} requires a value`);
        flags[body] = next;
        i++;
      }
    } else {
      pos.push(a);
    }
  }
  return { pos, flags };
}

function need(value, what) {
  if (value === undefined || value === null || value === '') throw userError(`Missing ${what}. Run \`node src/cli.js help\` for usage.`);
  return value;
}

// ---------- output helpers ----------

function table(rows) {
  const widths = [];
  for (const row of rows) {
    row.forEach((c, i) => { widths[i] = Math.max(widths[i] || 0, String(c).length); });
  }
  return rows
    .map((row) => row.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd())
    .join('\n');
}

function glyph(severity) {
  return GLYPH[severity] || '·';
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function readJsonFile(file, what) {
  let raw;
  try {
    raw = fs.readFileSync(path.resolve(file), 'utf8');
  } catch (err) {
    throw userError(`Cannot read ${what} file '${file}': ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw userError(`Invalid JSON in '${file}': ${err.message}`);
  }
}

// validateIngestFinding's return contract: it may throw, return an error string,
// an array of errors, or { errors: [...] }. Anything else counts as valid.
function assertValidFinding(f, idx) {
  let res;
  try {
    res = ledger.validateIngestFinding(f);
  } catch (err) {
    throw userError(`Finding #${idx + 1} invalid: ${err.message}`);
  }
  let errors = [];
  if (typeof res === 'string' && res) errors = [res];
  else if (Array.isArray(res)) errors = res;
  else if (res && typeof res === 'object' && Array.isArray(res.errors)) errors = res.errors;
  else if (res === false) errors = ['failed validation'];
  if (errors.length) throw userError(`Finding #${idx + 1} invalid: ${errors.join('; ')}`);
}

function extractFindings(data, file) {
  const findings = Array.isArray(data) ? data : data && data.findings;
  if (!Array.isArray(findings)) {
    throw userError(`'${file}' must be a JSON array of findings or { "findings": [...] }`);
  }
  return findings;
}

function openSummary(openBySeverity) {
  const parts = [];
  let total = 0;
  for (const sev of ['blocker', 'major', 'minor', 'info']) {
    const n = (openBySeverity && openBySeverity[sev]) || 0;
    total += n;
    parts.push(`${glyph(sev)} ${n} ${sev}`);
  }
  return `${parts.join('   ')}   (${total} open)`;
}

// ---------- commands ----------

function cmdFeatureAdd({ pos, flags }) {
  const id = need(pos[0], 'feature <id>');
  const title = need(flags.title, '--title');
  const opts = { id, title };
  if (flags.kind !== undefined) opts.kind = flags.kind; // spec | pr-review | pr-respond
  const feature = ledger.createFeature(opts);
  console.log(`Created feature ${feature.id} (${feature.kind || 'spec'}) — ${feature.title}`);
}

function cmdFeatureList({ flags }) {
  const features = ledger.listFeatures() || [];
  const summaries = features.map((f) => {
    let r = null;
    try { r = ledger.readiness(f.id); } catch { /* no ledger yet */ }
    return {
      id: f.id,
      title: f.title,
      status: f.status,
      updatedAt: f.updatedAt,
      readiness: r ? { score: r.score, gate: r.gate, openCount: r.openCount } : null,
    };
  });
  if (flags.json) return printJson(summaries);
  if (!summaries.length) {
    console.log('No features yet. Create one: node src/cli.js feature add <id> --title "..."');
    return;
  }
  const rows = [['ID', 'TITLE', 'STATUS', 'SCORE', 'GATE', 'OPEN']];
  for (const s of summaries) {
    rows.push([
      s.id,
      s.title,
      s.status,
      s.readiness ? `${s.readiness.score}/100` : '—',
      s.readiness ? s.readiness.gate : '—',
      s.readiness ? s.readiness.openCount : '—',
    ]);
  }
  console.log(table(rows));
}

function cmdFeatureShow({ pos, flags }) {
  const id = need(pos[0], 'feature <id>');
  const feature = ledger.getFeature(id);
  const r = ledger.readiness(id);
  if (flags.json) return printJson({ feature, readiness: r });

  console.log(`${feature.id} — ${feature.title}`);
  console.log(table([
    ['  Status', feature.status],
    ['  Created', feature.createdAt || '—'],
    ['  Updated', feature.updatedAt || '—'],
    ['  Readiness', `${r.score}/100 (${r.gate})`],
    ['  Open', openSummary(r.openBySeverity)],
  ]));

  const sources = feature.sources || {};
  const srcRows = [];
  for (const type of ['confluence', 'ado', 'figma']) {
    for (const s of sources[type] || []) {
      srcRows.push([`  ${type}`, s.id != null ? s.id : `${s.fileKey || ''}${s.nodeId ? '#' + s.nodeId : ''}`, s.title || '', s.url || '']);
    }
  }
  console.log('\nSources:');
  console.log(srcRows.length ? table(srcRows) : '  (none)');

  const sections = feature.specSections || [];
  const coverage = feature.coverage || [];
  if (sections.length || coverage.length) {
    const byStatus = {};
    for (const c of coverage) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    const bits = Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ');
    console.log(`\nCoverage: ${sections.length} spec sections, ${coverage.length} mapped${bits ? ` (${bits})` : ''}`);
  }
  if ((r.blockers || []).length) {
    console.log('\nBlockers:');
    for (const b of r.blockers) {
      if (typeof b === 'string') console.log(`  ◆ ${b}`);
      else console.log(`  ◆ ${b.fp || ''}  ${b.title || ''}`.trimEnd());
    }
  }
}

function cmdSourceAdd({ pos, flags }) {
  const featureId = need(pos[0], '<featureId>');
  const type = need(flags.type, '--type');
  if (!['confluence', 'ado', 'figma'].includes(type)) {
    throw userError(`--type must be confluence, ado or figma (got '${type}')`);
  }
  let id = need(flags.id, '--id');
  if (type === 'ado' && /^\d+$/.test(id)) id = Number(id);
  const source = { type, id };
  if (flags.title !== undefined) source.title = flags.title;
  if (flags.url !== undefined) source.url = flags.url;
  ledger.addSource(featureId, source);
  console.log(`Added ${type} source ${id} to ${featureId}`);
}

function cmdIngest({ pos, flags }) {
  const featureId = need(pos[0], '<featureId>');
  const file = need(flags.file, '--file');
  const findings = extractFindings(readJsonFile(file, 'findings'), file);
  findings.forEach((f, i) => assertValidFinding(f, i));
  const { round, stats } = ledger.ingestRound(featureId, findings, {
    note: flags.note,
    reopenResolved: Boolean(flags['reopen-resolved']),
    trigger: 'audit',
  });
  console.log(`Ingested round ${round.n} for ${featureId}${flags.note ? ` — ${flags.note}` : ''}`);
  console.log(table([
    ['  New', stats.new],
    ['  Still open', stats.stillOpen],
    ['  Auto-resolved', stats.autoResolved],
    ['  Regressions', stats.regressions],
    ['  Total open', stats.totalOpen],
  ]));
  if (round.readiness) {
    console.log(`  Readiness      ${round.readiness.score}/100 (${round.readiness.gate})`);
  }
}

function cmdFindingList({ pos, flags }) {
  const featureId = need(pos[0], '<featureId>');
  const doc = ledger.loadLedger(featureId);
  let findings = Array.isArray(doc) ? doc : (doc && doc.findings) || [];
  if (flags.status) findings = findings.filter((f) => f.status === flags.status);
  if (flags.dimension) findings = findings.filter((f) => f.dimension === flags.dimension);
  if (flags.severity) findings = findings.filter((f) => f.severity === flags.severity);
  findings = findings.slice().sort((a, b) =>
    (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9)
    || String(a.dimension).localeCompare(String(b.dimension))
    || String(a.title).localeCompare(String(b.title)));

  if (flags.json) return printJson(findings);
  if (!findings.length) return console.log('No findings match.');
  const rows = [['', 'FP', 'SEVERITY', 'DIMENSION', 'STATUS', 'TITLE']];
  for (const f of findings) {
    rows.push([glyph(f.severity), f.fp, f.severity, f.dimension, f.status + (f.pinned ? ' 📌' : ''), f.title]);
  }
  console.log(table(rows));
  console.log(`\n${findings.length} finding(s)`);
}

function cmdFindingSet({ pos, flags }) {
  const featureId = need(pos[0], '<featureId>');
  const fp = need(pos[1], '<fp>');
  if (flags.pin && flags.unpin) throw userError('Use either --pin or --unpin, not both');
  const change = { by: 'user' };
  if (flags.status !== undefined) {
    if (!['open', 'reworking', 'resolved', 'waived'].includes(flags.status)) {
      throw userError(`--status must be open, reworking, resolved or waived (got '${flags.status}')`);
    }
    change.status = flags.status;
  }
  if (flags.reason !== undefined) change.reason = flags.reason;
  if (flags.pin) change.pinned = true;
  if (flags.unpin) change.pinned = false;
  if (change.status === undefined && change.pinned === undefined) {
    throw userError('Nothing to change: pass --status and/or --pin/--unpin');
  }
  const finding = ledger.setFindingStatus(featureId, fp, change);
  console.log(`${glyph(finding.severity)} ${finding.fp}  ${finding.status}${finding.pinned ? ' 📌' : ''}  ${finding.title}`);
}

function cmdFindingEdit({ pos, flags }) {
  const featureId = need(pos[0], '<featureId>');
  const fp = need(pos[1], '<fp>');
  const change = { by: 'user' };
  if (flags.detail !== undefined) change.detail = flags.detail;
  if (flags.suggestion !== undefined) change.suggestion = flags.suggestion;
  if (flags.severity !== undefined) {
    if (!['blocker', 'major', 'minor', 'info'].includes(flags.severity)) {
      throw userError(`--severity must be blocker, major, minor or info (got '${flags.severity}')`);
    }
    change.severity = flags.severity;
  }
  if (flags.note !== undefined) change.note = flags.note;
  if (change.detail === undefined && change.suggestion === undefined && change.severity === undefined) {
    throw userError('Nothing to refine: pass --detail, --suggestion and/or --severity');
  }
  const finding = ledger.setFindingDetails(featureId, fp, change);
  console.log(`${glyph(finding.severity)} ${finding.fp}  refined  ${finding.title}`);
}

function cmdReadiness({ pos, flags }) {
  const featureId = need(pos[0], '<featureId>');
  const r = ledger.readiness(featureId);
  if (flags.json) return printJson(r);
  console.log(`Readiness for ${featureId}`);
  console.log(table([
    ['  Score', `${r.score}/100`],
    ['  Gate', r.gate],
    ['  Open', openSummary(r.openBySeverity)],
  ]));
  const blockers = r.blockers || [];
  if (blockers.length) {
    console.log('\nBlockers:');
    for (const b of blockers) {
      if (typeof b === 'string') console.log(`  ◆ ${b}`);
      else console.log(`  ◆ ${b.fp || ''}  ${b.title || ''}`.trimEnd());
    }
  } else {
    console.log('\nNo open blockers.');
  }
}

async function cmdReport({ pos, flags }) {
  const featureId = need(pos[0], '<featureId>');
  const { generateReport } = require('./report.js');
  const md = await generateReport(featureId);
  if (flags.out) {
    fs.writeFileSync(path.resolve(flags.out), md);
    console.log(`Report written to ${flags.out}`);
  } else {
    console.log(md);
  }
}

function cmdRequestsList({ flags }) {
  const requests = ledger.listRequests(flags.status ? { status: flags.status } : {});
  if (flags.json) return printJson(requests);
  if (!requests.length) {
    console.log('No requests queued.');
    return;
  }
  const rows = [['ID', 'ACTION', 'STATUS', 'TARGET', 'TITLE', 'NOTE']];
  for (const r of requests) {
    const target = r.prId ? `PR ${r.prId}` : (r.wsId ? r.wsId : '—');
    rows.push([r.id, r.action, r.status, target, r.title || '', r.note || '']);
  }
  console.log(table(rows));
  console.log(`\n${requests.length} request(s)`);
}

function cmdRequestsSet({ pos, flags }) {
  const id = need(pos[0], '<id>');
  const change = {};
  if (flags.status !== undefined) {
    if (!ledger.REQUEST_STATUSES.includes(flags.status)) {
      throw userError(`--status must be one of ${ledger.REQUEST_STATUSES.join(', ')} (got '${flags.status}')`);
    }
    change.status = flags.status;
  }
  if (flags.note !== undefined) change.note = flags.note;
  if (flags.wsId !== undefined) change.wsId = flags.wsId;
  if (change.status === undefined && change.note === undefined && change.wsId === undefined) {
    throw userError('Nothing to change: pass --status, --note and/or --wsId');
  }
  const request = ledger.setRequestStatus(id, change);
  const target = request.prId ? `PR ${request.prId}` : (request.wsId || '—');
  console.log(`${request.id}  ${request.action}  ${request.status}  ${target}${request.note ? ` — ${request.note}` : ''}`);
}

function cmdCoverageSet({ pos, flags }) {
  const featureId = need(pos[0], '<featureId>');
  const file = need(flags.file, '--file');
  const data = readJsonFile(file, 'coverage');
  const coverage = Array.isArray(data) ? data : data && data.coverage;
  if (!Array.isArray(coverage)) {
    throw userError(`'${file}' must be a JSON array of coverage entries or { "coverage": [...] }`);
  }
  ledger.setCoverage(featureId, coverage);
  console.log(`Coverage updated for ${featureId}: ${coverage.length} entr${coverage.length === 1 ? 'y' : 'ies'}`);
}

async function cmdDemo() {
  const demo = require('./demo.js');
  const result = await demo.seed();
  const id = result && (result.id || (result.feature && result.feature.id));
  console.log(`Demo data seeded${id ? ` (feature: ${id})` : ''}.`);
  console.log('Try: node src/cli.js feature list   ·   node src/server.js');
}

function cmdStart({ flags }) {
  if (flags.port) process.env.PORT = String(flags.port);
  const port = process.env.PORT || '4173';
  const url = `http://localhost:${port}`;
  require('./server.js'); // boots server.listen() on require
  if (flags.open !== 'false' && !flags['no-open']) {
    const cp = require('node:child_process');
    const opener = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    setTimeout(() => {
      try { cp.spawn(opener, [url], { stdio: 'ignore', detached: true }).unref(); } catch { /* ignore */ }
    }, 500);
  }
  // server.listen keeps the process alive; nothing else to do.
}

// ---------- dispatch ----------

async function run(argv) {
  const { pos, flags } = parseArgs(argv);
  const [a, b] = pos;
  const cmd = a === 'feature' || a === 'source' || a === 'finding' || a === 'coverage' || a === 'requests'
    ? `${a} ${b || ''}`.trim()
    : a;
  const rest = { pos: pos.slice(cmd.includes(' ') ? 2 : 1), flags };

  ledger.initDataDir();

  switch (cmd) {
    case 'feature add': return cmdFeatureAdd(rest);
    case 'feature list': return cmdFeatureList(rest);
    case 'feature show': return cmdFeatureShow(rest);
    case 'source add': return cmdSourceAdd(rest);
    case 'ingest': return cmdIngest(rest);
    case 'finding list': return cmdFindingList(rest);
    case 'finding set': return cmdFindingSet(rest);
    case 'finding edit': return cmdFindingEdit(rest);
    case 'readiness': return cmdReadiness(rest);
    case 'report': return cmdReport(rest);
    case 'coverage set': return cmdCoverageSet(rest);
    case 'requests list': return cmdRequestsList(rest);
    case 'requests set': return cmdRequestsSet(rest);
    case 'start': return cmdStart(rest);
    case 'demo': return cmdDemo();
    case 'help':
    case undefined:
      console.log(USAGE);
      return;
    default:
      throw userError(`Unknown command '${pos.join(' ')}'\n\n${USAGE}`);
  }
}

(async () => {
  try {
    await run(process.argv.slice(2));
  } catch (err) {
    if (err && err.code === 'EUSER') {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(2);
  }
})();
