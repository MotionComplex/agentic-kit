# Cutout-corner geometry

How the rounded chamfer is constructed, so you can extend or debug it. The implementation
is in `scripts/wm-shape.js` and `scripts/chamfer-path.js`.

## Why not clip-path:polygon

A chamfer via `clip-path: polygon(...)` gives **sharp** tips and **no edge to stroke**. The
brand look needs the two cut vertices rounded *and* a hairline that follows the diagonal.
Both require describing the outline as an **SVG path** built from line + arc segments. CSS
`clip-path: path('…')` can consume that same `d` when you only need to clip (no stroke).

## The shape as a rounded polygon

A rectangle has 4 corners. Cutting one corner replaces it with a short diagonal, i.e. **two**
new vertices — so a single chamfer is a **5-vertex polygon**. For `corner = br` on a box
`w × h` with chamfer leg `cs`, the vertices clockwise are:

```
(0,0) → (w,0) → (w, h-cs) → (w-cs, h) → (0,h)
 tl       tr      chamfer-top   chamfer-bottom   bl
```

The other corners map analogously for `tl`/`tr`/`bl`. Clamp `cs` to `min(cs, w, h)`.

## Filleting each vertex with a circular arc

Each vertex `V` (with previous `P`, next `N`) is rounded by a circular arc of radius `rad`
(`corner-rounded` for the two chamfer tips, otherwise the corner's `rounded` value):

1. Unit edge directions: `d1 = (P−V)/|P−V|`, `d2 = (N−V)/|N−V|`.
2. Half the interior angle: `half = acos(d1·d2) / 2`.
3. Tangent length from the vertex: `t = rad / tan(half)`.
   For a 90° corner `half = 45°`, so `t = rad` (a normal rounded corner). For the 135°
   chamfer vertices `t ≈ 0.41·rad`.
4. **Cap** so two fillets never overlap a shared edge: `t = min(t, |P−V|/2, |N−V|/2)`, then
   recompute the *effective* radius `effR = t · tan(half)`. This is what makes tiny boxes
   with oversized chamfers degrade gracefully instead of glitching.
5. Tangent points: `entry = V + d1·t` (toward prev), `exit = V + d2·t` (toward next).

The path then walks the polygon: start at the last vertex's `exit`, and for each vertex
`L entry  A effR effR 0 0 <sweep> exit`, then `Z`.

## Arc sweep direction (the #1 bug)

For a **clockwise** polygon in SVG's **y-down** coordinates, convex corners use **sweep = 1**.
Compute the turn sign with the cross product of the incoming and outgoing edges:

```
cross = (V.x−P.x)(N.y−V.y) − (V.y−P.y)(N.x−V.x)
sweep = cross < 0 ? 0 : 1
```

If the corners render **concave** (biting inward), the sweep flag is inverted — flip it.
This is the single most common failure; verify by rendering, not by reading the path.

## Per-corner radii

`rounded` may be one value (all normal corners) or four (`tl tr br bl`, CSS order). The
upgrader in `wm-shape.js` reads the host's computed `border-*-radius` per corner, so a host
like `border-radius: 14px 14px 0 0` keeps its square bottom edge and a pill keeps round ends
(the cap in step 4 reduces an oversized radius to half the box).

## Stroke

Draw the `d` with `stroke` + `stroke-width` and `vector-effect: non-scaling-stroke`; give the
SVG `overflow: visible` so the outer half of the hairline isn't clipped. The stroke follows
the whole outline, diagonal included — the thing `clip-path:polygon` cannot do.

## Reference parameter ranges (avax.network, measured)

| use | rounded | corner-size | corner-rounded |
|-----|---------|-------------|----------------|
| panel / hero shell | 16–32px | 72–136px | 12–24px |
| button (rounded-rect, not a pill) | 10–16px | 18–36px | 4–6px |

Rule of thumb: `corner-rounded ≈ 0.2 × corner-size`.
