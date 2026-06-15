/* FlowLever dashboard — vanilla ES2022, zero deps.
 * Talks to the HTTP API in docs/SCHEMA.md (same origin, /api). */
'use strict';

/* ============================== constants ============================== */

const SEV_ORDER = ['blocker', 'major', 'minor', 'info'];
const SEV = {
  blocker: { glyph: '◆', label: 'blocker' },  // ◆
  major:   { glyph: '▲', label: 'major' },    // ▲
  minor:   { glyph: '●', label: 'minor' },    // ●
  info:    { glyph: '○', label: 'info' },     // ○
};
const GATE = {
  'ready':       { label: 'Ready' },
  'in-progress': { label: 'In progress' },
  'not-ready':   { label: 'Not ready' },
};
const DIMENSIONS = ['consistency', 'completeness', 'testability', 'design-match', 'dor', 'ambiguity', 'feasibility'];
const STATUS_COLS = [
  { key: 'open',      label: 'Open' },
  { key: 'reworking', label: 'Reworking' },
  { key: 'resolved',  label: 'Resolved' },
  { key: 'waived',    label: 'Waived' },
];
// Mirrors config.json defaults — used only for optimistic readiness recompute;
// the server's value is authoritative and reconciled after every POST.
const SEVERITY_WEIGHTS = { blocker: 10, major: 5, minor: 2, info: 0.5 };
const READY_THRESHOLD = 85;

const ICONS = {
  pin: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16v6"/><path d="M9 3h6l-1 6 3.5 3.5a1 1 0 0 1-.7 1.5H7.2a1 1 0 0 1-.7-1.5L10 9z"/></svg>',
  confluence: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></svg>',
  ado: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 12l2.5 2.5L15.5 9.5"/></svg>',
  figma: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 14.5l9 5 9-5"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>',
  // kind glyphs (lucide-style: file-text / git-pull-request / reply-in-bubble)
  kindSpec: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h4"/></svg>',
  kindReview: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M6 8.5v7"/><circle cx="18" cy="18" r="2.5"/><path d="M18 15.5V12a4 4 0 0 0-4-4h-3"/><path d="M13 5l-2 3 2 3"/></svg>',
  kindRespond: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/><path d="M11 8l-3 3 3 3"/><path d="M8 11h6a2 2 0 0 1 2 2v1"/></svg>',
};

/* The three workflow kinds a workspace can host. Each rides the SAME finding model
 * + stepper; only the label/icon/tint differ. `spec` is the default + back-compat. */
const KIND = {
  spec:         { label: 'Spec',       section: '#/spec',       icon: 'kindSpec' },
  'pr-review':  { label: 'PR Review',  section: '#/pr-review',  icon: 'kindReview' },
  'pr-respond': { label: 'PR Respond', section: '#/pr-respond', icon: 'kindRespond' },
};
function kindMeta(kind) { return KIND[kind] || KIND.spec; }

function kindBadge(kind) {
  const m = kindMeta(kind);
  return h('span', { class: `kind-badge kind-${cssSafe(kind)}` },
    h('span', { class: 'kind-icon', html: ICONS[m.icon] || '' }),
    m.label);
}

/* ============================== state ============================== */

const state = {
  detailId: null,
  detail: null,            // { feature, ledger, rounds, readiness }
  filters: { dims: new Set(), sevs: new Set(), status: 'all', q: '', draft: false },
  waiving: null,           // fp showing the inline waive form
  diffMode: 'unified',     // 'unified' | 'split' — proposed-change diff layout (sticky pref)
  editingHunk: null,       // { fp, idx } — hunk whose inline edit textarea is open
  modalFp: null,           // fp whose finding modal is open (one at a time)
  modalMode: 'detail',     // 'detail' | 'review' — which sub-view the modal is showing
  modalTrigger: null,      // element to restore focus to when the modal closes
  exportFp: null,          // fp whose per-finding export panel is open
  exportAll: false,        // feature-level "export all reviewed" panel open
  report: { id: null, md: null },
  // guided review flow (the stepper). `items` is a snapshot of reviewable fps
  // taken when the flow launches; `decisions` is the per-finding flow decision
  // (accept/edit/redirect/waive/skip) — the actual edits persist via the draft
  // review API, this just records which path the reviewer chose.
  flow: { active: false, finish: false, featureId: null, items: null, idx: 0, decisions: {}, waiving: null },
};
const current = { view: null, id: null, tab: null };
let routeSeq = 0;

/* ============================== tiny DOM lib ============================== */

const $ = (sel, root = document) => root.querySelector(sel);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/* h(tag, attrs, ...children) — children that are strings/numbers become text
 * nodes (XSS-safe). attrs.html is reserved for TRUSTED constant markup only. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

function cssSafe(s) { return String(s ?? '').toLowerCase().replace(/[^a-z0-9-]/g, ''); }
function safeHref(u) { return /^(https?:|\/|#)/i.test(String(u ?? '')) ? String(u) : null; }

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

/* ============================== round helpers ============================== */

function currentRoundNum() {
  if (!state.detail || !state.detail.rounds) return null;
  const rounds = state.detail.rounds.rounds || [];
  return rounds.length > 0 ? rounds[rounds.length - 1].n : null;
}

function findingBadge(f, currentRound) {
  if (currentRound == null) return null;
  if (f.firstSeenRound === currentRound) return 'new';
  const hist = Array.isArray(f.history) ? f.history : [];
  // Explicitly reopened by reconcile in this round
  if (hist.some((h) => h.to === 'open' && h.by === 'reconcile' &&
      String(h.note || '').includes(`round ${currentRound}`))) return 'regressed';
  // Open finding last seen this round that was previously resolved and then reopened
  if (f.lastSeenRound === currentRound && f.firstSeenRound < currentRound) {
    if (hist.some((h) => h.to === 'resolved') && hist.some((h) => h.to === 'open' || h.to === 'reworking')) {
      return 'regressed';
    }
  }
  return null;
}

function deriveRoundFindings(findings, n) {
  const newF = [], autoResolved = [], regressed = [];
  for (const f of findings) {
    if (f.firstSeenRound === n) newF.push(f);
    if (f.resolvedInRound === n) {
      const hist = f.history || [];
      if (hist.some((h) => h.to === 'resolved' && h.by === 'reconcile')) autoResolved.push(f);
    }
    const hist = f.history || [];
    if (hist.some((h) => h.to === 'open' && h.by === 'reconcile' &&
        String(h.note || '').includes(`round ${n}`))) regressed.push(f);
  }
  return { newF, autoResolved, regressed };
}

/* ============================== toasts ============================== */

function toast(msg, kind = 'error') {
  const t = h('div', { class: `toast toast-${cssSafe(kind)}`, role: 'status' }, msg);
  $('#toasts').append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 200);
  }, 4500);
}

/* ============================== api ============================== */

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new Error('network unreachable');
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.text();
      try {
        const j = JSON.parse(body);
        msg = j.error || j.message || msg;
      } catch { if (body && body.length < 200) msg = body; }
    } catch { /* keep status text */ }
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

/* ============================== readiness (optimistic) ============================== */

function computeReadiness(findings) {
  const openBySeverity = { blocker: 0, major: 0, minor: 0, info: 0 };
  let penalty = 0;
  for (const f of findings || []) {
    if (f.status !== 'open' && f.status !== 'reworking') continue;
    if (openBySeverity[f.severity] != null) openBySeverity[f.severity]++;
    penalty += SEVERITY_WEIGHTS[f.severity] ?? 0;
  }
  const score = Math.max(0, Math.round(100 - (penalty * 100) / 40));
  let gate = 'in-progress';
  if (openBySeverity.blocker > 0) gate = 'not-ready';
  else if (score >= READY_THRESHOLD) gate = 'ready';
  return { score, gate, openBySeverity };
}

/* ============================== shared widgets ============================== */

function arcPath(cx, cy, r, a0deg, a1deg) {
  const a0 = ((a0deg - 90) * Math.PI) / 180;
  const a1 = ((a1deg - 90) * Math.PI) / 180;
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  const large = a1deg - a0deg > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/* Readiness dial: 270° instrument gauge, colored by gate. Numeric inputs only. */
function dialEl(score, gate, size, extraClass = '') {
  const n = Math.max(0, Math.min(100, Number(score) || 0));
  const cx = size / 2, cy = size / 2, r = size / 2 - 5;
  const start = -135, sweep = 270;
  const end = start + (sweep * n) / 100;
  const gateCls = GATE[gate] ? cssSafe(gate) : 'unknown';
  const wrap = h('div', {
    class: `dial dial-${gateCls} ${extraClass}`.trim(),
    style: `width:${size}px;height:${size}px`,
    role: 'img',
    'aria-label': `readiness ${Math.round(n)} of 100`,
  });
  wrap.innerHTML =
    `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">` +
    `<path class="dial-track" d="${arcPath(cx, cy, r, start, start + sweep)}"/>` +
    (n > 0.5 ? `<path class="dial-prog" d="${arcPath(cx, cy, r, start, end)}"/>` : '') +
    `</svg><div class="dial-num">${Math.round(n)}</div>`;
  return wrap;
}

function statusChip(status) {
  const s = String(status ?? 'draft');
  return h('span', { class: `chip status-${cssSafe(s)}` }, s);
}

function gateBadge(gate) {
  const meta = GATE[gate];
  return h('span', { class: `gate-badge gate-${meta ? cssSafe(gate) : 'unknown'}` },
    h('span', { class: 'gate-dot' }),
    meta ? meta.label : String(gate ?? 'unknown'));
}

function sevCountsRow(openBySeverity) {
  const o = openBySeverity || {};
  return h('div', { class: 'sev-counts' },
    SEV_ORDER.map((s) => h('span', { class: `sev sev-${s}`, title: `open ${SEV[s].label}s` },
      h('span', { class: 'sev-glyph' }, SEV[s].glyph),
      h('span', { class: 'num' }, String(o[s] ?? 0)),
    )));
}

function iconSpan(name, cls = 'icon') {
  return h('span', { class: cls, html: ICONS[name] || '' });
}

function skel(cls) { return h('div', { class: `skel ${cls}` }); }

/* ============================== guide ============================== */

function gStep(n, title, ...body) {
  return h('div', { class: 'guide-step' },
    h('div', { class: 'gs-num' }, String(n)),
    h('div', { class: 'gs-body' }, h('h3', {}, title), ...body));
}
function gCmd(text) { return h('code', { class: 'guide-cmd' }, text); }

function renderGuide() {
  current.view = 'guide'; current.id = null; current.tab = null;
  const app = $('#app');
  app.replaceChildren(
    h('div', { class: 'guide' },
      h('div', { class: 'view-head' },
        h('h1', {}, 'How FlowLever works'),
        h('p', { class: 'view-sub' }, 'A review cockpit for specs and PRs — from messy spec to ready-to-build, and from PR diff to posted comments, staying on top of every finding')),

      // What it is
      h('section', { class: 'guide-card' },
        h('h2', {}, 'The idea in one breath'),
        h('p', { class: 'guide-lead' },
          'A ', h('strong', {}, 'feature'), ' links its Confluence spec, Azure DevOps work items and Figma designs. ',
          'You run ', h('strong', {}, 'audits'), ' that flag ', h('strong', {}, 'findings'),
          ' (contradictions, gaps, untestable statements, design mismatches). Findings live in a ',
          h('strong', {}, 'fingerprinted ledger'), ' with a lifecycle and a ', h('strong', {}, 'readiness score'),
          '. You rework, re-audit, and the score climbs until the gate turns green — and the ledger ',
          'never loses track of what was flagged, fixed, or quietly came back.')),

      // Two halves
      h('section', { class: 'guide-card' },
        h('h2', {}, 'Two halves'),
        h('div', { class: 'guide-cols' },
          h('div', { class: 'guide-col' },
            h('h3', {}, '🖥️  The cockpit (this site + CLI)'),
            h('p', {}, 'Runs locally, no network, zero dependencies. It shows everything — readiness, the findings board, the coverage matrix, the round timeline, the report. Drive it from the dashboard or the ', gCmd('node src/cli.js'), ' commands.')),
          h('div', { class: 'guide-col' },
            h('h3', {}, '🤖  The skills (in Claude Code chat)'),
            h('p', {}, 'The ', h('code', {}, '/flowlever:*'), ' skills run inside your Claude Code session — where your Confluence / ADO / Figma access already lives. They do the fetching, analysis and (only on your OK) the fixes for both ', h('strong', {}, 'specs'), ' (audit / rework / brief) and ', h('strong', {}, 'PRs'), ' (pr-review / pr-respond), then write findings into the ledger.')))),

      // The loop
      h('section', { class: 'guide-card' },
        h('h2', {}, 'The loop'),
        h('div', { class: 'guide-steps' },
          gStep(1, 'Audit',
            h('p', {}, 'In Claude Code: ', h('code', {}, '/lever:audit checkout-redesign'), ' (or “audit feature X”, or paste a spec link). It fetches the sources, runs a 7-dimension check, and ingests findings into the ledger.')),
          gStep(2, 'Review — step through, one finding at a time',
            h('p', {}, 'Open the feature here and hit the ', h('strong', {}, '“Review N flagged items”'), ' button in the header loop strip. The guided ', h('strong', {}, 'stepper'), ' walks each flagged finding one at a time: you see the proposed change as a red/green diff and decide ', h('strong', {}, 'Accept · Edit · Redirect · Waive · Skip'), '. Decisions accumulate — nothing is applied mid-flow — and a rail lets you jump around. The ', h('strong', {}, 'All findings'), ' board, ', h('strong', {}, 'Coverage'), ', and ', h('strong', {}, 'Timeline'), ' tabs are all still there.')),
          gStep(3, 'Apply / Export',
            h('p', {}, 'The finish screen is a ', h('strong', {}, 'decision summary'), ' grouped by spec page / work item. From there: ', h('strong', {}, 'Export the work order'), ' (markdown to hand a coding agent) and/or ', h('strong', {}, 'mark the reviewed findings as Reworking'), ' so the board reflects in-flight work. Drafts come from ', h('code', {}, '/lever:rework'), '; nothing is written to Confluence/ADO from the browser.')),
          gStep(4, 'Re-audit',
            h('p', {}, 'Run ', h('code', {}, '/lever:audit'), ' again. The ledger ', h('strong', {}, 'reconciles'), ': fixed findings auto-resolve, still-open ones refresh, and anything that ', h('strong', {}, 'silently came back'), ' is flagged as a regression (red on the timeline).')),
          gStep(5, 'Ship',
            h('p', {}, 'When the gate is green, ', h('code', {}, '/lever:brief checkout-redesign'), ' composes an implementation-ready handoff brief from the spec, designs and settled decisions.')))),

      // PR flows
      h('section', { class: 'guide-card' },
        h('h2', {}, 'PRs ride the same cockpit'),
        h('p', { class: 'guide-lead' },
          'Pull requests use the exact same finding model and review stepper as specs — only the workflow differs. ',
          'Kick a job off from ', h('strong', {}, '“+ New PR review / respond”'), ' in the UI (or the skill in chat); the ',
          h('code', {}, '/flowlever:watch'), ' runner — a loop in your Claude Code session — picks it up, does the ADO work, and the results show back here.'),
        h('div', { class: 'guide-cols' },
          h('div', { class: 'guide-col' },
            h('h3', {}, h('code', {}, '/flowlever:pr-review'), ' — review someone’s PR'),
            h('p', {},
              'Enqueue a PR id → the runner fetches the diff + linked ticket/spec and reviews it → findings land in a workspace → you ',
              h('strong', {}, 'step through'), ' each one (Accept · Edit · Redirect · Waive · Skip) → ',
              h('strong', {}, '“Post comments”'), ' posts only what you approved as inline PR comments. ',
              h('strong', {}, 'Nothing is posted automatically.'))),
          h('div', { class: 'guide-col' },
            h('h3', {}, h('code', {}, '/flowlever:pr-respond'), ' — answer feedback on your PR'),
            h('p', {},
              'Pulls the reviewer threads awaiting your reply → each becomes a finding with a proposed reply/fix → you decide ',
              h('strong', {}, 'per thread'), ' (apply fix · reply · push back · waive) → ',
              h('strong', {}, '“Post replies”'), ' posts the replies and applies the code fixes — only on your action.')))),

      // Job lifecycle & statuses
      h('section', { class: 'guide-card' },
        h('h2', {}, 'Job lifecycle & statuses'),
        h('p', {},
          'A UI-triggered job moves through four statuses, shown live on its row in the jobs strip:'),
        h('ul', { class: 'guide-list' },
          h('li', {}, h('strong', {}, '⏳ Queued'), ' — waiting for the runner to pick it up.'),
          h('li', {}, h('strong', {}, '⠿ Running'), ' — being processed. The row shows the ', h('strong', {}, 'live phase'),
            ' (e.g. “Running · reviewing changes”) so you can see exactly what it’s doing.'),
          h('li', {}, h('strong', { class: 'guide-ni' }, '⚠ Needs your input'), ' — the job is ', h('strong', {}, 'blocked waiting on you'),
            ', most often to approve a 2FA / auth prompt in another window. An amber banner spells out what to do; ',
            'approve it and the job continues on its own.'),
          h('li', {}, h('strong', {}, '✓ Done'), ' — finished; the workspace is ready and linked from the row.'),
          h('li', {}, h('strong', {}, '✗ Error'), ' — failed; the row shows why.')),
        h('p', { class: 'meta-dim' },
          'The runner is the ', h('code', {}, '/flowlever:watch'), ' loop in your Claude Code session — that’s why a job can pause for your 2FA: ',
          'the session, not the browser, holds your Confluence / ADO access.')),

      // Reading the dashboard
      h('section', { class: 'guide-card' },
        h('h2', {}, 'Reading the dashboard'),
        h('ul', { class: 'guide-list' },
          h('li', {}, h('strong', {}, 'Readiness dial'), ' — 0–100. Green = ready, amber = in progress, red = not ready. Any open ', h('span', { class: 'sev-blocker' }, '◆ blocker'), ' forces “not ready” no matter the score.'),
          h('li', {}, h('strong', {}, 'Severity'), ' — ', h('span', { class: 'sev-blocker' }, '◆ blocker'), ' (build would be wrong/stuck) · ', h('span', { class: 'sev-major' }, '▲ major'), ' (rework needed) · ', h('span', { class: 'sev-minor' }, '● minor'), ' (polish) · ', h('span', { class: 'sev-info' }, '○ info'), '.'),
          h('li', {}, h('strong', {}, 'Status columns'), ' — Open → Reworking → Resolved | Waived. Waiving needs a reason; pinned findings never auto-resolve.'),
          h('li', {}, h('strong', {}, 'Coverage'), ' — covered / partial / uncovered sections, plus orphan work items with no matching spec section.'),
          h('li', {}, h('strong', {}, 'Timeline'), ' — each audit round with new / auto-resolved / regression counts and the score delta.'))),

      // Try now
      h('section', { class: 'guide-card guide-try' },
        h('h2', {}, 'Try it right now'),
        h('ol', { class: 'guide-list' },
          h('li', {}, 'The demo feature is already seeded — ', h('a', { href: '#/' }, 'open the Features overview'), ' and click into ', h('strong', {}, 'Checkout Redesign'), '.'),
          h('li', {}, 'Walk the four tabs. Notice the score climbing 0 → 33 → 53 across rounds on the Timeline, and the regression flagged in round 3.'),
          h('li', {}, 'Re-seed any time with ', gCmd('node src/cli.js demo'), '.'),
          h('li', {}, 'For a real feature, tell Claude Code: ', h('em', {}, '“audit feature <name>”'), ' with its Confluence / ADO / Figma links.'))),

      h('p', { class: 'guide-foot' }, 'Full details live in ', h('code', {}, 'README.md'), ' and ', h('code', {}, 'docs/SCHEMA.md'), '.'),
    ));
}

/* ============================== guided review flow ============================== */

/* Reviewable = an open/reworking finding that carries a proposed change (draft).
 * These are the items the stepper walks and the CTA counts. */
function reviewableFindings(findings) {
  return (findings || []).filter((f) => (f.status === 'open' || f.status === 'reworking') && f.draft);
}

const LOOP_STAGES = [['1', 'Audit'], ['2', 'Review'], ['3', 'Apply / Export'], ['4', 'Re-audit']];

function loopActiveStage(data) {
  const findings = (data.ledger && data.ledger.findings) || [];
  if (!findings.length) return 'Audit';
  if (reviewableFindings(findings).length) return 'Review';
  return 'Re-audit';
}

/* The loop, always visible in the feature header: Audit → Review → Apply/Export
 * → Re-audit, with the current stage lit and the primary CTA on the right. */
function loopStrip(activeStage, rightEl) {
  const stages = [];
  LOOP_STAGES.forEach(([ix, label], i) => {
    if (i) stages.push(h('span', { class: 'loop-sep' }, '→'));
    stages.push(h('div', { class: `loop-stage ${label === activeStage ? 'active' : ''}` },
      h('span', { class: 'loop-ix' }, ix), label));
  });
  return h('div', { class: 'loop-strip' },
    h('div', { class: 'loop-stages' }, stages),
    rightEl);
}

/* The single prominent next-action. "Review N" when there's something to review;
 * otherwise it tells the user what's blocking the loop (drafts missing) or that
 * there's nothing to do. */
function reviewCta(data) {
  const findings = (data.ledger && data.ledger.findings) || [];
  const n = reviewableFindings(findings).length;
  if (n > 0) {
    return h('button', {
      class: 'review-cta', type: 'button',
      onclick: () => { location.hash = `#/feature/${encodeURIComponent(current.id)}/review`; },
    }, 'Review ', h('span', { class: 'cta-n' }, String(n)), ` flagged ${n === 1 ? 'item' : 'items'}`);
  }
  const openNoDraft = findings.filter((f) => (f.status === 'open' || f.status === 'reworking') && !f.draft).length;
  if (openNoDraft > 0) {
    return h('div', { class: 'review-cta-done' },
      `Nothing to review — ${plural(openNoDraft, 'open finding', 'open findings')} without a draft`);
  }
  const gate = (data.readiness && data.readiness.gate) || 'in-progress';
  return h('div', { class: 'review-cta-done is-ready' }, gate === 'ready' ? '✓ Ready to build' : '✓ Nothing to review');
}

const DEC_LABEL = { accept: 'Apply', edit: 'With edits', redirect: 'Redirect', waive: 'Waive', skip: 'Skip' };
const RAIL_MARK = { accept: '✓', edit: '✎', redirect: '⤳', waive: '⊘', skip: '–' };

async function renderReviewFlow(id, finish) {
  current.view = 'review-flow'; current.id = id; current.tab = 'review';
  const seq = ++routeSeq;
  const app = $('#app');
  const cached = state.detailId === id && state.detail;
  if (!cached) app.replaceChildren(detailSkeleton());
  let data;
  try {
    data = await loadDetail(id);
  } catch (e) {
    if (seq !== routeSeq) return;
    toast(`Could not load feature: ${e.message}`);
    app.replaceChildren(errorView(`Could not load “${id}”`, e.message));
    return;
  }
  if (seq !== routeSeq) return;
  initFlow(data);
  state.flow.active = true;
  state.flow.finish = !!finish;
  renderFlowInto();
}

/* Snapshot the reviewable fps at launch so the step count is stable while the
 * reviewer works. Re-entering the same feature keeps decisions + position;
 * switching features resets. */
function initFlow(data) {
  const findings = (data.ledger && data.ledger.findings) || [];
  const reviewable = reviewableFindings(findings);
  if (state.flow.featureId !== current.id || !Array.isArray(state.flow.items)) {
    state.flow = {
      active: true, finish: false, featureId: current.id,
      items: reviewable.map((f) => f.fp), idx: 0, decisions: {}, waiving: null,
    };
  }
  const len = state.flow.items.length;
  if (len === 0) { state.flow.idx = 0; return; }
  if (state.flow.idx >= len) state.flow.idx = len - 1;
  if (state.flow.idx < 0) state.flow.idx = 0;
}

function renderFlowInto() {
  if (current.view !== 'review-flow' || !state.detail) return;
  const app = $('#app');
  const data = state.detail;
  const kind = data.feature && data.feature.kind;
  const postable = state.flow.finish && (kind === 'pr-review' || kind === 'pr-respond');
  if (postable) ensureApplyPolling(); else stopPolling();
  if (!state.flow.items || !state.flow.items.length) {
    app.replaceChildren(flowEmptyView());
    return;
  }
  app.replaceChildren(state.flow.finish ? finishView(data) : stepperView(data));
}

/* While the PR finish screen is open, keep the apply-request status for this
 * workspace fresh so the Post button shows queued → running → posted. The scope
 * guard means re-rendering the finish view reuses the interval, not resets it. */
function ensureApplyPolling() {
  startPolling(`apply:${current.id}`, (reqs) => {
    if (current.view !== 'review-flow' || !state.flow.finish) return;
    const next = reqs.filter((r) => r.action === 'apply' && r.wsId === current.id);
    const prev = state.flow.applyReqs || [];
    const sig = (list) => list.map((r) => `${r.id}:${r.status}:${r.note || ''}`).join('|');
    state.flow.applyReqs = next;
    if (sig(prev) !== sig(next)) renderFlowInto();
  });
}

function flowEmptyView() {
  const back = `#/feature/${encodeURIComponent(current.id)}`;
  return h('div', { class: 'stepper' },
    h('a', { class: 'backlink', href: back }, '← Overview'),
    h('div', { class: 'step-card' },
      h('div', { class: 'step-empty' },
        h('h2', {}, 'Nothing to review'),
        h('p', { class: 'meta-dim' }, 'No open findings carry a proposed change yet. Run ',
          h('code', {}, '/lever:rework'), ' in Claude Code to draft fixes, then re-audit.'),
        h('p', {}, h('a', { class: 'backlink', href: back }, '← Back to the board')))));
}

/* The stepper: top bar (progress) · item rail · focused step card · prev/next. */
function stepperView(data) {
  const findings = (data.ledger && data.ledger.findings) || [];
  const { items, idx } = state.flow;
  const fp = items[idx];
  const f = findings.find((x) => x.fp === fp);
  const total = items.length;
  const decided = items.filter((id) => state.flow.decisions[id]).length;

  const top = h('div', { class: 'step-top' },
    h('div', { class: 'step-top-title' }, 'Reviewing ', h('span', { class: 'meta-dim' }, data.feature.title || current.id)),
    h('span', { class: 'step-progress' }, `${idx + 1} of ${total}`),
    h('div', { class: 'step-progressbar', role: 'progressbar', 'aria-valuenow': String(decided), 'aria-valuemax': String(total) },
      h('i', { style: `width:${total ? Math.round((decided / total) * 100) : 0}%` })),
    h('button', { class: 'btn step-exit', type: 'button',
      onclick: () => { location.hash = `#/feature/${encodeURIComponent(current.id)}`; } }, 'Exit to board'),
  );

  const card = f ? stepCard(data, f)
    : h('div', { class: 'step-card' }, h('div', { class: 'step-empty' }, 'This finding is no longer available.'));

  return h('div', { class: 'stepper' },
    top,
    h('div', { class: 'step-layout' },
      stepRail(findings),
      h('div', {}, card, stepNav())));
}

function stepRail(findings) {
  const { items, idx } = state.flow;
  const rows = items.map((fp, i) => {
    const f = findings.find((x) => x.fp === fp);
    const dec = state.flow.decisions[fp];
    const sev = f && SEV[f.severity] ? f.severity : 'info';
    return h('button', {
      class: `rail-item ${i === idx ? 'active' : ''} ${dec ? `decided dec-${dec.kind}` : ''}`,
      type: 'button',
      onclick: () => { state.flow.idx = i; state.flow.finish = false; renderFlowInto(); },
    },
      h('span', { class: 'rail-mark' }, dec ? RAIL_MARK[dec.kind] : ''),
      h('span', { class: `rail-sev sev-${sev}` }, SEV[sev].glyph),
      h('span', { class: 'rail-label' }, f ? (f.title || '(untitled)') : fp));
  });
  return h('div', { class: 'step-rail' },
    h('div', { class: 'rail-head' }, plural(items.length, 'flagged item', 'flagged items')),
    rows,
    h('button', {
      class: 'rail-item', type: 'button', style: 'margin-top:6px;border-top:1px solid var(--line-soft);border-radius:0 0 var(--radius-sm) var(--radius-sm)',
      onclick: () => { state.flow.finish = true; renderFlowInto(); },
    }, h('span', { class: 'rail-mark' }, '✓'), h('span', { class: 'rail-label' }, 'Finish & summary')));
}

function stepCard(data, f) {
  const sev = SEV[f.severity] ? f.severity : 'info';
  const badge = findingBadge(f, currentRoundNum());
  const { adds, dels, hunks } = draftStats(f);
  const verdict = draftVerdict(f);

  const head = h('div', { class: 'step-finding-head' },
    h('div', { class: 'step-titlerow' },
      h('span', { class: `sev-glyph sev-${sev}`, title: SEV[sev].label }, SEV[sev].glyph),
      h('h2', {}, f.title || '(untitled finding)')),
    h('div', { class: 'step-tags' },
      f.dimension ? h('span', { class: 'dim-tag' }, f.dimension) : null,
      badge ? h('span', { class: `f-badge f-badge-${badge}` }, badge === 'new' ? 'NEW' : 'REGRESSED') : null,
      statusChip(f.status),
      verdictChip(f),
      f.locus ? h('code', { class: 'f-locus' }, f.locus) : null));

  const mkTab = (mode, label) => h('button', {
    class: `diff-tab ${state.diffMode === mode ? 'active' : ''}`, type: 'button', 'aria-label': `${label} diff`,
    onclick: () => { state.diffMode = mode === 'split' ? 'split' : 'unified'; refreshModal(); },
  }, label);

  const diffHead = h('div', { class: 'step-diffhead' },
    h('span', { class: 'step-section-label' }, 'Proposed change'),
    h('code', { class: 'diff-target' }, (f.draft && f.draft.target) || f.locus || '—'),
    h('span', { class: 'diff-counts' },
      h('span', { class: 'diff-add-n' }, `+${adds}`), ' ', h('span', { class: 'diff-del-n' }, `−${dels}`)),
    hunks.length ? h('div', { class: 'diff-toggle', role: 'group', 'aria-label': 'Diff view mode' },
      mkTab('unified', 'Unified'), mkTab('split', 'Split')) : null);

  const banner = verdict !== 'proposed'
    ? h('div', { class: `rm-verdict-banner verdict-${verdict}` },
        h('span', { class: 'verdict-glyph' }, VERDICT_GLYPH[verdict]),
        verdict === 'reject'
          ? 'Rejected — the proposed change below is overridden by your note.'
          : 'Redirect — the proposed change below is superseded; the agent follows your note instead.')
    : null;

  return h('div', { class: `step-card ${verdict !== 'proposed' ? `rm-frame-${verdict}` : ''}`.trim() },
    head,
    f.detail ? h('p', { class: 'step-detail' }, f.detail) : null,
    f.suggestion ? h('div', { class: 'f-suggestion' },
      h('span', { class: 'f-suglabel' }, 'suggestion'), h('p', {}, f.suggestion)) : null,
    h('div', { class: 'step-diffwrap' }, diffHead, banner, ...reviewBodyKids(f)),
    decisionRow(f));
}

function decisionRow(f) {
  if (state.flow.waiving === f.fp) {
    return h('div', { class: 'decision-row' },
      h('span', { class: 'decision-label' }, 'Waive'),
      stepWaiveForm(f));
  }
  const dec = state.flow.decisions[f.fp];
  const kind = dec && dec.kind;
  const mk = (k, label) => h('button', {
    class: `dec-btn dec-${k} ${kind === k ? 'on' : ''}`, type: 'button',
    'aria-pressed': kind === k ? 'true' : 'false',
    onclick: () => decide(f, k),
  }, label);
  return h('div', { class: 'decision-row' },
    h('span', { class: 'decision-label' }, 'Decision'),
    mk('accept', '✅ Accept'),
    mk('edit', '✏️ Edit'),
    mk('redirect', '⤳ Redirect'),
    mk('waive', '⊘ Waive'),
    mk('skip', '⏭ Skip'));
}

function stepWaiveForm(f) {
  const input = h('input', {
    class: 'waive-input', type: 'text', placeholder: 'Why is this acceptable as-is? (required)',
    'aria-label': 'Waive reason',
    onkeydown: (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') cancel(); },
  });
  function submit() {
    const r = input.value.trim();
    if (!r) { input.classList.add('invalid'); input.focus(); return; }
    setFlowDecision(f.fp, 'waive', { reason: r });
    state.flow.waiving = null;
    advance();
  }
  function cancel() { state.flow.waiving = null; renderFlowInto(); }
  const form = h('div', { class: 'waive-form' }, input,
    h('div', { style: 'display:flex;gap:6px' },
      h('button', { class: 'btn btn-accent', type: 'button', onclick: submit }, 'Waive & next'),
      h('button', { class: 'btn', type: 'button', onclick: cancel }, 'Cancel')));
  requestAnimationFrame(() => input.focus());
  return form;
}

function stepNav() {
  const { idx, items } = state.flow;
  const atFirst = idx <= 0;
  const atLast = idx >= items.length - 1;
  return h('div', { class: 'step-nav' },
    h('button', { class: 'btn', type: 'button', disabled: atFirst,
      onclick: () => { if (!atFirst) { state.flow.idx--; renderFlowInto(); } } }, '← Prev'),
    h('span', { class: 'step-nav-mid' }, `${idx + 1} / ${items.length}`),
    h('button', { class: 'btn btn-accent', type: 'button',
      onclick: () => { if (atLast) state.flow.finish = true; else state.flow.idx++; renderFlowInto(); } },
      atLast ? 'Finish →' : 'Next →'));
}

function setFlowDecision(fp, kind, extra = {}) {
  state.flow.decisions[fp] = { kind, ...extra };
}

function advance() {
  if (state.flow.idx >= state.flow.items.length - 1) state.flow.finish = true;
  else state.flow.idx++;
  renderFlowInto();
}

/* Decisions persist via the existing draft-review API (so the board + export
 * reflect them); nothing touches finding *status* until the finish screen. */
async function decide(f, kind) {
  const fp = f.fp;
  if (kind === 'accept') {
    setFlowDecision(fp, 'accept');
    await acceptAll(f);
    advance();
  } else if (kind === 'edit') {
    setFlowDecision(fp, 'edit');
    if (draftVerdict(f) !== 'proposed') await setVerdict(fp, 'proposed');
    else renderFlowInto();   // reveal the per-hunk controls; reviewer edits then Next
  } else if (kind === 'redirect') {
    setFlowDecision(fp, 'redirect');
    if (draftVerdict(f) !== 'redirect') await setVerdict(fp, 'redirect');
    else renderFlowInto();
    requestAnimationFrame(() => { const ta = $('.review-note-ta'); if (ta) ta.focus(); });
  } else if (kind === 'waive') {
    state.flow.waiving = fp;
    renderFlowInto();
  } else if (kind === 'skip') {
    setFlowDecision(fp, 'skip');
    advance();
  }
}

/* Accept the whole proposal: mark every hunk accepted + verdict proposed, in one
 * merged POST. Optimistic, then reconciled from the server. */
async function acceptAll(f) {
  const { hunks } = draftStats(f);
  const hunkObj = {};
  for (const hk of hunks) hunkObj[String(hk.id)] = { status: 'accepted', at: new Date().toISOString() };
  const cur = findFinding(f.fp);
  if (cur && cur.draft) {
    cur.draft.review = { ...(cur.draft.review || {}), hunks: hunkObj, verdict: 'proposed', updatedAt: new Date().toISOString() };
  }
  renderFlowInto();
  try {
    const body = hunks.length ? { hunks: hunkObj, verdict: 'proposed' } : { verdict: 'proposed' };
    await api(`/api/features/${encodeURIComponent(current.id)}/findings/${encodeURIComponent(f.fp)}/draft/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    await loadDetail(current.id, true);
  } catch (e) {
    toast(`Accept failed: ${e.message}`);
    try { await loadDetail(current.id, true); } catch { /* keep optimistic state */ }
  }
  renderFlowInto();
}

/* ---- finish: the decision summary ---- */

function flowDecisionKind(fp) {
  const dec = state.flow.decisions[fp];
  return (dec && dec.kind) || 'skip';
}

function finishView(data) {
  const findings = (data.ledger && data.ledger.findings) || [];
  const counts = { accept: 0, edit: 0, redirect: 0, waive: 0, skip: 0 };
  const byTarget = new Map();
  for (const fp of state.flow.items) {
    const f = findings.find((x) => x.fp === fp);
    if (!f) continue;
    const dec = state.flow.decisions[fp];
    const kind = (dec && dec.kind) || 'skip';
    counts[kind] = (counts[kind] || 0) + 1;
    const target = (f.draft && f.draft.target && f.draft.target.trim()) || f.locus || '—';
    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target).push({ f, kind, reason: dec && dec.reason });
  }

  const tally = (cls, label, n) => h('span', { class: `finish-tally t-${cls}` },
    h('span', { class: 'num' }, String(n)), label);
  const head = h('div', { class: 'finish-head' },
    h('h1', {}, 'Decision summary'),
    h('p', { class: 'view-sub' }, `${plural(state.flow.items.length, 'flagged item', 'flagged items')} reviewed · ${data.feature.title || current.id}`),
    h('div', { class: 'finish-tallies' },
      tally('accept', 'Apply as proposed', counts.accept),
      tally('edit', 'Apply with edits', counts.edit),
      tally('redirect', 'Redirect', counts.redirect),
      tally('waive', 'Waive', counts.waive),
      tally('skip', 'Skipped', counts.skip)));

  const groups = [...byTarget.entries()].map(([target, rows]) => h('div', { class: 'finish-group' },
    h('div', { class: 'finish-group-head' }, h('code', { class: 'finish-target' }, target)),
    h('div', { class: 'finish-rows' }, rows.map(({ f, kind, reason }) => {
      const sev = SEV[f.severity] ? f.severity : 'info';
      return h('div', { class: 'finish-row' },
        h('span', { class: `sev-glyph sev-${sev}` }, SEV[sev].glyph),
        h('span', { class: 'frow-title' }, f.title || '(untitled)',
          reason ? h('span', { class: 'meta-dim' }, ` — ${reason}`) : null),
        h('span', { class: `dec-pill dec-${kind}` }, DEC_LABEL[kind]));
    }))));

  const applyKinds = (fp) => ['accept', 'edit', 'redirect'].includes(flowDecisionKind(fp));
  const reworkFps = state.flow.items.filter(applyKinds);
  const waiveItems = state.flow.items
    .filter((fp) => flowDecisionKind(fp) === 'waive')
    .map((fp) => ({ fp, reason: (state.flow.decisions[fp] && state.flow.decisions[fp].reason) || '' }));
  const toExport = reworkFps.map((fp) => findings.find((x) => x.fp === fp)).filter(Boolean);

  const exportEl = toExport.length
    ? exportPanel(data.feature, toExport, 'feature')
    : h('p', { class: 'meta-dim export-empty' }, 'No applicable changes to export — every item was waived or skipped.');

  const applyN = reworkFps.length + waiveItems.length;
  const actions = h('div', { class: 'finish-actions' },
    h('button', {
      class: 'btn btn-accent', type: 'button', disabled: applyN === 0,
      onclick: () => applyReviewed(reworkFps, waiveItems),
    }, applyN ? `Mark ${plural(applyN, 'finding', 'findings')} as in-flight` : 'Nothing to apply'),
    h('button', { class: 'btn', type: 'button', onclick: () => { state.flow.finish = false; renderFlowInto(); } }, '← Back to steps'),
    h('button', { class: 'btn', type: 'button',
      onclick: () => { location.hash = `#/feature/${encodeURIComponent(current.id)}`; } }, 'Exit to board'));

  return h('div', { class: 'finish' },
    h('a', { class: 'backlink', href: `#/feature/${encodeURIComponent(current.id)}` }, '← Overview'),
    head,
    ...groups,
    h('div', { class: 'finish-head' },
      h('div', { class: 'step-section-label' }, 'Export work order — hand to a coding agent'),
      exportEl),
    postActionEl(data),
    actions,
    nextStepNote(data));
}

/* PR finish screens swap the "re-audit" hint for a posting action: enqueue an
 * `apply` request (the runner posts the kept comments / replies back to the PR)
 * and reflect its queued → running → posted progress. Spec workspaces keep the
 * re-audit note. */
function nextStepNote(data) {
  const kind = data.feature && data.feature.kind;
  if (kind === 'pr-review' || kind === 'pr-respond') {
    return h('div', { class: 'finish-next' }, '↻ Next: post back to the PR above, then the threads update in Azure DevOps.');
  }
  return h('div', { class: 'finish-next' }, '↻ Next: re-audit with ', h('code', {}, '/lever:audit'),
    ' in Claude Code so the ledger reconciles your fixes.');
}

function postActionEl(data) {
  const kind = data.feature && data.feature.kind;
  if (kind !== 'pr-review' && kind !== 'pr-respond') return null;
  const label = kind === 'pr-review' ? 'Post comments' : 'Post replies';
  const reqs = (state.flow.applyReqs || []).slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  const latest = reqs[reqs.length - 1];
  const active = !!latest && (latest.status === 'queued' || latest.status === 'running');
  const posted = !!latest && latest.status === 'done';
  const errored = !!latest && latest.status === 'error';
  const meta = latest ? (REQ_STATUS[latest.status] || REQ_STATUS.queued) : null;

  const statusLine = latest
    ? h('span', { class: `post-status req-state-${cssSafe(latest.status)}` },
        h('span', { class: `req-glyph req-glyph-${cssSafe(latest.status)} ${meta.spin ? 'req-spin' : ''}`.trim() }, meta.glyph),
        ' ', posted ? 'Posted to the PR' : meta.label,
        errored && latest.note ? h('span', { class: 'meta-dim' }, ` — ${latest.note}`) : null)
    : null;

  const btn = h('button', {
    class: 'btn btn-accent', type: 'button', disabled: active,
    onclick: () => enqueueApply(label),
  }, active ? 'Queued…' : posted ? `${label} again` : errored ? 'Retry post' : label);

  return h('div', { class: 'finish-post' },
    h('div', { class: 'step-section-label' }, `${label} — send the kept items back to the PR`),
    h('div', { class: 'finish-post-row' },
      btn,
      statusLine,
      h('span', { class: 'meta-dim post-flow' }, 'queued → running → posted')));
}

async function enqueueApply(label) {
  try {
    await api('/api/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'apply', wsId: current.id }),
    });
    toast(`${label} queued`, 'success');
    ensureApplyPolling();
    pollRequestsNow();
  } catch (e) {
    toast(`Could not queue: ${e.message}`);
  }
}

/* Apply the finish screen: accepted/edited/redirected → reworking (bulk endpoint);
 * waived → waived with their reasons (per-finding). Then back to the board. */
async function applyReviewed(reworkFps, waiveItems) {
  let n = 0;
  try {
    if (reworkFps.length) {
      await api(`/api/features/${encodeURIComponent(current.id)}/review/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fps: reworkFps, status: 'reworking' }),
      });
      n += reworkFps.length;
    }
    for (const { fp, reason } of waiveItems) {
      await api(`/api/features/${encodeURIComponent(current.id)}/findings/${encodeURIComponent(fp)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'waived', reason: reason.trim() || 'waived during review' }),
      });
      n += 1;
    }
    await loadDetail(current.id, true);
    toast(`Applied — ${plural(n, 'finding', 'findings')} updated`, 'success');
    location.hash = `#/feature/${encodeURIComponent(current.id)}`;
  } catch (e) {
    toast(`Apply failed: ${e.message}`);
  }
}

/* ============================== router ============================== */

function route() {
  if (state.modalFp) closeModal();   // never leave a modal open across navigation
  stopPolling();                     // each view (re)starts its own requests poll after it loads
  state.flow.active = false;         // the stepper owns this flag only while on the review route
  const hash = location.hash || '#/';
  const m = hash.match(/^#\/feature\/([^/]+)(?:\/(findings|coverage|timeline|report|review))?(?:\/(finish))?\/?$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    const sub = m[2] || 'findings';
    if (sub === 'review') renderReviewFlow(id, m[3] === 'finish');
    else renderDetail(id, sub);
  } else if (hash.startsWith('#/guide')) {
    renderGuide();
  } else if (hash.startsWith('#/spec')) {
    renderSection('spec');
  } else if (hash.startsWith('#/pr-review')) {
    renderSection('pr-review');
  } else if (hash.startsWith('#/pr-respond')) {
    renderSection('pr-respond');
  } else {
    renderHome();
  }
  syncNav();
}

function syncNav() {
  const hash = location.hash || '#/';
  let active = '#/';
  if (hash.startsWith('#/guide')) active = '#/guide';
  else if (hash.startsWith('#/pr-review')) active = '#/pr-review';
  else if (hash.startsWith('#/pr-respond')) active = '#/pr-respond';
  else if (hash.startsWith('#/spec')) active = '#/spec';
  else if (hash.startsWith('#/feature')) active = null;   // detail page — no top-level section lit
  document.querySelectorAll('.topnav a').forEach((a) => {
    a.classList.toggle('active', a.getAttribute('href') === active);
  });
}

/* ============================== home (unified inbox) ============================== */

/* Which "what needs you" bits to show for an inbox row. toReview/reworking/open are
 * the actionable states; a row with none of them is settled (shown as a check). */
function needsYouBits(c) {
  const bits = [];
  if (c.toReview) bits.push(`${c.toReview} to review`);
  if (c.reworking) bits.push(`${c.reworking} reworking`);
  if (!c.toReview && !c.reworking && c.open) bits.push(`${c.open} open`);
  return bits;
}

function inboxRow(r) {
  const bits = needsYouBits(r.counts);
  const rd = r.readiness || { score: 0, gate: 'in-progress' };
  return h('a', { class: 'inbox-row', href: `#/feature/${encodeURIComponent(r.id)}` },
    dialEl(rd.score, rd.gate, 44, 'dial-sm ir-dial'),
    h('div', { class: 'ir-main' },
      h('div', { class: 'ir-top' }, kindBadge(r.kind), h('span', { class: 'ir-title' }, r.title || r.id)),
      h('div', { class: 'ir-needs' },
        bits.length
          ? bits.map((b) => h('span', { class: 'ir-bit' }, b))
          : h('span', { class: 'ir-clear' }, rd.gate === 'ready' ? '✓ Ready to build' : '✓ Nothing needs you'))),
    h('span', { class: 'ir-arrow', 'aria-hidden': 'true' }, '→'));
}

async function renderHome() {
  current.view = 'home'; current.id = null; current.tab = null;
  const seq = ++routeSeq;
  const app = $('#app');
  app.replaceChildren(
    h('div', { class: 'view-head' },
      h('h1', {}, 'Home'),
      h('p', { class: 'view-sub' }, 'Everything that needs your attention — across specs and PRs')),
    h('div', { class: 'inbox' }, Array.from({ length: 3 }, () => skel('skel-row'))),
  );
  let rows;
  try {
    rows = await api('/api/home');
  } catch (e) {
    if (seq !== routeSeq) return;
    toast(`Could not load home: ${e.message}`);
    app.replaceChildren(errorView('Could not load home', e.message));
    return;
  }
  if (seq !== routeSeq) return;
  if (!Array.isArray(rows)) rows = [];

  if (rows.length === 0) {
    app.replaceChildren(
      h('div', { class: 'view-head' }, h('h1', {}, 'Home')),
      requestsStripEl([]),
      h('div', { class: 'empty' },
        h('div', { class: 'empty-glyphs' },
          h('span', { class: 'sev-blocker' }, '◆'), ' ',
          h('span', { class: 'sev-major' }, '▲'), ' ',
          h('span', { class: 'sev-minor' }, '●'), ' ',
          h('span', { class: 'sev-info' }, '○')),
        h('h2', {}, 'Nothing in the cockpit yet'),
        h('p', {}, 'Seed the demo with ', h('code', {}, 'node src/cli.js demo'),
          ', or run ', h('code', {}, '/lever:audit'), ', ', h('code', {}, '/pr-review'),
          ' or ', h('code', {}, '/pr-respond'), ' from Claude Code.')));
    startHomeRequestsPoll();
    return;
  }

  const actionable = rows.filter((r) => needsYouBits(r.counts).length).length;
  app.replaceChildren(
    h('div', { class: 'view-head' },
      h('h1', {}, 'Home'),
      h('p', { class: 'view-sub' }, actionable
        ? `${plural(actionable, 'workspace', 'workspaces')} need you · ${plural(rows.length, 'workspace', 'workspaces')} total`
        : `All caught up · ${plural(rows.length, 'workspace', 'workspaces')} under watch`)),
    requestsStripEl([]),
    h('div', { class: 'inbox' }, rows.map(inboxRow)),
  );
  startHomeRequestsPoll();
}

/* Home shows the active jobs (queued/running, plus errors awaiting attention);
 * done jobs drop off once their workspace appears in the inbox below. When a job
 * completes, refresh the inbox so the new workspace surfaces. */
function startHomeRequestsPoll() {
  let lastDone = new Set();
  startPolling('home', (reqs) => {
    if (current.view !== 'home') return;
    const active = reqs.filter((r) => r.status !== 'done');
    populateRequestsStrip($('#requests-strip'), active, null);
    const doneIds = new Set(reqs.filter((r) => r.status === 'done').map((r) => r.id));
    let newlyDone = false;
    doneIds.forEach((id) => { if (!lastDone.has(id)) newlyDone = true; });
    const first = lastDone.size === 0;
    lastDone = doneIds;
    if (newlyDone && !first) renderHome();
  });
}

/* ============================== kind sections (features grid) ============================== */

const SECTION_COPY = {
  spec: { sub: 'Readiness across all linked specs, work items and designs' },
  'pr-review': { sub: 'Pull requests you are reviewing' },
  'pr-respond': { sub: 'Reviewer threads on your own pull requests' },
};

function sectionHead(kind, count) {
  const m = kindMeta(kind);
  const copy = SECTION_COPY[kind] || SECTION_COPY.spec;
  return h('div', { class: 'view-head' },
    h('h1', {}, m.label),
    h('p', { class: 'view-sub' }, count != null
      ? `${plural(count, 'workspace', 'workspaces')} under watch`
      : copy.sub));
}

function sectionEmpty(kind) {
  if (kind === 'spec') {
    return h('div', { class: 'empty' },
      h('div', { class: 'empty-glyphs' },
        h('span', { class: 'sev-blocker' }, '◆'), ' ',
        h('span', { class: 'sev-major' }, '▲'), ' ',
        h('span', { class: 'sev-minor' }, '●'), ' ',
        h('span', { class: 'sev-info' }, '○')),
      h('h2', {}, 'No spec audits yet'),
      h('p', {}, 'Seed a demo workspace with ', h('code', {}, 'node src/cli.js demo'),
        ' or run ', h('code', {}, '/lever:audit'), ' from a Claude Code session.'));
  }
  const cmd = kind === 'pr-review' ? '/pr-review <id>' : '/pr-respond <id>';
  const what = kind === 'pr-review'
    ? "a pull request's diff into the cockpit so you can review it"
    : 'the reviewer threads on your PR so you can respond to them';
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon', html: ICONS[kindMeta(kind).icon] || '' }),
    h('h2', {}, `No ${kindMeta(kind).label.toLowerCase()} workspaces yet`),
    h('p', {}, 'Run ', h('code', {}, cmd), ' in Claude Code to pull ', what, '. ',
      'It rides the same review stepper as everything else — those adapters land in a later phase.'));
}

async function renderSection(kind) {
  current.view = 'section'; current.id = null; current.tab = null; current.kind = kind;
  const seq = ++routeSeq;
  const app = $('#app');
  app.replaceChildren(
    sectionHead(kind),
    h('div', { class: 'features-grid' }, Array.from({ length: 3 }, () => skel('skel-card'))),
  );
  let features;
  try {
    features = await api(`/api/features?kind=${encodeURIComponent(kind)}`);
  } catch (e) {
    if (seq !== routeSeq) return;
    toast(`Could not load ${kind}: ${e.message}`);
    app.replaceChildren(errorView(`Could not load ${kindMeta(kind).label}`, e.message));
    return;
  }
  if (seq !== routeSeq) return;
  if (!Array.isArray(features)) features = [];

  const isPr = kind === 'pr-review' || kind === 'pr-respond';
  const gridZone = h('div', { id: 'features-grid-zone' },
    features.length ? h('div', { class: 'features-grid' }, features.map(featureCard)) : sectionEmpty(kind));

  app.replaceChildren(...[
    sectionHead(kind, features.length || null),
    isPr ? newRequestZone(kind) : null,
    isPr ? requestsStripEl([]) : null,
    gridZone,
  ].filter(Boolean));

  if (isPr) startSectionRequestsPoll(kind);
}

/* Poll requests for a PR section: keep the strip in sync, and when a job newly
 * completes, refresh the features grid so the runner's new workspace card shows. */
function startSectionRequestsPoll(kind) {
  let lastDone = new Set();
  startPolling(`section:${kind}`, (reqs) => {
    if (current.view !== 'section' || current.kind !== kind) return;
    const rel = reqs.filter((r) => r.action === kind);
    populateRequestsStrip($('#requests-strip'), rel,
      `No ${REQ_ACTION_LABEL[kind].toLowerCase()} jobs yet — “+ New ${REQ_ACTION_LABEL[kind]}” enqueues one for the runner.`);
    const doneIds = new Set(rel.filter((r) => r.status === 'done').map((r) => r.id));
    let newlyDone = false;
    doneIds.forEach((id) => { if (!lastDone.has(id)) newlyDone = true; });
    lastDone = doneIds;
    if (newlyDone) refreshSectionGrid(kind);
  });
}

async function refreshSectionGrid(kind) {
  let features;
  try { features = await api(`/api/features?kind=${encodeURIComponent(kind)}`); } catch { return; }
  if (current.view !== 'section' || current.kind !== kind) return;
  const zone = $('#features-grid-zone');
  if (!zone) return;
  if (!Array.isArray(features)) features = [];
  zone.replaceChildren(features.length
    ? h('div', { class: 'features-grid' }, features.map(featureCard))
    : sectionEmpty(kind));
}

function summaryReadiness(f) {
  if (f.readiness) return f.readiness;
  // tolerate flattened summaries
  return { score: f.score ?? 0, gate: f.gate ?? 'in-progress', openBySeverity: f.openBySeverity || {} };
}

function sourcesLineText(f) {
  const s = f.sources;
  let c;
  if (s && (Array.isArray(s.confluence) || Array.isArray(s.ado) || Array.isArray(s.figma))) {
    c = { confluence: (s.confluence || []).length, ado: (s.ado || []).length, figma: (s.figma || []).length };
  } else if (f.sourceCounts) {
    c = f.sourceCounts;
  } else if (s && typeof s.confluence === 'number') {
    c = s;
  }
  if (!c) return null;
  const parts = [];
  if (c.confluence) parts.push(plural(c.confluence, 'spec', 'specs'));
  if (c.ado) parts.push(plural(c.ado, 'work item', 'work items'));
  if (c.figma) parts.push(plural(c.figma, 'design', 'designs'));
  return parts.length ? parts.join(' · ') : 'no sources';
}

function lastRoundDate(f) {
  const at = f.lastRoundAt
    || (f.lastRound && f.lastRound.at)
    || (Array.isArray(f.rounds) && f.rounds.length ? f.rounds[f.rounds.length - 1].at : null);
  return fmtDate(at);
}

function featureCard(f) {
  const r = summaryReadiness(f);
  const kind = f.kind || 'spec';
  const metaBits = [];
  // PR workspaces don't carry Confluence/ADO/Figma sources — skip the sources line.
  if (kind === 'spec') {
    const src = sourcesLineText(f);
    if (src) metaBits.push(h('span', {}, src));
  }
  const lr = lastRoundDate(f);
  metaBits.push(h('span', { class: 'meta-dim' }, lr ? `last round ${lr}` : 'no rounds yet'));

  return h('a', { class: 'card feature-card', href: `#/feature/${encodeURIComponent(f.id)}` },
    h('div', { class: 'fc-top' },
      h('div', { class: 'fc-titlewrap' },
        h('div', { class: 'fc-title' }, f.title || f.id),
        h('div', {}, statusChip(f.status)),
      ),
      dialEl(r.score, r.gate, 64, 'dial-sm'),
    ),
    sevCountsRow(r.openBySeverity),
    h('div', { class: 'fc-meta' }, metaBits),
  );
}

/* ============================== UI-triggered job requests ============================== */

/* A request is a job the UI enqueues (POST /api/requests) for the session-side
 * runner skill (/lever:watch) to pick up. We poll GET /api/requests on a ~4s
 * cadence while Home or a PR section is open and reflect the status here. */

const REQ_STATUS = {
  queued:  { glyph: '⏳', label: 'Queued' },
  running: { glyph: '⠿', label: 'Running', spin: true },
  done:    { glyph: '✓', label: 'Done' },
  error:   { glyph: '✗', label: 'Error' },
};
const REQ_ACTION_LABEL = { 'pr-review': 'PR review', 'pr-respond': 'PR respond', apply: 'Post to PR' };

/* One shared poller. `scope` lets a re-render (e.g. the finish screen) reuse the
 * running interval instead of resetting it; `token` invalidates in-flight fetches
 * after stopPolling so a late response can't clobber a newer view. */
const poller = { timer: null, token: 0, scope: null, fn: null };

function stopPolling() {
  if (poller.timer) clearInterval(poller.timer);
  poller.timer = null;
  poller.fn = null;
  poller.scope = null;
  poller.token++;
}

function startPolling(scope, fn) {
  if (poller.scope === scope && poller.timer) { poller.fn = fn; return; }
  stopPolling();
  poller.scope = scope;
  poller.fn = fn;
  const token = poller.token;
  const tick = async () => {
    if (token !== poller.token) return;
    let reqs;
    try { reqs = await api('/api/requests'); } catch { return; /* transient — keep last view */ }
    if (token !== poller.token || !poller.fn) return;
    poller.fn(Array.isArray(reqs) ? reqs : []);
  };
  tick();
  poller.timer = setInterval(tick, 4000);
}

/* Force an out-of-band refresh right after an enqueue, so the queued row shows
 * without waiting for the next interval. */
function pollRequestsNow() {
  const token = poller.token;
  if (!poller.fn) return;
  api('/api/requests')
    .then((reqs) => { if (token === poller.token && poller.fn) poller.fn(Array.isArray(reqs) ? reqs : []); })
    .catch(() => {});
}

function requestTarget(r) {
  if (r.prId) return `PR ${r.prId}`;
  if (r.wsId) return r.wsId;
  return '';
}

/* A single request row: status glyph (spinner while running), action + target,
 * optional title, the live phase while running, and a note (errors) / workspace
 * link (done). When the job is blocked waiting on the user (needsInput) it grows a
 * prominent amber "needs your input" banner carrying the instruction (note). All
 * text escaped. */
function requestRow(r) {
  const meta = REQ_STATUS[r.status] || REQ_STATUS.queued;
  const target = requestTarget(r);
  const linkable = r.status === 'done' && r.wsId;
  const needsInput = !!r.needsInput && (r.status === 'queued' || r.status === 'running');
  // While running, show the live phase next to the state, e.g. "Running · reviewing changes".
  const phaseText = r.status === 'running' && r.phase ? ` · ${r.phase}` : '';
  // The note doubles as the needs-input instruction; when the banner shows it, don't
  // repeat it in the sub line. Otherwise it's an error/progress note.
  const showSubNote = r.note && !needsInput;

  const main = h('div', { class: 'req-main' },
    h('div', { class: 'req-top' },
      h('span', { class: 'req-action' }, REQ_ACTION_LABEL[r.action] || r.action),
      target ? h('span', { class: 'req-target num-line' }, target) : null,
      r.title ? h('span', { class: 'req-title' }, r.title) : null),
    h('div', { class: 'req-sub meta-dim' },
      h('span', { class: `req-statetext req-state-${cssSafe(r.status)}` }, meta.label + phaseText),
      showSubNote ? h('span', { class: 'req-note' }, ` — ${r.note}`) : null,
      linkable ? h('a', { class: 'req-open', href: `#/feature/${encodeURIComponent(r.wsId)}` }, 'open workspace →') : null),
    needsInput
      ? h('div', { class: 'req-needsinput', role: 'alert' },
          h('span', { class: 'req-ni-icon', 'aria-hidden': 'true' }, '⚠'),
          h('div', { class: 'req-ni-body' },
            h('span', { class: 'req-ni-label' }, 'Needs your input'),
            h('span', { class: 'req-ni-note' }, r.note || 'Waiting on you to continue.')))
      : null);
  return h('div', { class: `req-row req-${cssSafe(r.status)} ${needsInput ? 'req-needs' : ''}`.trim() },
    h('span', { class: `req-glyph req-glyph-${cssSafe(r.status)} ${meta.spin ? 'req-spin' : ''}`.trim(),
      'aria-label': meta.label }, meta.glyph),
    main);
}

/* Compact status legend shown above a requests strip so the meanings of
 * Queued / Running / Done / Error (and the needs-input flag) are clear. */
function requestsLegend() {
  const item = (cls, glyph, label, desc) => h('span', { class: 'reqleg-item', title: `${label} — ${desc}` },
    h('span', { class: `reqleg-glyph req-glyph-${cls}` }, glyph),
    h('span', { class: 'reqleg-label' }, label),
    h('span', { class: 'reqleg-desc' }, desc));
  return h('details', { class: 'requests-legend' },
    h('summary', {}, h('span', { class: 'reqleg-q', 'aria-hidden': 'true' }, '?'), 'What do these statuses mean?'),
    h('div', { class: 'reqleg-grid' },
      item('queued', REQ_STATUS.queued.glyph, 'Queued', 'waiting for the runner to pick it up'),
      item('running', REQ_STATUS.running.glyph, 'Running', 'being processed (shows the live phase)'),
      item('done', REQ_STATUS.done.glyph, 'Done', 'finished — workspace ready'),
      item('error', REQ_STATUS.error.glyph, 'Error', 'failed (shows why)'),
      h('span', { class: 'reqleg-item' },
        h('span', { class: 'reqleg-glyph reqleg-ni' }, '⚠'),
        h('span', { class: 'reqleg-label' }, 'Needs your input'),
        h('span', { class: 'reqleg-desc' }, 'blocked on you — e.g. approve a 2FA/auth prompt'))));
}

function requestsStripEl(requests, emptyText) {
  const strip = h('div', { class: 'requests-strip', id: 'requests-strip' });
  populateRequestsStrip(strip, requests, emptyText);
  return strip;
}

function populateRequestsStrip(strip, requests, emptyText) {
  if (!strip) return;
  if (!requests.length) {
    if (emptyText) strip.replaceChildren(h('p', { class: 'meta-dim requests-empty' }, emptyText));
    else strip.replaceChildren();
    return;
  }
  strip.replaceChildren(
    h('div', { class: 'requests-head' },
      h('span', { class: 'f-suglabel' }, plural(requests.length, 'job', 'jobs')),
      requestsLegend()),
    h('div', { class: 'requests-list' }, requests.map(requestRow)));
}

/* The "+ New PR review/respond" entry: a button that swaps in an inline form
 * (PR id + optional title) and POSTs a request, then resets. */
function newRequestZone(kind) {
  const actionLabel = REQ_ACTION_LABEL[kind] || kind;
  const zone = h('div', { class: 'new-request-zone', id: 'new-request-zone' });
  const showButton = () => zone.replaceChildren(h('button', {
    class: 'btn btn-accent nr-add', type: 'button', onclick: showForm,
  }, `+ New ${actionLabel}`));
  function showForm() {
    zone.replaceChildren(newRequestForm(kind, showButton));
    const inp = zone.querySelector('.nr-prid');
    if (inp) requestAnimationFrame(() => inp.focus());
  }
  showButton();
  return zone;
}

function newRequestForm(kind, onClose) {
  const actionLabel = REQ_ACTION_LABEL[kind] || kind;
  const prInput = h('input', {
    class: 'nr-prid', type: 'text', placeholder: 'PR id (e.g. 1481)', 'aria-label': 'PR id',
    onkeydown: (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose(); },
  });
  const titleInput = h('input', {
    class: 'nr-title', type: 'text', placeholder: 'Title (optional)', 'aria-label': 'Title',
    onkeydown: (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose(); },
  });
  async function submit() {
    const prId = prInput.value.trim();
    if (!prId) { prInput.classList.add('invalid'); prInput.focus(); return; }
    try {
      await api('/api/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: kind, prId, title: titleInput.value.trim() || undefined }),
      });
      toast(`Queued ${actionLabel} for PR ${prId}`, 'success');
      onClose();
      pollRequestsNow();
    } catch (e) {
      toast(`Could not queue: ${e.message}`);
    }
  }
  return h('div', { class: 'nr-form' },
    prInput, titleInput,
    h('button', { class: 'btn btn-accent', type: 'button', onclick: submit }, `Queue ${actionLabel}`),
    h('button', { class: 'btn', type: 'button', onclick: onClose }, 'Cancel'));
}

/* ============================== detail: load + shell ============================== */

async function loadDetail(id, force = false) {
  if (!force && state.detailId === id && state.detail) return state.detail;
  if (state.detailId !== id) {
    state.filters = { dims: new Set(), sevs: new Set(), status: 'all', q: '', draft: false };
    state.waiving = null;
    state.editingHunk = null;
    state.modalFp = null;
    state.modalMode = 'detail';
    state.modalTrigger = null;
    state.exportFp = null;
    state.exportAll = false;
    state.report = { id: null, md: null };
  }
  const data = await api(`/api/features/${encodeURIComponent(id)}`);
  state.detailId = id;
  state.detail = data;
  return data;
}

async function renderDetail(id, tab) {
  current.view = 'detail'; current.id = id; current.tab = tab;
  const seq = ++routeSeq;
  const app = $('#app');
  const cached = state.detailId === id && state.detail;
  if (!cached) app.replaceChildren(detailSkeleton());
  let data;
  try {
    data = await loadDetail(id);
  } catch (e) {
    if (seq !== routeSeq) return;
    toast(`Could not load feature: ${e.message}`);
    app.replaceChildren(errorView(`Could not load “${id}”`, e.message));
    return;
  }
  if (seq !== routeSeq) return;
  app.replaceChildren(detailView(data, tab));
  if (tab === 'report') loadReportInto(id, seq);
}

function rerenderDetail() {
  if (current.view !== 'detail' || !state.detail) return;
  $('#app').replaceChildren(detailView(state.detail, current.tab));
  if (current.tab === 'report') loadReportInto(current.id, routeSeq);
}

function detailSkeleton() {
  return h('div', { class: 'detail' },
    h('div', { class: 'detail-head' },
      h('div', { class: 'dh-left' }, skel('skel-line w-120'), skel('skel-title'), skel('skel-line w-200')),
      skel('skel-dial'),
    ),
    skel('skel-strip'),
    h('div', { class: 'board' }, Array.from({ length: 4 }, () => skel('skel-col'))),
  );
}

function errorView(title, msg) {
  return h('div', { class: 'empty' },
    h('h2', {}, title),
    h('p', { class: 'meta-dim' }, msg),
    h('p', {}, h('a', { class: 'backlink', href: '#/' }, '← Back to overview')),
  );
}

function detailView(data, tab) {
  const feature = data.feature || {};
  const r = data.readiness || computeReadiness((data.ledger && data.ledger.findings) || []);
  const o = r.openBySeverity || {};
  const totalOpen = SEV_ORDER.reduce((n, s) => n + (o[s] ?? 0), 0);
  const blockers = o.blocker ?? 0;

  const tabs = ['findings', 'coverage', 'timeline', 'report'];
  const tabLabels = { findings: 'All findings', coverage: 'Coverage', timeline: 'Timeline', report: 'Report' };

  const kind = feature.kind || 'spec';
  const km = kindMeta(kind);
  return h('div', { class: 'detail' },
    h('div', { class: 'detail-head' },
      h('div', { class: 'dh-left' },
        h('a', { class: 'backlink', href: km.section }, `← ${km.label}`),
        h('div', { class: 'dh-titlerow' },
          h('h1', {}, feature.title || feature.id || current.id),
          kindBadge(kind),
          statusChip(feature.status),
        ),
        h('div', { class: 'dh-sub meta-dim' },
          feature.id ? h('code', { class: 'feature-id' }, feature.id) : null,
        ),
      ),
      h('div', { class: 'dh-right' },
        dialEl(r.score, r.gate, 96, 'dial-lg'),
        h('div', { class: 'dh-gate' },
          gateBadge(r.gate),
          h('div', { class: `dh-blocking ${blockers > 0 ? 'hot' : ''}` },
            blockers > 0 ? `${plural(blockers, 'blocker', 'blockers')} blocking` : 'nothing blocking'),
          h('div', { class: 'meta-dim num-line' }, `${totalOpen} open total`),
        ),
      ),
    ),
    loopStrip(loopActiveStage(data), reviewCta(data)),
    sourcesStrip(feature),
    h('nav', { class: 'tabs', role: 'tablist' },
      tabs.map((t) => h('a', {
        class: `tab ${t === tab ? 'active' : ''}`,
        role: 'tab',
        'aria-selected': t === tab ? 'true' : 'false',
        href: `#/feature/${encodeURIComponent(current.id)}/${t}`,
      }, tabLabels[t]))),
    h('div', { id: 'tab-content', class: 'tab-content' }, tabContent(data, tab)),
  );
}

function tabContent(data, tab) {
  switch (tab) {
    case 'coverage': return coverageView(data);
    case 'timeline': return timelineView(data);
    case 'report':   return reportView();
    default:         return findingsView(data);
  }
}

/* ============================== sources strip ============================== */

function sourcesStrip(feature) {
  const s = feature.sources || {};
  const groups = [
    { key: 'confluence', icon: 'confluence', label: 'Confluence', items: s.confluence || [],
      text: (it) => it.title || it.id || 'page' },
    { key: 'ado', icon: 'ado', label: 'Azure DevOps', items: s.ado || [],
      text: (it) => (it.id != null ? `#${it.id}` : '') + (it.title ? ` ${it.title}` : '') || 'item' },
    { key: 'figma', icon: 'figma', label: 'Figma', items: s.figma || [],
      text: (it) => it.title || it.fileKey || 'frame' },
  ];
  const any = groups.some((g) => g.items.length);
  return h('div', { class: 'sources-strip' },
    h('span', { class: 'src-label' }, 'Sources'),
    !any ? h('span', { class: 'meta-dim' }, 'none linked') :
      groups.filter((g) => g.items.length).map((g) =>
        h('span', { class: 'src-group' },
          g.items.map((it) => {
            const href = safeHref(it.url);
            const inner = [iconSpan(g.icon, `icon src-icon src-${g.key}`),
              h('span', { class: 'src-text' }, g.text(it).trim()),
              href ? iconSpan('link', 'icon src-out') : null];
            return href
              ? h('a', { class: 'src-link', href, target: '_blank', rel: 'noopener noreferrer', title: g.label }, inner)
              : h('span', { class: 'src-link src-nolink', title: g.label }, inner);
          }))),
  );
}

/* ============================== diff engine + renderer ============================== */

const DIFF_MAX_LINES = 600; // cap per side — guards the O(n·m) LCS table on huge inputs

/* Line-level LCS diff. Returns { rows: [{type:'context'|'del'|'add', text}], truncated }.
 * Classic dynamic-programming LCS over lines, then a back-to-front walk to emit rows. */
function lcsDiff(beforeText, afterText) {
  const aAll = String(beforeText ?? '').split('\n');
  const bAll = String(afterText ?? '').split('\n');
  const truncated = aAll.length > DIFF_MAX_LINES || bAll.length > DIFF_MAX_LINES;
  const a = aAll.slice(0, DIFF_MAX_LINES);
  const b = bAll.slice(0, DIFF_MAX_LINES);
  const n = a.length, m = b.length;

  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const rows = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ type: 'context', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: 'del', text: a[i] }); i++; }
    else { rows.push({ type: 'add', text: b[j] }); j++; }
  }
  while (i < n) rows.push({ type: 'del', text: a[i++] });
  while (j < m) rows.push({ type: 'add', text: b[j++] });
  return { rows, truncated };
}

/* Pair unified rows into side-by-side { left, right } rows for the split view:
 * context lines mirror on both sides; a run of dels/adds zips left↔right. */
function toSplitRows(rows) {
  const out = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].type === 'context') { out.push({ left: rows[i], right: rows[i] }); i++; continue; }
    const dels = [], adds = [];
    while (i < rows.length && rows[i].type === 'del') dels.push(rows[i++]);
    while (i < rows.length && rows[i].type === 'add') adds.push(rows[i++]);
    const max = Math.max(dels.length, adds.length);
    for (let k = 0; k < max; k++) out.push({ left: dels[k] || null, right: adds[k] || null });
  }
  return out;
}

const GUTTER = { add: '+', del: '−', context: ' ', empty: '' };

function diffUnified(rows) {
  const t = h('div', { class: 'diff-table diff-unified' });
  for (const r of rows) {
    t.append(h('div', { class: `diff-row diff-${r.type}` },
      h('span', { class: 'diff-gutter' }, GUTTER[r.type] ?? ' '),
      h('span', { class: 'diff-text' }, r.text)));
  }
  return t;
}

function diffSplit(rows) {
  const t = h('div', { class: 'diff-table diff-split' });
  const cell = (cr, side) => {
    const type = cr ? cr.type : 'empty';
    return h('div', { class: `diff-cell diff-cell-${side} diff-${type}` },
      h('span', { class: 'diff-gutter' }, GUTTER[type] ?? ''),
      h('span', { class: 'diff-text' }, cr ? cr.text : ''));
  };
  for (const pair of toSplitRows(rows)) {
    t.append(h('div', { class: 'diff-srow' }, cell(pair.left, 'left'), cell(pair.right, 'right')));
  }
  return t;
}

/* ---- hunk grouping: split the unified diff rows into reviewable hunks.
 * A hunk = a contiguous run of add/del rows plus up to HUNK_CONTEXT lines of
 * surrounding context. Change-runs separated by more than 2·HUNK_CONTEXT context
 * lines become distinct hunks (the gap collapses, GitHub-style). Each hunk gets a
 * stable index id within the finding, so decisions key off it. ---- */
const HUNK_CONTEXT = 3;

function groupHunks(rows) {
  const changed = [];
  for (let i = 0; i < rows.length; i++) if (rows[i].type !== 'context') changed.push(i);
  if (!changed.length) return [];
  const clusters = [];
  let cur = [changed[0]];
  for (let k = 1; k < changed.length; k++) {
    if (changed[k] - cur[cur.length - 1] - 1 <= 2 * HUNK_CONTEXT) cur.push(changed[k]);
    else { clusters.push(cur); cur = [changed[k]]; }
  }
  clusters.push(cur);
  return clusters.map((cl, idx) => {
    const start = Math.max(0, cl[0] - HUNK_CONTEXT);
    const end = Math.min(rows.length - 1, cl[cl.length - 1] + HUNK_CONTEXT);
    const hrows = rows.slice(start, end + 1);
    return {
      id: idx,
      rows: hrows,
      adds: hrows.filter((r) => r.type === 'add'),
      dels: hrows.filter((r) => r.type === 'del'),
    };
  });
}

function hunkAfterText(hunk) { return hunk.adds.map((r) => r.text).join('\n'); }

/* One-line summary of a hunk's proposed change, for the SKIP / UNDECIDED buckets. */
function hunkGist(hunk) {
  const firstAdd = hunk.adds.find((r) => r.text.trim());
  const firstDel = hunk.dels.find((r) => r.text.trim());
  let s;
  if (firstAdd && firstDel) s = `change “${firstDel.text.trim()}” → “${firstAdd.text.trim()}”`;
  else if (firstAdd) s = `add “${firstAdd.text.trim()}”`;
  else if (firstDel) s = `remove “${firstDel.text.trim()}”`;
  else s = '(whitespace-only change)';
  return s.length > 140 ? s.slice(0, 137) + '…' : s;
}

function reviewTally(hunks, review) {
  const t = { accepted: 0, rejected: 0, edited: 0, undecided: 0 };
  for (const hunk of hunks) {
    const dec = review[String(hunk.id)];
    const s = dec && dec.status;
    if (s === 'accepted' || s === 'rejected' || s === 'edited') t[s]++; else t.undecided++;
  }
  return t;
}

function tallyPart(n, label, cls) {
  return h('span', { class: `tally tally-${cls}` }, h('span', { class: 'num' }, String(n)), ' ', label);
}

/* Derive the diff/hunk/review shape for a finding's draft — shared by the
 * compact board trigger and the full-width review modal. */
function draftStats(f) {
  const d = f.draft;
  const { rows, truncated } = lcsDiff(d.before, d.after);
  const adds = rows.reduce((n, r) => n + (r.type === 'add' ? 1 : 0), 0);
  const dels = rows.reduce((n, r) => n + (r.type === 'del' ? 1 : 0), 0);
  const hunks = groupHunks(rows);
  const review = (d.review && d.review.hunks) || {};
  return { rows, truncated, adds, dels, hunks, review };
}

/* Finding-level counter-proposal accessors (verdict drives the override; note is
 * the free-text instruction for the coding agent). Default verdict is 'proposed'. */
function draftVerdict(f) {
  const r = f.draft && f.draft.review;
  return (r && r.verdict) || 'proposed';
}
function draftNote(f) {
  const r = f.draft && f.draft.review;
  return (r && r.note) || '';
}
const VERDICT_LABEL = { proposed: 'Proposed', redirect: '✋ Redirect', reject: '🚫 Reject' };
const VERDICT_GLYPH = { redirect: '✋', reject: '🚫' };

/* A finding counts as reviewed — for the "Export reviewed" count and inclusion —
 * if it has ANY hunk decision OR a non-empty note OR a non-default verdict. */
function isReviewed(f) {
  const r = f.draft && f.draft.review;
  if (!r) return false;
  if (r.hunks && Object.keys(r.hunks).length) return true;
  if (r.note && r.note.trim()) return true;
  if (r.verdict && r.verdict !== 'proposed') return true;
  return false;
}

/* In the finding modal's detail view: a single "Review change" button carrying
 * the ± glyph and +N −M counts. Clicking it switches the modal to its
 * full-width review sub-view (same modal, not a second dialog). */
function reviewTrigger(f) {
  const { adds, dels, hunks, review } = draftStats(f);
  const t = reviewTally(hunks, review);
  const reviewed = t.accepted + t.rejected + t.edited;
  return h('div', { class: 'f-review-trigger' },
    h('button', {
      class: 'btn btn-review', type: 'button',
      onclick: (e) => { e.stopPropagation(); state.modalMode = 'review'; syncModal(); },
    },
      h('span', { class: 'draft-glyph' }, '±'),
      h('span', { class: 'br-label' }, 'Review change'),
      h('span', { class: 'diff-counts' },
        h('span', { class: 'diff-add-n' }, `+${adds}`), ' ',
        h('span', { class: 'diff-del-n' }, `−${dels}`)),
      reviewed
        ? h('span', { class: 'br-progress num' }, `${reviewed}/${hunks.length} reviewed`)
        : null,
    ));
}

/* ---- finding modal: one roomy <dialog> reused for whichever finding is open.
 * It has two sub-views — a "detail" view (everything the inline expansion used
 * to show, with room) and a full-width "review" view (the diff experience).
 * Native showModal() gives us the dimmed backdrop, focus trap and Esc-to-close;
 * we add backdrop-click, body-scroll lock and focus restore on top. ---- */

function findFinding(fp) {
  const findings = (state.detail && state.detail.ledger && state.detail.ledger.findings) || [];
  return findings.find((x) => x.fp === fp) || null;
}

function ensureModal() {
  let dlg = document.getElementById('finding-modal');
  if (dlg) return dlg;
  dlg = h('dialog', {
    id: 'finding-modal', class: 'finding-modal',
    'aria-modal': 'true', role: 'dialog', 'aria-label': 'Finding detail',
    // a click whose target is the dialog box itself landed on the backdrop
    onclick: (e) => { if (e.target === dlg) closeModal(); },
    onclose: onModalClosed,
  });
  document.body.append(dlg);
  return dlg;
}

function openModal(fp, trigger) {
  const f = findFinding(fp);
  if (!f) return;
  state.modalFp = fp;
  state.modalMode = 'detail';
  state.modalTrigger = trigger || null;
  state.waiving = null;
  state.editingHunk = null;
  state.exportFp = null;
  const dlg = ensureModal();
  renderModalContent(dlg, f);
  document.body.classList.add('modal-open');
  if (!dlg.open) dlg.showModal();
}

function closeModal() {
  const dlg = document.getElementById('finding-modal');
  if (dlg && dlg.open) dlg.close();   // fires 'close' → onModalClosed
  else onModalClosed();
}

function onModalClosed() {
  const trigger = state.modalTrigger;
  state.modalFp = null;
  state.modalMode = 'detail';   // reopening returns to the detail view by default
  state.modalTrigger = null;
  state.waiving = null;
  state.editingHunk = null;
  state.exportFp = null;
  document.body.classList.remove('modal-open');
  renderBoard();
  if (trigger && document.contains(trigger)) requestAnimationFrame(() => trigger.focus());
}

/* After any state change: keep the board fresh and, if the modal is open,
 * re-render its contents (closing it if the finding vanished entirely). */
function refreshModal() {
  renderBoard();
  syncModal();
  if (state.flow.active) renderFlowInto();   // the stepper reuses the same review widgets
}

function syncModal() {
  if (!state.modalFp) return;
  const dlg = document.getElementById('finding-modal');
  if (!dlg || !dlg.open) return;
  const f = findFinding(state.modalFp);
  if (!f) { closeModal(); return; }   // finding gone — nothing to show
  renderModalContent(dlg, f);
}

/* Dispatch to whichever sub-view is active. The review view only exists while
 * the finding still has a draft; otherwise we fall back to the detail view
 * (e.g. after the draft is discarded from inside the review view). */
function renderModalContent(dlg, f) {
  const reviewMode = state.modalMode === 'review' && !!f.draft;
  dlg.classList.toggle('modal-review', reviewMode);
  dlg.setAttribute('aria-label', reviewMode ? 'Review proposed change' : 'Finding detail');
  dlg.replaceChildren(reviewMode ? reviewFrame(f) : detailFrame(f));
}

/* The detail sub-view: header (severity · title · tags · status · close) and a
 * roomy body holding what the inline card expansion used to show. */
function detailFrame(f) {
  const sev = SEV[f.severity] ? f.severity : 'info';
  const badge = findingBadge(f, currentRoundNum());
  const header = h('header', { class: 'fm-head' },
    h('div', { class: 'fm-head-main' },
      h('div', { class: 'fm-titlerow' },
        h('span', { class: `sev-glyph sev-${sev}`, title: SEV[sev].label }, SEV[sev].glyph),
        h('h2', { class: 'rm-title' }, f.title || '(untitled finding)'),
        f.pinned ? iconSpan('pin', 'icon f-pin') : null,
      ),
      h('div', { class: 'fm-tags' },
        f.dimension ? h('span', { class: 'dim-tag' }, f.dimension) : null,
        badge ? h('span', { class: `f-badge f-badge-${badge}` }, badge === 'new' ? 'NEW' : 'REGRESSED') : null,
        statusChip(f.status),
        verdictChip(f),
        f.locus ? h('code', { class: 'f-locus' }, f.locus) : null,
      ),
    ),
    h('button', { class: 'rm-close', type: 'button', 'aria-label': 'Close',
      onclick: () => closeModal() }, '×'),
  );
  return h('div', { class: 'rm-frame' },
    header,
    h('div', { class: 'rm-body' }, findingBody(f)),
  );
}

/* The full-width review sub-view: header (← Back · title · target · format ·
 * counts · Unified/Split · close), scrolling diff body with per-hunk controls +
 * tally, and footer (Export decisions + Discard). Reuses the existing
 * hunk/export render functions — this is presentation, not new diff logic. */
/* Shared review body: the finding-level note/verdict control, the hunk tally,
 * each reviewable hunk, and a truncation note. Used by both the modal review
 * sub-view and the guided stepper so they stay pixel-identical. */
function reviewBodyKids(f) {
  const { hunks, review, truncated } = draftStats(f);
  const kids = [reviewNoteSection(f)];
  if (!hunks.length) {
    kids.push(h('div', { class: 'diff-table diff-nochange' },
      h('div', { class: 'diff-empty-note' }, 'No changes — proposed text is identical to the current text.')));
  } else {
    const t = reviewTally(hunks, review);
    kids.push(h('div', { class: 'hunk-tally' },
      tallyPart(t.accepted, 'accepted', 'accepted'),
      tallyPart(t.rejected, 'rejected', 'rejected'),
      tallyPart(t.edited, 'edited', 'edited'),
      tallyPart(t.undecided, 'undecided', 'undecided'),
    ));
    for (const hunk of hunks) kids.push(hunkEl(f, hunk, review[String(hunk.id)]));
  }
  if (truncated) kids.push(h('div', { class: 'diff-trunc' }, `Diff truncated to ${DIFF_MAX_LINES} lines per side.`));
  return kids;
}

function reviewFrame(f) {
  const d = f.draft;
  const { adds, dels, hunks, review, truncated } = draftStats(f);

  const mkTab = (mode, label) => h('button', {
    class: `diff-tab ${state.diffMode === mode ? 'active' : ''}`,
    type: 'button', 'aria-label': `${label} diff`,
    onclick: () => { state.diffMode = mode === 'split' ? 'split' : 'unified'; refreshModal(); },
  }, label);

  const header = h('header', { class: 'rm-head' },
    h('div', { class: 'rm-head-main' },
      h('button', { class: 'btn rm-back', type: 'button',
        onclick: () => { state.modalMode = 'detail'; state.editingHunk = null; state.exportFp = null; syncModal(); } },
        '← Back'),
      h('h2', { class: 'rm-title' }, f.title || '(untitled finding)'),
      h('div', { class: 'rm-headmeta' },
        h('code', { class: 'diff-target' }, d.target || f.locus || '—'),
        d.format ? h('span', { class: 'diff-fmt' }, d.format) : null,
        h('span', { class: 'diff-counts' },
          h('span', { class: 'diff-add-n' }, `+${adds}`), ' ',
          h('span', { class: 'diff-del-n' }, `−${dels}`)),
      ),
    ),
    h('div', { class: 'rm-head-right' },
      hunks.length ? h('div', { class: 'diff-toggle', role: 'group', 'aria-label': 'Diff view mode' },
        mkTab('unified', 'Unified'), mkTab('split', 'Split')) : null,
      h('button', { class: 'rm-close', type: 'button', 'aria-label': 'Close review',
        onclick: () => closeModal() }, '×'),
    ),
  );

  const verdict = draftVerdict(f);
  const bodyKids = reviewBodyKids(f);

  const exportOpen = state.exportFp === f.fp;
  const footer = h('footer', { class: 'rm-foot' },
    hunks.length ? h('button', {
      class: `btn ${exportOpen ? 'btn-accent' : ''}`, type: 'button',
      onclick: () => { state.exportFp = exportOpen ? null : f.fp; refreshModal(); },
    }, exportOpen ? 'Hide export' : 'Export decisions') : null,
    h('button', { class: 'btn btn-danger', type: 'button',
      onclick: () => discardDraft(f.fp) }, 'Discard draft'),
  );

  const banner = verdict !== 'proposed'
    ? h('div', { class: `rm-verdict-banner verdict-${verdict}` },
        h('span', { class: 'verdict-glyph' }, VERDICT_GLYPH[verdict]),
        verdict === 'reject'
          ? 'Rejected — the proposed change below is overridden by your note; the agent will not apply it.'
          : 'Redirect — the proposed change below is superseded; the agent will follow your note instead.')
    : null;

  return h('div', { class: `rm-frame ${verdict !== 'proposed' ? `rm-frame-${verdict}` : ''}`.trim() },
    header,
    banner,
    h('div', { class: 'rm-body' }, bodyKids),
    exportOpen ? h('div', { class: 'rm-export' }, exportPanel(state.detail && state.detail.feature, [f], 'finding')) : null,
    footer,
  );
}

/* Finding-level counter-proposal: a compact verdict control (Proposed · Redirect ·
 * Reject) plus a free-text note to the coding agent. Both are FINDING-level (not
 * per-hunk). The note persists debounced on input + on blur WITHOUT re-rendering
 * (so the textarea keeps focus); the verdict persists on click and re-renders so
 * the banner / board marker update. */
function reviewNoteSection(f) {
  const stop = (e) => e.stopPropagation();
  const verdict = draftVerdict(f);

  const mkV = (val) => h('button', {
    class: `btn verdict-btn verdict-btn-${val} ${verdict === val ? 'active' : ''}`,
    type: 'button',
    'aria-pressed': verdict === val ? 'true' : 'false',
    title: val === 'redirect' ? 'Do it differently / elsewhere — see note'
      : val === 'reject' ? "Don't apply this at all" : 'Apply the proposed change',
    onclick: (e) => { e.stopPropagation(); setVerdict(f.fp, val); },
  }, VERDICT_LABEL[val]);

  const saved = h('span', { class: 'note-saved', 'aria-live': 'polite' },
    draftNote(f).trim() ? 'saved' : '');
  let timer = null;
  const ta = h('textarea', {
    class: 'review-note-ta', rows: '3', spellcheck: 'true',
    'aria-label': 'Note to the agent / counter-proposal',
    placeholder: "Wrong target? Reject and say where/how it should be done instead — e.g. 'these belong in systemProperties, not the component-fields table'.",
    onclick: stop,
    onkeydown: (e) => e.stopPropagation(),
    oninput: () => { saved.textContent = ''; if (timer) clearTimeout(timer); timer = setTimeout(commit, 600); },
    onblur: () => { if (timer) { clearTimeout(timer); timer = null; } commit(); },
  });
  ta.value = draftNote(f);

  let lastSaved = ta.value;
  async function commit() {
    const val = ta.value;
    if (val === lastSaved) { if (val.trim()) saved.textContent = 'saved'; return; }
    lastSaved = val;
    const cur = findFinding(f.fp);
    if (cur && cur.draft) {
      cur.draft.review = { ...(cur.draft.review || {}), hunks: (cur.draft.review && cur.draft.review.hunks) || {}, note: val };
    }
    try {
      await api(`/api/features/${encodeURIComponent(current.id)}/findings/${encodeURIComponent(f.fp)}/draft/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: val }),
      });
      saved.textContent = 'saved';
    } catch (e) {
      saved.textContent = '';
      toast(`Note save failed: ${e.message}`);
    }
  }

  return h('div', { class: 'review-note', onclick: stop },
    h('div', { class: 'review-note-head' },
      h('span', { class: 'f-suglabel' }, 'Note to the agent / counter-proposal'),
      h('div', { class: 'verdict-control', role: 'group', 'aria-label': 'Finding verdict' },
        mkV('proposed'), mkV('redirect'), mkV('reject')),
      saved,
    ),
    ta,
  );
}

/* Optimistic finding-level verdict op: mutate locally, POST { verdict }, re-render
 * so the banner + board marker reflect it. No server reload — keeps it independent
 * of an in-flight note save (the server merges the two fields). */
async function setVerdict(fp, verdict) {
  const f = findFinding(fp);
  if (!f || !f.draft) return;
  const prev = f.draft.review ? structuredClone(f.draft.review) : undefined;
  const cur = f.draft.review || {};
  f.draft.review = { ...cur, hunks: cur.hunks || {}, verdict, updatedAt: new Date().toISOString() };
  refreshModal();
  try {
    await api(`/api/features/${encodeURIComponent(current.id)}/findings/${encodeURIComponent(fp)}/draft/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict }),
    });
  } catch (e) {
    if (prev === undefined) delete f.draft.review; else f.draft.review = prev;
    refreshModal();
    toast(`Verdict update failed: ${e.message}`);
  }
}

/* A single reviewable hunk: its mini diff + decision controls (or the edit form). */
function hunkEl(f, hunk, decision) {
  const status = (decision && decision.status) || 'undecided';
  const editing = state.editingHunk && state.editingHunk.fp === f.fp && state.editingHunk.idx === hunk.id;
  const parts = [
    h('div', { class: 'hunk-diff' }, state.diffMode === 'split' ? diffSplit(hunk.rows) : diffUnified(hunk.rows)),
  ];
  if (editing) {
    parts.push(hunkEditForm(f, hunk, decision));
  } else {
    parts.push(hunkControls(f, hunk, status));
    if (status === 'edited' && decision && typeof decision.editedText === 'string') {
      parts.push(h('div', { class: 'hunk-edited-note' },
        h('span', { class: 'f-suglabel' }, 'applied edit'),
        h('pre', { class: 'hunk-edited-text' }, decision.editedText || '(empty — these lines are removed)')));
    }
  }
  return h('div', { class: `hunk hunk-${status}` }, parts);
}

function hunkControls(f, hunk, status) {
  const mk = (label, target, cls) => h('button', {
    class: `btn hunk-btn ${cls} ${status === target ? 'active' : ''}`,
    type: 'button',
    'aria-pressed': status === target ? 'true' : 'false',
    onclick: (e) => {
      e.stopPropagation();
      if (target === 'edited') { state.editingHunk = { fp: f.fp, idx: hunk.id }; refreshModal(); return; }
      // toggling the active decision clears it back to undecided
      reviewHunk(f.fp, { hunk: hunk.id, status: status === target ? 'undecided' : target });
    },
  }, label);
  return h('div', { class: 'hunk-actions' },
    mk('✅ Accept', 'accepted', 'hunk-accept'),
    mk('❌ Reject', 'rejected', 'hunk-reject'),
    mk('✏️ Edit', 'edited', 'hunk-edit'),
  );
}

function hunkEditForm(f, hunk, decision) {
  const initial = decision && decision.status === 'edited' && typeof decision.editedText === 'string'
    ? decision.editedText : hunkAfterText(hunk);
  const ta = h('textarea', {
    class: 'hunk-edit-ta', spellcheck: 'false',
    rows: String(Math.min(14, Math.max(2, initial.split('\n').length + 1))),
    'aria-label': 'Edited replacement text',
    onclick: (e) => e.stopPropagation(),
    onkeydown: (e) => { e.stopPropagation(); if (e.key === 'Escape') cancel(); },
  });
  ta.value = initial;
  function save() {
    state.editingHunk = null;
    reviewHunk(f.fp, { hunk: hunk.id, status: 'edited', editedText: ta.value });
  }
  function cancel() { state.editingHunk = null; refreshModal(); }
  function reset() { ta.value = hunkAfterText(hunk); ta.focus(); }
  const form = h('div', { class: 'hunk-edit', onclick: (e) => e.stopPropagation() },
    h('div', { class: 'hunk-edit-label meta-dim' }, 'Edit the replacement text, then Save:'),
    ta,
    h('div', { class: 'hunk-edit-actions' },
      h('button', { class: 'btn btn-accent', type: 'button', onclick: (e) => { e.stopPropagation(); save(); } }, 'Save edit'),
      h('button', { class: 'btn', type: 'button', onclick: (e) => { e.stopPropagation(); reset(); } }, 'Reset to proposal'),
      h('button', { class: 'btn', type: 'button', onclick: (e) => { e.stopPropagation(); cancel(); } }, 'Cancel'),
    ));
  requestAnimationFrame(() => ta.focus());
  return form;
}

/* Optimistic per-hunk review op: mutate locally, POST the single-hunk patch,
 * then reconcile from the server (authoritative). */
async function reviewHunk(fp, patch) {
  const d = state.detail;
  if (!d) return;
  const findings = (d.ledger && d.ledger.findings) || [];
  const f = findings.find((x) => x.fp === fp);
  if (!f || !f.draft) return;
  const prev = f.draft.review ? structuredClone(f.draft.review) : undefined;

  const hunks = { ...((f.draft.review && f.draft.review.hunks) || {}) };
  const idx = String(patch.hunk);
  if (patch.status === 'undecided' || patch.status == null) {
    delete hunks[idx];
  } else {
    const entry = { status: patch.status, at: new Date().toISOString() };
    if (patch.status === 'edited') entry.editedText = patch.editedText;
    hunks[idx] = entry;
  }
  f.draft.review = { hunks, updatedAt: new Date().toISOString() };
  refreshModal();

  try {
    await api(`/api/features/${encodeURIComponent(current.id)}/findings/${encodeURIComponent(fp)}/draft/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    await loadDetail(current.id, true); // server state is authoritative
    refreshModal();
  } catch (e) {
    if (prev === undefined) delete f.draft.review; else f.draft.review = prev;
    refreshModal();
    toast(`Review update failed: ${e.message}`);
  }
}

/* ---- export: build a copy-pasteable work order from the review decisions ---- */

function mdBlock(text) {
  const t = String(text);
  if (t === '') return '  - _(empty — remove the shown lines)_';
  if (!t.includes('\n')) return `  - ${t}`;
  return '  -\n    ```\n' + t.split('\n').map((l) => `    ${l}`).join('\n') + '\n    ```';
}

function buildExportMarkdown(feature, findings) {
  const title = (feature && (feature.title || feature.id)) || 'feature';
  const date = new Date().toISOString().slice(0, 10);
  const out = [`## Rework decisions — ${title} (${date})`, ''];

  // One section per reviewed finding/target. The finding-level verdict (redirect /
  // reject) overrides the per-hunk proposal; a plain note rides alongside it.
  let sectionCount = 0;
  for (const f of findings) {
    if (!f.draft) continue;
    const review = f.draft.review || {};
    const verdict = review.verdict || 'proposed';
    const note = (review.note || '').trim();
    const decisions = review.hunks || {};
    const hunks = groupHunks(lcsDiff(f.draft.before, f.draft.after).rows);

    // Skip findings with nothing to say: no hunks, no note, default verdict.
    if (!hunks.length && verdict === 'proposed' && !note) continue;

    const target = (f.draft.target && f.draft.target.trim()) || f.locus || '—';
    out.push(`### ${target}`, '');
    sectionCount++;

    if (verdict === 'reject') {
      // Reviewer rejected the whole proposal — the agent must not apply it.
      out.push(`🚫 DO NOT APPLY — ${note || '(reviewer gave no note)'}`, '');
    } else if (verdict === 'redirect') {
      // Apply differently / elsewhere; show the original proposal as muted context.
      out.push(`✋ APPLY DIFFERENTLY — ${note || '(reviewer gave no note)'}`, '');
      const orig = hunks.map(hunkAfterText).filter((t) => t.trim());
      if (orig.length) {
        out.push('_(original proposal, superseded)_');
        orig.forEach((t) => out.push(mdBlock(t)));
        out.push('');
      }
    } else {
      // Plain proposed: the normal Apply / Edit / Skip / Undecided buckets…
      const g = { accepted: [], edited: [], rejected: [], undecided: [] };
      for (const hunk of hunks) {
        const dec = decisions[String(hunk.id)];
        const status = dec && dec.status;
        if (status === 'accepted') g.accepted.push(hunkAfterText(hunk));
        else if (status === 'edited') g.edited.push(typeof dec.editedText === 'string' ? dec.editedText : hunkAfterText(hunk));
        else if (status === 'rejected') g.rejected.push(hunkGist(hunk));
        else g.undecided.push(hunkGist(hunk));
      }
      if (g.accepted.length) { out.push('✅ APPLY AS PROPOSED'); g.accepted.forEach((t) => out.push(mdBlock(t))); out.push(''); }
      if (g.edited.length) { out.push('✏️ APPLY WITH EDITS'); g.edited.forEach((t) => out.push(mdBlock(t))); out.push(''); }
      if (g.rejected.length) { out.push('❌ SKIP'); g.rejected.forEach((t) => out.push(`  - ${t}`)); out.push(''); }
      if (g.undecided.length) { out.push('⏳ UNDECIDED'); g.undecided.forEach((t) => out.push(`  - ${t}`)); out.push(''); }
      // …plus a free-text note if the reviewer left one.
      if (note) { out.push(`📝 NOTE: ${note}`, ''); }
    }
  }

  if (!sectionCount) { out.push('_No reviewed drafts yet._'); return out.join('\n') + '\n'; }
  return out.join('\n').trimEnd() + '\n';
}

/* readonly textarea (text content ⇒ XSS-safe) + clipboard copy. */
function exportPanel(feature, findings, scope) {
  const md = buildExportMarkdown(feature, findings);
  const ta = h('textarea', {
    class: 'export-md', readonly: true, spellcheck: 'false',
    'aria-label': 'Exported rework decisions work order',
    onclick: (e) => e.stopPropagation(),
  });
  ta.value = md;
  return h('div', { class: `export-panel export-${scope}`, onclick: (e) => e.stopPropagation() },
    h('div', { class: 'export-bar' },
      h('span', { class: 'f-suglabel' }, scope === 'finding' ? 'Work order — this finding' : 'Work order — all reviewed drafts'),
      h('button', { class: 'btn btn-accent', type: 'button',
        onclick: (e) => { e.stopPropagation(); copyExport(md); } }, 'Copy'),
    ),
    ta,
  );
}

async function copyExport(md) {
  try {
    await navigator.clipboard.writeText(md);
    toast('Work order copied', 'success');
  } catch {
    toast('Clipboard unavailable');
  }
}

/* Feature-level panel: a single work order spanning every reviewed draft. */
function featureExportPanel(data) {
  const feature = data.feature || {};
  const findings = ((data.ledger && data.ledger.findings) || []).filter(isReviewed);
  if (!findings.length) {
    return h('div', { class: 'export-panel export-feature' },
      h('div', { class: 'export-bar' }, h('span', { class: 'f-suglabel' }, 'Work order — all reviewed drafts')),
      h('p', { class: 'meta-dim export-empty' }, 'No reviewed drafts yet — accept, reject or edit hunks on a finding first.'));
  }
  return exportPanel(feature, findings, 'feature');
}

/* Optimistic draft discard: drop locally, DELETE, then reconcile from server. */
async function discardDraft(fp) {
  const d = state.detail;
  if (!d) return;
  const findings = (d.ledger && d.ledger.findings) || [];
  const f = findings.find((x) => x.fp === fp);
  if (!f || !f.draft) return;
  const prev = f.draft;
  delete f.draft;
  refreshModal();   // draft gone → review view falls back to the detail view
  try {
    await api(`/api/features/${encodeURIComponent(current.id)}/findings/${encodeURIComponent(fp)}/draft`, {
      method: 'DELETE',
    });
    await loadDetail(current.id, true); // server state is authoritative
    refreshModal();
    toast('Draft discarded', 'success');
  } catch (e) {
    f.draft = prev;
    refreshModal();
    toast(`Discard failed: ${e.message}`);
  }
}

/* ============================== findings tab ============================== */

function findingsView(data) {
  const findings = (data.ledger && data.ledger.findings) || [];
  const dims = [...new Set([...DIMENSIONS, ...findings.map((f) => f.dimension).filter(Boolean)])];
  const fl = state.filters;

  const dimChips = dims.map((d) => h('button', {
    class: `fchip ${fl.dims.has(d) ? 'active' : ''}`,
    type: 'button',
    onclick: (e) => {
      if (fl.dims.has(d)) fl.dims.delete(d); else fl.dims.add(d);
      e.currentTarget.classList.toggle('active');
      renderBoard();
    },
  }, d));

  const sevChips = SEV_ORDER.map((s) => h('button', {
    class: `fchip fchip-sev sev-${s} ${fl.sevs.has(s) ? 'active' : ''}`,
    type: 'button',
    onclick: (e) => {
      if (fl.sevs.has(s)) fl.sevs.delete(s); else fl.sevs.add(s);
      e.currentTarget.classList.toggle('active');
      renderBoard();
    },
  }, h('span', { class: 'sev-glyph' }, SEV[s].glyph), ' ', s));

  const draftPill = h('button', {
    class: `fchip fchip-draft ${fl.draft ? 'active' : ''}`,
    type: 'button',
    title: 'Show only findings with a proposed change',
    onclick: (e) => { fl.draft = !fl.draft; e.currentTarget.classList.toggle('active'); renderBoard(); },
  }, h('span', { class: 'draft-glyph' }, '±'), ' has draft');

  const statusSel = h('select', {
    class: 'fselect',
    'aria-label': 'Filter by status',
    onchange: (e) => { fl.status = e.target.value; renderBoard(); },
  },
    h('option', { value: 'all' }, 'All statuses'),
    STATUS_COLS.map((c) => h('option', { value: c.key, selected: fl.status === c.key }, c.label)));
  statusSel.value = fl.status;

  const search = h('input', {
    id: 'finding-search',
    class: 'fsearch',
    type: 'search',
    placeholder: 'Search findings…  ( / )',
    value: fl.q,
    oninput: (e) => { fl.q = e.target.value; renderBoard(); },
  });

  const reviewedCount = findings.filter(isReviewed).length;
  const exportAllBtn = h('button', {
    class: `fchip fchip-export ${state.exportAll ? 'active' : ''}`,
    type: 'button',
    title: 'Export all reviewed drafts as one agent work order',
    onclick: () => { state.exportAll = !state.exportAll; rerenderDetail(); },
  }, '⬇ Export reviewed', reviewedCount ? h('span', { class: 'fchip-count num' }, String(reviewedCount)) : null);

  const wrap = h('div', { class: 'findings-wrap' },
    h('div', { class: 'filterbar' },
      h('div', { class: 'fgroup' }, h('span', { class: 'fgroup-label' }, 'dimension'), dimChips),
      h('div', { class: 'fgroup' }, h('span', { class: 'fgroup-label' }, 'severity'), sevChips),
      h('div', { class: 'fgroup fgroup-end' }, draftPill, exportAllBtn, statusSel, search),
    ),
    state.exportAll ? featureExportPanel(data) : null,
    h('div', { id: 'board', class: 'board' }),
  );
  buildBoard(wrap.querySelector('#board'), findings);
  return wrap;
}

function matchesFilters(f) {
  const fl = state.filters;
  if (fl.dims.size && !fl.dims.has(f.dimension)) return false;
  if (fl.sevs.size && !fl.sevs.has(f.severity)) return false;
  if (fl.status !== 'all' && f.status !== fl.status) return false;
  if (fl.draft && !f.draft) return false;
  if (fl.q) {
    const q = fl.q.toLowerCase();
    const hay = `${f.title ?? ''} ${f.detail ?? ''} ${f.locus ?? ''} ${f.fp ?? ''} ${f.dimension ?? ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function renderBoard() {
  const board = $('#board');
  if (!board || !state.detail) return;
  buildBoard(board, (state.detail.ledger && state.detail.ledger.findings) || []);
}

function buildBoard(board, findings) {
  const filtered = findings.filter(matchesFilters);
  const sevRank = (s) => { const i = SEV_ORDER.indexOf(s); return i === -1 ? SEV_ORDER.length : i; };
  board.replaceChildren(...STATUS_COLS.map((col) => {
    const items = filtered
      .filter((f) => f.status === col.key)
      .sort((a, b) => sevRank(a.severity) - sevRank(b.severity)
        || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    return h('section', { class: `col col-${col.key}` },
      h('header', { class: 'col-head' },
        h('span', { class: 'col-title' }, col.label),
        h('span', { class: 'col-count num' }, String(items.length))),
      h('div', { class: 'col-body' },
        items.length ? items.map(findingCard) : h('div', { class: 'col-empty' }, '—')),
    );
  }).flat());
}

/* Compact board card: severity glyph, title, dimension tag, locus and a ±
 * indicator when the finding carries a draft. The whole card is a button that
 * opens the finding in the roomy modal — no inline expansion. */
function findingCard(f) {
  const sev = SEV[f.severity] ? f.severity : 'info';
  const open = state.modalFp === f.fp;
  const badge = findingBadge(f, currentRoundNum());
  const card = h('article', {
    class: `finding sevb-${sev} ${open ? 'open' : ''} ${f.pinned ? 'pinned' : ''}`,
    dataset: { fp: f.fp },
    tabindex: '0',
    role: 'button',
    'aria-haspopup': 'dialog',
    onclick: (e) => openModal(f.fp, e.currentTarget),
    onkeydown: (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
        e.preventDefault(); openModal(f.fp, e.currentTarget);
      }
    },
  },
    h('div', { class: 'f-head' },
      h('span', { class: `sev-glyph sev-${sev}`, title: SEV[sev].label }, SEV[sev].glyph),
      h('span', { class: 'f-title' }, f.title || '(untitled finding)'),
      f.pinned ? iconSpan('pin', 'icon f-pin') : null,
    ),
    h('div', { class: 'f-tags' },
      f.dimension ? h('span', { class: 'dim-tag' }, f.dimension) : null,
      badge ? h('span', { class: `f-badge f-badge-${badge}` }, badge === 'new' ? 'NEW' : 'REGRESSED') : null,
      f.draft ? h('span', { class: 'f-draft-chip', title: 'Has a proposed change' }, '±') : null,
      verdictChip(f),
      f.locus ? h('code', { class: 'f-locus' }, f.locus) : null,
    ),
  );
  return card;
}

/* Board / header marker shown when a finding's proposal is overridden by a
 * redirect or reject verdict. Null for the default 'proposed' verdict. */
function verdictChip(f) {
  if (!f.draft) return null;
  const v = draftVerdict(f);
  if (v === 'proposed') return null;
  return h('span', {
    class: `f-verdict-chip f-verdict-${v}`,
    title: v === 'reject' ? 'Rejected — do not apply (see note)' : 'Redirect — apply differently (see note)',
  }, `${VERDICT_GLYPH[v]} ${v === 'reject' ? 'REJECT' : 'REDIRECT'}`);
}

function findingBody(f) {
  const stop = (e) => e.stopPropagation();
  const meta = [];
  meta.push(h('span', {}, 'fp ', h('code', {}, f.fp ?? '?')));
  if (f.firstSeenRound != null) {
    meta.push(h('span', { class: 'num-line' },
      `seen r${f.firstSeenRound}` + (f.lastSeenRound != null && f.lastSeenRound !== f.firstSeenRound ? `–r${f.lastSeenRound}` : '')));
  }
  if (f.resolvedInRound != null) meta.push(h('span', { class: 'num-line' }, `resolved r${f.resolvedInRound}`));
  if (f.status === 'waived' && f.statusReason) meta.push(h('span', { class: 'waive-reason' }, 'waived: ', f.statusReason));

  const history = Array.isArray(f.history) && f.history.length
    ? h('ul', { class: 'f-history' }, f.history.map((ev) =>
        h('li', {},
          h('span', { class: 'meta-dim num-line' }, fmtDateTime(ev.at) || '?'),
          ` ${ev.from ?? '?'} → ${ev.to ?? '?'} `,
          h('span', { class: 'meta-dim' }, `(${ev.by ?? '?'})`),
          ev.note ? h('span', { class: 'hist-note' }, ` — ${ev.note}`) : null)))
    : null;

  return h('div', { class: 'f-body', onclick: stop },
    f.detail ? h('p', { class: 'f-detail' }, f.detail) : null,
    f.suggestion ? h('div', { class: 'f-suggestion' },
      h('span', { class: 'f-suglabel' }, 'suggestion'),
      h('p', {}, f.suggestion)) : null,
    f.draft ? reviewTrigger(f) : null,
    h('div', { class: 'f-meta' }, meta),
    history ? h('div', { class: 'f-histwrap' }, h('span', { class: 'f-suglabel' }, 'history'), history) : null,
    state.waiving === f.fp ? waiveForm(f) : actionsRow(f),
  );
}

function actionsRow(f) {
  const btn = (label, body, cls = '') => h('button', {
    class: `btn ${cls}`.trim(),
    type: 'button',
    onclick: (e) => { e.stopPropagation(); doAction(f.fp, body); },
  }, label);
  const waiveBtn = h('button', {
    class: 'btn',
    type: 'button',
    onclick: (e) => { e.stopPropagation(); state.waiving = f.fp; refreshModal(); },
  }, '→ Waive');

  const out = [];
  if (f.status === 'open') {
    out.push(btn('→ Reworking', { status: 'reworking' }),
      btn('→ Resolved', { status: 'resolved' }, 'btn-good'), waiveBtn);
  } else if (f.status === 'reworking') {
    out.push(btn('→ Resolved', { status: 'resolved' }, 'btn-good'), waiveBtn,
      btn('Reopen', { status: 'open' }));
  } else {
    out.push(btn('Reopen', { status: 'open' }));
  }
  out.push(h('button', {
    class: `btn btn-pin ${f.pinned ? 'active' : ''}`,
    type: 'button',
    title: f.pinned ? 'Unpin (allow auto-resolve)' : 'Pin (never auto-resolve)',
    onclick: (e) => { e.stopPropagation(); doAction(f.fp, { pinned: !f.pinned }); },
  }, iconSpan('pin', 'icon'), ' ', f.pinned ? 'Pinned' : 'Pin'));
  return h('div', { class: 'f-actions' }, out);
}

function waiveForm(f) {
  const input = h('input', {
    class: 'waive-input',
    type: 'text',
    placeholder: 'Reason (required)',
    'aria-label': 'Waive reason',
    onclick: (e) => e.stopPropagation(),
    onkeydown: (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') cancel();
    },
  });
  function submit() {
    const reason = input.value.trim();
    if (!reason) {
      input.classList.add('invalid');
      input.focus();
      return;
    }
    doAction(f.fp, { status: 'waived', reason });
  }
  function cancel() { state.waiving = null; refreshModal(); }
  const form = h('div', { class: 'waive-form', onclick: (e) => e.stopPropagation() },
    input,
    h('button', { class: 'btn btn-accent', type: 'button', onclick: submit }, 'Waive'),
    h('button', { class: 'btn', type: 'button', onclick: cancel }, 'Cancel'),
  );
  requestAnimationFrame(() => input.focus());
  return form;
}

/* Optimistic lifecycle op: mutate locally, POST, then reconcile from server. */
async function doAction(fp, body) {
  const d = state.detail;
  if (!d) return;
  const findings = (d.ledger && d.ledger.findings) || [];
  const f = findings.find((x) => x.fp === fp);
  if (!f) return;
  const prev = { status: f.status, statusReason: f.statusReason, pinned: f.pinned, updatedAt: f.updatedAt };

  if (body.status !== undefined) {
    f.status = body.status;
    f.statusReason = body.reason ?? null;
  }
  if (body.pinned !== undefined) f.pinned = body.pinned;
  f.updatedAt = new Date().toISOString();
  state.waiving = null;
  d.readiness = computeReadiness(findings);
  rerenderDetail();
  syncModal();

  try {
    await api(`/api/features/${encodeURIComponent(current.id)}/findings/${encodeURIComponent(fp)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await loadDetail(current.id, true); // server state is authoritative
    rerenderDetail();
    syncModal();
  } catch (e) {
    Object.assign(f, prev);
    d.readiness = computeReadiness(findings);
    rerenderDetail();
    syncModal();
    toast(`Update failed: ${e.message}`);
  }
}

/* ============================== coverage tab ============================== */

function coverageView(data) {
  const feature = data.feature || {};
  const sections = feature.specSections || [];
  const coverage = feature.coverage || [];
  if (!sections.length && !coverage.length) {
    return h('div', { class: 'empty empty-tab' },
      h('h2', {}, 'No coverage data yet'),
      h('p', {}, 'Coverage is filled in by an audit round (', h('code', {}, '/lever:audit'),
        ') or via ', h('code', {}, 'coverage set'), '.'));
  }

  const sources = feature.sources || {};
  const adoById = new Map((sources.ado || []).map((it) => [String(it.id), it]));
  const figmaByNode = new Map((sources.figma || []).map((it) => [String(it.nodeId), it]));

  const adoChip = (id) => {
    const src = adoById.get(String(id));
    const href = src ? safeHref(src.url) : null;
    const label = `#${id}`;
    const title = src && src.title ? src.title : undefined;
    return href
      ? h('a', { class: 'mchip mchip-ado', href, target: '_blank', rel: 'noopener noreferrer', title }, label)
      : h('span', { class: 'mchip mchip-ado', title }, label);
  };
  const figmaChip = (nodeId) => {
    const src = figmaByNode.get(String(nodeId));
    const href = src ? safeHref(src.url) : null;
    const label = src && src.title ? src.title : String(nodeId);
    return href
      ? h('a', { class: 'mchip mchip-figma', href, target: '_blank', rel: 'noopener noreferrer' }, label)
      : h('span', { class: 'mchip mchip-figma' }, label);
  };
  const statusCell = (status) => {
    const s = ['covered', 'partial', 'uncovered', 'orphan'].includes(status) ? status : 'uncovered';
    return h('span', { class: `cov-status cov-${s}` }, h('span', { class: 'cov-dot' }), s);
  };

  const covBySection = new Map(coverage.filter((c) => c.sectionKey).map((c) => [c.sectionKey, c]));
  const rows = sections.map((sec) => {
    const entry = covBySection.get(sec.key);
    return h('tr', {},
      h('td', { class: 'cov-section' }, sec.title || sec.key),
      h('td', {}, h('div', { class: 'chiprow' },
        entry && entry.adoIds && entry.adoIds.length ? entry.adoIds.map(adoChip) : h('span', { class: 'meta-dim' }, '—'))),
      h('td', {}, h('div', { class: 'chiprow' },
        entry && entry.figmaNodeIds && entry.figmaNodeIds.length ? entry.figmaNodeIds.map(figmaChip) : h('span', { class: 'meta-dim' }, '—'))),
      h('td', {}, statusCell(entry ? entry.status : 'uncovered')),
    );
  });

  // orphans: explicit orphan entries + sources never referenced by a section row
  const referencedAdo = new Set();
  const referencedFigma = new Set();
  for (const c of coverage) {
    if (c.status === 'orphan' || !c.sectionKey) continue;
    (c.adoIds || []).forEach((id) => referencedAdo.add(String(id)));
    (c.figmaNodeIds || []).forEach((n) => referencedFigma.add(String(n)));
  }
  const orphanAdo = new Set();
  const orphanFigma = new Set();
  for (const c of coverage) {
    if (c.status !== 'orphan' && c.sectionKey) continue;
    (c.adoIds || []).forEach((id) => orphanAdo.add(String(id)));
    (c.figmaNodeIds || []).forEach((n) => orphanFigma.add(String(n)));
  }
  for (const it of sources.ado || []) {
    if (!referencedAdo.has(String(it.id))) orphanAdo.add(String(it.id));
  }
  for (const it of sources.figma || []) {
    if (!referencedFigma.has(String(it.nodeId))) orphanFigma.add(String(it.nodeId));
  }

  const orphanBlock = (orphanAdo.size || orphanFigma.size)
    ? h('div', { class: 'orphans' },
        h('h3', {}, 'Unmapped work items / designs'),
        h('div', { class: 'chiprow' },
          [...orphanAdo].map(adoChip),
          [...orphanFigma].map(figmaChip)))
    : null;

  return h('div', { class: 'coverage' },
    h('table', { class: 'cov-table' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Section'), h('th', {}, 'ADO items'), h('th', {}, 'Figma frames'), h('th', {}, 'Status'))),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: '4', class: 'meta-dim' }, 'No spec sections extracted'))),
    ),
    orphanBlock,
  );
}

/* ============================== timeline tab ============================== */

function discFindingList(label, findings, cls) {
  if (!findings.length) return null;
  return h('div', { class: `disc-section ${cls}` },
    h('div', { class: 'disc-label' }, label),
    h('ul', { class: 'disc-list' },
      findings.map((f) => {
        const sev = SEV[f.severity] ? f.severity : 'info';
        return h('li', { class: 'disc-item' },
          h('span', { class: `sev-glyph sev-${sev}` }, SEV[sev].glyph),
          ' ',
          f.title || '(untitled)');
      })));
}

function timelineView(data) {
  const rounds = ((data.rounds && data.rounds.rounds) || []).slice().sort((a, b) => (b.n ?? 0) - (a.n ?? 0));
  if (!rounds.length) {
    return h('div', { class: 'empty empty-tab' },
      h('h2', {}, 'No audit rounds yet'),
      h('p', {}, 'Run ', h('code', {}, '/lever:audit'), ' to start the ledger.'));
  }
  const allFindings = (data.ledger && data.ledger.findings) || [];
  const byN = new Map(rounds.map((r) => [r.n, r]));
  return h('ol', { class: 'timeline' }, rounds.map((r) => {
    const stats = r.stats || {};
    const rd = r.readiness || {};
    const prev = byN.get((r.n ?? 0) - 1);
    const prevScore = prev && prev.readiness ? prev.readiness.score : null;
    const delta = (prevScore != null && rd.score != null) ? rd.score - prevScore : null;

    const pills = [
      h('span', { class: 'pill pill-new num-line' }, `+${stats.new ?? 0} new`),
      h('span', { class: 'pill pill-resolved num-line' },
        `✓ ${plural(stats.autoResolved ?? 0, 'auto-resolved', 'auto-resolved')}`),
    ];
    if ((stats.regressions ?? 0) > 0) {
      pills.push(h('span', { class: 'pill pill-regress num-line' },
        `⚠︎ ${plural(stats.regressions, 'regression', 'regressions')}`));
    }
    pills.push(h('span', { class: 'pill pill-open num-line' },
      `${plural(stats.totalOpen ?? 0, 'open after', 'open after')}`));

    const scorePill = h('span', { class: 'pill pill-score num-line' },
      `score ${rd.score ?? '?'}`,
      delta == null || delta === 0
        ? h('span', { class: 'delta delta-flat' }, ' —')
        : h('span', { class: `delta ${delta > 0 ? 'delta-up' : 'delta-down'}` },
            ` ${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}`));
    pills.push(scorePill);

    const { newF, autoResolved, regressed } = deriveRoundFindings(allFindings, r.n);
    const unknownRegressions = (stats.regressions ?? 0) - regressed.length;
    const hasDisc = newF.length || autoResolved.length || regressed.length || unknownRegressions > 0;

    const disc = hasDisc ? h('details', { class: 'round-disc' },
      h('summary', { class: 'round-disc-sum' }, 'Findings breakdown'),
      discFindingList('+ New', newF, 'disc-new'),
      discFindingList('✓ Auto-resolved', autoResolved, 'disc-resolved'),
      discFindingList('⚠︎ Regressed', regressed, 'disc-regressed'),
      unknownRegressions > 0
        ? h('p', { class: 'disc-note' },
            `${plural(unknownRegressions, 'regression', 'regressions')} stayed closed — finding remained in its prior resolved/waived state`)
        : null,
    ) : null;

    return h('li', { class: 'round' },
      h('div', { class: 'round-head' },
        h('span', { class: 'round-n num-line' }, `Round ${r.n ?? '?'}`),
        h('span', { class: 'meta-dim' }, fmtDateTime(r.at) || ''),
        r.trigger ? h('span', { class: 'chip chip-trigger' }, r.trigger) : null,
        rd.gate ? gateBadge(rd.gate) : null,
      ),
      r.note ? h('p', { class: 'round-note' }, r.note) : null,
      h('div', { class: 'round-pills' }, pills),
      disc,
    );
  }));
}

/* ============================== report tab ============================== */

function reportView() {
  const wrap = h('div', { class: 'report' },
    h('div', { class: 'report-bar' },
      h('span', { class: 'meta-dim' }, 'Markdown report (generated by src/report.js)'),
      h('button', {
        class: 'btn btn-accent',
        type: 'button',
        id: 'copy-md',
        disabled: state.report.id !== current.id || state.report.md == null,
        onclick: copyReport,
      }, 'Copy markdown'),
    ),
    h('div', { id: 'report-body', class: 'report-body' },
      state.report.id === current.id && state.report.md != null
        ? renderMarkdown(state.report.md)
        : h('div', { class: 'report-skel' }, skel('skel-line w-200'), skel('skel-line'), skel('skel-line'), skel('skel-line w-120'))),
  );
  return wrap;
}

async function loadReportInto(id, seq) {
  if (state.report.id === id && state.report.md != null) return; // already rendered by reportView
  let md;
  try {
    md = await api(`/api/report/${encodeURIComponent(id)}`);
  } catch (e) {
    if (seq !== routeSeq) return;
    const body = $('#report-body');
    if (body) body.replaceChildren(h('p', { class: 'meta-dim' }, `Could not load report: ${e.message}`));
    toast(`Could not load report: ${e.message}`);
    return;
  }
  if (seq !== routeSeq) return;
  state.report = { id, md: typeof md === 'string' ? md : JSON.stringify(md, null, 2) };
  const body = $('#report-body');
  if (body) body.replaceChildren(renderMarkdown(state.report.md));
  const btn = $('#copy-md');
  if (btn) btn.disabled = false;
}

async function copyReport() {
  if (state.report.md == null) return;
  try {
    await navigator.clipboard.writeText(state.report.md);
    toast('Report markdown copied', 'success');
  } catch {
    toast('Clipboard unavailable');
  }
}

/* ---- minimal markdown renderer (headings, bold/em/code, links, lists,
 * tables, fenced code, hr, blockquote). DOM-built ⇒ XSS-safe. ---- */

function renderMarkdown(md) {
  const root = h('div', { class: 'md' });
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let para = [];
  const flush = () => {
    if (para.length) { root.append(h('p', {}, mdInline(para.join(' ')))); para = []; }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {                              // fenced code
      flush();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // closing fence
      root.append(h('pre', {}, h('code', {}, buf.join('\n'))));
      continue;
    }

    const hm = line.match(/^(#{1,6})\s+(.*)$/);           // heading
    if (hm) {
      flush();
      root.append(h(`h${hm[1].length}`, { class: 'md-h' }, mdInline(hm[2])));
      i++;
      continue;
    }

    if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {      // hr
      flush();
      root.append(h('hr'));
      i++;
      continue;
    }

    if (/^\|.*\|\s*$/.test(line)) {                        // table
      flush();
      const tlines = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { tlines.push(lines[i]); i++; }
      root.append(mdTable(tlines));
      continue;
    }

    if (/^\s*([-*+]\s+|\d+[.)]\s+)/.test(line)) {          // list
      flush();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]\s+|\d+[.)]\s+)/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
        i++;
      }
      root.append(h(ordered ? 'ol' : 'ul', {}, items.map((t) => h('li', {}, mdInline(t)))));
      continue;
    }

    if (/^\s*>\s?/.test(line)) {                           // blockquote
      flush();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      root.append(h('blockquote', {}, h('p', {}, mdInline(buf.join(' ')))));
      continue;
    }

    if (!line.trim()) { flush(); i++; continue; }          // blank

    para.push(line.trim());
    i++;
  }
  flush();
  return root;
}

function mdTable(tlines) {
  const parseRow = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
  const isSep = (l) => /^\s*\|?\s*:?-{2,}.*$/.test(l) && /^[\s|:\-]+$/.test(l);
  const table = h('table', { class: 'md-table' });
  let rows = tlines;
  if (rows.length >= 2 && isSep(rows[1])) {
    table.append(h('thead', {}, h('tr', {}, parseRow(rows[0]).map((c) => h('th', {}, mdInline(c))))));
    rows = rows.slice(2);
  }
  table.append(h('tbody', {}, rows.filter((l) => !isSep(l)).map((l) =>
    h('tr', {}, parseRow(l).map((c) => h('td', {}, mdInline(c)))))));
  return table;
}

function mdInline(text) {
  const frag = document.createDocumentFragment();
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    if (m[1] != null) frag.append(h('strong', {}, m[1]));
    else if (m[2] != null) frag.append(h('code', {}, m[2]));
    else if (m[3] != null) {
      const href = safeHref(m[4]);
      frag.append(href
        ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, m[3])
        : h('span', {}, m[3]));
    } else if (m[5] != null) frag.append(h('em', {}, m[5]));
    else if (m[6] != null) frag.append(h('em', {}, m[6]));
    last = re.lastIndex;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

/* ============================== keyboard ============================== */

function isTyping(t) {
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const s = $('#finding-search');
    if (s) { e.preventDefault(); s.focus(); s.select(); }
  } else if (e.key === 'Escape') {
    if (state.modalFp) return;   // the finding modal owns Escape (native <dialog> closes it)
    const search = document.getElementById('finding-search');
    if (search && document.activeElement === search) {
      state.filters.q = '';
      search.value = '';
      search.blur();
      renderBoard();
    } else if (isTyping(document.activeElement)) {
      document.activeElement.blur();
    }
  }
});

/* ============================== boot ============================== */

window.addEventListener('hashchange', route);
route();
