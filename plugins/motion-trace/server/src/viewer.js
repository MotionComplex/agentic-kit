/**
 * Trace-overlay viewer (spec M4) — generate a self-contained HTML page that
 * overlays the numeric trace on the filmstrip and lets you scrub through it.
 *
 * The point: a human (or a reviewer checking the tool) can SEE that the data
 * matches the pixels — bounding boxes and resolved state are drawn on top of the
 * actual rendered frame at each instant. Everything (trace + frames as data URIs)
 * is embedded, so the output opens by double-click via file:// — no server.
 *
 * @param {object} trace   a MotionTrace (with tracks + timeline + meta)
 * @param {{t:number, dataURI:string}[]} frames  one per sampled frame, in order
 * @returns {string} HTML
 */
export function buildViewer(trace, frames) {
  const [vw, vh] = trace.meta.viewport;
  const data = {
    meta: trace.meta,
    timeline: trace.timeline || [],
    tracks: trace.tracks.map((t) => ({ selector: t.selector, frames: t.frames })),
    frames: frames.map((f) => f.dataURI),
    times: (trace.tracks[0]?.frames || []).map((f) => f.t),
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>MotionTrace viewer — ${escapeHtml(trace.meta.url || '')}</title>
<style>
  :root { --bg:#0e1116; --panel:#161b22; --line:#30363d; --fg:#e6edf3; --muted:#8b949e; --accent:#58a6ff; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:13px/1.5 ui-sans-serif,system-ui,sans-serif; }
  header { padding:10px 16px; border-bottom:1px solid var(--line); display:flex; gap:16px; align-items:baseline; flex-wrap:wrap; }
  header b { color:var(--accent); }
  header .muted { color:var(--muted); }
  main { display:grid; grid-template-columns:1fr 320px; gap:0; height:calc(100vh - 52px); }
  .stage { position:relative; overflow:auto; background:#000 repeating-conic-gradient(#1b1b1b 0% 25%, #222 0% 50%) 0/24px 24px; display:flex; align-items:center; justify-content:center; }
  .frame { position:relative; }
  .frame img { display:block; max-width:100%; height:auto; }
  .frame svg { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
  rect.box { fill:rgba(88,166,255,.08); stroke:var(--accent); stroke-width:1.5; vector-effect:non-scaling-stroke; }
  text.lbl { fill:var(--accent); font:11px ui-monospace,monospace; paint-order:stroke; stroke:#000; stroke-width:3px; }
  aside { background:var(--panel); border-left:1px solid var(--line); padding:14px; overflow:auto; }
  aside h3 { margin:14px 0 6px; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
  .anim, .state { border:1px solid var(--line); border-radius:6px; padding:8px; margin-bottom:8px; }
  .anim b { color:var(--fg); } .anim .k { color:var(--muted); }
  .state .sel { color:var(--accent); font:12px ui-monospace,monospace; }
  .row { display:flex; justify-content:space-between; font:12px ui-monospace,monospace; }
  .row span:first-child { color:var(--muted); }
  .controls { padding:10px 16px; border-top:1px solid var(--line); display:flex; gap:12px; align-items:center; }
  .controls input[type=range] { flex:1; }
  button { background:#21262d; color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:6px 12px; cursor:pointer; }
  button:hover { border-color:var(--accent); }
  .t { font:12px ui-monospace,monospace; color:var(--muted); min-width:110px; }
</style></head>
<body>
<header>
  <div><b>MotionTrace</b> viewer</div>
  <div class="muted" id="hUrl"></div>
  <div class="muted" id="hMeta"></div>
</header>
<main>
  <div class="stage"><div class="frame" id="frame">
    <img id="img" alt="frame">
    <svg id="ovl" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet"></svg>
  </div></div>
  <aside>
    <h3>Declared timeline</h3><div id="anims"></div>
    <h3>State @ frame</h3><div id="states"></div>
  </aside>
</main>
<div class="controls">
  <button id="play">▶ Play</button>
  <input type="range" id="scrub" min="0" value="0">
  <div class="t" id="tlabel"></div>
</div>
<script>
const D = ${json};
const img = document.getElementById('img');
const ovl = document.getElementById('ovl');
const scrub = document.getElementById('scrub');
const tlabel = document.getElementById('tlabel');
const N = D.frames.length;
scrub.max = String(N - 1);

document.getElementById('hUrl').textContent = D.meta.url || '';
document.getElementById('hMeta').textContent =
  D.meta.viewport.join('×') + '  ·  ' + D.meta.fps + 'fps  ·  ' + D.meta.duration_ms + 'ms  ·  ' +
  N + ' frames  ·  trigger:' + D.meta.trigger + (D.meta.reducedMotion === 'reduce' ? '  ·  reduced-motion' : '');

document.getElementById('anims').innerHTML = D.timeline.length
  ? D.timeline.map(a => '<div class="anim"><b>' + esc(a.selector) + '</b> <span class="k">' + a.type + '</span><br>' +
      '<span class="k">dur</span> ' + a.duration_ms + 'ms · <span class="k">delay</span> ' + a.delay_ms + 'ms<br>' +
      '<span class="k">easing</span> ' + esc(String(a.easing)) + '</div>').join('')
  : '<div class="anim k">no declared animations</div>';

function esc(s){ return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
const COLORS = ['#58a6ff','#3fb950','#d29922','#db61a2','#a371f7'];

function render(i) {
  img.src = D.frames[i];
  // overlay boxes
  let svg = '';
  let panel = '';
  D.tracks.forEach((tr, ti) => {
    const f = tr.frames[i];
    if (!f) return;
    const [x,y,w,h] = f.bbox;
    const col = COLORS[ti % COLORS.length];
    svg += '<rect class="box" x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" style="stroke:'+col+'" opacity="'+Math.max(0.15,f.opacity)+'"/>' +
           '<text class="lbl" x="'+(x+2)+'" y="'+(y-4)+'" style="fill:'+col+'">'+esc(tr.selector)+'</text>';
    const tf = f.transform;
    panel += '<div class="state"><div class="sel" style="color:'+col+'">'+esc(tr.selector)+'</div>' +
      row('opacity', f.opacity) +
      row('translate', tf.translate.join(', ')) +
      row('scale', tf.scale.join(', ')) +
      row('rotate', tf.rotate + '°') +
      row('bbox', f.bbox.join(', ')) + '</div>';
  });
  ovl.innerHTML = svg;
  document.getElementById('states').innerHTML = panel;
  tlabel.textContent = 't = ' + D.times[i] + 'ms   (' + (i+1) + '/' + N + ')';
}
function row(k,v){ return '<div class="row"><span>'+k+'</span><span>'+esc(v)+'</span></div>'; }

scrub.addEventListener('input', () => render(+scrub.value));

let playing = false, timer = null;
const playBtn = document.getElementById('play');
playBtn.addEventListener('click', () => {
  playing = !playing;
  playBtn.textContent = playing ? '❚❚ Pause' : '▶ Play';
  if (playing) {
    const dt = 1000 / (D.meta.fps || 30);
    timer = setInterval(() => {
      let i = (+scrub.value + 1) % N;
      scrub.value = String(i);
      render(i);
      if (i === N - 1) { /* loop */ }
    }, dt);
  } else clearInterval(timer);
});

render(0);
</script>
</body></html>
`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
