#!/usr/bin/env node
/* =============================================================================
   chamfer-path.js — rounded-chamfer ("cutout corner") SVG path generator + CLI.
   Mirrors the geometry in wm-shape.js so you can generate a path headlessly and
   rasterize it to eyeball the shape before shipping.

   As a module:
     const { chamferPath } = require('./chamfer-path');
     chamferPath(w, h, { corner:'br', r:28, cornerSize:96, cornerRadius:20 });
     // r may be a number (all corners) or {tl,tr,br,bl} for mixed/square corners.

   As a CLI:
     node chamfer-path.js --w 520 --h 360 --corner br \
          --rounded 32 --corner-size 136 --corner-rounded 24 [--out panel.svg]
     # prints the path d; with --out, writes an SVG you can rasterize:
     #   convert -density 144 -background none panel.svg panel.png
   ========================================================================== */
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
    t = Math.min(t, lenP / 2, lenN / 2);           // never overlap an edge
    var effR = t * Math.tan(half);
    var entry = { x: V.x + d1.x * t, y: V.y + d1.y * t };
    var exit = { x: V.x + d2.x * t, y: V.y + d2.y * t };
    var cross = (V.x - P.x) * (N.y - V.y) - (V.y - P.y) * (N.x - V.x);
    var sweep = cross < 0 ? 0 : 1;                  // convex turn, CW (y-down)
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

module.exports = { chamferPath };

/* ---- CLI ---- */
if (require.main === module) {
  var a = process.argv.slice(2), o = {};
  for (var i = 0; i < a.length; i++) {
    if (a[i].slice(0, 2) === '--') o[a[i].slice(2)] = (a[i + 1] && a[i + 1].slice(0, 2) !== '--') ? a[++i] : true;
  }
  var w = +o.w || 520, h = +o.h || 360;
  var d = chamferPath(w, h, {
    corner: o.corner || 'br',
    r: o.rounded != null ? +o.rounded : 28,
    cornerSize: o['corner-size'] != null ? +o['corner-size'] : 96,
    cornerRadius: o['corner-rounded'] != null ? +o['corner-rounded'] : 20
  });
  if (o.out) {
    var pad = 12, fill = o.fill || '#E84142', stroke = o.stroke || '#FF8A8B', sw = o['stroke-width'] || 1.5;
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + (w + pad * 2) + '" height="' + (h + pad * 2) +
      '" viewBox="' + (-pad) + ' ' + (-pad) + ' ' + (w + pad * 2) + ' ' + (h + pad * 2) + '">' +
      '<rect x="' + (-pad) + '" y="' + (-pad) + '" width="' + (w + pad * 2) + '" height="' + (h + pad * 2) + '" fill="#0c0c10"/>' +
      '<path d="' + d + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"/></svg>';
    require('fs').writeFileSync(o.out, svg);
    process.stderr.write('wrote ' + o.out + ' — rasterize: convert -density 144 -background none ' + o.out + ' ' + o.out.replace(/\.svg$/, '.png') + '\n');
  }
  process.stdout.write(d + '\n');
}
