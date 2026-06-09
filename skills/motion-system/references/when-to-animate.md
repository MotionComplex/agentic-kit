# When to animate — and when not to

The hardest part of a motion system isn't the easing curves; it's the **triage** — deciding which moments deserve motion and which are better left instant. A system that animates everything is as broken as one that animates nothing. This reference is the decision framework: run it *before* you wire up transitions, so motion is allocated on purpose.

The governing principle, from the people who think about this professionally: **motion is behavior, not ornamentation, and behavior can only help or hinder the experience** (Issara Willenskomer). The best interface animation is close to invisible — you don't notice it because it's doing a job: reinforcing what happened, where something went, or what changed (Val Head). If you can't name the job, don't animate.

## Functional vs decorative — the first cut

Every candidate animation is one of two kinds:

- **Functional** — it guides, informs, or gives feedback in the moment. It earns its place because removing it would cost the user information or orientation. This is the default kind a UI should have.
- **Decorative** — it expresses brand or delights. It can be valuable, but only at non-disruptive moments (an empty state, an onboarding flow, a success celebration) and never on a path the user walks many times a day.

Triage rule: **functional motion is allowed by default; decorative motion must justify the moment.** When in doubt on a decorative animation, cut it — gratuitous motion reads as unprofessional and slows people down.

## The four jobs motion can do (Willenskomer)

If an animation isn't serving one of these, it probably shouldn't exist. Use them as the checklist for "what job is this doing?":

1. **Expectation** — set or confirm what an object is and how it behaves (a button that depresses, a toggle that slides). Real-time feedback to a user action.
2. **Continuity** — preserve the user's sense of flow and consistency across a change (an element that morphs into its next form rather than popping). Keeps the user from losing the thread.
3. **Narrative** — order events in time so a sequence reads as a coherent progression (staggered entrance, step-by-step reveal), rather than everything happening at once.
4. **Relationship** — express spatial/temporal/hierarchical links between objects (a detail that emerges *from* the row it belongs to; parallax that signals depth) so the user understands structure.

Map each proposed animation to one of these. If you can name the job, animate; if you're reaching, don't.

## Real-time vs non-real-time

A second axis that changes the budget:

- **Real-time** motion responds *instantly* to direct manipulation (hover, press, drag, toggle). It must be fast (≤~120ms) and is almost always worth having — it's the interface confirming it heard the user.
- **Non-real-time** motion plays *after* an action and the user has to wait for it (a screen transition, a modal opening, a list reordering). It carries the most usability value (continuity, orientation) but also the most cost — every millisecond is latency the user can't skip. Budget it carefully and keep it short.

## The animate / don't-animate checklist

**Animate when the motion:**

- gives **feedback** to a user action (press, toggle, submit, drag) — confirms the system responded;
- preserves **continuity** across a state or spatial change (expand/collapse, navigation, a card opening into a detail) — so the user doesn't lose context;
- **directs attention** to a genuine, meaningful change (a new item arriving, an error appearing, a value updating) — orientation, not decoration;
- communicates **spatial relationship / hierarchy** (where a panel came from, what contains what);
- expresses **brand** at a deliberate, low-frequency moment (onboarding, empty state, a one-time success).

**Don't animate (or make it instant) when the motion:**

- is **purely decorative** and serves none of the four jobs;
- sits on a **high-frequency, repeated action** where the added duration becomes cumulative latency (you'll pay it hundreds of times a day) — keep these near-instant;
- **blocks input** or forces the user to wait before they can act (motion should never gate the next task);
- **competes for attention** with content the user is trying to read or with another animation firing at the same time;
- is **long or large-travel** for no functional reason (showy hero motion in a utility tool);
- can't pass **reduced-motion** — if the only version you can imagine is large parallax/zoom/spin, reconsider whether it belongs at all.

## Frequency and density govern the budget

The more often an action happens and the denser the UI, the *less* motion it should carry. A data-heavy enterprise tool used all day wants terse, near-instant feedback and almost no non-real-time motion; a marketing page seen once can afford expressive, staged motion. Allocate motion inversely to frequency: rare, high-ceremony moments get the expressive treatment; the daily-driver interactions get speed.

## Accessibility is a gate, not a preference

`prefers-reduced-motion` is not a taste call — it's a hard requirement, and vestibular disorders make large motion genuinely harmful for some users. Every animation needs a reduced variant (instant or opacity-only), and the most motion-sensitive techniques (parallax, large zoom/scale, spin, big travel) must be gated behind the reduced-motion check entirely, not merely softened. If a moment only works with motion that can't degrade safely, that's a signal the motion is doing too much.

## How this feeds the rest of the system

The output of this triage is a **list of the moments that get motion, each tagged with its job** (which of the four purposes) and its kind (real-time vs non-real-time, functional vs decorative). That list is what Phase 3 (map motion to states) and Phase 4 (choreography) then build — you're not animating every state pair, only the ones triage approved, and each at a budget set by its frequency and kind.

## Sources

- Issara Willenskomer — *Creating Usability with Motion: The UX in Motion Manifesto* (the four usability purposes + 12 principles; motion as behavior). https://medium.com/ux-in-motion/creating-usability-with-motion-the-ux-in-motion-manifesto-a87a4584ddc
- Val Head — *Designing Interface Animation* (purposeful, "invisible" interface animation; functional vs expressive). https://alistapart.com/article/designing-interface-animation-interview-with-val-head/
- Nielsen Norman Group — *Executing UX Animations: Duration and Motion Characteristics* (perception thresholds, when motion helps vs hurts). https://www.nngroup.com/articles/animation-duration/
- Material Design 3 — *Easing and duration* (enter/persist vs exit/dismiss budgets, easing-by-intent). https://m3.material.io/styles/motion/easing-and-duration
- Apple Human Interface Guidelines — *Motion* (responsiveness, reduced-motion accessibility). https://developer.apple.com/design/human-interface-guidelines/motion
