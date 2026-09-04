# Decisions made on your behalf — FlowLever P2 run

Every entry is a default-and-proceed call taken while you were away. **You can override any
of them**; each notes how reversible it is.

## Decisions

- [process] Decided: integration branch `feat/flowlever-p2` off `main`, per-unit branches off
  that, final `--no-ff` merge into `main` myself. Alternatives: commit straight onto `main`
  (you said "work directly on main") / leave a PR for you. Why: you asked for everything on
  `main` and are away, so leaving an unmerged PR would block you; the integration branch keeps
  each unit independently revertable and keeps the autopilot rail against committing raw to a
  default branch. Reversible: yes (`git revert` per unit, or reset `main`). OWNER CAN OVERRIDE.

- [state] Decided: replaced the previous run's `AUTOPILOT-STATE.md` content with this run's.
  Alternatives: a second state file / an archive section. Why: the skill wants one state file
  and one truth; the prior run is closed and its full record is in git at `49dae65`.
  Reversible: yes (`git show 49dae65:plugins/flowlever/AUTOPILOT-STATE.md`). OWNER CAN OVERRIDE.

- [scope] Decided: added U4 (coherence) to the run. Alternatives: park it in the backlog. Why:
  your mandate said "plus whatever is needed to make it coherent", and the brevity rule shipped
  in `9fcfd5b` currently lives in the two FlowLever skills only, while
  `conventions/code-review.md` — which declares itself canonical and says "the pr-review skill
  enforces it" — has no length rule at all. The standalone `/pr-review` and `/pr-respond` skills
  therefore still author unbounded comments. Reversible: yes, docs only. OWNER CAN OVERRIDE.

<!-- further decisions appended per cycle -->

## OWNER ACTIONS REQUIRED

- **Nothing is pushed.** `main` will be ahead of `origin/main`. Push when you're ready:
  `git push origin main`
- **Hard-reload the cockpit** (⌘⇧R) after this run — the server sends no `ETag`/`Cache-Control`,
  so your browser may hold the older `app.js`/`style.css`.
