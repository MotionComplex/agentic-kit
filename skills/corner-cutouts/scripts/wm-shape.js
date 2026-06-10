/* =============================================================================
   <wm-shape> — AVAX Network signature corner primitive
   -----------------------------------------------------------------------------
   The "cutout" on the brand panels and CTAs is NOT a sharp clip-path:polygon and
   NOT an exposed convex corner. It is a rounded-rectangle with ONE corner
   replaced by a 45° chamfer whose own vertices are rounded — drawn as an SVG
   path so the diagonal can carry the hairline stroke. This mirrors the live
   avax.network <wm-shape> custom element.

   Usage (host must be a positioned box; the element fills it):

     <div class="panel" style="position:relative">
       <wm-shape corner="br" rounded="28" corner-size="120" corner-rounded="20"
                 fill="var(--red)" stroke="rgba(255,255,255,.18)" stroke-width="1"></wm-shape>
       <div class="content"> ... </div>   <!-- sits above the shape -->
     </div>

   Attributes
     corner         tl | tr | br | bl            (default br)
     rounded        radius of the 3 normal corners — any CSS length (default 24)
     corner-size    chamfer leg length           — any CSS length (default 96)
     corner-rounded radius at the 2 chamfer tips  — any CSS length (default 16)
     fill           paint for the surface         (default none)
     stroke         paint for the hairline        (default none)
     stroke-width   hairline width in px          (default 0)
     clip           present => also clip the HOST element to the shape
                    (so its own background + overflowing media follow the cut)

   All lengths accept clamp()/vw/rem/px — they are resolved to px against the
   host and recomputed on resize, so the shape stays exact at every breakpoint.

   Also exposes window.WMShape.path(w, h, opts) for ad-hoc clip-path usage.
   ========================================================================== */
(function () {
  'use strict';

  function chamferPolygon(w, h, cs, corner) {
    var TL = { x: 0, y: 0, role: 'r', c: 'tl' },
        TR = { x: w, y: 0, role: 'r', c: 'tr' },
        BR = { x: w, y: h, role: 'r', c: 'br' },
        BL = { x: 0, y: h, role: 'r', c: 'bl' };
    switch (corner) {
      case 'tr': return [TL, { x: w - cs, y: 0, role: 'c' }, { x: w, y: cs, role: 'c' }, BR, BL];
      case 'bl': return [TL, TR, BR, { x: cs, y: h, role: 'c' }, { x: 0, y: h - cs, role: 'c' }];
      case 'tl': return [{ x: cs, y: 0, role: 'c' }, TR, BR, BL, { x: 0, y: cs, role: 'c' }];
      case 'br':
      default:   return [TL, TR, { x: w, y: h - cs, role: 'c' }, { x: w - cs, y: h, role: 'c' }, BL];
    }
  }

  function rnd(x) { return Math.round(x * 1000) / 1000; }

  function chamferPath(w, h, opts) {
    opts = opts || {};
    var r = opts.r != null ? opts.r : 24,
        cs = opts.cornerSize != null ? opts.cornerSize : 96,
        cr = opts.cornerRadius != null ? opts.cornerRadius : 16,
        corner = opts.corner || 'br';
    // clamp params to what the box can hold
    cs = Math.max(0, Math.min(cs, w, h));
    var pts = chamferPolygon(w, h, cs, corner), n = pts.length;
    var dist = function (a, b) { return Math.hypot(a.x - b.x, a.y - b.y); };

    var nodes = pts.map(function (V, i) {
      var P = pts[(i - 1 + n) % n], N = pts[(i + 1) % n];
      var rad = V.role === 'c' ? cr : (typeof r === 'number' ? r : (r[V.c] != null ? r[V.c] : 24));
      var lenP = dist(V, P), lenN = dist(V, N);
      var d1 = { x: (P.x - V.x) / lenP, y: (P.y - V.y) / lenP };
      var d2 = { x: (N.x - V.x) / lenN, y: (N.y - V.y) / lenN };
      var dot = Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y));
      var half = Math.acos(dot) / 2;
      var t = rad / Math.tan(half);
      t = Math.min(t, lenP / 2, lenN / 2);
      var effR = t * Math.tan(half);
      var entry = { x: V.x + d1.x * t, y: V.y + d1.y * t };
      var exit = { x: V.x + d2.x * t, y: V.y + d2.y * t };
      var cross = (V.x - P.x) * (N.y - V.y) - (V.y - P.y) * (N.x - V.x);
      var sweep = cross < 0 ? 0 : 1; // convex turn for a CW (y-down) polygon
      return { entry: entry, exit: exit, effR: effR, sweep: sweep };
    });

    var f = function (p) { return rnd(p.x) + ' ' + rnd(p.y); };
    var d = 'M ' + f(nodes[n - 1].exit);
    for (var i = 0; i < n; i++) {
      var nd = nodes[i];
      d += ' L ' + f(nd.entry) + ' A ' + rnd(nd.effR) + ' ' + rnd(nd.effR) +
           ' 0 0 ' + nd.sweep + ' ' + f(nd.exit);
    }
    return d + ' Z';
  }

  if (typeof window === 'undefined') return;
  window.WMShape = { path: chamferPath };

  var NS = 'http://www.w3.org/2000/svg';

  if (!('customElements' in window)) return;
  if (customElements.get('wm-shape')) return;

  class WMShapeElement extends HTMLElement {
    static get observedAttributes() {
      return ['corner', 'rounded', 'corner-size', 'corner-rounded', 'stroke-width', 'fill', 'stroke', 'clip'];
    }

    connectedCallback() {
      var host = this.parentElement;
      this._host = host;
      if (host && getComputedStyle(host).position === 'static') host.style.position = 'relative';

      Object.assign(this.style, {
        position: 'absolute', inset: '0', display: 'block', pointerEvents: 'none', zIndex: '0'
      });
      if (!this._svg) {
        this._svg = document.createElementNS(NS, 'svg');
        this._path = document.createElementNS(NS, 'path');
        this._svg.appendChild(this._path);
        this.appendChild(this._svg);
        Object.assign(this._svg.style, {
          position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'visible'
        });
        this._svg.setAttribute('preserveAspectRatio', 'none');
        this._svg.setAttribute('fill', 'none');
        this._ro = new ResizeObserver(this.render.bind(this));
        if (host) this._ro.observe(host);
      }
      this.render();
    }

    disconnectedCallback() {
      if (this._ro) this._ro.disconnect();
      if (this.hasAttribute('clip') && this._host) this._host.style.clipPath = '';
    }

    attributeChangedCallback() {
      if (this.isConnected) this.render();
    }

    // resolve any CSS length string (px / rem / vw / clamp()) to px against the host
    _measure(v, def) {
      if (v == null || v === '') return def;
      var asNum = Number(v);
      if (!isNaN(asNum) && String(asNum) === String(v).trim()) return asNum;
      var probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;height:0;width:' + v;
      (this._host || document.body).appendChild(probe);
      var px = probe.getBoundingClientRect().width;
      probe.parentNode.removeChild(probe);
      return px;
    }
    _len(attr, def) { return this._measure(this.getAttribute(attr), def); }

    // `rounded` accepts one value (all corners) or four (tl tr br bl, CSS order)
    _rounded() {
      var v = this.getAttribute('rounded');
      if (v == null || v === '') return 24;
      var parts = v.trim().split(/\s+/);
      if (parts.length < 4) return this._measure(parts[0], 24);
      var self = this;
      return {
        tl: self._measure(parts[0], 24), tr: self._measure(parts[1], 24),
        br: self._measure(parts[2], 24), bl: self._measure(parts[3], 24)
      };
    }

    render() {
      var host = this._host;
      if (!host || !this._path) return;
      var rect = host.getBoundingClientRect();
      var w = rect.width, h = rect.height;
      if (!w || !h) return;
      var d = chamferPath(w, h, {
        corner: this.getAttribute('corner') || 'br',
        r: this._rounded(),
        cornerSize: this._len('corner-size', 96),
        cornerRadius: this._len('corner-rounded', 16)
      });
      this._svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      this._path.setAttribute('d', d);
      this._path.setAttribute('fill', this.getAttribute('fill') || 'none');
      this._path.setAttribute('stroke', this.getAttribute('stroke') || 'none');
      this._path.setAttribute('stroke-width', this._len('stroke-width', 0));
      this._path.setAttribute('vector-effect', 'non-scaling-stroke');
      if (this.hasAttribute('clip')) host.style.clipPath = "path('" + d + "')";
    }
  }

  customElements.define('wm-shape', WMShapeElement);

  /* ---------------------------------------------------------------------------
     Declarative upgraders — add the signature cut to existing markup without
     rewriting every element. Two ways in:

       1. Attribute:  <button class="btn" data-wm-cut="br" data-wm-size="24"> ...
          (auto-applied on DOMContentLoaded)
       2. Programmatic: WMShape.upgrade('.notch-br', { corner:'br', cornerSize:24 })
          — maps an existing utility CLASS onto the primitive, so legacy class
          names keep working but now render the rounded path.

     Both default to `clip` mode: the host element's own background/border/media
     follow the cut, so no fill needs to be re-declared. Pass paint:true (or
     a fill/stroke) to draw the shape instead. `rounded` defaults to the host's
     computed border-radius; `cornerRadius` defaults to ~20% of the chamfer leg.

     FILLED vs BORDERED hosts — important:
       • Filled host (solid button, panel, card): use clip mode. The element's
         background just follows the cut. Done.
       • Bordered host (outline/ghost button): a CSS `border` CANNOT trace the
         clipped diagonal — the cut edge is left open. Instead drop the CSS
         border and use paint:true + strokeWidth, so the shape draws the border
         and it follows the chamfer. Colour it from CSS for hover/state:
            .btn-outline{background:transparent}              // no border
            .btn-outline wm-shape path{stroke:var(--line)}    // base
            .btn-outline:hover wm-shape path{stroke:var(--ink)} // hover
         (CSS `stroke` on the path overrides the presentation attribute, so
          state changes work even though render() re-sets the attribute.)
     --------------------------------------------------------------------------- */
  function num(v) { return v == null || v === '' ? undefined : parseFloat(v); }

  function applyTo(host, opts) {
    if (!host || host.querySelector(':scope > wm-shape')) return; // idempotent
    opts = opts || {};
    // Any of cornerSize / rounded / cornerRadius can be given as an explicit value
    // OR as a *Ratio of the host's height*, so a button is the same shape scaled to size.
    // Options: roundedRatio, cornerSizeRatio (+ cornerSizeMin/cornerSizeMax to clamp the
    // cut at extreme sizes), cornerRoundedRatio, and cornerRoundedOfCut (tip as a fraction
    // of the cut — keeps the chamfer's softness constant regardless of cut size).
    // Our button rule: roundedRatio 0.20, cornerSizeRatio 0.32 (clamp 12-28), cornerRoundedOfCut 0.31.
    var H = host.getBoundingClientRect().height;
    var size;
    if (opts.cornerSize != null) size = opts.cornerSize;
    else if (opts.cornerSizeRatio != null) {
      size = opts.cornerSizeRatio * H;
      if (opts.cornerSizeMin != null) size = Math.max(opts.cornerSizeMin, size); // don't go too small on tiny buttons
      if (opts.cornerSizeMax != null) size = Math.min(opts.cornerSizeMax, size); // don't balloon on huge ones
      size = Math.round(size);
    }
    else size = 24;
    var rounded = opts.rounded;
    if (rounded == null && opts.roundedRatio != null) rounded = Math.round(opts.roundedRatio * H);
    if (rounded == null) {
      // inherit the host's own per-corner radii so square/rounded edges are preserved
      var cs = getComputedStyle(host);
      var g = function (p) { var n = parseFloat(cs[p]); return isNaN(n) ? 0 : n; };
      rounded = g('borderTopLeftRadius') + ' ' + g('borderTopRightRadius') + ' ' +
                g('borderBottomRightRadius') + ' ' + g('borderBottomLeftRadius');
    }
    // tip: prefer a fraction of the CUT (keeps the chamfer's softness constant at any cut size),
    // else a fraction of height, else ~20% of the cut.
    var cr = opts.cornerRadius != null ? opts.cornerRadius
      : (opts.cornerRoundedOfCut != null && typeof size === 'number') ? Math.max(3, Math.round(opts.cornerRoundedOfCut * size))
      : opts.cornerRoundedRatio != null ? Math.max(3, Math.round(opts.cornerRoundedRatio * H))
      : (typeof size === 'number' ? Math.max(4, Math.round(size * 0.2)) : 16);
    var el = document.createElement('wm-shape');
    el.setAttribute('corner', opts.corner || 'br');
    el.setAttribute('rounded', rounded);
    el.setAttribute('corner-size', size);
    el.setAttribute('corner-rounded', cr);
    var painting = opts.paint || opts.fill || opts.stroke;
    if (opts.fill) el.setAttribute('fill', opts.fill);
    if (opts.stroke) el.setAttribute('stroke', opts.stroke);
    if (opts.strokeWidth != null) el.setAttribute('stroke-width', opts.strokeWidth);
    if (!painting || opts.clip) el.setAttribute('clip', '');
    host.appendChild(el);
  }

  window.WMShape.applyTo = applyTo;
  window.WMShape.upgrade = function (selector, opts) {
    document.querySelectorAll(selector).forEach(function (host) { applyTo(host, opts); });
  };

  function autoInit() {
    document.querySelectorAll('[data-wm-cut]').forEach(function (host) {
      applyTo(host, {
        corner: host.getAttribute('data-wm-cut') || 'br',
        cornerSize: num(host.getAttribute('data-wm-size')),
        rounded: num(host.getAttribute('data-wm-rounded')),
        cornerRadius: num(host.getAttribute('data-wm-corner-rounded')),
        fill: host.getAttribute('data-wm-fill') || undefined,
        stroke: host.getAttribute('data-wm-stroke') || undefined,
        strokeWidth: num(host.getAttribute('data-wm-stroke-width')),
        paint: host.hasAttribute('data-wm-paint')
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})();
