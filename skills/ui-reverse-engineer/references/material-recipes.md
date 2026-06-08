# Phase 5 — Material Recipes

## The principle: effects need their preconditions

A material effect is not a property of one element — it is a relationship between an element and its surroundings. The most common reconstruction failure is applying an effect's *surface* properties while ignoring the *precondition* that makes it visible. Glass is the canonical case: `backdrop-filter` blurs whatever is painted behind the element. If nothing textured is behind it, there is nothing to refract, and the "glass" collapses into a flat rounded rectangle.

So: before applying any effect, ensure its precondition exists in the build. For glass, that means there must be a photo, gradient, or texture layer directly behind the glass element — including in isolated component specimens, which must carry their own backdrop.

## Glassmorphism / frosted glass

Separate the invariant from the style. Don't apply a remembered "glass recipe" — measure which variant the source actually uses.

### The invariant (all glass)

Precondition: a **non-uniform** layer behind the element (photo, gradient, or other content). Blurring a flat color produces no visible change, so glass over a solid fill reads as nothing. Then only two things are mechanically required:

```css
.glass{
  background: rgba(255,255,255,0.55);   /* translucent, NOT opaque */
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
}
```

That is the entire requirement. Everything below is optional and style-dependent.

### Variant A — flat frosted

A plain translucent blurred panel: no border, no highlight, no shadow, often no `saturate()`. This is common in minimal/system UIs (iOS-style sheets, notification pills). If the source edge is soft and undecorated, build this — adding edge-lighting would be *wrong*, not "better."

### Variant B — glossy / refractive (edge-lit)

Simulates a lit bevelled edge. Add, only if the source shows them:

```css
  background: rgba(255,255,255,0.55);
  backdrop-filter: blur(24px) saturate(180%);   /* saturate boosts vibrancy behind */
  border: 1px solid rgba(255,255,255,0.7);       /* light hairline edge */
  box-shadow:
    0 20px 50px -22px rgba(40,44,66,.2),         /* far soft tinted shadow */
    inset 0 1px 0 rgba(255,255,255,.9);          /* inner top highlight */
```

For dark "smoked" refractive glass, drop the fill toward `rgba(38,38,42,.5)`, the border to `rgba(255,255,255,.10)`, the inner highlight to `rgba(255,255,255,.12)`.

### How to tell which

Look at the source edge: a bright hairline rim and a top sheen mean refractive (Variant B); a clean soft edge with no rim means flat frosted (Variant A). Build what you see.

Provide a solid-fill fallback under `@media (prefers-reduced-transparency: reduce)` for either variant.

## Gradient-under-glass (iridescent / aurora)

The color reads as ambient *light*, not paint. Put the gradient on a background layer, then place the frosted glass over it. Never paint the gradient onto the glass surface itself. A subtle pastel radial gradient rising from one corner, viewed through frost, is the effect.

## Photo bleed + scrim

For edge-to-edge photography with text over it: place the photo full-bleed, then a vertical gradient scrim (`linear-gradient(180deg, transparent 30%, rgba(bg,0.85) 100%)`) before any text. Text sits on the scrim, not the raw photo, so contrast holds.

## Neumorphism (if the source uses it)

Precondition: the element and its background are the *same* color. The effect is two shadows — one light (top-left), one dark (bottom-right) — of the same hue:

```css
box-shadow: -6px -6px 12px rgba(255,255,255,.7), 6px 6px 12px rgba(0,0,0,.15);
```

If the element color differs from the background, it is not neumorphism.

## Flat / crisp-technical (e.g. instrument UIs)

The opposite discipline: no soft shadows, no blur, no gradient-as-decoration, low/zero corner radius. Depth comes from hairlines and contrast, not elevation. Applying soft shadows here breaks the look as surely as missing glass breaks a glass UI.

## Tinted shadows

Whatever the effect, shadows are tinted toward the background hue and are soft and far-cast for "premium," tight and dark for "material/elevated." Pure-black drop shadows on a light page are an instant tell.
