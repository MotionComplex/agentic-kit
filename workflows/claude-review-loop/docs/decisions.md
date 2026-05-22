# Design decisions and rationale

Captured from the design discussion that produced this workflow. Pull this open before changing
defaults — many of them are deliberate compromises.

## Goal

Automate PR reviews on personal/MotionComplex projects using the Claude subscription that's
already paid for. Baseline before this workflow: no PR reviews at all. So the bar is "anything
beats nothing", not "match a paid PR reviewer".

## Why not Bugbot, Greptile, or CodeRabbit

All three are objectively better (independent reviewer ≠ the model that wrote the code), but
each costs extra:

- **Cursor Bugbot**: ~$1.00–$1.50 per PR, usage-based on top of Cursor plan.
- **Greptile**: separate product, separate billing; gives a numeric confidence score.
- **CodeRabbit**: similar tier.

The Claude GitHub Action via `CLAUDE_CODE_OAUTH_TOKEN` bills against the existing Pro/Max
subscription. For low-volume personal projects this is effectively free. We accept worse
review quality in exchange for zero incremental cost.

**Trigger to revisit**: if a Critical bug ships despite a passing loop, the self-grading bias
is biting and we should add an independent reviewer.

## Why not greploop

The `greploop` skill (also installed in this kit) is hard-wired to Greptile — it polls for the
Greptile bot's `X/5` score on the PR. Without Greptile installed, greploop has no exit
condition and the loop never terminates. The skill is reusable as a *pattern*, not as a drop-in
for a Claude-only setup.

This workflow re-implements the loop pattern but uses Claude as the reviewer, with the rubric
file replacing Greptile's proprietary judgement.

## Why "Confidence ≥ 4/5 AND Critical == 0 AND Unresolved == 0" instead of strict 5/5

Self-grading at 5/5 is unrealistic — Claude rarely gives itself perfect marks even on clean
PRs, and the loop would iterate pointlessly. 4/5 is achievable when the work is genuinely
good but not trivial to hit, so it functions as a quality gate.

The `Critical == 0` clause is the actual safety lever. The Confidence number is soft;
"zero critical issues remaining" is hard.

## Why max 3 iterations

Each iteration is one review run plus one fix run. Three rounds:

- gives the loop enough chances to fix what it spots
- caps subscription quota burn per PR
- if 3 rounds don't converge, the PR likely has a design problem a human should look at

Bump to 4–5 if you find PRs commonly stop at iter 3 with one or two remaining issues.

## Why same model (Opus 4.7) for reviewer and fixer

Earlier draft had Opus reviewing and Sonnet fixing for cost savings. Reconsidered because:

1. The actual cost difference on a Pro/Max subscription is small (no per-token bill).
2. Consistency simplifies debugging when the loop misbehaves.
3. The dominant bias is *same model family*, not *same model size* — splitting Opus/Sonnet
   doesn't meaningfully break the bias loop.

If true independence becomes important, the right move is a different model family
(Gemini, GPT) as reviewer — not a smaller Claude.

## Why two workflows instead of one big one

- `claude-code-review.yml` triggers on `pull_request: synchronize` so every push (including
  the loop's own fix push) auto-re-reviews. Nothing else has to drive that.
- `claude-loop.yml` triggers on `pull_request_review: submitted` so it only fires after a
  review has been posted — never as a side-effect of an unrelated push.

Keeping them split means each workflow has one trigger and one job, easier to reason about.
A single workflow with conditional jobs would conflate "review just happened" with
"someone pushed code".

## Why a "summary block" instead of just counting review comments

Two reasons:

1. **Severity matters more than count.** 1 Critical issue should block merge; 5 Suggestions
   should not. A pure comment-count loop conflates the two.
2. **Resolution state isn't reliably queryable from a single API.** The summary block lets the
   reviewer self-report `Unresolved` based on its own re-evaluation of existing threads,
   without us having to chase GraphQL pagination on every iteration.

The downside is the reviewer has to follow instructions to emit the block. The `skip` decision
path in `claude-loop.yml` handles the case where it doesn't.

## Why opt-out via label instead of opt-in

User's stated goal was automation. Opt-in defeats that — they'd have to remember to label every
PR. Opt-out with a documented label is genuinely automatic, and the local agent that opens
trivial PRs is instructed (via `AGENTS.md`) to apply the label.

## Why copy-install instead of submodule or callable workflow

Three options were considered:

| Mechanism | Pro | Con |
|---|---|---|
| Copy via `install.sh` (chosen) | Repo owns its files, easy to diff/customize, no extra git state | Manual sync on updates |
| Git submodule | Auto-sync via `git submodule update` | Submodule UX overhead in every consumer |
| Callable workflow (`uses: org/repo/.github/workflows/foo.yml@main`) | True live-sync | Requires the kit to be a public/accessible repo and adds an external dep at run time |

Copy install matches this kit's existing pattern (one-shot scaffolds) and keeps the target
repo self-contained. Update story is "re-run installer with --force when you want to pull
upstream changes".

## Explicitly out of scope

- **Dependency vulnerability scanning** — Dependabot + `npm audit` already do this better.
  See "tech-guardian" follow-up note in `source/AGENTS-snippet.md`.
- **Cross-PR memory / learning** — every PR is reviewed independently.
- **Human approval gating** — branch protection rules on the target repo handle this; the
  loop only produces signal, it doesn't bypass anything.
