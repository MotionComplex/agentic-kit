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
// Defaults matching ledger.js's DEFAULT_CONFIG — used only for the optimistic readiness
// recompute, and only until GET /api/config answers (fetched at boot, see loadLiveConfig
// below). The server's value is authoritative either way and reconciled after every POST;
// this is what keeps the OPTIMISTIC number from drifting the moment someone edits
// config.json's documented severityWeights/readyThreshold (F-5).
const SEVERITY_WEIGHTS = { blocker: 10, major: 5, minor: 2, info: 0.5 };
const READY_THRESHOLD = 85;
const SCORE_ZERO_AT_PENALTY = 40;
let liveConfig = null;   // { severityWeights, gates: { readyThreshold, scoreZeroAtPenalty } } once fetched

async function loadLiveConfig() {
  try { liveConfig = await api('/api/config'); } catch { /* keep the fallback constants */ }
}

const ICONS = {
  pin: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16v6"/><path d="M9 3h6l-1 6 3.5 3.5a1 1 0 0 1-.7 1.5H7.2a1 1 0 0 1-.7-1.5L10 9z"/></svg>',
  confluence: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></svg>',
  ado: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 12l2.5 2.5L15.5 9.5"/></svg>',
  figma: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 14.5l9 5 9-5"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
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
  diffMode: 'rendered',    // 'rendered' | 'unified' | 'split' — proposed-change view (sticky pref).
                           // 'rendered' shows markdown/gherkin formatted; raw diff falls back to unified.
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
  flow: { active: false, finish: false, featureId: null, items: null, idx: 0, decisions: {}, waiving: null, editingComment: null, persistFailed: {} },
  section: { kind: null, features: [] },   // cached cards for the open PR section, re-bound to live jobs each poll
  runner: null,            // last GET /api/runner — is a session draining the queue right now?
};
const current = { view: null, id: null, tab: null };
let routeSeq = 0;

/* Footer appended to AI-drafted PR comments/replies when the post toggle is on (the default). */
const DISCLOSURE_LINE = '🤖 AI comment posted by Claude';

/* The API contract this build of the UI expects — must match src/version.js. A browser reload always
 * gets the newest app.js, but src/server.js is only read when the cockpit process starts, so an
 * updated plugin + a long-running server means the page calls routes the server has never heard of.
 * That used to surface as a bare "Not found"; now it says which half is stale. */
const EXPECTED_API_VERSION = '3';

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
/* Compact relative age — "just now", "12m ago", "3h ago", "2d ago", then an absolute date.
 * Used for the review/activity stamps, where "how long ago" is the question being asked;
 * the absolute time always rides along in the element's title attribute. */
function fmtAgo(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const secs = Math.round((Date.now() - t) / 1000);
  if (secs < 0) return fmtDateTime(iso);         // clock skew / future stamp — show it plainly
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDate(iso);
}
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

/* ============================== review / activity stamps ============================== */

/* The two timestamps that answer "can I re-review yet?":
 *   lastReviewedAt — when WE last reviewed (the last ingest round; a round IS a review pass)
 *   lastActivityAt — when the OTHER side last touched the PR (their newest comment/commit),
 *                    recorded by the runner from ADO, with lastActivityBy naming who.
 * `newSinceReview` = their update landed after our last round, so a re-review would see
 * something new. Works off either shape: an API summary row (which carries `stamps`) or a
 * full detail payload ({ feature, rounds }). */
function reviewStampsOf(source) {
  if (source && source.stamps) return source.stamps;
  const feature = (source && source.feature) || source || {};
  const rv = feature.review || {};
  const rounds = (source && source.rounds && source.rounds.rounds) || [];
  const lastReviewedAt = rounds.length ? rounds[rounds.length - 1].at : (source && source.lastRoundAt) || null;
  const lastActivityAt = rv.lastActivityAt || null;
  const newer = lastActivityAt
    && !Number.isNaN(Date.parse(lastActivityAt))
    && (!lastReviewedAt || Number.isNaN(Date.parse(lastReviewedAt))
        || Date.parse(lastActivityAt) > Date.parse(lastReviewedAt));
  return {
    lastReviewedAt,
    lastActivityAt,
    lastActivityBy: rv.lastActivityBy || null,
    lastPostedAt: rv.lastPostedAt || null,
    authorRespondedAt: rv.authorRespondedAt || null,
    newSinceReview: Boolean(newer),
  };
}

/* One stamp: "<label> <relative> [by <who>]", with the exact timestamp in the tooltip. */
function stampEl(label, iso, extraClass = '', who = '') {
  const rel = fmtAgo(iso);
  if (!rel) return null;
  return h('span', {
    class: `stamp ${extraClass}`.trim(),
    title: `${label}: ${fmtDateTime(iso) || iso}${who ? ` by ${who}` : ''}`,
  },
  h('span', { class: 'stamp-label' }, label),
  h('span', { class: 'stamp-val' }, rel),
  who ? h('span', { class: 'stamp-who' }, `by ${who}`) : null);
}

/* The stamps line for a PR workspace: when we reviewed, when the PR was last updated by the
 * other side (and by whom), and — when their update is newer than our review — a "new since
 * your review" marker, which is exactly the "you can re-review now" signal. `compact` drops
 * the posted stamp (used on cards, where space is tight). */
function reviewStampsRow(source, kind, { compact = false, cls = 'review-stamps' } = {}) {
  if (kind !== 'pr-review' && kind !== 'pr-respond') return null;
  const s = reviewStampsOf(source);
  if (!s.lastReviewedAt && !s.lastActivityAt && !s.lastPostedAt) return null;
  const bits = [
    stampEl('Reviewed', s.lastReviewedAt),
    !compact ? stampEl('Posted', s.lastPostedAt) : null,
    stampEl('PR updated', s.lastActivityAt, s.newSinceReview ? 'stamp-new' : '', s.lastActivityBy || ''),
  ].filter(Boolean);
  if (!bits.length) return null;
  if (s.newSinceReview) {
    bits.push(h('span', {
      class: 'stamp-flag',
      title: 'The PR changed after our last review round — a re-review will pick up the delta.',
    }, '● new since your review'));
  }
  return h('div', { class: cls }, bits);
}

/* ============================== round helpers ============================== */

function currentRoundNum() {
  if (!state.detail || !state.detail.rounds) return null;
  const rounds = state.detail.rounds.rounds || [];
  return rounds.length > 0 ? rounds[rounds.length - 1].n : null;
}

function findingBadge(f, currentRound) {
  if (currentRound == null) return null;
  // Once a finding has been acted on — resolved, waived, in-flight, posted or applied — it is no
  // longer "new"/"regressed" to the reviewer; those badges only describe untouched open work.
  if (f.status === 'resolved' || f.status === 'waived' || isInFlightOrOut(f)) return null;
  // NEW = a freshly surfaced finding that hasn't been triaged yet (still Open).
  if (f.status === 'open' && f.firstSeenRound === currentRound) return 'new';
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
  const weights = (liveConfig && liveConfig.severityWeights) || SEVERITY_WEIGHTS;
  const gates = (liveConfig && liveConfig.gates) || {};
  const readyThreshold = gates.readyThreshold ?? READY_THRESHOLD;
  const scoreZeroAtPenalty = gates.scoreZeroAtPenalty || SCORE_ZERO_AT_PENALTY;
  const openBySeverity = { blocker: 0, major: 0, minor: 0, info: 0 };
  let penalty = 0;
  for (const f of findings || []) {
    if (f.status !== 'open' && f.status !== 'reworking') continue;
    if (isInFlightOrOut(f)) continue;   // posted/applied/in-flight = not open reviewer work → no penalty
    if (openBySeverity[f.severity] != null) openBySeverity[f.severity]++;
    penalty += weights[f.severity] ?? 0;
  }
  const score = Math.max(0, Math.round(100 - (penalty * 100) / scoreZeroAtPenalty));
  let gate = 'in-progress';
  if (openBySeverity.blocker > 0) gate = 'not-ready';
  else if (score >= readyThreshold) gate = 'ready';
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

/* "Mark review complete" / "Reopen" — sets the workspace's lifecycle status to `done`
 * (or back to `reworking`). A done workspace reads as completed everywhere: a green check
 * in the header, a done chip on its card, and it drops out of the "needs you" inbox. */
function completeControl(feature) {
  const done = feature.status === 'done';
  return h('button', {
    class: `btn btn-complete ${done ? 'is-done' : ''}`.trim(), type: 'button',
    title: done ? 'Reopen this review (back to in-progress)' : 'Mark this review complete — it shows as done and leaves the inbox',
    onclick: () => setFeatureStatus(done ? 'reworking' : 'done'),
  }, done ? '↩ Reopen review' : '✓ Mark review complete');
}

async function setFeatureStatus(status) {
  try {
    await api(`/api/features/${encodeURIComponent(current.id)}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await loadDetail(current.id, true);
    rerenderDetail();
    toast(status === 'done' ? 'Review marked complete' : 'Review reopened', 'success');
  } catch (e) {
    toast(`Could not update status: ${e.message}`);
  }
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
            h('p', {}, 'In Claude Code: ', h('code', {}, '/flowlever:audit checkout-redesign'), ' (or “audit feature X”, or paste a spec link). It fetches the sources, runs a 7-dimension check, and ingests findings into the ledger.')),
          gStep(2, 'Review — step through, one finding at a time',
            h('p', {}, 'Open the feature here and hit the ', h('strong', {}, '“Review N flagged items”'), ' button in the header loop strip. The guided ', h('strong', {}, 'stepper'), ' walks each flagged finding one at a time: you see the proposed change as a red/green diff and decide ', h('strong', {}, 'Accept · Edit · Redirect · Waive · Skip'), '. Decisions accumulate — nothing is applied mid-flow — and a rail lets you jump around. The ', h('strong', {}, 'All findings'), ' board, ', h('strong', {}, 'Coverage'), ', and ', h('strong', {}, 'Timeline'), ' tabs are all still there.')),
          gStep(3, 'Apply / Export',
            h('p', {}, 'The finish screen is a ', h('strong', {}, 'decision summary'), ' grouped by spec page / work item. From there: ', h('strong', {}, 'Export the work order'), ' (markdown to hand a coding agent) and/or ', h('strong', {}, 'mark the reviewed findings as Reworking'), ' so the board reflects in-flight work. Drafts come from ', h('code', {}, '/flowlever:rework'), '; nothing is written to Confluence/ADO from the browser.')),
          gStep(4, 'Re-audit',
            h('p', {}, 'Run ', h('code', {}, '/flowlever:audit'), ' again. The ledger ', h('strong', {}, 'reconciles'), ': fixed findings auto-resolve, still-open ones refresh, and anything that ', h('strong', {}, 'silently came back'), ' is flagged as a regression (red on the timeline).')),
          gStep(5, 'Ship',
            h('p', {}, 'When the gate is green, ', h('code', {}, '/flowlever:brief checkout-redesign'), ' composes an implementation-ready handoff brief from the spec, designs and settled decisions.')))),

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
              h('strong', {}, 'per thread'), ' (reply · fix + reply · ', h('strong', {}, 'fix only'),
              ' · push back · skip) → ', h('strong', {}, '“Post replies”'),
              ' posts the replies and applies the code fixes — only on your action. ',
              h('strong', {}, 'Fix only'), ' is the quiet path: it pushes the commit and marks the thread ',
              h('em', {}, 'Fixed'), ' without writing any comment — for when you want the change in but ',
              'would rather answer the reviewer yourself, or not at all.')))),

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
          h('li', {}, h('strong', {}, '✗ Error'), ' — failed; the row shows why.'),
          h('li', {}, h('strong', { class: 'guide-ni' }, '⏸ Not running'), ' — queued (or claiming to run) for ',
            'minutes with ', h('strong', {}, 'no runner going'), '. Nothing has been posted. Hit ',
            h('strong', {}, '▶ Run it now'), ', or cancel the job to put its items back in the review queue.')),
        h('h3', {}, 'Running jobs from here — ▶ Run N jobs'),
        h('p', {},
          'Queued jobs only move when a Claude Code session runs ', h('code', {}, '/flowlever:watch'), '. ',
          'The cockpit server is a local process, so it can start that session for you: ',
          h('strong', {}, '▶ Run N jobs'), ' (on Home, the PR sections, and in the stalled banner) launches it ',
          'headlessly and the job rows then move queued → running → done in front of you. While it works ',
          'the control reads ', h('strong', {}, 'Runner working… ■ Stop'), '. Because this one ',
          h('em', {}, 'writes'), ' to Azure DevOps it confirms once before starting, only ever runs one session ',
          'at a time, and logs to ', h('code', {}, '~/.flowlever/runner.log'), ' so a headless failure ',
          '(expired auth, missing MCP) is visible instead of silent. If the ', h('code', {}, 'claude'),
          ' CLI can\'t be found the button says so — set ', h('code', {}, 'FLOWLEVER_CLAUDE_BIN'), '.'),
        h('h3', {}, 'Why a Post can never silently look done'),
        h('p', {},
          'Clicking Post does ', h('em', {}, 'not'), ' write anything — the browser can\'t reach Azure DevOps. It marks the ',
          'items ', h('strong', {}, '“Posting…”'), ' and queues a job; only the runner can confirm a comment landed, ',
          'by stamping it ', h('strong', {}, 'Posted — awaiting author'), '. So if the runner never arrives, dies ',
          'mid-way, or finishes without stamping, the cockpit says exactly that ("no runner picked this up", ',
          '"finished but N items not confirmed as posted") instead of implying success — and offers ',
          h('strong', {}, '↩ Back to the review queue'), ' to release the items so you can Post again. ',
          'Each ', h('code', {}, '/flowlever:watch'), ' pass also heals strays: it checks the PR and either stamps ',
          'items whose comment is already there, or releases the ones that never made it.'),
        h('h3', {}, 'The two review clocks — when can I re-review?'),
        h('p', {},
          'Every PR workspace carries two timestamps, shown together on its card, its Home row and its header: ',
          h('strong', {}, 'Reviewed'), ' (when we last reviewed it — its last ingest round) and ',
          h('strong', {}, 'PR updated'), ' (when the ', h('em', {}, 'other'),
          ' side last touched the PR: the author on a PR review, the reviewer on a PR respond). ',
          'When their update is newer than our review, the stamp turns blue with a ',
          h('strong', {}, '● new since your review'), ' badge and the prominent ',
          h('strong', {}, '↻ Re-review'), ' action appears — a re-review will actually see something. ',
          'Hover a stamp for the exact time.'),
        h('h3', {}, 'The ↻ Refresh button'),
        h('p', {},
          'The scheduled ', h('code', {}, '/flowlever:poll'), ' pass runs every couple of hours. When you already ',
          h('em', {}, 'know'), ' a new PR landed or a reviewer just commented, hit ', h('strong', {}, '↻ Refresh'),
          ' on Home or on either PR section: it queues a discovery pass your ', h('code', {}, '/flowlever:watch'),
          ' session runs right away — finding PRs with no workspace yet and re-checking the known ones for updates. ',
          'The button is its own progress indicator (queued → live phase → done, or the failure reason with a retry), ',
          'it de-dupes so a double-click can’t start two passes, and like the scheduled pass it ',
          h('strong', {}, 'never posts anything'), '.'),
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

/* Reviewable = an open/reworking finding that carries something to decide on: a
 * code-diff `draft` OR a non-empty `suggestion` (the proposed PR comment / reply).
 * PR-review findings usually carry only a suggestion, so they MUST count here too —
 * these are the items the stepper walks and the CTA counts. */
function hasSuggestion(f) {
  return typeof f.suggestion === 'string' && f.suggestion.trim() !== '';
}
/* A finding whose comment/reply has been posted back to the PR: it stays open/reworking
 * (so a re-review reconciles it) but is "awaiting the author", not the reviewer — it sits in
 * its own lane and is NOT re-counted as something to review. */
function isOpenish(f) {
  return f.status === 'open' || f.status === 'reworking';
}
function isPosted(f) {
  return Boolean(f.postedAt) && isOpenish(f);
}
/* Spec mirror of isPosted: the accepted change has actually been written back to Confluence/ADO
 * (stamped by the runner), so it's awaiting re-audit, not the reviewer. */
function isApplied(f) {
  return Boolean(f.appliedAt) && isOpenish(f);
}
/* Transient: the reviewer clicked Post/Apply and the runner is mid-flight (`pending` is
 * 'post' | 'apply'). Shown in the "Posting…/Applying…" lane until the real completion stamp lands. */
function isPending(f) {
  return Boolean(f.pending) && isOpenish(f) && !f.postedAt && !f.appliedAt;
}
/* Out of the reviewer's hands — in flight, posted, or applied — so not "to review". */
function isInFlightOrOut(f) {
  return isPosted(f) || isApplied(f) || isPending(f);
}
function reviewableFindings(findings) {
  return (findings || []).filter((f) =>
    isOpenish(f) && !isInFlightOrOut(f) && (f.draft || hasSuggestion(f)));
}
function postedFindings(findings) {
  return (findings || []).filter(isPosted);
}
/* Spec findings whose accepted change has been written back and are awaiting a re-audit to
 * reconcile (the spec analog of postedFindings awaiting the author). */
function appliedFindings(findings) {
  return (findings || []).filter(isApplied);
}
/* A spec workspace is "ready to re-audit" once changes are applied and nothing is left to
 * triage — the spec analog of reviewWait==='responded'. (Applying IS the trigger; unlike a PR
 * there's no third party to wait on.) */
function specReauditReady(data) {
  const kind = data.feature && data.feature.kind;
  if (kind !== 'spec') return false;
  const findings = (data.ledger && data.ledger.findings) || [];
  if (reviewableFindings(findings).length) return false;   // still stuff to triage
  return appliedFindings(findings).length > 0;
}

/* The post-posting wait state for a PR workspace: 'waiting' (comments out, nothing to do
 * but wait), 'responded' (the runner saw new author replies/commits — time to re-review), or
 * null (not a PR, or still has things to review/post). Drives the loop + CTA framing. */
function reviewWait(data) {
  const kind = data.feature && data.feature.kind;
  if (kind !== 'pr-review' && kind !== 'pr-respond') return null;
  const findings = (data.ledger && data.ledger.findings) || [];
  if (reviewableFindings(findings).length) return null;   // still stuff to triage/post
  if (!postedFindings(findings).length) return null;       // nothing posted → not waiting
  // Either the runner explicitly flagged a response, or the recorded PR-activity timestamp is
  // newer than our last review round — both mean the same thing: there's a delta to reconcile.
  const stamps = reviewStampsOf(data);
  const responded = (data.feature.review && data.feature.review.authorRespondedAt) || stamps.newSinceReview;
  return responded ? 'responded' : 'waiting';
}

/* Build the review-flow decision map from PERSISTED finding state, so a decision taken on
 * ANY surface (board modal or the stepper) shows everywhere and survives a page refresh:
 * a waived finding reads as Dismissed, a stored `decision` as Approve/Edit, the rest
 * Undecided. The in-memory flow map is just a cache hydrated from this. */
function hydrateDecisions(findings) {
  const d = {};
  for (const f of findings || []) {
    if (f.status === 'waived') d[f.fp] = { kind: 'waive', reason: f.statusReason || '' };
    else if (f.decision === 'approve') d[f.fp] = { kind: 'accept' };
    else if (f.decision === 'edit') d[f.fp] = { kind: 'edit' };
    else if (f.decision === 'fix-only') d[f.fp] = { kind: 'fix-only' };
    else {
      // No finding-level decision stored — derive one from the persisted draft review,
      // so accepting a proposal hunk-by-hunk counts as deciding the finding (otherwise
      // the finish screen reads it as Undecided and silently drops it from the post).
      const rv = f.draft && f.draft.review;
      if (!rv) continue;
      if (rv.verdict === 'redirect') { d[f.fp] = { kind: 'redirect', reason: rv.note || '' }; continue; }
      if (rv.verdict === 'reject') continue;   // an explicit "don't apply" stays undecided here
      const hunkDecs = rv.hunks || {};
      const statuses = draftStats(f).hunks.map((hk) => (hunkDecs[String(hk.id)] || {}).status);
      if (statuses.length && statuses.every((s) => s === 'accepted' || s === 'edited')) {
        d[f.fp] = { kind: statuses.includes('edited') ? 'edit' : 'accept' };
      }
    }
  }
  return d;
}

/* Canonical loop stages keyed independent of label, so a kind can rename them.
 * fetch → review → apply → reaudit. `reaudit` is the trailing "next" step and is
 * never lit as the *active* stage — it's what you do after posting/applying. */
const STAGE_KEYS = ['fetch', 'review', 'apply', 'reaudit'];
const LOOP_STAGES_BY_KIND = {
  spec:         [['1', 'Audit'], ['2', 'Review'], ['3', 'Apply / Export'], ['4', 'Re-audit']],
  'pr-review':  [['1', 'Fetch'], ['2', 'Review comments'], ['3', 'Post'], ['4', '(re-run)']],
  'pr-respond': [['1', 'Fetch'], ['2', 'Review threads'], ['3', 'Post'], ['4', '(re-run)']],
};

/* Active stage from REAL state, not "rounds exist": no findings → fetch; any
 * undecided reviewable finding → review; otherwise everything's been triaged →
 * apply/post. `reaudit` is only ever the dangling next step (never returned here). */
function loopActiveStage(data) {
  const findings = (data.ledger && data.ledger.findings) || [];
  if (!findings.length) return 'fetch';
  if (reviewableFindings(findings).length) return 'review';
  // Nothing left to review/post. If comments are posted (PR) or changes applied (spec), the live
  // step is the reconcile (re-review / re-audit); otherwise it's still the post/apply step.
  if (postedFindings(findings).length || appliedFindings(findings).length) return 'reaudit';
  return 'apply';
}

/* The loop, always visible in the feature header, with kind-aware stage labels,
 * the current stage lit and the primary CTA on the right. */
function loopStrip(data, rightEl) {
  const kind = (data.feature && data.feature.kind) || 'spec';
  const stages = LOOP_STAGES_BY_KIND[kind] || LOOP_STAGES_BY_KIND.spec;
  const activeIdx = STAGE_KEYS.indexOf(loopActiveStage(data));
  const isPr = kind === 'pr-review' || kind === 'pr-respond';
  const canReReview = isPr && !!prNumber(data.feature);
  const wait = reviewWait(data);   // null | 'waiting' | 'responded'  (PR)
  const reaudit = specReauditReady(data);   // spec: changes applied → re-audit available
  const els = [];
  stages.forEach(([ix, label], i) => {
    if (i) els.push(h('span', { class: 'loop-sep' }, '→'));
    // The trailing stage lights once comments are posted (PR) or changes applied (spec). For a
    // PR it's "Re-review" (or a passive Waiting chip); for a spec, applying makes it "Re-audit".
    const active = i === activeIdx;
    const onLast = i === 3 && active;
    const prClickable = onLast && canReReview;
    const specClickable = onLast && reaudit;
    const clickable = prClickable || specClickable;
    const act = specClickable ? () => reAuditSpec(data) : (prClickable ? () => reReviewPr(data) : undefined);
    let stageLabel = label;
    let stateCls = '';
    if (specClickable) { stageLabel = '↻ Re-audit'; stateCls = 'loop-stage-action'; }
    else if (onLast && wait === 'responded') { stageLabel = '↻ Re-review'; stateCls = 'loop-stage-action'; }
    else if (onLast && wait === 'waiting') { stageLabel = '⏳ Waiting'; stateCls = 'loop-stage-waiting'; }
    els.push(h('div', {
      class: `loop-stage ${active ? 'active' : ''} ${stateCls}`.trim(),
      role: clickable ? 'button' : undefined,
      tabindex: clickable ? '0' : undefined,
      title: clickable
        ? (specClickable ? 'Changes applied — re-audit to re-fetch the spec and reconcile these findings'
          : wait === 'responded' ? 'Author responded — re-review and reconcile'
          : 'Waiting on the author — click to re-review anyway')
        : undefined,
      onclick: act,
      onkeydown: clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } } : undefined,
    }, h('span', { class: 'loop-ix' }, ix), stageLabel));
  });
  return h('div', { class: 'loop-strip' },
    h('div', { class: 'loop-stages' }, els),
    rightEl);
}

/* Noun the CTA + stepper use for one reviewable item, per kind. */
const REVIEW_NOUN = {
  spec: ['flagged item', 'flagged items'],
  'pr-review': ['comment', 'comments'],
  'pr-respond': ['thread', 'threads'],
};
function reviewNoun(kind) { return REVIEW_NOUN[kind] || REVIEW_NOUN.spec; }

/* The single prominent next-action. "Review N comments/items/threads" when there's
 * something to review; otherwise it tells the user there's nothing left to triage. */
function reviewCta(data) {
  const findings = (data.ledger && data.ledger.findings) || [];
  const kind = (data.feature && data.feature.kind) || 'spec';
  const [one, many] = reviewNoun(kind);
  const n = reviewableFindings(findings).length;
  if (n > 0) {
    return h('button', {
      class: 'review-cta', type: 'button',
      onclick: () => { location.hash = `#/feature/${encodeURIComponent(current.id)}/review`; },
    }, 'Review ', h('span', { class: 'cta-n' }, String(n)), ` ${n === 1 ? one : many}`);
  }
  const openNone = findings.filter((f) =>
    (f.status === 'open' || f.status === 'reworking') && !f.draft && !hasSuggestion(f)).length;
  if (openNone > 0) {
    const noun = kind === 'spec' ? 'a draft' : 'a comment';
    return h('div', { class: 'review-cta-done' },
      `Nothing to review — ${plural(openNone, 'open finding', 'open findings')} without ${noun}`);
  }
  if (kind === 'pr-review' || kind === 'pr-respond') {
    // Once comments are posted the work is OUT — the workspace waits on the author. It stays in
    // a passive "Waiting on author" state until the runner detects a reply/commit (or you act
    // manually); only then does it surface a prominent Re-review.
    const wait = reviewWait(data);
    if (wait) {
      const posted = postedFindings(findings).length;
      const prNum = prNumber(data.feature);
      const target = prNum ? `PR #${prNum}` : 'the PR';
      const canReReview = !!prNum;
      const reBtn = (cls, label) => canReReview ? h('button', {
        class: cls, type: 'button',
        title: 'Re-fetch the PR and reconcile the author’s response into this ledger',
        onclick: () => reReviewPr(data),
      }, label) : null;
      if (wait === 'responded') {
        const note = data.feature.review && data.feature.review.note;
        return h('div', { class: 'review-cta-done is-responded' },
          h('span', {}, `● Author responded on ${target}${note ? ` — ${note}` : ''}`),
          reBtn('review-cta review-cta-rereview is-hot', '↻ Re-review'));
      }
      return h('div', { class: 'review-cta-done is-waiting' },
        h('span', {}, `${plural(posted, 'comment', 'comments')} posted to ${target}`),
        reBtn('review-cta review-cta-rereview', '↻ Re-review'));
    }
    return h('div', { class: 'review-cta-done is-ready' }, '✓ All reviewed — ready to post');
  }
  // Spec: once accepted changes are written back to Confluence/ADO, the workspace is "out for
  // re-audit" — surface a prominent Re-audit that re-fetches the spec and reconciles (auto-resolves
  // the applied findings if the spec now reflects them, or keeps them open + flags regressions).
  if (specReauditReady(data)) {
    const n = appliedFindings(findings).length;
    return h('div', { class: 'review-cta-done is-responded' },
      h('span', {}, `● ${plural(n, 'change', 'changes')} applied — re-audit to reconcile`),
      h('button', {
        class: 'review-cta review-cta-rereview is-hot', type: 'button',
        title: 'Re-fetch the spec sources and reconcile: applied findings auto-resolve if the spec now reflects them.',
        onclick: () => reAuditSpec(data),
      }, '↻ Re-audit'));
  }
  const gate = (data.readiness && data.readiness.gate) || 'in-progress';
  return h('div', { class: 'review-cta-done is-ready' }, gate === 'ready' ? '✓ Ready to build' : '✓ Nothing to review');
}

/* Kind-aware decision actions for the stepper's decision row. Each returns the
 * button set (each mapped to an internal flow-decision kind so the rail marks,
 * finish tallies, export + apply all keep working), the per-finding triage tag
 * labels, and behavior flags. `editsComment` → the Edit button opens the proposed
 * comment in a textarea (not the per-hunk diff); `quickDismiss` → Dismiss records
 * the decision immediately (reason optional). */
function decisionActions(kind) {
  if (kind === 'pr-review') {
    return {
      label: 'Decision',
      editsComment: true,
      quickDismiss: true,
      helper: 'Approved comments are posted only when you click Post — nothing is sent until then.',
      tagLabels: { accept: 'Will post', edit: 'Edited', waive: 'Dismissed', undecided: 'Undecided' },
      buttons: [
        { kind: 'accept', label: '✓ Approve comment', cls: 'dec-accept' },
        { kind: 'edit', label: '✎ Edit comment', cls: 'dec-edit' },
        { kind: 'waive', label: '✕ Dismiss', cls: 'dec-waive' },
      ],
    };
  }
  if (kind === 'pr-respond') {
    return {
      label: 'Decision',
      helper: 'Replies and fixes are sent only when you click Post — nothing is sent until then. '
        + '“Fix only” pushes the fix and resolves the thread without writing a reply.',
      tagLabels: {
        accept: 'Will reply', edit: 'Fix + reply', 'fix-only': 'Fix, no reply',
        redirect: 'Push back', skip: 'Skipped', undecided: 'Undecided',
      },
      buttons: [
        { kind: 'accept', label: '↩ Reply', cls: 'dec-accept' },
        // Named for what it actually does: this one commits the fix AND answers the thread.
        { kind: 'edit', label: '✎ Fix + reply', cls: 'dec-edit' },
        // Fix, push, resolve the thread — no comment written.
        { kind: 'fix-only', label: '✎ Fix only', cls: 'dec-fixonly' },
        { kind: 'redirect', label: '⤺ Push back', cls: 'dec-redirect' },
        { kind: 'skip', label: '⏭ Skip', cls: 'dec-skip' },
      ],
    };
  }
  return {
    label: 'Decision',
    buttons: [
      { kind: 'accept', label: '✅ Accept', cls: 'dec-accept' },
      { kind: 'edit', label: '✏️ Edit', cls: 'dec-edit' },
      { kind: 'redirect', label: '⤳ Redirect', cls: 'dec-redirect' },
      { kind: 'waive', label: '⊘ Waive', cls: 'dec-waive' },
      { kind: 'skip', label: '⏭ Skip', cls: 'dec-skip' },
    ],
  };
}

const DEC_LABEL = { accept: 'Apply', edit: 'With edits', 'fix-only': 'Fix, no reply', redirect: 'Redirect', waive: 'Waive', skip: 'Skip' };
const RAIL_MARK = { accept: '✓', edit: '✎', 'fix-only': '✎', redirect: '⤳', waive: '⊘', skip: '–' };

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
      items: reviewable.map((f) => f.fp), idx: 0, decisions: hydrateDecisions(findings), waiving: null, editingComment: null,
      persistFailed: {},
    };
  }
  const len = state.flow.items.length;
  if (len === 0) { state.flow.idx = 0; return; }
  if (state.flow.idx >= len) state.flow.idx = len - 1;
  if (state.flow.idx < 0) state.flow.idx = 0;
}

/* While the stepper is open, a background reload (a decision synced in from the board modal, a
 * scoped re-audit finishing, /flowlever:watch reconciling a round) can change which findings
 * exist — but state.flow.items was frozen at launch and only ever rebuilt on a feature switch
 * or by retryPost's manual reset. So a re-review landing mid-stepper added findings the rail and
 * "x of N" never showed, and a finding removed by reconciliation stayed counted forever (C-25).
 * Reconciles in place instead: keeps the reviewer's position and every decision already
 * recorded, appends newly-reviewable fps, and drops only fps that no longer exist at all. */
function reconcileFlowItems(data) {
  if (state.flow.featureId !== current.id || !Array.isArray(state.flow.items)) return;
  const findings = (data.ledger && data.ledger.findings) || [];
  const byFp = new Set(findings.map((f) => f.fp));
  const liveFps = reviewableFindings(findings).map((f) => f.fp);
  const currentFp = state.flow.items[state.flow.idx];
  const kept = state.flow.items.filter((fp) => byFp.has(fp));
  const known = new Set(kept);
  const added = liveFps.filter((fp) => !known.has(fp));
  if (kept.length === state.flow.items.length && added.length === 0) return;   // nothing changed
  state.flow.items = [...kept, ...added];
  const newIdx = state.flow.items.indexOf(currentFp);
  state.flow.idx = newIdx >= 0 ? newIdx : Math.min(state.flow.idx, state.flow.items.length - 1);
  if (state.flow.idx < 0) state.flow.idx = 0;
}

function renderFlowInto() {
  if (current.view !== 'review-flow' || !state.detail) return;
  const app = $('#app');
  const data = state.detail;
  reconcileFlowItems(data);
  const kind = data.feature && data.feature.kind;
  const postable = state.flow.finish && (kind === 'pr-review' || kind === 'pr-respond');
  if (postable) ensureApplyPolling(); else stopPolling();
  if (!state.flow.items || !state.flow.items.length) {
    app.replaceChildren(flowEmptyView());
    return;
  }
  app.replaceChildren(state.flow.finish ? finishView(data) : stepperView(data));
}

/* Re-render whichever review surface is live: the full-page stepper when it's the
 * active view, otherwise the finding modal (board + open dialog). This lets the
 * shared decision widgets (decisionRow / suggestionSection / acceptAll …) drive
 * BOTH the stepper and the modal review sub-view without each knowing the other. */
function reviewRefresh() {
  if (current.view === 'review-flow') renderFlowInto();
  else refreshModal();
}

/* Make state.flow track the current feature's reviewable findings WITHOUT
 * launching the stepper, so a decision taken in the modal lands in the same
 * state.flow.decisions the stepper reads (they must agree). Re-entering the same
 * feature keeps prior decisions; switching features starts fresh. */
function ensureFlow() {
  const data = state.detail;
  if (!data || !current.id) return;
  if (state.flow.featureId === current.id && Array.isArray(state.flow.items)) return;
  const findings = (data.ledger && data.ledger.findings) || [];
  state.flow = {
    active: false, finish: false, featureId: current.id,
    items: reviewableFindings(findings).map((f) => f.fp),
    idx: 0, decisions: hydrateDecisions(findings), waiving: null, editingComment: null,
    persistFailed: {},
  };
}

/* While the PR finish screen is open, keep the apply-request status for this
 * workspace fresh so the Post button shows queued → running → posted. The scope
 * guard means re-rendering the finish view reuses the interval, not resets it. */
function ensureApplyPolling() {
  startPolling(`apply:${current.id}`, (reqs) => {
    if (current.view !== 'review-flow' || !state.flow.finish) return;
    const next = reqs.filter((r) => (r.action === 'apply' || r.action === 'propose') && r.wsId === current.id);
    const prev = state.flow.applyReqs || [];
    const sig = (list) => list.map((r) => `${r.id}:${r.status}:${r.phase || ''}:${r.note || ''}:${r.needsInput ? 1 : 0}`).join('|');
    state.flow.applyReqs = next;
    // Once the server has a queued/running apply request, that drives the busy
    // state; clear the optimistic flag when nothing is in flight anymore.
    state.flow.applying = next.some((r) => r.status === 'queued' || r.status === 'running');
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
          h('code', {}, '/flowlever:rework'), ' in Claude Code to draft fixes, then re-audit.'),
        h('p', {}, h('a', { class: 'backlink', href: back }, '← Back to the board')))));
}

/* Single source of truth for the decide-loop keyboard shortcuts (U-5) — the global keydown
 * handler and this discoverability hint both read it, so the hint can never claim a key the
 * handler doesn't actually bind. Keyed by the same `kind` decisionActions() buttons use. */
const DECIDE_KEYS = { a: 'accept', e: 'edit', w: 'waive', r: 'redirect', f: 'fix-only', s: 'skip' };

function stepKbdHint(kind) {
  const cfg = decisionActions(kind);
  const labelFor = (k) => {
    const b = cfg.buttons.find((btn) => btn.kind === k);
    // Buttons carry an emoji glyph prefix ("✅ Accept") — strip it so the hint reads as plain text.
    return b ? b.label.replace(/^\S+\s*/, '') : k;
  };
  const entries = [['k/j', '←/→ prev/next'],
    ...Object.entries(DECIDE_KEYS).filter(([, k]) => cfg.buttons.some((b) => b.kind === k))
      .map(([key, k]) => [key, labelFor(k)])];
  return h('div', { class: 'step-kbd-hint', title: 'Keyboard shortcuts (disabled while typing)' },
    entries.map(([key, label], i) => [i ? ' · ' : '', h('kbd', {}, key), ' ', label]));
}

/* The stepper: top bar (progress) · item rail · focused step card · prev/next. */
function stepperView(data) {
  const findings = (data.ledger && data.ledger.findings) || [];
  const { items, idx } = state.flow;
  const fp = items[idx];
  const f = findings.find((x) => x.fp === fp);
  const total = items.length;
  const decided = items.filter((id) => state.flow.decisions[id]).length;
  const kind = (data.feature && data.feature.kind) || 'spec';

  const top = h('div', { class: 'step-top' },
    h('div', { class: 'step-top-title' }, 'Reviewing ', h('span', { class: 'meta-dim' }, data.feature.title || current.id)),
    h('span', { class: 'step-progress' }, `${idx + 1} of ${total}`),
    h('div', { class: 'step-progressbar', role: 'progressbar', 'aria-valuenow': String(decided), 'aria-valuemax': String(total) },
      h('i', { style: `width:${total ? Math.round((decided / total) * 100) : 0}%` })),
    stepKbdHint(kind),
    h('button', { class: 'btn step-exit', type: 'button',
      onclick: () => { location.hash = `#/feature/${encodeURIComponent(current.id)}`; } }, 'Exit to board'),
  );

  const card = f ? stepCard(data, f)
    : h('div', { class: 'step-card' }, h('div', { class: 'step-empty' }, 'This finding is no longer available.'));

  return h('div', { class: 'stepper' },
    top,
    h('div', { class: 'step-layout' },
      stepRail(findings, (data.feature && data.feature.kind) || 'spec'),
      h('div', {}, card, stepNav())));
}

function stepRail(findings, kind) {
  const { items, idx } = state.flow;
  const [one, many] = reviewNoun(kind || 'spec');
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
    h('div', { class: 'rail-head' }, plural(items.length, one, many)),
    rows,
    h('button', {
      class: 'rail-item', type: 'button', style: 'margin-top:6px;border-top:1px solid var(--line-soft);border-radius:0 0 var(--radius-sm) var(--radius-sm)',
      onclick: () => { state.flow.finish = true; renderFlowInto(); },
    }, h('span', { class: 'rail-mark' }, '✓'), h('span', { class: 'rail-label' }, 'Finish & summary')));
}

/* The suggestion label per kind: a pr-review finding's suggestion IS the proposed
 * comment, so it's surfaced prominently as "Proposed comment". */
function suggestionLabel(kind) {
  return kind === 'pr-review' ? 'Proposed comment'
    : kind === 'pr-respond' ? 'Proposed reply'
    : 'Suggestion';
}

function stepCard(data, f) {
  const kind = (data.feature && data.feature.kind) || 'spec';
  const sev = SEV[f.severity] ? f.severity : 'info';
  const badge = findingBadge(f, currentRoundNum());
  const hasDraft = !!f.draft;
  const verdict = hasDraft ? draftVerdict(f) : 'proposed';

  const head = h('div', { class: 'step-finding-head' },
    h('div', { class: 'step-titlerow' },
      h('span', { class: `sev-glyph sev-${sev}`, title: SEV[sev].label }, SEV[sev].glyph),
      h('h2', {}, f.title || '(untitled finding)')),
    h('div', { class: 'step-tags' },
      f.dimension ? h('span', { class: 'dim-tag' }, f.dimension) : null,
      badge ? h('span', { class: `f-badge f-badge-${badge}` }, badge === 'new' ? 'NEW' : 'REGRESSED') : null,
      duplicateChip(f),
      statusChip(f.status),
      verdictChip(f),
      f.locus ? h('code', { class: 'f-locus' }, f.locus) : null));

  const diffSection = hasDraft ? stepDiffSection(f, verdict) : null;

  // The reviewer's saved note (their objection / answer), shown read-only under the suggestion
  // once written — distinct from the suggestion itself. Hidden while the editor is open.
  const noteEl = (f.note && state.flow.editingComment !== f.fp)
    ? h('div', { class: 'f-suggestion f-note' },
        h('span', { class: 'f-suglabel' }, 'Your note'),
        h('p', {}, f.note))
    : null;

  return h('div', { class: `step-card ${verdict !== 'proposed' ? `rm-frame-${verdict}` : ''}`.trim() },
    head,
    f.detail ? h('p', { class: 'step-detail' }, f.detail) : null,
    suggestionSection(kind, f),
    noteEl,
    diffSection,
    decisionRow(data, f));
}

/* The "Proposed comment" / "Suggestion" block — editable inline when the user
 * picked "Edit comment" on this finding (pr-review/pr-respond). */
function suggestionSection(kind, f) {
  if (state.flow.editingComment === f.fp) return commentEditForm(kind, f);
  const body = hasSuggestion(f) ? f.suggestion : '';
  if (!body && kind === 'spec') return null;
  const cls = kind === 'spec' ? 'f-suggestion' : 'f-suggestion proposed-comment';
  return h('div', { class: cls },
    h('span', { class: 'f-suglabel' }, suggestionLabel(kind)),
    h('p', {}, body || h('span', { class: 'meta-dim' }, '(no comment text yet — use Edit comment)')));
}

function commentEditForm(kind, f) {
  function cancel() { state.flow.editingComment = null; state.flow.editingKind = null; reviewRefresh(); }

  // Spec: keep the audit SUGGESTION visible (read-only) and give a SEPARATE field for the
  // reviewer's note — what they object to, or their answer if the finding asks a question.
  // The note persists on the finding (finding.note); the suggestion is left untouched.
  if (kind === 'spec') {
    const decKind = state.flow.editingKind === 'redirect' ? 'redirect' : 'edit';
    const ta = h('textarea', {
      class: 'comment-edit-ta', rows: '4', spellcheck: 'true',
      'aria-label': 'Your note / response',
      placeholder: decKind === 'redirect'
        ? "Why is this the wrong fix, or where/how should it be done instead? (your counter)"
        : "Your note: what to change about the suggestion, or your answer if it asks for clarification.",
      onkeydown: (e) => { if (e.key === 'Escape') cancel(); },
    });
    ta.value = f.note || '';
    const form = h('div', { class: 'comment-edit' },
      f.suggestion ? h('div', { class: 'f-suggestion' },
        h('span', { class: 'f-suglabel' }, 'Suggestion'),
        h('p', {}, f.suggestion)) : null,
      h('span', { class: 'f-suglabel' }, decKind === 'redirect' ? 'Your counter / answer' : 'Your note / answer'),
      ta,
      h('div', { class: 'comment-edit-actions' },
        h('button', { class: 'btn btn-accent', type: 'button', onclick: () => saveSpecNote(f.fp, ta.value, decKind) }, 'Save note'),
        h('button', { class: 'btn', type: 'button', onclick: cancel }, 'Cancel')));
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
    return form;
  }

  // PR: the suggestion IS the proposed comment, so editing it inline is the intent.
  const ta = h('textarea', {
    class: 'comment-edit-ta', rows: '5', spellcheck: 'true',
    'aria-label': `${suggestionLabel(kind)} — editing`,
    onkeydown: (e) => { if (e.key === 'Escape') cancel(); },
  });
  ta.value = f.suggestion || '';
  const form = h('div', { class: 'comment-edit proposed-comment' },
    h('span', { class: 'f-suglabel' }, `${suggestionLabel(kind)} — editing`),
    ta,
    h('div', { class: 'comment-edit-actions' },
      h('button', { class: 'btn btn-accent', type: 'button', onclick: () => saveComment(f.fp, ta.value) }, 'Save & approve'),
      h('button', { class: 'btn', type: 'button', onclick: cancel }, 'Cancel')));
  requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
  return form;
}

/* Persist a spec finding's reviewer NOTE (separate from the suggestion) plus the chosen decision
 * (edit keeps the suggestion + your note; redirect routes it elsewhere with your counter). */
async function saveSpecNote(fp, note, decKind) {
  const f = findFinding(fp);
  if (f) f.note = note;                       // optimistic
  setFlowDecision(fp, decKind);
  state.flow.editingComment = null;
  state.flow.editingKind = null;
  reviewRefresh();
  try {
    // Persist the note; for 'edit' also persist the decision so it's durable across refresh.
    const body = decKind === 'edit' ? { note, decision: 'edit' } : { note };
    await api(`/api/features/${encodeURIComponent(current.id)}/findings/${encodeURIComponent(fp)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await loadDetail(current.id, true);
  } catch (e) {
    toast(`Note save failed: ${e.message}`);
    try { await loadDetail(current.id, true); } catch { /* keep optimistic */ }
  }
  reviewRefresh();
}

/* Persist the edited proposed-comment body (via setFindingDetails on the server),
 * mark the finding Approved (edited), and close the editor. */
async function saveComment(fp, val) {
  const f = findFinding(fp);
  if (f) { f.suggestion = val; f.decision = 'edit'; }   // optimistic
  setFlowDecision(fp, 'edit');
  state.flow.editingComment = null;
  reviewRefresh();
  try {
    // Persist the edited body AND the edit decision together, so the approval is durable.
    await api(`/api/features/${encodeURIComponent(current.id)}/findings/${encodeURIComponent(fp)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggestion: val, decision: 'edit' }),
    });
    await loadDetail(current.id, true);
  } catch (e) {
    toast(`Comment save failed: ${e.message}`);
    try { await loadDetail(current.id, true); } catch { /* keep optimistic state */ }
  }
  reviewRefresh();
}

/* The red/green diff section (present only when a finding carries a code-diff
 * draft). Pulled out of stepCard so suggestion-only findings render without it. */
function stepDiffSection(f, verdict) {
  const { adds, dels, hunks } = draftStats(f);
  const renderable = canRenderProse(f);
  const mkTab = (mode, label) => h('button', {
    class: `diff-tab ${state.diffMode === mode ? 'active' : ''}`, type: 'button', 'aria-label': `${label} view`,
    onclick: () => { state.diffMode = mode; reviewRefresh(); },
  }, label);

  const diffHead = h('div', { class: 'step-diffhead' },
    h('span', { class: 'step-section-label' }, 'Proposed change'),
    h('code', { class: 'diff-target' }, (f.draft && f.draft.target) || f.locus || '—'),
    h('span', { class: 'diff-counts' },
      h('span', { class: 'diff-add-n' }, `+${adds}`), ' ', h('span', { class: 'diff-del-n' }, `−${dels}`)),
    hunks.length ? h('div', { class: 'diff-toggle', role: 'group', 'aria-label': 'Diff view mode' },
      renderable ? mkTab('rendered', 'Rendered') : null, mkTab('unified', 'Unified'), mkTab('split', 'Split')) : null);

  const banner = verdict !== 'proposed'
    ? h('div', { class: `rm-verdict-banner verdict-${verdict}` },
        h('span', { class: 'verdict-glyph' }, VERDICT_GLYPH[verdict]),
        verdict === 'reject'
          ? 'Rejected — the proposed change below is overridden by your note.'
          : 'Redirect — the proposed change below is superseded; the agent follows your note instead.')
    : null;

  return h('div', { class: 'step-diffwrap' }, diffHead, banner, ...reviewBodyKids(f));
}

function decisionRow(data, f) {
  const kind = (data.feature && data.feature.kind) || 'spec';
  const cfg = decisionActions(kind);
  if (state.flow.waiving === f.fp) {
    return h('div', { class: 'decision-row' },
      h('span', { class: 'decision-label' }, 'Waive'),
      stepWaiveForm(f));
  }
  const dec = state.flow.decisions[f.fp];
  const decKind = dec && dec.kind;
  const mk = (b) => h('button', {
    class: `dec-btn ${b.cls} ${decKind === b.kind ? 'on' : ''}`, type: 'button',
    'aria-pressed': decKind === b.kind ? 'true' : 'false',
    onclick: () => decide(data, f, b.kind),
  }, b.label);
  const tag = cfg.tagLabels
    ? h('span', { class: `triage-tag triage-${decKind || 'undecided'}` }, cfg.tagLabels[decKind || 'undecided'] || cfg.tagLabels.undecided)
    : null;
  const undo = decKind
    ? h('button', { class: 'dec-undo', type: 'button', title: 'Clear this decision', onclick: () => undecide(f) }, '↺ Undo')
    : null;
  // The click landed locally (decKind/tag above already reflect it) but the server never
  // confirmed it — say so here rather than let the tag imply it's saved (U-2).
  const notSaved = state.flow.persistFailed[f.fp]
    ? h('button', {
        class: 'dec-not-saved', type: 'button',
        title: 'The server did not confirm this decision.', onclick: () => retryPersist(f.fp),
      }, '⚠ not saved — retry')
    : null;
  const row = h('div', { class: 'decision-row' },
    h('span', { class: 'decision-label' }, cfg.label || 'Decision'),
    ...cfg.buttons.map(mk),
    tag, undo, notSaved);
  return cfg.helper
    ? h('div', { class: 'decision-wrap' }, row, h('p', { class: 'decision-helper meta-dim' }, cfg.helper))
    : row;
}

async function undecide(f) {
  delete state.flow.decisions[f.fp];
  state.flow.waiving = null;
  state.flow.editingComment = null;
  state.flow.editingKind = null;
  reviewRefresh();
  // Clear the persisted decision too: a dismissed (waived) finding is reopened; an
  // approve/edit marker is simply removed. Keeps every surface in sync.
  try {
    const body = f.status === 'waived' ? { status: 'open' } : { decision: null };
    await api(`/api/features/${encodeURIComponent(current.id)}/findings/${encodeURIComponent(f.fp)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await loadDetail(current.id, true);
  } catch (e) {
    toast(`Could not clear decision: ${e.message}`);
  }
  reviewRefresh();
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

/* Shared with the j/k keyboard shortcuts (U-5) so both routes move the stepper identically. */
function stepGoPrev() {
  if (state.flow.idx <= 0) return;
  state.flow.idx--;
  renderFlowInto();
}
/* Reconcile BEFORE asking "was that the last one?". A finding ingested while the reviewer was
 * deciding is already in state.detail but not yet in state.flow.items, and measuring against the
 * stale list jumped straight to the summary instead of walking them onto the new item. Nothing was
 * lost — it appeared there as Undecided — but they were never taken to it. */
function syncFlowBeforeMove() {
  if (state.detail) reconcileFlowItems(state.detail);
}

function stepGoNext() {
  syncFlowBeforeMove();
  if (state.flow.idx >= state.flow.items.length - 1) state.flow.finish = true;
  else state.flow.idx++;
  renderFlowInto();
}

function stepNav() {
  const { idx, items } = state.flow;
  const atFirst = idx <= 0;
  const atLast = idx >= items.length - 1;
  return h('div', { class: 'step-nav' },
    h('button', { class: 'btn', type: 'button', disabled: atFirst, title: 'Previous (k / ←)',
      onclick: stepGoPrev }, '← Prev'),
    h('span', { class: 'step-nav-mid' }, `${idx + 1} / ${items.length}`),
    h('button', { class: 'btn btn-accent', type: 'button', title: 'Next (j / →)',
      onclick: stepGoNext },
      atLast ? 'Finish →' : 'Next →'));
}

function setFlowDecision(fp, kind, extra = {}) {
  state.flow.decisions[fp] = { kind, ...extra };
}

function advance() {
  syncFlowBeforeMove();
  if (state.flow.idx >= state.flow.items.length - 1) state.flow.finish = true;
  else state.flow.idx++;
  renderFlowInto();
}

/* Decisions persist via the existing draft-review API (so the board + export
 * reflect them); nothing touches finding *status* until the finish/Post screen. */
async function decide(data, f, kind) {
  const fp = f.fp;
  const wsKind = (data.feature && data.feature.kind) || 'spec';
  const cfg = decisionActions(wsKind);
  // The stepper advances to the next finding after a terminal decision; the modal
  // has no "next", so it just re-renders in place.
  const inStepper = current.view === 'review-flow';
  const next = () => { if (inStepper) advance(); else reviewRefresh(); };

  // pr-review: Edit opens the proposed comment in a textarea (not the per-hunk
  // diff). In the modal's detail sub-view, route into the review sub-view so the
  // editable comment is actually visible.
  if (kind === 'edit' && cfg.editsComment) {
    state.flow.editingComment = fp;
    if (!inStepper) state.modalMode = 'review';
    reviewRefresh();
    requestAnimationFrame(() => { const ta = $('.comment-edit-ta'); if (ta) ta.focus(); });
    return;
  }
  // pr-review: Dismiss is a one-tap decision (reason optional). Persist it as `waived`
  // straight away so the card moves to the Waived lane and the decision survives a refresh.
  if (kind === 'waive' && cfg.quickDismiss) {
    setFlowDecision(fp, 'waive', { reason: '' });
    const ok = await persistWaive(fp, 'dismissed');
    // A failed persist must not read as done: stay put and show "not saved" rather than
    // auto-advancing to a summary that claims this was dismissed (U-2).
    if (ok) next(); else reviewRefresh();
    return;
  }

  if (kind === 'accept') {
    setFlowDecision(fp, 'accept');
    const ok = await persistDecisionField(fp, 'approve');   // persist the approve so every surface agrees
    if (!ok) { reviewRefresh(); return; }
    await acceptAll(f);
    next();
  } else if (kind === 'fix-only') {
    // Apply the fix exactly as drafted, and post NO reply: accept the hunks (so the runner knows
    // what to write to the working tree) and persist `fix-only`, which is what tells the runner to
    // resolve the thread instead of answering it. A thread-only item with no code draft has no fix
    // to apply, so this decision would be a no-op — refuse it rather than silently swallow it.
    if (!f.draft) {
      toast('Nothing to fix here — this thread has no proposed code change. Use Reply or Push back.');
      return;
    }
    setFlowDecision(fp, 'fix-only');
    const ok = await persistDecisionField(fp, 'fix-only');
    if (!ok) { reviewRefresh(); return; }
    await acceptAll(f);
    next();
  } else if (kind === 'edit') {
    setFlowDecision(fp, 'edit');
    // Suggestion-only finding (no code-diff draft): there are no per-hunk controls to reveal, so
    // open the inline editor — the reviewer keeps the suggestion visible and writes a separate
    // note/answer. Save persists the note on the finding.
    if (!f.draft) {
      state.flow.editingComment = fp;
      state.flow.editingKind = 'edit';
      if (!inStepper) state.modalMode = 'review';
      reviewRefresh();
      requestAnimationFrame(() => { const ta = $('.comment-edit-ta'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } });
      return;
    }
    if (!inStepper) state.modalMode = 'review';
    if (draftVerdict(f) !== 'proposed') await setVerdict(fp, 'proposed');
    else reviewRefresh();   // reveal the per-hunk controls; reviewer edits then Next
  } else if (kind === 'redirect') {
    setFlowDecision(fp, 'redirect');
    // Suggestion-only finding: same editor (suggestion read-only + a counter/answer field), so the
    // reviewer can write where/how it should be done instead even without a code-diff draft.
    if (!f.draft) {
      state.flow.editingComment = fp;
      state.flow.editingKind = 'redirect';
      if (!inStepper) state.modalMode = 'review';
      reviewRefresh();
      requestAnimationFrame(() => { const ta = $('.comment-edit-ta'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } });
      return;
    }
    if (!inStepper) state.modalMode = 'review';
    if (draftVerdict(f) !== 'redirect') await setVerdict(fp, 'redirect');
    else reviewRefresh();
    requestAnimationFrame(() => { const ta = $('.review-note-ta'); if (ta) ta.focus(); });
  } else if (kind === 'waive') {
    state.flow.waiving = fp;
    reviewRefresh();
  } else if (kind === 'skip') {
    setFlowDecision(fp, 'skip');
    next();
  }
}

/* A decision the Decision Summary lists as e.g. "Apply as proposed" must mean the server
 * actually holds it — otherwise the summary is describing a click, not a saved state. Both
 * persist helpers below report ok/failed here instead of only toasting, so a dropped POST
 * (server down mid-stepper, say) stays visible on the finding and blocks Apply rather than
 * silently reading as decided. Cleared the moment a later persist for the same fp succeeds. */
function markPersisted(fp, ok) {
  if (ok) delete state.flow.persistFailed[fp];
  else state.flow.persistFailed[fp] = true;
}

/* Persist a triage decision (approve/edit, or null to clear) onto the finding so the board,
 * stepper and Post screen stay in sync and it survives a refresh. Optimistic, then reloads.
 * Returns whether the server actually accepted it — callers must not advance/report success
 * on a false return (U-2). */
async function persistDecisionField(fp, decision) {
  const cur = findFinding(fp);
  if (cur) { if (decision) cur.decision = decision; else delete cur.decision; }
  try {
    await api(`/api/features/${encodeURIComponent(current.id)}/findings/${encodeURIComponent(fp)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    await loadDetail(current.id, true);
    markPersisted(fp, true);
    return true;
  } catch (e) {
    toast(`Could not save decision: ${e.message} — it will show as "not saved" until you retry`);
    try { await loadDetail(current.id, true); } catch { /* keep optimistic */ }
    markPersisted(fp, false);
    return false;
  }
}

/* Dismiss = persist the finding as `waived` immediately (it moves to the Waived lane and the
 * decision sticks across refreshes), rather than holding the decision only in the browser.
 * Returns whether the server accepted it — same contract as persistDecisionField. */
async function persistWaive(fp, reason) {
  const cur = findFinding(fp);
  if (cur) { cur.status = 'waived'; cur.statusReason = reason || 'dismissed'; }   // optimistic
  try {
    await api(`/api/features/${encodeURIComponent(current.id)}/findings/${encodeURIComponent(fp)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'waived', reason: reason || 'dismissed' }),
    });
    await loadDetail(current.id, true);
    markPersisted(fp, true);
    return true;
  } catch (e) {
    toast(`Could not dismiss: ${e.message} — it will show as "not saved" until you retry`);
    try { await loadDetail(current.id, true); } catch { /* keep optimistic */ }
    markPersisted(fp, false);
    return false;
  }
}

/* Retry a decision whose persist previously failed (surfaced as "not saved — retry" on the
 * decision row and the Decision Summary). Re-issues the same persist call decide() made —
 * doesn't re-run acceptAll/advance, so it's safe to call from the finish screen without
 * disturbing the reviewer's position. */
async function retryPersist(fp) {
  const dec = state.flow.decisions[fp];
  if (!dec) return;
  if (dec.kind === 'accept') await persistDecisionField(fp, 'approve');
  else if (dec.kind === 'fix-only') await persistDecisionField(fp, 'fix-only');
  else if (dec.kind === 'waive') await persistWaive(fp, dec.reason || 'dismissed');
  else { delete state.flow.persistFailed[fp]; }   // decisions with no direct persist call (edit/redirect/skip)
  reviewRefresh();
}

/* Accept the whole proposal: mark every hunk accepted + verdict proposed, in one
 * merged POST. Optimistic, then reconciled from the server. */
async function acceptAll(f) {
  // Suggestion-only finding (no code-diff draft): the approval is the decision —
  // there's nothing to persist server-side until the Post step.
  if (!f.draft) { reviewRefresh(); return; }
  const { hunks } = draftStats(f);
  const hunkObj = {};
  for (const hk of hunks) hunkObj[String(hk.id)] = { status: 'accepted', at: new Date().toISOString() };
  const cur = findFinding(f.fp);
  if (cur && cur.draft) {
    cur.draft.review = { ...(cur.draft.review || {}), hunks: hunkObj, verdict: 'proposed', updatedAt: new Date().toISOString() };
  }
  reviewRefresh();
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
  reviewRefresh();
}

/* ---- finish: the decision summary ---- */

function flowDecisionKind(fp) {
  const dec = state.flow.decisions[fp];
  return (dec && dec.kind) || 'skip';
}

/* Per-kind labels for the finish-screen decision tallies + summary pills. */
const FINISH_TALLIES = {
  spec: [
    ['accept', 'Apply as proposed'], ['edit', 'Apply with edits'],
    ['redirect', 'Redirect'], ['waive', 'Waive'], ['skip', 'Skipped'],
  ],
  'pr-review': [
    ['accept', 'Approved'], ['edit', 'Edited'], ['waive', 'Dismissed'], ['skip', 'Undecided'],
  ],
  'pr-respond': [
    ['accept', 'Reply'], ['edit', 'Fix + reply'], ['fix-only', 'Fix, no reply'],
    ['redirect', 'Push back'], ['skip', 'Skipped'],
  ],
};
const DEC_PILL = {
  spec: DEC_LABEL,
  'pr-review': { accept: 'Approved', edit: 'Edited', redirect: 'Redirect', waive: 'Dismissed', skip: 'Undecided' },
  'pr-respond': { accept: 'Reply', edit: 'Fix + reply', 'fix-only': 'Fix, no reply', redirect: 'Push back', waive: 'Dismissed', skip: 'Skipped' },
};

/* The PR number for a pr-review/pr-respond workspace, read off the title (#482)
 * or the id (pr-482-…), so the Post button can name the target PR. */
function prNumber(feature) {
  const t = (feature && feature.title) || '';
  let m = t.match(/#(\d+)/);
  if (m) return m[1];
  const id = (feature && feature.id) || '';
  m = id.match(/pr-?(\d+)/i) || id.match(/(\d+)/);
  return m ? m[1] : null;
}

function finishView(data) {
  const findings = (data.ledger && data.ledger.findings) || [];
  const kind = (data.feature && data.feature.kind) || 'spec';
  const isPr = kind === 'pr-review' || kind === 'pr-respond';
  const counts = { accept: 0, edit: 0, redirect: 0, waive: 0, skip: 0 };
  const byTarget = new Map();
  for (const fp of state.flow.items) {
    const f = findings.find((x) => x.fp === fp);
    if (!f) continue;
    const dec = state.flow.decisions[fp];
    const dk = (dec && dec.kind) || 'skip';
    counts[dk] = (counts[dk] || 0) + 1;
    const target = (f.draft && f.draft.target && f.draft.target.trim()) || f.locus || '—';
    if (!byTarget.has(target)) byTarget.set(target, []);
    byTarget.get(target).push({ f, kind: dk, reason: dec && dec.reason });
  }

  const [, many] = reviewNoun(kind);
  const tally = (cls, label, n) => h('span', { class: `finish-tally t-${cls}` },
    h('span', { class: 'num' }, String(n)), label);
  const tallySpecs = FINISH_TALLIES[kind] || FINISH_TALLIES.spec;
  const head = h('div', { class: 'finish-head' },
    h('h1', {}, isPr ? 'Triage summary' : 'Decision summary'),
    h('p', { class: 'view-sub' }, `${plural(state.flow.items.length, many.replace(/s$/, ''), many)} reviewed · ${data.feature.title || current.id}`),
    h('div', { class: 'finish-tallies' },
      tallySpecs.map(([k, label]) => tally(k, label, counts[k] || 0))));

  const pillMap = DEC_PILL[kind] || DEC_LABEL;
  const groups = [...byTarget.entries()].map(([target, rows]) => h('div', { class: 'finish-group' },
    h('div', { class: 'finish-group-head' }, h('code', { class: 'finish-target' }, target)),
    h('div', { class: 'finish-rows' }, rows.map(({ f, kind: dk, reason }) => {
      const sev = SEV[f.severity] ? f.severity : 'info';
      // A decision the server never confirmed must not read the same as a saved one here —
      // this IS the screen that told the reviewer their click "will be applied" (U-2).
      const notSaved = state.flow.persistFailed[f.fp]
        ? h('button', {
            class: 'dec-not-saved', type: 'button',
            title: 'The server did not confirm this decision.', onclick: () => retryPersist(f.fp),
          }, '⚠ not saved — retry')
        : null;
      return h('div', { class: 'finish-row' },
        h('span', { class: `sev-glyph sev-${sev}` }, SEV[sev].glyph),
        h('span', { class: 'frow-title' }, f.title || '(untitled)',
          reason ? h('span', { class: 'meta-dim' }, ` — ${reason}`) : null),
        h('span', { class: `dec-pill dec-${dk}` }, pillMap[dk] || dk),
        notSaved);
    }))));

  // `fix-only` belongs here too: it's the decision with the MOST to hand a coding agent (a code
  // change and no reply to soften it). Omitting it made the work order claim "no applicable changes"
  // on a screen showing two agreed fixes.
  const applyKinds = (fp) => ['accept', 'edit', 'fix-only', 'redirect'].includes(flowDecisionKind(fp));
  const reworkFps = state.flow.items.filter(applyKinds);
  const waiveItems = state.flow.items
    .filter((fp) => flowDecisionKind(fp) === 'waive')
    .map((fp) => ({ fp, reason: (state.flow.decisions[fp] && state.flow.decisions[fp].reason) || '' }));
  const toExport = reworkFps.map((fp) => findings.find((x) => x.fp === fp)).filter(Boolean);
  // Findings this screen is about to write back or mark in-flight, but whose decision the
  // server never confirmed — Apply/Mark must refuse rather than act on a click that may not
  // be what's actually recorded server-side (U-2).
  const unsavedInScope = [...reworkFps, ...waiveItems.map((w) => w.fp)]
    .filter((fp) => state.flow.persistFailed[fp]);
  const unsavedWarning = unsavedInScope.length
    ? h('p', { class: 'finish-unsaved-warning' },
        `⚠ ${plural(unsavedInScope.length, 'decision', 'decisions')} above didn't save to the server — retry ${unsavedInScope.length === 1 ? 'it' : 'them'} before applying or marking in-flight.`)
    : null;

  const exportEl = toExport.length
    ? exportPanel(data.feature, toExport, 'feature')
    : h('p', { class: 'meta-dim export-empty' }, 'No applicable changes to export — every item was waived or skipped.');

  // Spec: "Apply accepted changes" (write-back to ADO/Confluence via the runner) is the primary
  // action; "Mark in-flight" stays as the local-only bookkeeping. PR: the Post gate is the whole
  // action (postActionEl). Only accept/edit are written back — redirect is countered (re-auditing),
  // reject/waive/skip are not.
  const applyN = reworkFps.length + waiveItems.length;
  const applyableFps = state.flow.items.filter((fp) => ['accept', 'edit'].includes(flowDecisionKind(fp)));
  const applyableN = applyableFps.length;
  // Apply only writes findings that carry an actual before→after draft bound to a write target
  // (targetRef) and aren't rejected/redirected. Approving a finding ≠ having a writable proposal —
  // drafts come from /flowlever:propose. Gating on this is what stops Apply from silently no-opping.
  const isDraftable = (fp) => {
    const ff = findings.find((x) => x.fp === fp);
    const dr = ff && ff.draft;
    const tr = dr && dr.targetRef;
    const verdict = dr && dr.review && dr.review.verdict;
    return !!tr && verdict !== 'reject' && verdict !== 'redirect';
  };
  const draftableFps = applyableFps.filter(isDraftable);
  const draftableN = draftableFps.length;
  const undraftedN = applyableN - draftableN;   // approved/edited but no writable draft yet
  const applyReqs = state.flow.applyReqs || [];
  const activeApply = applyReqs.find((r) => r.status === 'queued' || r.status === 'running');
  const busy = !!(state.flow.applying || activeApply);
  // The primary spec button has three modes: APPLY (writable drafts exist) · PROPOSE (approved but
  // nothing drafted yet — clicking drafts them) · disabled (nothing accepted). This is what makes
  // "Draft proposals first" actually DO something instead of being an inert disabled button.
  const proposeMode = !busy && draftableN === 0 && undraftedN > 0;
  const applyMode = !busy && draftableN > 0;
  const applyLabel = busy
    ? (activeApply && activeApply.status === 'running'
        ? `⏳ Applying${activeApply.phase ? ` · ${activeApply.phase}` : '…'}`
        : '⏳ Queued…')
    : (applyMode ? `Apply ${plural(draftableN, 'change', 'changes')} → ADO / Confluence`
        : proposeMode ? `Draft ${plural(undraftedN, 'proposal', 'proposals')} first`
        : 'Nothing accepted to apply');
  // Apply writes real proposals to real ADO/Confluence targets — the same class of action
  // PR posting gates behind an explicit "Run now?" (renderRunnerZone's showConfirm). A single
  // click used to both queue the write and start the runner that executes it; this makes Apply
  // ask the same are-you-sure, naming what gets written and where, before doing either.
  const confirmingApply = applyMode && !!state.flow.confirmApply;
  const applyPrimary = confirmingApply
    ? h('span', { class: 'apply-confirm' },
        h('span', { class: 'runner-confirm-msg' },
          `Write ${plural(draftableN, 'change', 'changes')} to ADO work-item fields / Confluence sections now?`),
        h('button', {
          class: 'btn btn-accent', type: 'button',
          onclick: () => { state.flow.confirmApply = false; applySpec(draftableFps); },
        }, '▶ Write now'),
        h('button', {
          class: 'btn', type: 'button',
          onclick: () => { state.flow.confirmApply = false; renderFlowInto(); },
        }, 'Cancel'))
    : h('button', {
        class: `btn btn-accent${busy ? ' is-busy' : ''}`, type: 'button',
        disabled: busy || unsavedInScope.length > 0 || (!applyMode && !proposeMode),
        'aria-busy': busy ? 'true' : 'false',
        title: unsavedInScope.length > 0
          ? `${plural(unsavedInScope.length, 'decision', 'decisions')} below didn't save — retry ${unsavedInScope.length === 1 ? 'it' : 'them'} first.`
          : applyMode
            ? 'Queue the write-back: the runner applies your accepted/edited proposals to ADO work-item fields / Confluence sections — surgically, on your confirmation (nothing is written until you click, and confirmed again next).'
            : proposeMode
              ? 'Draft the before→after edits for your accepted findings (runs /flowlever:propose). You then review them here and Apply.'
              : 'Nothing accepted to apply yet.',
        onclick: () => {
          if (applyMode) { state.flow.confirmApply = true; renderFlowInto(); }
          else if (proposeMode) enqueuePropose();
        },
      }, busy ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : null, applyLabel);
  const actions = h('div', { class: 'finish-actions' },
    isPr ? null : applyPrimary,
    isPr ? null : h('button', {
      class: 'btn', type: 'button', disabled: applyN === 0 || busy || unsavedInScope.length > 0,
      title: unsavedInScope.length > 0
        ? `${plural(unsavedInScope.length, 'decision', 'decisions')} below didn't save — retry ${unsavedInScope.length === 1 ? 'it' : 'them'} first.`
        : 'Mark these findings as rework-in-flight locally (no write-back).',
      onclick: () => applyReviewed(reworkFps, waiveItems),
    }, applyN ? `Mark ${plural(applyN, 'finding', 'findings')} in-flight` : 'Nothing to mark'),
    h('button', { class: 'btn', type: 'button', onclick: () => { state.flow.finish = false; renderFlowInto(); } }, '← Back to steps'),
    h('button', { class: 'btn', type: 'button',
      onclick: () => { location.hash = `#/feature/${encodeURIComponent(current.id)}`; } }, 'Exit to board'));

  return h('div', { class: 'finish' },
    h('a', { class: 'backlink', href: `#/feature/${encodeURIComponent(current.id)}` }, '← Overview'),
    head,
    ...groups,
    unsavedWarning,
    postActionEl(data),
    h('div', { class: 'finish-head' },
      h('div', { class: 'step-section-label' }, 'Export work order — hand to a coding agent'),
      exportEl),
    actions,
    (!isPr && undraftedN > 0 && draftableN === 0)
      ? h('div', { class: 'apply-status apply-needs-input' },
          h('span', { class: 'apply-dot' }, '✎'),
          h('span', {}, `${plural(undraftedN, 'accepted finding', 'accepted findings')} have no writable draft yet. `,
            'Run ', h('code', {}, `/flowlever:propose ${current.id}`),
            ' to draft the before→after edits, review them, then Apply. (Structural or decision-only findings may stay as action items.)'))
      : null,
    isPr ? null : applyStatusEl(state.flow.applyReqs || []),
    nextStepNote(data));
}

/* Live status of the spec write-back (apply) request, shown under the finish
 * actions so "Apply" feels responsive: queued → applying (+phase) → applied /
 * failed, plus the amber "needs your input" cue when the runner hits a 2FA/auth
 * prompt. Reads the latest apply request for this workspace. */
function applyStatusEl(applyReqs) {
  if (!applyReqs.length) return null;
  const r = [...applyReqs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (!r) return null;
  if (r.needsInput) {
    return h('div', { class: 'apply-status apply-needs-input' },
      h('span', { class: 'apply-dot' }, '⚠'),
      h('span', {}, r.note || 'Waiting on you — approve the auth prompt in your other window to continue.'));
  }
  const isPropose = r.action === 'propose';
  if (r.status === 'queued') {
    return h('div', { class: 'apply-status apply-running' },
      h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', {}, 'Queued — waiting for the runner to pick it up…'));
  }
  if (r.status === 'running') {
    return h('div', { class: 'apply-status apply-running' },
      h('span', { class: 'spinner', 'aria-hidden': 'true' }),
      h('span', {}, isPropose ? `Drafting proposals${r.phase ? ` — ${r.phase}` : '…'}` : `Applying${r.phase ? ` — ${r.phase}` : ' to spec…'}`));
  }
  if (r.status === 'done') {
    return h('div', { class: 'apply-status apply-done' },
      h('span', { class: 'apply-dot' }, '✓'),
      h('span', {}, isPropose
        ? `${r.phase || 'Proposals drafted'} — review the red/green diffs, then Apply.`
        : `${r.phase || 'Applied to spec'} — re-audit to confirm the edits landed.`));
  }
  if (r.status === 'error') {
    return h('div', { class: 'apply-status apply-error' },
      h('span', { class: 'apply-dot' }, '⚠'),
      h('span', {}, `Apply failed: ${r.note || 'see the Claude session for details'}`));
  }
  return null;
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
  return h('div', { class: 'finish-next' }, '↻ Next: ', h('strong', {}, 'Apply'),
    ' writes accepted changes back to ADO / Confluence (countered items re-audit automatically), then ',
    h('code', {}, '/flowlever:audit'), ' reconciles the ledger.');
}

function postActionEl(data) {
  const kind = data.feature && data.feature.kind;
  if (kind !== 'pr-review' && kind !== 'pr-respond') return null;
  const noun = kind === 'pr-review' ? ['comment', 'comments'] : ['reply', 'replies'];
  // Only approved/edited (and, for respond, pushed-back or fix-only) items post; dismissed +
  // undecided do not — the Post button counts exactly what will be sent.
  const postable = kind === 'pr-review' ? ['accept', 'edit'] : ['accept', 'edit', 'fix-only', 'redirect'];
  const decided = state.flow.items.map(flowDecisionKind);
  const postN = decided.filter((k) => postable.includes(k)).length;
  // A fix-only item writes code and resolves its thread but posts NO reply, so it must not be
  // counted as one — "Post 3 replies" when only 2 are replies is exactly the kind of quiet
  // inaccuracy that makes the cockpit disagree with the PR.
  const fixOnlyN = decided.filter((k) => k === 'fix-only').length;
  const replyN = postN - fixOnlyN;
  const prNum = prNumber(data.feature);
  const target = prNum ? `PR #${prNum}` : 'the PR';
  const verb = kind === 'pr-review' ? 'Post comments' : (replyN === 0 && fixOnlyN > 0 ? 'Push fixes' : 'Post replies');

  const reqs = (state.flow.applyReqs || []).slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  const latest = reqs[reqs.length - 1];
  const stalled = !!latest && isStaleJob(latest);
  // A stalled job is NOT active: keep the button live so the user can retry instead of staring
  // at a disabled "Queued…" that will never advance.
  const active = !!latest && (latest.status === 'queued' || latest.status === 'running') && !stalled;
  const errored = !!latest && latest.status === 'error';
  // "Posted" is only true when the runner actually STAMPED the findings (postedAt). A request that
  // merely reached `done` while items sit in the in-flight lane means the write wasn't confirmed —
  // claiming success there is what makes the cockpit disagree with the real PR.
  const pendingLeft = ((data.ledger && data.ledger.findings) || []).filter(isPending).length;
  const posted = !!latest && latest.status === 'done' && pendingLeft === 0;
  const unconfirmed = !!latest && latest.status === 'done' && pendingLeft > 0;
  const meta = latest ? (REQ_STATUS[latest.status] || REQ_STATUS.queued) : null;

  const statusLine = latest
    ? h('span', { class: `post-status req-state-${cssSafe(stalled ? 'stalled' : latest.status)}` },
        h('span', { class: `req-glyph req-glyph-${cssSafe(stalled ? 'stalled' : latest.status)} ${meta.spin && !stalled ? 'req-spin' : ''}`.trim() },
          stalled ? '⏸' : meta.glyph),
        ' ',
        stalled ? `Not running — ${latest.status} ${fmtAge(jobAgeMs(latest))} ago, nothing posted`
          : posted ? `Posted to ${target}`
          : unconfirmed ? `Finished, but ${plural(pendingLeft, 'item', 'items')} not confirmed as posted`
          : meta.label,
        errored && latest.note ? h('span', { class: 'meta-dim' }, ` — ${latest.note}`) : null,
        stalled ? h('span', { class: 'meta-dim' }, ' — start /flowlever:watch, then retry') : null)
    : null;

  // Retrying after a job that never confirmed must first RELEASE the stranded in-flight markers —
  // otherwise the items are excluded from the post set and the retry silently posts nothing.
  const needsRelease = pendingLeft > 0 && (stalled || unconfirmed || errored);
  // Spell out the mix so the button never over-promises: "Post 2 replies + 1 fix to PR #5751".
  const parts = [];
  if (replyN) parts.push(`${replyN} ${replyN === 1 ? noun[0] : noun[1]}`);
  if (fixOnlyN) parts.push(`${fixOnlyN} ${fixOnlyN === 1 ? 'fix' : 'fixes'} (no reply)`);
  const postLabel = parts.length
    ? `${verb.split(' ')[0]} ${parts.join(' + ')} to ${target}`
    : `${verb.split(' ')[0]} ${postN} ${postN === 1 ? noun[0] : noun[1]} to ${target}`;
  const btn = h('button', {
    class: 'btn btn-accent btn-post', type: 'button',
    disabled: active || (postN === 0 && !posted && !errored && !stalled && !unconfirmed),
    onclick: () => (needsRelease ? retryPost(data, kind, verb) : postBack(data, kind, verb)),
  }, active ? 'Queued…'
    : stalled || unconfirmed || errored ? 'Retry post'
    : posted ? `${verb} again`
    : postLabel);

  // AI-disclosure toggle: on by default; the choice rides the apply request's
  // `instructions`, so the runner needs no other channel to know it.
  if (state.flow.disclosure === undefined) state.flow.disclosure = true;
  // The footer only lands on text that gets written, so it's meaningless when every decision is
  // fix-only — don't offer a toggle that changes nothing.
  const disclosureToggle = replyN === 0 && fixOnlyN > 0 ? null
    : h('label', { class: 'post-disclosure meta-dim', title: `When on, each posted ${noun[0]} ends with "${DISCLOSURE_LINE}".` },
      h('input', {
        type: 'checkbox', checked: state.flow.disclosure ? 'checked' : undefined, disabled: active ? 'disabled' : undefined,
        onchange: (e) => { state.flow.disclosure = e.target.checked; },
      }),
      ` ${DISCLOSURE_LINE}`);

  // If a job is waiting and nothing is draining the queue, put the run control right next to the
  // status line — this is the screen the user is staring at while wondering why nothing happens.
  const needsRunner = !!latest && (latest.status === 'queued' || latest.status === 'running') && !runnerBusy();
  return h('div', { class: 'finish-post' },
    h('div', { class: 'step-section-label' }, `${verb} — nothing is sent until you click this`),
    h('div', { class: 'finish-post-row' },
      btn,
      statusLine,
      needsRunner ? runnerZone(1, '▶ Run it now') : null,
      h('span', { class: 'meta-dim post-flow' }, 'queued → running → posted')),
    disclosureToggle);
}

/* Post gate for PR workspaces: first persist the triage to finding statuses
 * (approved/edited → resolved "will post", dismissed → waived), then enqueue the
 * `apply` request the runner posts back to the PR. */
async function postBack(data, kind, verb) {
  await persistTriage(data);
  await enqueueApply(verb, kind);
}

/* Retry a Post whose previous attempt never confirmed (job stalled, errored, or finished without
 * stamping). Releases the stranded in-flight markers first, then rebuilds the post set from the
 * findings' persisted decisions — so the retry actually carries the items, instead of enqueueing
 * an apply over an empty set because the pending ones were filtered out. */
async function retryPost(data, kind, verb) {
  const fid = current.id;
  try {
    await api(`/api/features/${encodeURIComponent(fid)}/review/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'retrying the post — previous attempt never confirmed' }),
    });
    await loadDetail(fid, true);
  } catch (e) {
    toast(`Could not reset the previous attempt: ${e.message}`);
    return;
  }
  // Rebuild the snapshot from the released findings (their approve/edit decisions survived).
  state.flow.items = null;
  initFlow(state.detail);
  state.flow.finish = true;
  await postBack(state.detail, kind, verb);
  renderFlowInto();
}

async function persistTriage(data) {
  const postFps = [];
  const waiveItems = [];
  for (const fp of state.flow.items) {
    const k = flowDecisionKind(fp);
    if (k === 'skip') continue;                       // undecided → leave open
    if (k === 'waive') waiveItems.push({ fp, reason: (state.flow.decisions[fp] && state.flow.decisions[fp].reason) || 'dismissed' });
    else postFps.push(fp);                             // accept / edit / redirect → posting back
  }
  try {
    if (postFps.length) {
      // Mark them "Posting…" (in-flight), NOT posted: the real postedAt stamp is set by the
      // runner once the comment is actually on the PR. This keeps the lane honest — the card
      // reads "Posting…" until the runner finishes, then moves to "Posted — awaiting author".
      await api(`/api/features/${encodeURIComponent(current.id)}/review/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fps: postFps, status: 'pending-post' }),
      });
    }
    for (const { fp, reason } of waiveItems) {
      await api(`/api/features/${encodeURIComponent(current.id)}/findings/${encodeURIComponent(fp)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'waived', reason: reason.trim() || 'dismissed' }),
      });
    }
    await loadDetail(current.id, true);
  } catch (e) {
    toast(`Could not save triage: ${e.message}`);
  }
}

/* Re-review: enqueue a fresh `pr-review` run for the SAME PR. The runner re-fetches the PR
 * (the author's replies + any new commits) and re-ingests — reconciliation auto-resolves the
 * findings the author addressed, keeps the ones still flagged, and inserts anything new. Same
 * loop as a spec re-audit; stable `pr:<n>:<path>:<line>` loci keep fingerprints aligned. */
async function reReviewPr(data) {
  const feature = (data && data.feature) || (state.detail && state.detail.feature);
  const prNum = prNumber(feature);
  if (!prNum) { toast('Could not determine the PR number for this workspace'); return; }
  try {
    await api('/api/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // wsId pins the re-review to THIS workspace so it reconciles into the same ledger
      // rather than spinning up a duplicate pr-<id>-<slug>.
      body: JSON.stringify({ action: 'pr-review', prId: String(prNum), wsId: current.id, title: feature.title || null }),
    });
    toast(`Re-review of PR #${prNum} queued — the runner will reconcile the author’s response`, 'success');
    // We're acting on the response now — clear the "author responded" flag (best-effort) so the
    // workspace returns to waiting until the re-review lands.
    try {
      await api(`/api/features/${encodeURIComponent(current.id)}/activity`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorResponded: false }),
      });
      await loadDetail(current.id, true);
      rerenderDetail();
    } catch { /* non-fatal */ }
    ensureApplyPolling();
    pollRequestsNow();
  } catch (e) {
    toast(`Could not queue re-review: ${e.message}`);
  }
}

/* Re-audit: enqueue a fresh full audit of the SAME spec workspace. The runner re-fetches the
 * spec sources and re-ingests — reconciliation auto-resolves the findings the spec now reflects
 * (the applied ones), keeps any still-open, and flags regressions. `wsId` pins it to THIS
 * workspace (the watch runner treats `audit` + wsId as "re-audit existing", not a new analysis). */
async function reAuditSpec(data) {
  const feature = (data && data.feature) || (state.detail && state.detail.feature);
  try {
    await api('/api/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'audit', wsId: current.id, title: (feature && feature.title) || null }),
    });
    toast('Re-audit queued — the runner will re-fetch the spec and reconcile', 'success');
    ensureApplyPolling();
    pollRequestsNow();
  } catch (e) {
    toast(`Could not queue re-audit: ${e.message}`);
  }
}

/* Draft proposals: enqueue a `propose` job the runner fulfils with /flowlever:propose, which
 * attaches before→after drafts to the accepted findings (read-only — writes nothing external).
 * Once drafted, this same button flips to "Apply". */
async function enqueuePropose() {
  state.flow.applying = true;     // reuse the busy spinner while the propose job runs
  renderFlowInto();
  try {
    await api('/api/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'propose', wsId: current.id }),
    });
    toast('Drafting proposals — the runner will attach before→after edits for review', 'success');
    ensureApplyPolling();
    pollRequestsNow();
  } catch (e) {
    state.flow.applying = false;
    renderFlowInto();
    toast(`Could not queue propose: ${e.message}`);
  }
}

/* Spec Apply gate: first move the accepted/edited findings into the "Applying…" lane
 * (pending=apply — in-flight, NOT yet written), then enqueue the apply request the runner
 * fulfils. The runner stamps appliedAt on the real write → "Applied — awaiting re-audit". */
async function applySpec(applyableFps) {
  if (applyableFps && applyableFps.length) {
    try {
      await api(`/api/features/${encodeURIComponent(current.id)}/review/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fps: applyableFps, status: 'pending-apply' }),
      });
      await loadDetail(current.id, true);
    } catch (e) {
      toast(`Could not mark applying: ${e.message}`);
    }
  }
  await enqueueApply('Apply spec changes');
}

async function enqueueApply(label, kind) {
  // Optimistic: flip the button into its busy state immediately (before the POST
  // round-trips) so the click feels responsive; the apply-request polling then
  // drives the real queued → running → done state.
  state.flow.applying = true;
  renderFlowInto();
  try {
    const isPr = kind === 'pr-review' || kind === 'pr-respond';
    // For PR posts, spell the disclosure choice out on the request so the runner
    // never has to guess (checkbox in postActionEl; default on).
    const disclosure = state.flow.disclosure !== false
      ? `disclosure: append "${DISCLOSURE_LINE}" as the last line of every posted ${kind === 'pr-review' ? 'comment' : 'reply'}`
      : 'disclosure: off — post the reviewed text verbatim, no AI footer';
    // Call out fix-only items explicitly. The runner can read `decision: "fix-only"` off the
    // ledger, but a reply posted where the user asked for silence is not a recoverable mistake —
    // so it gets said twice.
    const fixOnly = state.flow.items.filter((fp) => flowDecisionKind(fp) === 'fix-only');
    const fixNote = fixOnly.length
      ? ` · fix-only (do NOT reply — push the fix, then set the thread status to Fixed): ${fixOnly.join(', ')}`
      : '';
    const instructions = !isPr ? undefined : `${disclosure}${fixNote}`;
    await api('/api/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'apply', wsId: current.id, instructions }),
    });
    // Clicking Post/Apply IS the go-ahead to write. Queueing a job nobody is running turns that
    // into a silent no-op until the user happens to notice — so start the runner right here. Its
    // progress then shows on this very screen (queued → running → posted). No runner available
    // (no `claude` CLI) → say plainly that it's queued and needs a session.
    const r = await refreshRunner();
    if (r && r.available && !r.running) {
      await startRunner('watch', { silent: true });
      toast(`${label} — running now`, 'success');
    } else if (r && r.running) {
      toast(`${label} queued — the running session will pick it up`, 'success');
    } else {
      toast(`${label} queued — run /flowlever:watch in Claude Code to execute it`, 'success');
    }
    ensureApplyPolling();
    pollRequestsNow();
  } catch (e) {
    state.flow.applying = false;
    renderFlowInto();
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
  // Posted comments are awaiting the author — surface them so the inbox shows a PR is
  // out for response (and can be re-reviewed), not silently "settled".
  if (c.posted) bits.push(`${c.posted} posted`);
  return bits;
}

function inboxRow(r) {
  const done = r.status === 'done';
  const bits = done ? [] : needsYouBits(r.counts);   // a completed workspace never nags
  const rd = r.readiness || { score: 0, gate: 'in-progress' };
  const wrap = h('div', { class: `ir-wrap ${done ? 'ir-done' : ''}`.trim() });

  const link = h('a', { class: 'inbox-row', href: `#/feature/${encodeURIComponent(r.id)}` },
    dialEl(rd.score, rd.gate, 44, 'dial-sm ir-dial'),
    h('div', { class: 'ir-main' },
      h('div', { class: 'ir-top' }, kindBadge(r.kind), h('span', { class: 'ir-title' }, r.title || r.id),
        done ? h('span', { class: 'chip status-done ir-done-chip' }, 'done') : null),
      h('div', { class: 'ir-needs' },
        done
          ? h('span', { class: 'ir-clear' }, '✓ Review complete')
          : bits.length
            ? bits.map((b) => h('span', { class: 'ir-bit' }, b))
            : h('span', { class: 'ir-clear' }, rd.gate === 'ready' ? '✓ Ready to build' : '✓ Nothing needs you')),
      // PR rows carry the reviewed-vs-updated stamps, so the inbox shows at a glance which
      // PRs have moved since we last looked at them.
      done ? null : reviewStampsRow(r, r.kind, { compact: true, cls: 'review-stamps ir-stamps' })),
    h('span', { class: 'ir-arrow', 'aria-hidden': 'true' }, '→'));

  const label = r.title || r.id;

  function showDefault() {
    const trashBtn = h('button', {
      class: 'btn-icon ir-delete', type: 'button',
      'aria-label': `Delete workspace ${label}`, title: 'Delete workspace',
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); showConfirm(); },
    }, h('span', { class: 'icon', html: ICONS.trash }));
    wrap.replaceChildren(link, trashBtn);
  }

  function showConfirm() {
    wrap.replaceChildren(h('div', { class: 'delete-confirm' },
      h('span', { class: 'delete-confirm-msg' },
        `Delete "${label}"? This removes its findings and history. This can't be undone.`),
      h('div', { class: 'delete-confirm-actions' },
        h('button', { class: 'btn btn-danger', type: 'button', onclick: doDelete }, 'Delete'),
        h('button', { class: 'btn', type: 'button', onclick: showDefault }, 'Cancel'))));
  }

  async function doDelete() {
    try {
      await api(`/api/features/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
      wrap.remove();
      toast(`Deleted "${label}"`, 'success');
    } catch (e) {
      toast(`Delete failed: ${e.message}`);
      showDefault();
    }
  }

  showDefault();
  return wrap;
}

/* Active-first lists: finished workspaces are tucked into a collapsed <details> so
 * what still needs you stays on top. Keyed open-state survives the polling re-renders
 * (which rebuild the list every tick) so an expanded "Done" section doesn't snap shut. */
const doneOpen = {};
function doneDisclosure(key, count, bodyEl) {
  return h('details', {
      class: 'done-disc', open: !!doneOpen[key],
      ontoggle: (e) => { doneOpen[key] = e.currentTarget.open; },
    },
    h('summary', { class: 'done-disc-sum' }, `Done (${count})`),
    bodyEl);
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
      h('div', { class: 'section-actions' }, refreshZone(null), runnerZone(0)),
      requestsStripEl([]),
      h('div', { class: 'empty' },
        h('div', { class: 'empty-glyphs' },
          ...SEV_ORDER.map((s) => h('span', { class: `sev sev-${s}` },
            h('span', { class: 'sev-glyph' }, SEV[s].glyph), ' ', SEV[s].label))),
        h('h2', {}, 'Nothing in the cockpit yet'),
        h('p', {}, 'Seed the demo with ', h('code', {}, 'node src/cli.js demo'),
          ', or run ', h('code', {}, '/flowlever:audit'), ', ', h('code', {}, '/flowlever:pr-review'),
          ' or ', h('code', {}, '/flowlever:pr-respond'), ' from Claude Code.')));
    startHomeRequestsPoll();
    return;
  }

  const actionable = rows.filter((r) => r.status !== 'done' && needsYouBits(r.counts).length).length;
  const activeRows = rows.filter((r) => r.status !== 'done');
  const doneRows = rows.filter((r) => r.status === 'done');
  const lists = [];
  if (activeRows.length) lists.push(h('div', { class: 'inbox' }, activeRows.map(inboxRow)));
  else lists.push(h('p', { class: 'all-done-note' }, 'No active workspaces — everything below is complete.'));
  if (doneRows.length) lists.push(doneDisclosure('home', doneRows.length,
    h('div', { class: 'inbox done-disc-body' }, doneRows.map(inboxRow))));
  app.replaceChildren(
    h('div', { class: 'view-head' },
      h('h1', {}, 'Home'),
      h('p', { class: 'view-sub' }, actionable
        ? `${plural(actionable, 'workspace', 'workspaces')} need you · ${plural(rows.length, 'workspace', 'workspaces')} total`
        : `All caught up · ${plural(rows.length, 'workspace', 'workspaces')} under watch`)),
    h('div', { class: 'section-actions' }, refreshZone(null), runnerZone(0)),
    requestsStripEl([]),
    h('div', { class: 'section-lists' }, ...lists),
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
    // Home's Refresh button covers both PR sections, so any live poll job drives it.
    renderRefreshZone($('#refresh-zone'), null, pickPollJob(reqs, null));
    // Home's Run button offers to drain everything that's waiting, whatever section it belongs to.
    renderRunnerZone($('.runner-zone'), queuedJobs(reqs).length);
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
        ' or run ', h('code', {}, '/flowlever:audit'), ' from a Claude Code session.'));
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
  state.section = { kind, features };
  const gridZone = h('div', { id: 'features-grid-zone' }, sectionGrid(kind, features, []));

  app.replaceChildren(...[
    sectionHead(kind, features.length || null),
    // PR sections get the manual refresh next to "+ New …": queue a discovery pass now
    // instead of waiting for the scheduled poller.
    isPr
      ? h('div', { class: 'section-actions' }, newRequestZone(kind), refreshZone(kind), runnerZone(0))
      : (kind === 'spec' ? newAuditZone() : null),
    gridZone,
  ].filter(Boolean));

  if (isPr) startSectionRequestsPoll(kind);
}

/* The cards for a section, with each workspace's live job folded onto its card and a
 * placeholder card for any in-flight review whose workspace doesn't exist yet. No
 * separate jobs strip — the status lives on the card it belongs to. */
function sectionGrid(kind, features, requests) {
  const live = (requests || []).filter(isLiveJob);
  const used = new Set();
  const withJob = features.map((f) => {
    const job = jobForFeature(f, live);
    if (job) used.add(job.id);
    return { f, job };
  });
  // Cards sort by how urgently they need the user: needs-input first, then
  // errored, running, queued jobs, then idle workspaces (stable within a rank).
  const urgency = (job) => (job ? jobRank(job) : 0);
  // Active workspaces stay on top; finished ones drop into a collapsed "Done" section.
  const activeCards = withJob
    .filter(({ f }) => f.status !== 'done')
    .map(({ f, job }) => ({ rank: urgency(job), el: featureCard(f, job) }));
  const doneCards = withJob.filter(({ f }) => f.status === 'done').map(({ f, job }) => featureCard(f, job));
  // In-flight reviews for THIS section with no workspace yet → pending placeholder cards,
  // ranked in the same urgency pool as the workspace cards.
  const pending = live
    .filter((r) => r.action === kind && r.prId && !used.has(r.id))
    .map((r) => ({ rank: jobRank(r), el: pendingJobCard(r) }));
  const top = [...pending, ...activeCards].sort((a, b) => b.rank - a.rank).map((c) => c.el);
  if (!top.length && !doneCards.length) return sectionEmpty(kind);
  const lists = [];
  if (top.length) lists.push(h('div', { class: 'features-grid' }, top));
  else lists.push(h('p', { class: 'all-done-note' }, 'No active workspaces — everything below is complete.'));
  if (doneCards.length) lists.push(doneDisclosure(kind, doneCards.length,
    h('div', { class: 'features-grid done-disc-body' }, doneCards)));
  return h('div', { class: 'section-lists' }, ...lists);
}

/* Poll requests for a PR section: rebind jobs to cards every tick, and when a job
 * newly completes, refetch features so the runner's new/updated workspace card shows. */
function startSectionRequestsPoll(kind) {
  let lastDone = new Set();
  startPolling(`section:${kind}`, async (reqs) => {
    if (current.view !== 'section' || current.kind !== kind) return;
    // Jobs relevant to this section: same-kind reviews + apply jobs targeting its workspaces.
    const wsIds = new Set(state.section.features.map((f) => f.id));
    const rel = reqs.filter((r) => r.action === kind || (r.action === 'apply' && r.wsId && wsIds.has(r.wsId)));
    // The manual-refresh pass has no workspace of its own — it drives the Refresh button
    // instead of a card. An unscoped (`kind: null`) poll covers every PR section.
    renderRefreshZone($('#refresh-zone'), kind, pickPollJob(reqs, kind));
    // Count everything queued, not just this section's: the runner drains the whole queue, so
    // promising "run 1 job" while three others go along for the ride would be a lie.
    renderRunnerZone($('.section-actions .runner-zone'), queuedJobs(reqs).length);
    // A finished refresh may have created workspaces or updated activity stamps → refetch.
    const tracked = [...rel, ...reqs.filter((r) => r.action === 'poll' && (!r.kind || r.kind === kind))];
    const doneIds = new Set(tracked.filter((r) => r.status === 'done').map((r) => r.id));
    let newlyDone = false;
    doneIds.forEach((id) => { if (!lastDone.has(id)) newlyDone = true; });
    lastDone = doneIds;
    if (newlyDone) {
      try {
        const fresh = await api(`/api/features?kind=${encodeURIComponent(kind)}`);
        if (Array.isArray(fresh) && current.view === 'section' && current.kind === kind) state.section.features = fresh;
      } catch { /* keep cache */ }
    }
    const zone = $('#features-grid-zone');
    if (zone) zone.replaceChildren(sectionGrid(kind, state.section.features, rel));
  });
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

function featureCard(f, job) {
  const r = summaryReadiness(f);
  const kind = f.kind || 'spec';
  const metaBits = [];
  // PR workspaces don't carry Confluence/ADO/Figma sources — skip the sources line.
  if (kind === 'spec') {
    const src = sourcesLineText(f);
    if (src) metaBits.push(h('span', {}, src));
  }
  const lr = lastRoundDate(f);
  const isPrKind = kind === 'pr-review' || kind === 'pr-respond';
  // On PR cards the "Reviewed <ago>" stamp below already carries the last-round time — don't
  // print it twice; the "no rounds yet" case still needs saying.
  if (!(isPrKind && lr)) metaBits.push(h('span', { class: 'meta-dim' }, lr ? `last round ${lr}` : 'no rounds yet'));

  // A re-run on a workspace that already has findings reads as "re-reviewing".
  const hasFindings = (r.openBySeverity && Object.values(r.openBySeverity).some(Boolean))
    || (f.lastRoundAt || (f.rounds && f.rounds.length));
  const busyState = job
    ? (job.needsInput && job.status !== 'error' ? 'needs' : (isStaleJob(job) ? 'stale' : job.status))
    : null;
  const busyClass = job ? ` fc-busy fc-busy-${cssSafe(busyState)}` : '';

  const card = h('a', { class: `card feature-card ${f.status === 'done' ? 'fc-done' : ''}${busyClass}`.trim(), href: `#/feature/${encodeURIComponent(f.id)}` },
    h('div', { class: 'fc-top' },
      h('div', { class: 'fc-titlewrap' },
        h('div', { class: 'fc-title' }, f.title || f.id),
        h('div', {}, statusChip(f.status)),
      ),
      dialEl(r.score, r.gate, 64, 'dial-sm'),
    ),
    job ? cardJobRow(job, hasFindings) : (f.awaitingAuthor ? cardReviewRow(f) : null),
    // Reviewed-vs-updated stamps: on a PR card this is what tells you a re-review is due.
    reviewStampsRow(f, kind, { compact: true, cls: 'review-stamps fc-stamps' }),
    sevCountsRow(r.openBySeverity),
    metaBits.length ? h('div', { class: 'fc-meta' }, metaBits) : null,
  );

  const label = f.title || f.id;
  const wrap = h('div', { class: 'fc-wrap' });

  function showDefault() {
    const trashBtn = h('button', {
      class: 'btn-icon fc-delete', type: 'button',
      'aria-label': `Delete workspace ${label}`, title: 'Delete workspace',
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); showConfirm(); },
    }, h('span', { class: 'icon', html: ICONS.trash }));
    wrap.replaceChildren(card, trashBtn);
  }

  function showConfirm() {
    wrap.replaceChildren(h('div', { class: 'card feature-card delete-confirm' },
      h('p', { class: 'delete-confirm-msg' },
        `Delete "${label}"? This removes its findings and history. This can't be undone.`),
      h('div', { class: 'delete-confirm-actions' },
        h('button', { class: 'btn btn-danger', type: 'button', onclick: doDelete }, 'Delete'),
        h('button', { class: 'btn', type: 'button', onclick: showDefault }, 'Cancel'))));
  }

  async function doDelete() {
    try {
      await api(`/api/features/${encodeURIComponent(f.id)}`, { method: 'DELETE' });
      wrap.remove();
      toast(`Deleted "${label}"`, 'success');
    } catch (e) {
      toast(`Delete failed: ${e.message}`);
      showDefault();
    }
  }

  showDefault();
  return wrap;
}

/* ============================== UI-triggered job requests ============================== */

/* A request is a job the UI enqueues (POST /api/requests) for the session-side
 * runner skill (/flowlever:watch) to pick up. We poll GET /api/requests on a ~4s
 * cadence while Home or a PR section is open and reflect the status here. */

const REQ_STATUS = {
  queued:  { glyph: '⏳', label: 'Queued' },
  running: { glyph: '⠿', label: 'Running', spin: true },
  done:    { glyph: '✓', label: 'Done' },
  error:   { glyph: '✗', label: 'Error' },
};
const REQ_ACTION_LABEL = { 'pr-review': 'PR review', 'pr-respond': 'PR respond', apply: 'Post to PR', 're-audit': 'Re-audit', audit: 'Spec analysis', poll: 'Refresh' };

/* ---- live job ↔ card binding ----------------------------------------------
 * Instead of a separate "jobs" strip duplicating the cards, the active request
 * for a workspace is folded onto its card (and a brand-new review with no
 * workspace yet gets its own "pending" card). These helpers correlate them. */

// A job worth surfacing on a card: still in flight, blocked on the user, or failed.
// `done` jobs are not shown — the finished workspace card speaks for itself.
function isLiveJob(r) {
  return r.status === 'queued' || r.status === 'running' || r.status === 'error' || !!r.needsInput;
}

/* A queued job only moves when a /flowlever:watch runner is draining the queue. With no session
 * running, "· queued" is technically true but reads as "in progress" forever — which is the exact
 * trap that makes a Post look like it happened. Past this age we say what's really going on:
 * nobody is running it. Generous enough that a normal ~4s pickup never trips it. */
const JOB_STALE_MS = 3 * 60 * 1000;

function jobAgeMs(r) {
  const t = Date.parse(r.updatedAt || r.createdAt);
  return Number.isNaN(t) ? 0 : Date.now() - t;
}
/* Stale = waiting (or claiming to work) for longer than any real pickup takes, and not blocked on
 * the user (needsInput has its own, clearer banner). A `running` job that goes quiet this long has
 * almost certainly lost its session mid-flight.
 * A live runner clears the whole condition: the job isn't abandoned, it's waiting its turn in a
 * queue that is actively being drained — calling that "not running" would be the opposite lie. */
function isStaleJob(r) {
  if (r.needsInput) return false;
  if (r.status !== 'queued' && r.status !== 'running') return false;
  if (runnerBusy()) return false;
  return jobAgeMs(r) > JOB_STALE_MS;
}
/* Compact age for the stale note: "4m", "2h", "3d". */
function fmtAge(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
// Higher = more urgent, so a card shows the most important job when several match.
// A stalled job outranks a live one: it's the one that needs a human to unstick it.
function jobRank(r) {
  if (r.needsInput && r.status !== 'done' && r.status !== 'error') return 4;
  if (r.status === 'error') return 3;
  if (isStaleJob(r)) return 3;
  if (r.status === 'running') return 2;
  return 1; // queued
}
// The live job acting on this workspace: an apply/re-run targeting its id, or a
// pr-review/pr-respond for the same PR number. Most-urgent wins.
function jobForFeature(f, jobs) {
  const pr = prNumber(f);
  const mine = jobs.filter((r) =>
    (r.wsId && r.wsId === f.id) ||
    ((r.action === 'pr-review' || r.action === 'pr-respond') && r.prId && pr && String(r.prId) === String(pr)));
  return mine.sort((a, b) => jobRank(b) - jobRank(a))[0] || null;
}
// What the runner is doing, in card language. `existing` ⇒ a re-run on a workspace
// that already has findings (re-review) rather than a first pass.
function jobVerb(job, existing) {
  if (job.action === 'apply') return 'Posting to PR';
  if (job.action === 'poll') return 'Checking for updates';
  if (job.action === 'pr-review') return existing ? 'Re-reviewing' : 'Reviewing';
  if (job.action === 'pr-respond') return existing ? 'Re-checking threads' : 'Responding';
  return REQ_ACTION_LABEL[job.action] || job.action;
}

// The status line shown on a busy card: spinner + verb + live phase, an amber
// "needs your input" note, or a red error note (with a dismiss).
function cardJobRow(job, existing) {
  const meta = REQ_STATUS[job.status] || REQ_STATUS.queued;
  const needsInput = !!job.needsInput && job.status !== 'done' && job.status !== 'error';
  const stale = isStaleJob(job);
  const verb = jobVerb(job, existing);
  const phase = job.status === 'running' && job.phase ? ` · ${job.phase}` : '';
  const stateClass = needsInput ? 'needs' : (stale ? 'stale' : job.status);
  // A stale job must not keep spinning — a spinner on something nobody is running is the lie.
  const spin = (meta.spin || needsInput) && !stale;
  const rows = [
    h('div', { class: 'fc-job-line' },
      h('span', { class: `req-glyph req-glyph-${cssSafe(needsInput ? 'running' : (stale ? 'stalled' : job.status))} ${spin ? 'req-spin' : ''}`.trim() },
        stale ? '⏸' : (needsInput ? REQ_STATUS.running.glyph : meta.glyph)),
      h('span', { class: 'fc-job-verb' },
        needsInput || stale ? verb : verb + (job.status === 'queued' ? ' · queued' : phase))),
  ];
  if (needsInput) {
    rows.push(h('div', { class: 'fc-job-needs', role: 'alert' },
      h('span', { 'aria-hidden': 'true' }, '⚠ '), job.note || 'Waiting on you to continue.'));
  } else if (stale) {
    // Say the true thing: this is not in progress, it is waiting for a runner that isn't there.
    rows.push(h('div', { class: 'fc-job-stale' },
      `Not running — ${job.status === 'queued' ? 'queued' : 'started'} ${fmtAge(jobAgeMs(job))} ago with no runner picking it up. `,
      h('strong', {}, 'Nothing has been posted.'),
      ' Start ', h('code', {}, '/flowlever:watch'), ' in Claude Code, or cancel below.'));
  } else if (job.status === 'error' && job.note) {
    rows.push(h('div', { class: 'fc-job-err' }, job.note));
  }
  // A failed job is dismissible; a stale one is cancellable (which also releases the findings it
  // stranded in the Posting…/Applying… lane). A genuinely-running job stays untouched.
  let action = null;
  if (stale) {
    action = h('button', {
      class: 'btn-icon fc-job-dismiss', type: 'button',
      title: 'Cancel this job and put its findings back in the review queue',
      'aria-label': 'Cancel stalled job',
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); cancelStalledJob(job); },
    }, '×');
  } else if (job.status === 'error') {
    action = h('button', {
      class: 'btn-icon fc-job-dismiss', type: 'button', title: 'Dismiss this failed job',
      'aria-label': 'Dismiss failed job',
      onclick: async (e) => {
        e.preventDefault(); e.stopPropagation();
        // A failed apply leaves findings stranded in the in-flight lane too — release them.
        cancelStalledJob(job);
      } }, '×');
  }
  return h('div', { class: `fc-job fc-job-${cssSafe(stateClass)}` }, h('div', { class: 'fc-job-body' }, rows), action);
}

/* Drop a job that will never finish and release whatever it stranded. For a post/apply that means
 * clearing the findings' in-flight markers so they return to the review queue — otherwise the
 * workspace is stuck reading "Posting…" with nothing on the PR. Nothing is claimed as posted. */
async function cancelStalledJob(job) {
  const isWrite = job.action === 'apply';
  try {
    if (isWrite && job.wsId) {
      const res = await api(`/api/features/${encodeURIComponent(job.wsId)}/review/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: job.id, reason: 'cancelled from the cockpit — job never ran' }),
      });
      toast(res.cancelled
        ? `Cancelled — ${plural(res.cancelled, 'item', 'items')} back in the review queue. Nothing was posted.`
        : 'Job cancelled. Nothing was posted.', 'success');
    } else {
      await api(`/api/requests/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
      toast('Job cancelled', 'success');
    }
    if (current.view === 'detail' && current.id === job.wsId) {
      await loadDetail(current.id, true);
      rerenderDetail();
    }
    pollRequestsNow();
  } catch (e) {
    toast(`Could not cancel: ${e.message}`);
  }
}

// The post-posting wait state on a settled card (no job running): a passive "Waiting on
// author" line, or a highlighted "Author responded" once the runner detected a reply/commit.
function cardReviewRow(f) {
  const s = reviewStampsOf(f);
  if (f.authorResponded || s.newSinceReview) {
    // Name WHEN they responded (their real update time), not when we happened to notice.
    const when = fmtAgo(s.lastActivityAt);
    return h('div', { class: 'fc-review fc-review-responded' },
      h('span', { class: 'fc-review-dot' }, '●'),
      h('span', {},
        when ? `Author responded ${when}` : 'Author responded',
        f.reviewNote ? h('span', { class: 'meta-dim' }, ` — ${f.reviewNote}`) : null,
        ' · re-review'));
  }
  const since = fmtAgo(s.lastPostedAt);
  return h('div', { class: 'fc-review fc-review-waiting' },
    since ? `⏳ Waiting on author — posted ${since}` : '⏳ Waiting on author');
}

// A workspace doesn't exist yet (a first review still running): show a placeholder
// card so the work is visible exactly where its real card will land.
function pendingJobCard(job) {
  const title = job.title || `PR ${job.prId}`;
  return h('div', { class: 'card feature-card fc-pending' },
    h('div', { class: 'fc-top' },
      h('div', { class: 'fc-titlewrap' },
        h('div', { class: 'fc-title' }, title),
        h('div', {}, h('span', { class: 'chip status-auditing' }, 'starting…'))),
      h('div', { class: 'fc-pending-dial', 'aria-hidden': 'true' }, '—')),
    cardJobRow(job, false),
    job.instructions ? h('div', { class: 'fc-meta' }, h('span', { class: 'meta-dim' }, '↳ ', job.instructions)) : null);
}

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
    // The runner's liveness rides the same tick: every surface that shows a job also wants to know
    // whether anything is draining it, and one extra tiny GET beats a second interval. The
    // server-version check rides along too (C-18) — a tab left open across an upgrade re-checks
    // instead of only ever trusting the verdict from page load.
    await refreshRunner();
    if (token !== poller.token || !poller.fn) return;
    poller.fn(Array.isArray(reqs) ? reqs : []);
    renderRunnerZones();
    checkServerVersion();
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
  // A refresh (`poll`) has no single target — name the section it covers, or "all PRs".
  if (r.action === 'poll') return r.kind ? kindMeta(r.kind).label : 'all PRs';
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
  const stale = isStaleJob(r);
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
      h('span', { class: `req-statetext req-state-${cssSafe(stale ? 'stalled' : r.status)}` },
        stale ? `Not running · ${meta.label.toLowerCase()} ${fmtAge(jobAgeMs(r))} ago` : meta.label + phaseText),
      showSubNote ? h('span', { class: 'req-note' }, ` — ${r.note}`) : null,
      linkable ? h('a', { class: 'req-open', href: `#/feature/${encodeURIComponent(r.wsId)}` }, 'open workspace →') : null),
    // The per-run scope/focus the runner will honor, shown as a small muted line.
    r.instructions ? h('div', { class: 'req-instr', title: 'Review scope for this run' }, '↳ ', r.instructions) : null,
    needsInput
      ? h('div', { class: 'req-needsinput', role: 'alert' },
          h('span', { class: 'req-ni-icon', 'aria-hidden': 'true' }, '⚠'),
          h('div', { class: 'req-ni-body' },
            h('span', { class: 'req-ni-label' }, 'Needs your input'),
            h('span', { class: 'req-ni-note' }, r.note || 'Waiting on you to continue.')))
      : null,
    // No runner is draining the queue — say so, rather than spinning indefinitely.
    stale
      ? h('div', { class: 'req-stalled' },
          h('span', { class: 'req-stalled-icon', 'aria-hidden': 'true' }, '⏸'),
          h('div', { class: 'req-stalled-body' },
            h('span', { class: 'req-stalled-label' }, 'No runner picked this up'),
            h('span', { class: 'req-stalled-note' },
              r.action === 'apply'
                ? 'Nothing has been posted. Start /flowlever:watch in Claude Code, or dismiss to put the items back in the review queue.'
                : 'Start /flowlever:watch in Claude Code to run it, or dismiss it.')))
      : null);
  const row = h('div', { class: `req-row req-${cssSafe(r.status)} ${needsInput ? 'req-needs' : ''} ${stale ? 'req-stale' : ''}`.trim() },
    h('span', { class: `req-glyph req-glyph-${cssSafe(stale ? 'stalled' : r.status)} ${meta.spin && !stale ? 'req-spin' : ''}`.trim(),
      'aria-label': stale ? 'not running' : meta.label }, stale ? '⏸' : meta.glyph),
    main,
    h('button', {
      class: 'btn-icon req-dismiss', type: 'button',
      'aria-label': 'Dismiss job', title: stale || r.status === 'error'
        ? 'Dismiss this job (its items go back to the review queue)'
        : 'Dismiss this job',
      onclick: async () => {
        // Dismissing a post/apply must also release the findings it stranded in the in-flight
        // lane, or the workspace keeps reading "Posting…" with no job behind it.
        if (r.action === 'apply' && r.wsId) { await cancelStalledJob(r); return; }
        try {
          await api(`/api/requests/${encodeURIComponent(r.id)}`, { method: 'DELETE' });
          row.remove();
        } catch (e) {
          toast(`Dismiss failed: ${e.message}`);
        }
      },
    }, '×'));
  return row;
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
        h('span', { class: 'reqleg-desc' }, 'blocked on you — e.g. approve a 2FA/auth prompt')),
      h('span', { class: 'reqleg-item' },
        h('span', { class: 'reqleg-glyph req-glyph-stalled' }, '⏸'),
        h('span', { class: 'reqleg-label' }, 'Not running'),
        h('span', { class: 'reqleg-desc' }, 'queued but no runner picked it up — start /flowlever:watch'))));
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
  // Jobs blocked on the user first, then errors/running/queued (stable within a rank).
  const ordered = [...requests].sort((a, b) => jobRank(b) - jobRank(a));
  strip.replaceChildren(
    h('div', { class: 'requests-head' },
      h('span', { class: 'f-suglabel' }, plural(requests.length, 'job', 'jobs')),
      requestsLegend()),
    h('div', { class: 'requests-list' }, ordered.map(requestRow)));
}

/* ---- runner control (the "▶ Run queued jobs" button) ------------------------
 * A queued job only moves when a Claude Code session runs /flowlever:watch. The cockpit server is
 * a local process, so it can start that session for us — which is the difference between "your
 * Post is queued forever" and "your Post happens now". `state.runner` is the last known status;
 * the shared requests poller refreshes it, so every surface agrees. */
function runnerStatus() { return state.runner || null; }
function runnerBusy() { const r = runnerStatus(); return !!r && r.running; }

async function refreshRunner(withLog = false) {
  try {
    state.runner = await api(`/api/runner${withLog ? '?log=1' : ''}`);
  } catch { /* server hiccup — keep the last known status */ }
  return state.runner;
}

/* Jobs the runner would actually pick up right now. Drives the button's count + whether it shows:
 * offering "run 0 jobs" is noise, and hiding it while work is stuck is the bug we're fixing. */
function queuedJobs(reqs) {
  return (reqs || []).filter((r) => r.status === 'queued' || r.status === 'running');
}

/* Start the runner. `action` is 'watch' (drain what's queued) or 'poll' (discover, then drain). */
async function startRunner(action = 'watch', { silent = false } = {}) {
  try {
    state.runner = await api('/api/runner', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!silent) {
      toast(action === 'poll'
        ? 'Runner started — discovering PRs, then draining the queue'
        : 'Runner started — working through the queued jobs now', 'success');
    }
    pollRequestsNow();
    renderRunnerZones();
  } catch (e) {
    // 503 = no `claude` binary; 409 = already going. Both are worth saying plainly.
    toast(`Could not start the runner: ${e.message}`);
    await refreshRunner();
    renderRunnerZones();
  }
}

async function stopRunner() {
  try {
    state.runner = await api('/api/runner', { method: 'DELETE' });
    toast('Runner stopped', 'success');
  } catch (e) {
    toast(`Could not stop the runner: ${e.message}`);
  }
  renderRunnerZones();
}

/* Re-render every runner control currently on the page (there may be one in the section header and
 * one inside a stalled banner). Cheap: they're tiny and keyed by class. */
function renderRunnerZones() {
  document.querySelectorAll('.runner-zone').forEach((zone) => {
    renderRunnerZone(zone, Number(zone.dataset.queued || 0), zone.dataset.label || '');
  });
}

/* `label` overrides the "Run N jobs" wording — used where the count would mislead (the stalled
 * banner talks about one job, but the runner always drains the whole queue). */
function runnerZone(queuedCount, label = '') {
  const zone = h('div', { class: 'runner-zone', dataset: { queued: String(queuedCount || 0), label } });
  renderRunnerZone(zone, queuedCount, label);
  return zone;
}

/* The button, in four honest states: running (with a stop), idle-with-work ("Run N jobs"),
 * unavailable (say why — a missing CLI must not look like a broken button), idle-with-nothing
 * (render nothing at all). */
function renderRunnerZone(zone, queuedCount, label = '') {
  if (!zone) return;
  const r = runnerStatus();
  zone.dataset.queued = String(queuedCount || 0);
  if (label) zone.dataset.label = label;
  if (!r) { zone.replaceChildren(); return; }

  if (r.running) {
    zone.replaceChildren(
      h('span', { class: 'runner-live', title: `Started ${fmtDateTime(r.startedAt) || 'just now'} · pid ${r.pid}` },
        h('span', { class: 'spinner', 'aria-hidden': 'true' }),
        'Runner working…'),
      h('button', {
        class: 'btn btn-runner-stop', type: 'button',
        title: 'Stop the runner (it finishes the write it is in the middle of)',
        onclick: stopRunner,
      }, '■ Stop'));
    return;
  }
  if (!queuedCount) { zone.replaceChildren(); return; }
  if (!r.available) {
    zone.replaceChildren(h('span', { class: 'runner-unavailable', title: r.reason || '' },
      '⚠ Can’t start the runner from here — ', h('code', {}, '/flowlever:watch'), ' in Claude Code instead'));
    return;
  }
  // Two-click confirm: this posts to real pull requests. The user already approved the content when
  // they clicked Post; this confirms they want it to go out NOW.
  const showConfirm = () => zone.replaceChildren(
    h('span', { class: 'runner-confirm-msg' },
      'Run the queued jobs now? Approved comments get posted to Azure DevOps.'),
    h('button', { class: 'btn btn-accent', type: 'button', onclick: () => startRunner('watch') }, '▶ Run now'),
    h('button', { class: 'btn', type: 'button', onclick: () => renderRunnerZone(zone, queuedCount, label) }, 'Cancel'));
  zone.replaceChildren(h('button', {
    class: 'btn btn-runner', type: 'button',
    title: 'Start a headless /flowlever:watch session that works through the queued jobs now',
    onclick: showConfirm,
  }, label
    ? label
    : ['▶ Run ', h('span', { class: 'runner-n' }, String(queuedCount)), queuedCount === 1 ? ' job' : ' jobs']));
}

/* ---- manual refresh (the "↻ Refresh" button) --------------------------------
 * The scheduled /flowlever:poll pass runs every couple of hours. When you already KNOW a new
 * PR landed or a reviewer just commented, this enqueues a `poll` request so the runner does a
 * discovery pass NOW: find PRs you haven't got a workspace for, and re-check the known ones for
 * counterpart updates (which is what stamps `review.lastActivityAt`). Read-only — like the
 * scheduled pass it never posts to a PR. */
/* `kind` null = refresh BOTH PR sections (used on Home); otherwise scoped to one. */
function refreshZone(kind) {
  const zone = h('div', { class: 'refresh-zone', id: 'refresh-zone' });
  renderRefreshZone(zone, kind, null);
  return zone;
}

function refreshScopeLabel(kind) {
  return kind ? kindMeta(kind).label : 'PR review + PR respond';
}

/* Reflects the live `poll` job so the button itself is the progress indicator:
 * idle → "↻ Refresh", queued/running → spinner + live phase, error → the reason + retry. */
function renderRefreshZone(zone, kind, job) {
  if (!zone) return;
  const label = refreshScopeLabel(kind);
  const busy = !!job && (job.status === 'queued' || job.status === 'running');
  const failed = !!job && job.status === 'error';
  const btn = h('button', {
    class: `btn btn-refresh ${busy ? 'is-busy' : ''} ${failed ? 'is-error' : ''}`.trim(),
    type: 'button',
    disabled: busy || undefined,
    title: busy
      ? 'A refresh pass is already in flight'
      : `Check Azure DevOps now for new ${label} PRs and updated comments — instead of waiting for the scheduled poll`,
    onclick: () => enqueueRefresh(kind),
  }, busy
    ? [h('span', { class: 'spinner', 'aria-hidden': 'true' }),
       job.status === 'queued' ? 'Refresh queued…' : (job.phase || 'Checking…')]
    : (failed ? '↻ Retry refresh' : '↻ Refresh'));
  const kids = [btn];
  if (busy && job.needsInput) {
    kids.push(h('span', { class: 'refresh-note refresh-needs', role: 'alert' },
      '⚠ ', job.note || 'Waiting on you — approve the auth prompt in your other window.'));
  } else if (failed && job.note) {
    kids.push(h('span', { class: 'refresh-note refresh-err' }, job.note));
  }
  zone.replaceChildren(...kids);
}

/* Which `poll` job the Refresh button reflects. In-flight beats failed on purpose: after a retry
 * the button must read "queued…", not keep showing the old error (which is what ranking by
 * urgency would do). Newest wins within each group. */
function pickPollJob(reqs, kind) {
  const mine = (reqs || []).filter((r) => r.action === 'poll' && (!r.kind || r.kind === kind || !kind));
  const newest = (list) => list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
  return newest(mine.filter((r) => r.status === 'queued' || r.status === 'running'))
      || newest(mine.filter((r) => r.status === 'error'));
}

async function enqueueRefresh(kind) {
  const label = refreshScopeLabel(kind);
  try {
    const res = await api('/api/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // dedupe: a double-click (or a pass already in flight for this scope) must not fan out
      // two runs. `kind: null` is an explicit "both sections" scope, not "any scope".
      body: JSON.stringify({ action: 'poll', kind: kind || null, dedupe: true, title: `Refresh ${label}` }),
    });
    // A refresh only does something once a runner picks it up. If none is going, start one right
    // away instead of quietly queueing work nobody will do — the button says "Refresh", so refresh.
    const r = await refreshRunner();
    if (r && r.available && !r.running) {
      await startRunner('poll', { silent: true });
      toast('Refreshing — the runner is checking ADO for new and updated PRs', 'success');
    } else {
      toast(res && res.deduped
        ? 'A refresh is already in flight'
        : (r && r.running
          ? 'Refresh queued — the running session will pick it up'
          : 'Refresh queued — run /flowlever:watch in Claude Code to execute it'), 'success');
    }
    pollRequestsNow();
  } catch (e) {
    toast(`Could not queue the refresh: ${e.message}`);
  }
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
  // Optional per-run scope/focus passed straight to the runner (e.g. "front-end only").
  // Enter inserts a newline here (it's a textarea); only Escape closes the form.
  const instrInput = h('textarea', {
    class: 'nr-instructions', rows: '2', 'aria-label': 'Review instructions (optional)',
    placeholder: "Scope or focus for this review — e.g. 'front-end only', 'back-end only', 'focus on the import validation'",
    onkeydown: (e) => { if (e.key === 'Escape') onClose(); },
  });
  async function submit() {
    const prId = prInput.value.trim();
    if (!prId) { prInput.classList.add('invalid'); prInput.focus(); return; }
    try {
      await api('/api/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: kind, prId,
          title: titleInput.value.trim() || undefined,
          instructions: instrInput.value.trim() || undefined,
        }),
      });
      toast(`Queued ${actionLabel} for PR ${prId}`, 'success');
      onClose();
      pollRequestsNow();
    } catch (e) {
      toast(`Could not queue: ${e.message}`);
    }
  }
  return h('div', { class: 'nr-form' },
    h('div', { class: 'nr-row' }, prInput, titleInput),
    h('label', { class: 'nr-instr-label' }, 'Review instructions (optional)'),
    instrInput,
    h('div', { class: 'nr-actions' },
      h('button', { class: 'btn btn-accent', type: 'button', onclick: submit }, `Queue ${actionLabel}`),
      h('button', { class: 'btn', type: 'button', onclick: onClose }, 'Cancel')));
}

/* The "+ New spec analysis" entry (spec section): a button that swaps in an inline form
 * (source URLs + optional title) and POSTs an `audit` request. The runner (/flowlever:watch)
 * creates the workspace from the URLs, registers the sources, and runs the audit sweep. */
function newAuditZone() {
  const zone = h('div', { class: 'new-request-zone', id: 'new-request-zone' });
  const showButton = () => zone.replaceChildren(h('button', {
    class: 'btn btn-accent nr-add', type: 'button', onclick: showForm,
  }, '+ New spec analysis'));
  function showForm() {
    zone.replaceChildren(newAuditForm(showButton));
    const ta = zone.querySelector('.nr-urls');
    if (ta) requestAnimationFrame(() => ta.focus());
  }
  showButton();
  return zone;
}

function newAuditForm(onClose) {
  const titleInput = h('input', {
    class: 'nr-title', type: 'text', placeholder: 'Title (optional, e.g. "Checkout redesign")', 'aria-label': 'Title',
    onkeydown: (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose(); },
  });
  // The source URLs (Confluence spec / ADO work items / Figma) and any focus go in
  // `instructions`; the audit runner parses them, creates the workspace + sources, and audits.
  const urlsInput = h('textarea', {
    class: 'nr-urls nr-instructions', rows: '4', 'aria-label': 'Spec / work-item / Figma URLs',
    placeholder: "Paste the spec & work-item URLs (one per line) — Confluence spec, ADO user story / bug, Figma frame. Add a focus note if you like, e.g. 'just the payment flow'.",
    onkeydown: (e) => { if (e.key === 'Escape') onClose(); },
  });
  async function submit() {
    const instructions = urlsInput.value.trim();
    if (!instructions) { urlsInput.classList.add('invalid'); urlsInput.focus(); return; }
    try {
      await api('/api/requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'audit',
          title: titleInput.value.trim() || undefined,
          instructions,
        }),
      });
      toast('Queued spec analysis', 'success');
      onClose();
      ensureApplyPolling();
      pollRequestsNow();
    } catch (e) {
      toast(`Could not queue: ${e.message}`);
    }
  }
  return h('div', { class: 'nr-form' },
    h('div', { class: 'nr-row' }, titleInput),
    h('label', { class: 'nr-instr-label' }, 'Spec / work-item / Figma URLs'),
    urlsInput,
    h('div', { class: 'nr-actions' },
      h('button', { class: 'btn btn-accent', type: 'button', onclick: submit }, 'Queue analysis'),
      h('button', { class: 'btn', type: 'button', onclick: onClose }, 'Cancel')));
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
  state.featureJob = null; state.featureJobSig = '';   // reset job banner when entering a feature
  app.replaceChildren(detailView(data, tab));
  ensureFeatureJobPolling(id);
  if (tab === 'report') loadReportInto(id, seq);
}

function rerenderDetail() {
  if (current.view !== 'detail' || !state.detail) return;
  $('#app').replaceChildren(detailView(state.detail, current.tab));
  if (current.tab === 'report') loadReportInto(current.id, routeSeq);
  // A propose/apply job finishing reloads state.detail behind an open finding modal — without
  // this the modal keeps showing the pre-reload finding while the board underneath moves on (C-24).
  syncModal();
}

/* Keep the feature view's job banner live: while a propose/apply job for THIS workspace is
 * queued/running it shows "Drafting…/Applying…"; the moment it finishes we reload the detail so
 * freshly-attached drafts / applied stamps appear, then flip the banner to "ready to review" /
 * "applied". This is what makes the draft/apply lifecycle auto-update and read clearly. */
function ensureFeatureJobPolling(id) {
  startPolling(`featjob:${id}`, (reqs) => {
    if (current.view !== 'detail' || current.id !== id) return;
    const mine = (reqs || []).filter((r) => (r.action === 'propose' || r.action === 'apply') && r.wsId === id);
    const latest = mine.length
      ? [...mine].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] : null;
    // Staleness rides in the signature: it flips with the passage of time, not with a server
    // change, so without it the banner would keep claiming "queued…" long after the job died.
    const sig = latest
      ? `${latest.id}:${latest.status}:${latest.phase || ''}:${latest.needsInput ? 1 : 0}:${isStaleJob(latest) ? 1 : 0}`
      : '';
    if (sig === (state.featureJobSig || '')) return;        // nothing changed
    const prev = state.featureJob;
    state.featureJob = latest; state.featureJobSig = sig;
    const justDone = latest && latest.status === 'done'
      && (!prev || prev.id !== latest.id || prev.status !== 'done');
    if (justDone) { loadDetail(id, true).then(() => rerenderDetail()).catch(() => rerenderDetail()); }
    else rerenderDetail();
  });
}

/* The live banner above the board: what the runner is doing for this workspace right now — and,
 * just as important, when it is NOT doing anything. Wording is kind-aware ("Posting" for a PR,
 * "Applying" for a spec) because the verb is what the user checks against the real PR. */
function specJobBanner(data) {
  const fid = data.feature && data.feature.id;
  const kind = (data.feature && data.feature.kind) || 'spec';
  const isPr = kind === 'pr-review' || kind === 'pr-respond';
  const writeVerb = isPr ? 'Posting' : 'Applying';
  const j = state.featureJob && state.featureJob.wsId === fid ? state.featureJob : null;
  const pending = ((data.ledger && data.ledger.findings) || []).filter(isPending);

  // No job for this workspace, yet findings still sit in the in-flight lane: the job was dropped
  // (or never existed) and nothing will ever stamp them. This is the state that silently reads as
  // "Posting…" forever, so it gets the loudest, most explicit treatment.
  if (!j && pending.length) {
    return h('div', { class: 'apply-status apply-stalled feat-job' },
      h('span', { class: 'apply-dot' }, '⏸'),
      h('div', { class: 'apply-stalled-body' },
        h('span', {}, `${plural(pending.length, 'item', 'items')} marked “${writeVerb}…” but no job is running — `,
          h('strong', {}, isPr ? 'nothing has been posted' : 'nothing has been written'), '.'),
        h('span', { class: 'meta-dim' },
          'Put them back in the review queue, then Post again with ', h('code', {}, '/flowlever:watch'), ' running.')),
      h('button', {
        class: 'btn btn-cancel-pending', type: 'button',
        onclick: () => cancelPendingHere(fid, isPr),
      }, '↩ Back to the review queue'));
  }
  if (!j) return null;

  const isPropose = j.action === 'propose';
  if (j.needsInput) {
    return h('div', { class: 'apply-status apply-needs-input feat-job' },
      h('span', { class: 'apply-dot' }, '⚠'),
      h('span', {}, j.note || 'Waiting on you — approve the auth prompt in your other window.'));
  }
  // Queued/running but untouched for too long: no runner is draining the queue. Never keep
  // spinning here — a spinner on a job nobody is running is exactly what made a Post look done.
  if (isStaleJob(j)) {
    // This is where the user actually notices the problem, so put the fix right here: one click to
    // run the job now, or one to take the items back.
    return h('div', { class: 'apply-status apply-stalled feat-job' },
      h('span', { class: 'apply-dot' }, '⏸'),
      h('div', { class: 'apply-stalled-body' },
        h('span', {}, `${isPropose ? 'Drafting proposals' : writeVerb} — ${j.status} ${fmtAge(jobAgeMs(j))} ago and no runner picked it up. `,
          h('strong', {}, isPr ? 'Nothing has been posted' : 'Nothing has been written'), '.'),
        h('span', { class: 'meta-dim' },
          'Run it now, or cancel to put the items back in the review queue.')),
      h('div', { class: 'apply-stalled-actions' },
        runnerZone(1, '▶ Run it now'),
        h('button', {
          class: 'btn btn-cancel-pending', type: 'button',
          onclick: () => cancelStalledJob(j),
        }, '✕ Cancel job')));
  }
  if (j.status === 'queued') {
    // Queued with a live runner = genuinely waiting its turn. Queued with nothing running = it needs
    // one click, offered right here rather than making the user wait out the staleness timeout.
    const idle = !runnerBusy();
    return h('div', { class: 'apply-status apply-running feat-job' },
      idle ? h('span', { class: 'apply-dot' }, '⏳') : h('span', { class: 'spinner', 'aria-hidden': 'true' }),
      h('span', {}, isPropose
        ? `Drafting proposals — queued${idle ? ', nothing running it yet' : ' for the runner…'}`
        : `${writeVerb} — queued${idle ? ', nothing running it yet' : ' for the runner…'}`),
      idle ? runnerZone(1, '▶ Run it now') : null);
  }
  if (j.status === 'running') {
    return h('div', { class: 'apply-status apply-running feat-job' },
      h('span', { class: 'spinner', 'aria-hidden': 'true' }),
      h('span', {}, isPropose ? `Drafting proposals${j.phase ? ` — ${j.phase}` : '…'}` : `${writeVerb}${j.phase ? ` — ${j.phase}` : '…'}`));
  }
  if (j.status === 'done') {
    // "done" is the runner's word, not proof of a stamp: if items are still pending after the job
    // finished, the write did not complete for them — say that instead of implying success.
    if (!isPropose && pending.length) {
      // Two very different situations wear the same "still pending" shape, and conflating them gives
      // actively wrong advice:
      //   (a) the work DID go out — a commit is recorded — and only the completion stamp is missing.
      //       Telling the user to "retry" here would re-push an applied fix.
      //   (b) nothing is recorded, so the write genuinely isn't confirmed.
      const withCommit = pending.filter((f) => f.fixCommit && f.fixCommit.sha);
      const without = pending.filter((f) => !(f.fixCommit && f.fixCommit.sha));
      if (withCommit.length && !without.length) {
        const shas = [...new Set(withCommit.map((f) => f.fixCommit.sha.slice(0, 8)))].join(', ');
        return h('div', { class: 'apply-status apply-done feat-job' },
          h('span', { class: 'apply-dot' }, '✓'),
          h('div', { class: 'apply-stalled-body' },
            h('span', {}, `${plural(withCommit.length, 'fix is', 'fixes are')} pushed (`,
              h('code', {}, shas), ') — only the completion stamp is missing, so they still show as ',
              `“${writeVerb}…”.`),
            h('span', { class: 'meta-dim' },
              'The code is on the branch. Mark them done to move them out of the queue — nothing gets re-pushed.')),
          h('button', {
            class: 'btn btn-good', type: 'button',
            title: 'Record these as done using the commit already on file',
            onclick: () => confirmPushedFixes(fid, withCommit.map((f) => f.fp)),
          }, `✔ Mark ${withCommit.length} done`));
      }
      return h('div', { class: 'apply-status apply-error feat-job' },
        h('span', { class: 'apply-dot' }, '⚠'),
        h('div', { class: 'apply-stalled-body' },
          h('span', {}, `The job finished but ${plural(without.length, 'item is', 'items are')} still marked “${writeVerb}…” with `,
            h('strong', {}, 'no commit on file'),
            isPr ? ' — not confirmed as posted.' : ' — not confirmed as written.'),
          h('span', { class: 'meta-dim' }, 'Check the PR, then put them back in the queue and retry if they are missing.')),
        h('button', {
          class: 'btn btn-cancel-pending', type: 'button',
          onclick: () => cancelPendingHere(fid, isPr),
        }, '↩ Back to the review queue'));
    }
    return h('div', { class: 'apply-status apply-done feat-job' },
      h('span', { class: 'apply-dot' }, '✓'),
      h('span', {}, isPropose
        ? 'Proposals ready — open a finding with a ± to review the red/green diff, then Apply.'
        : (isPr ? 'Posted — the comments are on the PR.' : 'Applied — re-audit (↻) to confirm the changes landed.')));
  }
  if (j.status === 'error') {
    return h('div', { class: 'apply-status apply-error feat-job' },
      h('span', { class: 'apply-dot' }, '⚠'),
      h('div', { class: 'apply-stalled-body' },
        h('span', {}, `${isPropose ? 'Drafting' : writeVerb} failed: ${j.note || 'see the Claude session'}`),
        pending.length ? h('span', { class: 'meta-dim' },
          `${plural(pending.length, 'item is', 'items are')} still marked “${writeVerb}…” — put them back in the queue to retry.`) : null),
      pending.length ? h('button', {
        class: 'btn btn-cancel-pending', type: 'button',
        onclick: () => cancelPendingHere(fid, isPr),
      }, '↩ Back to the review queue') : null);
  }
  return null;
}

/* Stamp findings whose fix is already pushed as done, using the commit already on file. Safe by
 * construction: the ledger's fix gate accepts this precisely because a fixCommit exists, so it can
 * never be used to fake a completion for work that didn't happen. */
async function confirmPushedFixes(wsId, fps) {
  try {
    await api(`/api/features/${encodeURIComponent(wsId)}/review/apply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fps, status: 'posted' }),
    });
    await loadDetail(wsId, true);
    rerenderDetail();
    toast(`${plural(fps.length, 'fix', 'fixes')} marked done — the commit was already on file`, 'success');
  } catch (e) {
    toast(`Could not mark done: ${e.message}`);
  }
}

/* Release this workspace's in-flight markers (no job to drop — just the stranded findings). */
async function cancelPendingHere(wsId, isPr) {
  try {
    const res = await api(`/api/features/${encodeURIComponent(wsId)}/review/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'released from the cockpit — write never confirmed' }),
    });
    toast(`${plural(res.cancelled, 'item', 'items')} back in the review queue — ${isPr ? 'nothing was posted' : 'nothing was written'}.`, 'success');
    await loadDetail(wsId, true);
    rerenderDetail();
  } catch (e) {
    toast(`Could not release: ${e.message}`);
  }
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

function detailDeleteZone(feature) {
  const zone = h('div', { class: 'dh-delete-zone' });
  const label = feature.title || feature.id || 'this workspace';

  function showButton() {
    zone.replaceChildren(h('button', {
      class: 'btn-icon dh-delete', type: 'button',
      'aria-label': `Delete workspace ${label}`, title: 'Delete workspace',
      onclick: showConfirm,
    }, h('span', { class: 'icon', html: ICONS.trash })));
  }

  function showConfirm() {
    zone.replaceChildren(h('div', { class: 'delete-confirm-inline' },
      h('span', { class: 'delete-confirm-msg' },
        `Delete "${label}"? This removes its findings and history. This can't be undone.`),
      h('button', { class: 'btn btn-danger', type: 'button', onclick: doDelete }, 'Delete'),
      h('button', { class: 'btn', type: 'button', onclick: showButton }, 'Cancel')));
  }

  async function doDelete() {
    try {
      await api(`/api/features/${encodeURIComponent(feature.id)}`, { method: 'DELETE' });
      toast(`Deleted "${label}"`, 'success');
      location.hash = kindMeta(feature.kind || 'spec').section;
    } catch (e) {
      toast(`Delete failed: ${e.message}`);
      showButton();
    }
  }

  showButton();
  return zone;
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
        h('h1', { class: 'dh-title' }, feature.title || feature.id || current.id),
        h('div', { class: 'dh-meta' },
          kindBadge(kind),
          statusChip(feature.status),
          feature.id ? h('code', { class: 'feature-id' }, feature.id) : null,
          detailDeleteZone(feature),
        ),
      ),
      h('div', { class: 'dh-right' },
        dialEl(r.score, r.gate, 96, 'dial-lg'),
        h('div', { class: 'dh-gate' },
          gateBadge(r.gate),
          h('div', { class: `dh-blocking ${blockers > 0 ? 'hot' : ''}` },
            blockers > 0 ? `${plural(blockers, 'blocker', 'blockers')} blocking` : 'nothing blocking'),
          h('div', { class: 'meta-dim num-line' }, `${totalOpen} open total`),
          completeControl(feature),
        ),
      ),
    ),
    loopStrip(data, reviewCta(data)),
    // When we reviewed vs. when the PR last changed — the re-review decision, in one line.
    reviewStampsRow(data, kind),
    unbackedFixBanner(data),
    specJobBanner(data),
    reviewScopeNote(feature),
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

/* Loud, unmissable banner for the one state that must never pass silently: a finding closed as
 * handled whose agreed code change has no commit behind it. That means the reviewer was told their
 * point was addressed while the branch never changed — they will re-raise it, and rightly. Offers to
 * reopen them all so the fix can actually be made. */
function unbackedFixBanner(data) {
  const findings = (data.ledger && data.ledger.findings) || [];
  const bad = findings.filter((f) => isAgreedCodeFix(f) && !(f.fixCommit && f.fixCommit.sha)
    && (isPosted(f) || f.status === 'resolved'));
  if (!bad.length) return null;
  return h('div', { class: 'apply-status unbacked-fix' },
    h('span', { class: 'apply-dot' }, '⚠'),
    h('div', { class: 'apply-stalled-body' },
      h('span', {},
        `${plural(bad.length, 'agreed code fix is', 'agreed code fixes are')} closed as handled but `,
        h('strong', {}, 'no commit carries the change'), ' — the branch does not contain them.'),
      h('span', { class: 'meta-dim' },
        'The reviewer was told this was addressed. Reopen to make the fix for real: ',
        bad.map((f) => f.draft && f.draft.target).filter(Boolean).join(' · ') || bad.map((f) => f.locus).join(' · ')),
    ),
    h('button', {
      class: 'btn btn-cancel-pending', type: 'button',
      title: 'Set these back to open so the fix can actually be applied and pushed',
      onclick: () => reopenUnbackedFixes(bad.map((f) => f.fp)),
    }, `↩ Reopen ${bad.length}`));
}

async function reopenUnbackedFixes(fps) {
  try {
    for (const fp of fps) {
      await api(`/api/features/${encodeURIComponent(current.id)}/findings/${encodeURIComponent(fp)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'open', reason: 'reopened — closed as fixed but no commit carries the change' }),
      });
    }
    await loadDetail(current.id, true);
    rerenderDetail();
    toast(`${plural(fps.length, 'finding', 'findings')} reopened — the fix still needs to be pushed`, 'success');
  } catch (e) {
    toast(`Could not reopen: ${e.message}`);
  }
}

/* The per-run scope/focus the review was launched with, carried onto the
 * workspace as `reviewBrief` by the runner. Shown as a small note so the
 * applied scope is visible while stepping through findings. */
function reviewScopeNote(feature) {
  const brief = feature && typeof feature.reviewBrief === 'string' ? feature.reviewBrief.trim() : '';
  if (!brief) return null;
  return h('div', { class: 'review-scope' },
    h('span', { class: 'review-scope-label' }, 'Review scope'),
    h('span', { class: 'review-scope-text' }, brief));
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
            const txt = g.text(it).trim();
            const ttl = `${g.label}: ${txt}`;
            const inner = [iconSpan(g.icon, `icon src-icon src-${g.key}`),
              h('span', { class: 'src-text' }, txt),
              href ? iconSpan('link', 'icon src-out') : null];
            return href
              ? h('a', { class: 'src-link', href, target: '_blank', rel: 'noopener noreferrer', title: ttl }, inner)
              : h('span', { class: 'src-link src-nolink', title: ttl }, inner);
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

/* ---- rendered proposal view for the READ view of a proposal diff. Reuses the app's
 * existing DOM markdown renderer (renderMarkdown / mdInline, defined later) so the proposed
 * text shows as real formatted content — tables, bold, code, links — instead of raw markup.
 * gherkin gets a small DOM builder that bolds Given/When/Then. Returns a DOM NODE (appended as
 * a child), NOT an HTML string. ---- */
function gherkinNode(src) {
  const KW = /^(\s*)(Given|When|Then|And|But|Scenario|Feature|Background|Examples)\b(.*)$/;
  const wrap = h('div', { class: 'rd-gherkin' });
  for (const l of String(src).replace(/\r\n/g, '\n').split('\n')) {
    if (l.trim() === '') { wrap.append(h('div', { class: 'rd-gblank' })); continue; }
    const m = KW.exec(l);
    if (m) {
      wrap.append(h('div', { class: 'rd-gline' },
        m[1] ? h('span', { class: 'rd-indent' }, m[1]) : null,
        h('strong', { class: 'rd-kw' }, m[2]),
        mdInline(m[3])));
    } else {
      wrap.append(h('div', { class: 'rd-gline' }, mdInline(l)));
    }
  }
  return wrap;
}
function proseNode(src, format) {
  if (format === 'markdown') return renderMarkdown(src);   // existing DOM renderer → a node
  if (format === 'gherkin') return gherkinNode(src);
  return h('pre', { class: 'rd-pre' }, String(src));
}
/* True when a draft's text is worth rendering (vs. a raw code diff). */
function canRenderProse(f) {
  const fmt = f && f.draft && f.draft.format;
  return fmt === 'markdown' || fmt === 'gherkin';
}
/* The rendered (read-only) view of one hunk: the current text (if this hunk
 * removes anything) and the proposed text, each rendered from the draft format.
 * Context + del → "current"; context + add → "proposed". */
function renderedHunkEl(f, hunk) {
  const fmt = (f.draft && f.draft.format) || 'text';
  const beforeText = hunk.rows.filter((r) => r.type === 'context' || r.type === 'del').map((r) => r.text).join('\n');
  const afterText = hunk.rows.filter((r) => r.type === 'context' || r.type === 'add').map((r) => r.text).join('\n');
  const removes = hunk.rows.some((r) => r.type === 'del');
  const adds = hunk.rows.some((r) => r.type === 'add');
  const blocks = [];
  if (removes && beforeText.trim()) {
    blocks.push(h('div', { class: 'rd-block rd-current' },
      h('div', { class: 'rd-label' }, 'Current'),
      h('div', { class: 'rd-body' }, proseNode(beforeText, fmt))));
  }
  if (afterText.trim()) {
    blocks.push(h('div', { class: 'rd-block rd-proposed' },
      h('div', { class: 'rd-label' }, removes ? 'Proposed' : 'Proposed addition'),
      h('div', { class: 'rd-body' }, proseNode(afterText, fmt))));
  }
  if (!blocks.length) blocks.push(h('div', { class: 'diff-empty-note' }, 'No changes.'));
  return h('div', { class: 'rendered-diff' }, ...blocks);
}

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
  // PR-kind workspaces present the same kind-aware triage as the stepper: open a
  // reviewable PR finding straight in the review sub-view (proposed comment +
  // Approve/Edit/Dismiss), crash-safe even with no code-diff draft. Spec findings
  // keep opening in the detail sub-view.
  const kind = (state.detail && state.detail.feature && state.detail.feature.kind) || 'spec';
  const isPr = kind === 'pr-review' || kind === 'pr-respond';
  if (isPr) ensureFlow();   // so a modal decision lands in the same state.flow the stepper reads
  state.modalMode = (isPr && (!!f.draft || hasSuggestion(f))) ? 'review' : 'detail';
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
  const kind = (state.detail && state.detail.feature && state.detail.feature.kind) || 'spec';
  const isPr = kind === 'pr-review' || kind === 'pr-respond';
  // Spec review needs a code-diff draft; a PR finding is reviewable on a proposed
  // comment alone (suggestion-only), so don't require a draft there.
  const reviewable = isPr ? (!!f.draft || hasSuggestion(f)) : !!f.draft;
  const reviewMode = state.modalMode === 'review' && reviewable;
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
    // Captioned so the per-hunk ✅/❌/✏️ buttons read as scoped to each individual change,
    // not a second "the decision" — they sit below the finding-level Decision row and the
    // draft verdict control, and this heading is what makes that nesting legible (U-3).
    kids.push(h('div', { class: 'hunk-section-head' },
      h('span', { class: 'step-section-label' }, 'Per-change:'),
      h('div', { class: 'hunk-tally' },
        tallyPart(t.accepted, 'accepted', 'accepted'),
        tallyPart(t.rejected, 'rejected', 'rejected'),
        tallyPart(t.edited, 'edited', 'edited'),
        tallyPart(t.undecided, 'undecided', 'undecided'),
      )));
    for (const hunk of hunks) kids.push(hunkEl(f, hunk, review[String(hunk.id)]));
  }
  if (truncated) kids.push(h('div', { class: 'diff-trunc' }, `Diff truncated to ${DIFF_MAX_LINES} lines per side.`));
  return kids;
}

function reviewFrame(f) {
  const data = state.detail;
  const kind = (data && data.feature && data.feature.kind) || 'spec';
  const isPr = kind === 'pr-review' || kind === 'pr-respond';
  const hasDraft = !!f.draft;
  const d = f.draft;
  // Only touch draft-derived stats when there actually is a draft — a
  // suggestion-only PR finding has none and must not read draft.* (Bug A).
  const stats = hasDraft ? draftStats(f) : null;

  const renderable = canRenderProse(f);
  const mkTab = (mode, label) => h('button', {
    class: `diff-tab ${state.diffMode === mode ? 'active' : ''}`,
    type: 'button', 'aria-label': `${label} view`,
    onclick: () => { state.diffMode = mode; reviewRefresh(); },
  }, label);

  const headMeta = hasDraft
    ? h('div', { class: 'rm-headmeta' },
        h('code', { class: 'diff-target' }, d.target || f.locus || '—'),
        d.format ? h('span', { class: 'diff-fmt' }, d.format) : null,
        h('span', { class: 'diff-counts' },
          h('span', { class: 'diff-add-n' }, `+${stats.adds}`), ' ',
          h('span', { class: 'diff-del-n' }, `−${stats.dels}`)))
    : (f.locus ? h('div', { class: 'rm-headmeta' }, h('code', { class: 'diff-target' }, f.locus)) : null);

  const header = h('header', { class: 'rm-head' },
    h('div', { class: 'rm-head-main' },
      h('button', { class: 'btn rm-back', type: 'button',
        onclick: () => { state.modalMode = 'detail'; state.editingHunk = null; state.exportFp = null; syncModal(); } },
        '← Back'),
      h('h2', { class: 'rm-title' }, f.title || '(untitled finding)'),
      headMeta,
    ),
    h('div', { class: 'rm-head-right' },
      hasDraft && stats.hunks.length ? h('div', { class: 'diff-toggle', role: 'group', 'aria-label': 'Diff view mode' },
        renderable ? mkTab('rendered', 'Rendered') : null, mkTab('unified', 'Unified'), mkTab('split', 'Split')) : null,
      h('button', { class: 'rm-close', type: 'button', 'aria-label': 'Close review',
        onclick: () => closeModal() }, '×'),
    ),
  );

  const verdict = draftVerdict(f);

  // For a PR finding the review surface mirrors the stepper card: the finding
  // rationale, the editable proposed comment, the (optional) diff, and the
  // kind-aware decision row. Spec findings keep the pure diff-review body.
  const bodyKids = [];
  if (isPr) {
    if (f.detail) bodyKids.push(h('p', { class: 'rm-detail' }, f.detail));
    bodyKids.push(suggestionSection(kind, f));
    if (hasDraft) bodyKids.push(...reviewBodyKids(f));
    bodyKids.push(decisionRow(data, f));
  } else {
    bodyKids.push(...reviewBodyKids(f));
  }

  const exportOpen = state.exportFp === f.fp;
  // Export / discard act on a code-diff draft, so only show them when there is one.
  const footer = hasDraft ? h('footer', { class: 'rm-foot' },
    stats.hunks.length ? h('button', {
      class: `btn ${exportOpen ? 'btn-accent' : ''}`, type: 'button',
      onclick: () => { state.exportFp = exportOpen ? null : f.fp; refreshModal(); },
    }, exportOpen ? 'Hide export' : 'Export decisions') : null,
    h('button', { class: 'btn btn-danger', type: 'button',
      onclick: () => discardDraft(f.fp) }, 'Discard draft'),
  ) : null;

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

  // When the proposal is redirected (rejected with a counter), offer to fire the loop:
  // POST /counter records the redirect + note AND queues a scoped re-audit so the proposer
  // re-evaluates just this item against the counter and re-drafts.
  const reauditBtn = verdict === 'redirect'
    ? h('button', {
        class: 'btn btn-accent reaudit-btn', type: 'button',
        title: 'Send your counter and re-audit just this item against it (a scoped re-audit job is queued for /flowlever:watch).',
        onclick: (e) => { e.stopPropagation(); sendCounter(f, ta); },
      }, '↻ Send counter & re-audit')
    : null;

  return h('div', { class: 'review-note', onclick: stop },
    h('div', { class: 'review-note-head' },
      h('span', { class: 'f-suglabel' }, 'Note to the agent / counter-proposal'),
      h('div', { class: 'verdict-control', role: 'group', 'aria-label': 'Finding verdict' },
        mkV('proposed'), mkV('redirect'), mkV('reject')),
      saved,
    ),
    ta,
    reauditBtn,
  );
}

/* Reject + counter: POST the counter to /counter, which records verdict=redirect + the note
 * AND enqueues a SCOPED re-audit so the proposer re-evaluates just this item against the
 * counter and re-drafts — the per-item refine loop the spec section mirrors from PR review. */
async function sendCounter(f, ta) {
  const note = ((ta && ta.value) || draftNote(f) || '').trim();
  if (!note) { toast('Write your counter-proposal in the note first'); return; }
  try {
    const res = await api(`/api/features/${encodeURIComponent(current.id)}/findings/${encodeURIComponent(f.fp)}/counter`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    const cur = findFinding(f.fp);
    if (cur && res && res.finding && res.finding.draft) cur.draft = res.finding.draft;
    toast('Counter sent — scoped re-audit queued', 'success');
    ensureApplyPolling();
    pollRequestsNow();
    refreshModal();
  } catch (e) {
    toast(`Could not send counter: ${e.message}`);
  }
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
  const rendered = !editing && canRenderProse(f) && state.diffMode === 'rendered';
  const parts = [
    h('div', { class: `hunk-diff${rendered ? ' hunk-diff-rendered' : ''}` },
      rendered ? renderedHunkEl(f, hunk)
        : (state.diffMode === 'split' ? diffSplit(hunk.rows) : diffUnified(hunk.rows))),
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
      h('div', { class: 'fgroup fgroup-end' }, draftPill, statusSel, search, exportAllBtn),
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
  // Posted findings (comment sent, awaiting author) are reworking under the hood but get their
  // own lane so they read as "out, not in-progress". Inserted after Reworking, PR kinds only.
  const kind = (state.detail && state.detail.feature && state.detail.feature.kind) || 'spec';
  const isPr = kind === 'pr-review' || kind === 'pr-respond';
  // After Reworking, insert the transient in-flight lane (Posting…/Applying…) and the
  // "out, awaiting reconcile" lane (Posted — awaiting author for PR, Applied — awaiting re-audit
  // for spec). These are derived from the pending marker + the postedAt/appliedAt stamp, so an
  // item only reads "done-ish" once the runner has actually written it back.
  const inflightLane = isPr
    ? { key: 'pending', label: 'Posting…' }
    : { key: 'pending', label: 'Applying…' };
  const outLane = isPr
    ? { key: 'posted', label: 'Posted — awaiting author' }
    : { key: 'applied', label: 'Applied — awaiting re-audit' };
  const cols = [];
  for (const col of STATUS_COLS) {
    cols.push(col);
    if (col.key === 'reworking') { cols.push(inflightLane); cols.push(outLane); }
  }
  const inCol = (f, key) => {
    if (key === 'pending') return isPending(f);
    if (key === 'posted') return isPosted(f);
    if (key === 'applied') return isApplied(f);
    // base status lanes never show a finding that's in-flight or already out
    return f.status === key && !isInFlightOrOut(f);
  };
  board.classList.toggle('board-pr', true);          // wider grid: adds the in-flight + out lanes
  board.replaceChildren(...cols.map((col) => {
    const items = filtered
      .filter((f) => inCol(f, col.key))
      .sort((a, b) => sevRank(a.severity) - sevRank(b.severity)
        || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    return h('section', { class: `col col-${col.key}${items.length ? '' : ' col-vacant'}` },
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
      duplicateChip(f),
      // A drafted proposal that hasn't been decided yet → a clear "review me" cue.
      (f.draft && f.draft.targetRef && !isReviewed(f) && f.decision === undefined && !isInFlightOrOut(f))
        ? h('span', { class: 'f-review-chip', title: 'A proposed change is ready — open to review' }, '± review')
        : (f.draft ? h('span', { class: 'f-draft-chip', title: 'Has a proposed change' }, '±') : null),
      decisionChip(f),
      fixCommitChip(f),
      verdictChip(f),
      f.locus ? h('code', { class: 'f-locus' }, f.locus) : null,
    ),
  );
  return card;
}

/* Board / header marker shown when a finding's proposal is overridden by a
 * redirect or reject verdict. Null for the default 'proposed' verdict. */
/* Board chip for a persisted triage decision on a not-yet-posted PR comment, so the
 * board shows "Will post" / "Edited" without opening the card. (Dismissed findings already
 * move to the Waived lane; posted ones to the Posted lane.) */
/* Amber DUPLICATE chip: instantly flags a finding that mirrors an already-raised comment.
 * Links to the canonical comment when duplicateOf.url is set (click must not open the modal). */
function duplicateChip(f) {
  const d = f.duplicateOf;
  if (!d || !d.label) return null;
  const title = `Duplicate of ${d.label} — the full answer lives there`;
  if (d.url) {
    return h('a', { class: 'f-dup-chip', href: d.url, target: '_blank', rel: 'noopener', title,
      onclick: (e) => e.stopPropagation() }, 'DUPLICATE ↗');
  }
  return h('span', { class: 'f-dup-chip', title }, 'DUPLICATE');
}

function decisionChip(f) {
  if (isPosted(f) || f.status === 'waived') return null;
  if (f.decision === 'approve') return h('span', { class: 'f-dec-chip dec-accept', title: 'Approved — will post' }, 'Will post');
  if (f.decision === 'edit') return h('span', { class: 'f-dec-chip dec-edit', title: 'Edited — will post' }, 'Edited');
  if (f.decision === 'fix-only') return h('span', { class: 'f-dec-chip dec-fixonly', title: 'Fix will be pushed; no reply will be posted' }, 'Fix, no reply');
  return null;
}

/* Does this finding owe a code change? Mirrors ledger.isAgreedCodeFix — a before→after draft that
 * actually changes something and was signed off, either finding-level or hunk-by-hunk. */
function isAgreedCodeFix(f) {
  const d = f.draft;
  if (!d || typeof d.after !== 'string' || d.after === d.before) return false;
  const rv = d.review || {};
  if (rv.verdict === 'redirect' || rv.verdict === 'reject') return false;
  if (f.decision === 'edit' || f.decision === 'fix-only') return true;
  return Object.values(rv.hunks || {}).some((h) => h && (h.status === 'accepted' || h.status === 'edited'));
}

/* The proof, or the absence of it. A fix that landed shows its commit; a fix claimed done with NO
 * commit behind it gets a loud red chip — that combination means the reviewer was told their point
 * was handled while the branch never changed, which is the failure this whole gate exists to stop.
 * Legacy findings stamped before the gate existed surface here too, which is intended. */
function fixCommitChip(f) {
  const owed = isAgreedCodeFix(f);
  const sha = f.fixCommit && f.fixCommit.sha;
  if (sha) {
    return h('span', {
      class: 'f-fix-chip',
      title: `Fix pushed in ${sha}${f.fixCommit.branch ? ` on ${f.fixCommit.branch}` : ''}${f.fixCommit.repo ? ` (${f.fixCommit.repo})` : ''}`,
    }, `✔ fix ${sha.slice(0, 8)}`);
  }
  if (owed && (isPosted(f) || f.status === 'resolved')) {
    return h('span', {
      class: 'f-fix-chip f-fix-missing',
      title: 'This was closed as handled but no commit carries the change — the branch does not contain the fix. Reopen it and redo the fix.',
    }, '⚠ fix not pushed');
  }
  return null;
}

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
  // PR-kind workspaces use the kind-aware triage (Approve/Edit/Dismiss · Reply/
  // Apply fix/Push back/Skip), NOT the spec lifecycle verbs — same decision row
  // and underlying state.flow the stepper uses, so the two agree. Spec/default
  // keeps the Reworking / Resolved / Waive / Pin lifecycle below.
  const kind = (state.detail && state.detail.feature && state.detail.feature.kind) || 'spec';
  const btn = (label, body, cls = '') => h('button', {
    class: `btn ${cls}`.trim(),
    type: 'button',
    onclick: (e) => { e.stopPropagation(); doAction(f.fp, body); },
  }, label);
  if (kind === 'pr-review' || kind === 'pr-respond') {
    // A posted comment is past triage — it's awaiting the author. Offer manual override so it
    // can be closed/resolved at any time (no author response needed) or reopened to re-comment,
    // rather than the Approve/Edit/Dismiss triage row that only applies before posting.
    if (isPosted(f)) {
      const waiveBtnP = h('button', { class: 'btn', type: 'button',
        onclick: (e) => { e.stopPropagation(); state.waiving = f.fp; refreshModal(); } }, '→ Dismiss');
      return h('div', { class: 'f-actions' },
        h('span', { class: 'f-posted-note meta-dim' }, 'Posted — awaiting author.'),
        btn('✓ Mark resolved', { status: 'resolved' }, 'btn-good'),
        btn('↺ Reopen (re-comment)', { status: 'open' }),
        waiveBtnP);
    }
    ensureFlow();
    return decisionRow(state.detail, f);
  }
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
      h('p', {}, 'Coverage is filled in by an audit round (', h('code', {}, '/flowlever:audit'),
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
      h('p', {}, 'Run ', h('code', {}, '/flowlever:audit'), ' to start the ledger.'));
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
  } else if (
    // Stepper-scoped decide-loop shortcuts (U-5): only while the focused card is showing (not
    // the finish screen), never while an inline editor is open (its own textarea/keys own input),
    // and never while any modifier is held or focus is in a field — isTyping already covers a
    // field with focus, this adds the belt-and-suspenders check for non-field-but-editing state.
    current.view === 'review-flow' && !state.flow.finish && !state.flow.waiving
    && !state.flow.editingComment && !state.editingHunk
    && !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey
  ) {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'j' || e.key === 'ArrowRight') { e.preventDefault(); stepGoNext(); return; }
    if (key === 'k' || e.key === 'ArrowLeft') { e.preventDefault(); stepGoPrev(); return; }
    const decKind = DECIDE_KEYS[key];
    if (!decKind || !state.detail) return;
    const data = state.detail;
    const fp = state.flow.items[state.flow.idx];
    const findings = (data.ledger && data.ledger.findings) || [];
    const f = findings.find((x) => x.fp === fp);
    if (!f) return;
    const kind = (data.feature && data.feature.kind) || 'spec';
    // Only fire a key the current workspace kind actually offers — the SAME handler the visible
    // decision button calls (decide()), so there is no separate, easier-to-drift code path.
    if (!decisionActions(kind).buttons.some((b) => b.kind === decKind)) return;
    e.preventDefault();
    decide(data, f, decKind);
  }
});

/* ============================== boot ============================== */

/* Compare the running server's API version against what this page was built for, and say so loudly
 * if they differ — in the RIGHT direction. A 404 on /api/version means the server predates the
 * check entirely, which is conclusive evidence the SERVER is the stale side; a numeric mismatch
 * can go either way (an upgraded server outliving a browser tab with a cached older app.js is just
 * as real as the reverse), so the two are told apart and each gets the instruction that actually
 * fixes it — the previous version only ever blamed the server, even when the PAGE was behind.
 * Re-checked on every poll tick (not a second timer) so a tab left open across an upgrade catches
 * up instead of latching the boot-time verdict forever; a banner is dropped once versions agree
 * again (e.g. the server got restarted). */
async function checkServerVersion() {
  let got = null;
  try {
    const res = await fetch('/api/version');
    if (res.ok) {
      const body = await res.json();
      got = body && body.apiVersion;
    } else if (res.status !== 404) {
      return;   // some other transient failure; don't cry wolf
    }
  } catch {
    return;     // server down / offline — the views surface that on their own
  }
  const gotN = got == null ? NaN : Number(got);
  if (Number.isFinite(gotN) && gotN === Number(EXPECTED_API_VERSION)) {
    const bar = $('#stale-server');
    if (bar) bar.remove();   // back in sync since the last check
    return;
  }
  const serverIsNewer = Number.isFinite(gotN) && gotN > Number(EXPECTED_API_VERSION);
  showStaleServerBanner(got, serverIsNewer);
}

function showStaleServerBanner(got, serverIsNewer) {
  const versionNote = got ? ` (server API v${got}, page expects v${EXPECTED_API_VERSION})` : ' (server predates the version check)';
  const body = serverIsNewer
    ? h('div', { class: 'stale-server-body' },
        h('strong', {}, 'This page is running an older build than the cockpit server.'),
        h('span', {}, ' It may call routes or read fields the server has since changed. Hard-reload this tab', versionNote, '.'))
    : h('div', { class: 'stale-server-body' },
        h('strong', {}, 'The cockpit server is running an older build than this page.'),
        h('span', {}, ' Actions can fail with a bare “Not found” because the server has never heard of ',
          'the routes this page calls. Restart it: ', h('code', {}, 'node src/cli.js start'), versionNote));
  const existing = $('#stale-server');
  if (existing) existing.remove();   // rebuilt below — the direction may have flipped since last check
  const bar = h('div', { class: 'stale-server', id: 'stale-server', role: 'alert' },
    h('span', { class: 'stale-server-icon', 'aria-hidden': 'true' }, '⚠'),
    body,
    h('button', {
      class: 'btn-icon stale-server-dismiss', type: 'button', 'aria-label': 'Dismiss',
      title: 'Dismiss (the mismatch remains)', onclick: () => bar.remove(),
    }, '×'));
  document.body.prepend(bar);
}

window.addEventListener('hashchange', route);
// Know whether a runner is going before the first paint settles, so the Run button doesn't pop in
// a tick later (the shared poller keeps it fresh from then on).
refreshRunner().then(renderRunnerZones).catch(() => {});
checkServerVersion();
loadLiveConfig();
route();
