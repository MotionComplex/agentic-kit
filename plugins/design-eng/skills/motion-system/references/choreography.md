# Choreography — multi-element motion recipes

Single transitions cover one element changing state. Choreography is how *several* elements move together: lists arriving in sequence, a card morphing into a detail view, a sheet presenting with its scrim. Each recipe below uses the motion tokens (`motion-tokens.md`) and ships with its reduced-motion variant — which is not optional.

Two rules run through all of them:
- **Animate `transform` and `opacity` only.** They're compositor-friendly and don't trigger layout. For anything that changes layout (size/position), use FLIP, not animated `width`/`top`.
- **`prefers-reduced-motion: reduce` gets a real fallback** — instant or opacity-only, no travel, no parallax, no overshoot.

## Stagger (lists / grids)

Items arrive in sequence so the eye reads order, but the *total* time stays short.

```css
.stagger-item {
  opacity: 0;
  transform: translateY(var(--motion-rise, 16px));
  animation: enter var(--motion-base) var(--ease-decelerate) forwards;
  animation-delay: calc(var(--i) * 40ms);      /* --i set per item; cap the set */
}
@keyframes enter { to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  .stagger-item { transform: none; animation: fade var(--motion-fast) forwards; animation-delay: 0ms; }
  @keyframes fade { to { opacity: 1; } }
}
```

Shrink the per-item step as the count grows so the last item never lags (keep total ≤ ~400ms). Reduced motion drops the translate and the stagger — everything just fades in.

## Shared-element / FLIP (layout changes)

For an element that persists across a state change (a card expanding into a panel, a thumbnail becoming a hero), never animate layout properties. Use **FLIP**: measure **F**irst and **L**ast rects, apply the **I**nverted transform, then **P**lay to identity.

```js
function flip(el, mutate) {
  const first = el.getBoundingClientRect();
  mutate();                                   // DOM change that moves/resizes el
  const last = el.getBoundingClientRect();
  const dx = first.left - last.left, dy = first.top - last.top;
  const sx = first.width / last.width, sy = first.height / last.height;
  el.animate(
    [{ transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` }, { transform: 'none' }],
    { duration: 320, easing: 'cubic-bezier(.2,0,0,1)' }   // motion.expand
  );
}
if (matchMedia('(prefers-reduced-motion: reduce)').matches) { mutate(); /* no animation */ }
```

FLIP animates only `transform`, so a resize that would thrash layout becomes a smooth composited move.

## Present / dismiss (modal, sheet, popover)

The surface and its scrim are choreographed together; enter and exit are asymmetric. Respect the size-class substitution from `ui-reverse-engineer` — a bottom sheet slides up from the edge, a centered dialog scales up slightly from ~0.96.

```css
.scrim { opacity: 0; transition: opacity var(--motion-base) var(--ease-standard); }
.scrim[data-open] { opacity: 1; }

.dialog {                                     /* centered dialog */
  opacity: 0; transform: scale(.96);
  transition: opacity var(--motion-base) var(--ease-decelerate),
              transform var(--motion-base) var(--ease-decelerate);
}
.dialog[data-open] { opacity: 1; transform: none; }
.dialog[data-closing] {                       /* exit: faster, accelerate */
  transition-duration: var(--motion-fast);
  transition-timing-function: var(--ease-accelerate);
}

@media (prefers-reduced-motion: reduce) {
  .dialog, .scrim { transition: opacity var(--motion-fast) linear; transform: none; }
  .dialog { transform: none; }
}
```

Bottom sheet: swap the `transform` for `translateY(100%)` → `none` (a percentage translate moves the sheet by *its own height*, so it works at any size — the Sonner/Vaul technique). Reduced motion: opacity only, no slide/scale.

Two craft refinements (see `craft-tips.md`): a **popover** must scale from its **trigger**, not center — set `transform-origin` to the trigger (e.g. `var(--radix-popover-content-transform-origin)`); a **modal stays centered**. And never enter from `scale(0)` — start from `scale(0.95)`+opacity so it doesn't pop out of nowhere.

The modern no-JS way to animate entry is **`@starting-style`** (define the entered state, then the starting state inside it), which replaces the `useEffect(setMounted)` / `data-mounted` pattern where browser support allows:

```css
.toast {
  opacity: 1; transform: translateY(0);
  transition: opacity var(--motion-base) var(--ease-out), transform var(--motion-base) var(--ease-out);
  @starting-style { opacity: 0; transform: translateY(100%); }
}
```

## Persistent chrome over an overlay (the morphing header / logo / close)

Present/dismiss above covers the *entering surface*. But a full-screen menu, drawer, or modal usually leaves **chrome in place on top of it** — a logo, a close/▢ button, a header — that must stay visible and *morph* (re-color, swap ☰→✕, change elevation) rather than be replaced by a second copy inside the panel. This is a **shared element**, and getting it wrong is what makes a menu feel like "two different screens flashing" instead of one continuous transform.

Three rules make it read as one element:

1. **Elevate with `z-index`, never by changing `position`.** The chrome only needs to sit *above* the panel — it does not need to move. Switching it `relative`→`fixed` to "lift" it changes a non-tweenable layout property, so it **teleports** to the fixed coordinate the instant the menu opens (and back on close). Keep its position untouched; raise it with `z-index` while open. If it genuinely must relocate, FLIP it (animate the delta on `transform`), never the layout box.
2. **Morph in place with `transform` / `opacity` / `color`.** A hamburger becomes an ✕ by rotating its bars (`transform`), not by swapping icons. A logo goes white-on-photo → ink-on-panel by transitioning `color`, not by hiding one logo and showing another. One element, tweenable properties, same duration — so it's continuous.
3. **Separate the two jobs across open *and* close** (see the teardown section below): elevation must persist through the whole exit (so the chrome isn't covered by the still-fading panel), but the morph-back must start the instant close begins (so it reverses *with* the panel, not after).

```css
/* hamburger ☰ ↔ ✕ — one icon, strokes morph (driven by aria-expanded) */
.ham-bar { transition: transform var(--motion-base) var(--ease-accelerate),    /* EXIT */
                       opacity   var(--motion-fast) var(--ease-accelerate); }
[aria-expanded="true"] .ham-bar { transition: transform var(--motion-base) var(--ease-decelerate),
                                              opacity var(--motion-base) var(--ease-decelerate); } /* ENTER */
[aria-expanded="true"] .ham-bar:nth-child(1){ transform: translateY(6px) rotate(45deg); }
[aria-expanded="true"] .ham-bar:nth-child(2){ opacity: 0; }
[aria-expanded="true"] .ham-bar:nth-child(3){ transform: translateY(-6px) rotate(-45deg); }

/* persistent logo: re-colors IN PLACE; elevation is a separate, lingering flag */
.logo { transition: color var(--motion-base) var(--ease-accelerate); }              /* EXIT */
.menu-active .topnav { z-index: 70; }            /* elevation: lives through the whole exit */
.menu-open   .logo   { color: var(--ink); transition: color var(--motion-slow) var(--ease-decelerate); } /* ENTER + morph state */
```

```js
function open(){ body.classList.add('menu-active','menu-open'); burger.setAttribute('aria-expanded','true'); /* …panel data-open… */ }
function shut(){ panel.removeAttribute('data-open');           // panel fades
                 body.classList.remove('menu-open');           // morph-back starts NOW, in sync
                 burger.setAttribute('aria-expanded','false');
                 setTimeout(()=>body.classList.remove('menu-active'), EXIT_MS); } // drop elevation AFTER fade
```

Reduced motion: the ✕ shape still forms but with `transition: none` (a state change without movement is fine); the logo color still changes; no travel.

## Exit = one coordinated teardown (not a pile of reversions)

Enter gets all the attention; the **exit is where coordination breaks.** When a panel, its scrim, and its chrome leave together, they must reverse on a **single timeline from a single trigger**. The classic flash bug is mixing mechanisms: the panel reverses on a class toggle (immediate) while the chrome reverses on a `setTimeout`/unmount (delayed) — so the panel vanishes first and the chrome snaps back over the bare background a beat later.

- **One trigger, one frame.** Remove the "open" state from everything at the same instant; let each element's own transition carry it back.
- **Asymmetric by construction.** Put the *enter* transition on the opened state and the *exit* transition on the base state, so leaving is automatically faster + accelerate without extra JS.
- **Unmount last.** If you must `display:none`/unmount the surface, do it *after* the exit duration — and keep any shared chrome elevated until then, or it gets covered mid-fade.
- **Verify the reverse**, don't assume it: `motion_diff` an enter trace against an exit trace and confirm every element that animated in also animates out (none left behind), and that the exit is the shorter of the two.

## Scroll-reveal (editorial / marketing)

Reveal on entry with `IntersectionObserver`, not a scroll handler (cheaper, no jank). Reveal **once**; don't re-hide on scroll-up.

```js
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.dataset.shown = ''; io.unobserve(e.target); }
}, { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));
```
```css
.reveal { opacity: 0; transform: translateY(var(--motion-rise)); transition: opacity var(--motion-slow) var(--ease-decelerate), transform var(--motion-slow) var(--ease-decelerate); }
.reveal[data-shown] { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) { .reveal { transform: none; transition: opacity var(--motion-fast); } }
```

Parallax belongs to this family and is the most motion-sensitive of all — gate it entirely behind the reduced-motion check, never just soften it.

## Choreography hierarchy

When several patterns fire at once (a route change that staggers content while a sheet dismisses), order them: **primary content leads, chrome/secondary follows.** Define the enter order explicitly — simultaneous everything reads as chaos, and a clear lead element gives the sequence a focal point.
