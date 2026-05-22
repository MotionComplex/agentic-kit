# PR Review Rubric

Used by `.github/workflows/claude-code-review.yml`. The reviewer must apply this rubric
deterministically and emit a machine-readable summary block.

## Severity definitions

| Severity | Meaning | Examples |
|---|---|---|
| **Critical** | Blocks merge. Correctness, security, data-loss, or runtime regressions. | Null deref on a hot path, missing auth check, SQL injection, breaks existing tests, leaks secrets, broken build. |
| **Suggestion** | Should fix, but does not block merge. | Naming, minor duplication, missing edge-case test, slightly unclear comment, stylistic deviation, opportunity for refactor. |
| **Informational** | FYI only. **Do not count** in Critical or Suggestions. | Praise, questions, future-work pointers. |

## Categories to evaluate

For every PR, evaluate each of these and post inline comments where issues exist:

1. **Correctness** — Does the code do what the PR claims? Are edge cases handled?
2. **Security** — Authn/authz, input validation, secrets, injection, dependency risks.
3. **Tests** — New behavior covered? Regression tests for fixed bugs? Tests actually exercise the change?
4. **Reliability** — Error handling, retries, idempotency, race conditions, resource leaks.
5. **API/Schema compatibility** — Breaking changes to public APIs, DB schemas, message formats.
6. **Performance** — Obvious O(n²) when n is large, N+1 queries, unnecessary blocking I/O.
7. **Style & maintainability** — Naming, structure, comments, dead code, files getting too long.

Each inline comment must start with a tag of the form `[Category/Severity]`, e.g.
`[Security/Critical] User input flows into raw SQL on line 47.`

## Confidence scale (1–5)

Confidence is your overall belief that this PR is safe to merge **as-is**. Apply strictly.

| Score | Meaning |
|---|---|
| **5/5** | Production-ready. Zero Critical, no concerning Suggestions, tests cover the change, no unresolved threads. |
| **4/5** | Mergeable. Zero Critical, at most a few minor Suggestions, all threads resolved or trivially addressable. |
| **3/5** | Needs work. Either ≥1 Critical, several Suggestions affecting maintainability, or thin test coverage. |
| **2/5** | Significant rework needed. Multiple Critical issues or fundamental design concerns. |
| **1/5** | Do not merge. Broken, unsafe, or misses the goal entirely. |

The loop's pass threshold is **Confidence ≥ 4/5 AND Critical == 0 AND Unresolved == 0**. Optimize
for an honest score, not a high one. Inflating the score breaks the loop's exit condition and
ships bugs.

## Counting "Unresolved"

After posting your review:

- For a **fresh review** (first one on the PR): `Unresolved = Critical + Suggestions`. Every
  comment you just posted is an unresolved thread.
- For a **re-review** (after the loop pushed fixes): inspect existing review threads. Count
  threads that you would *not* mark resolved yet — i.e. the issue is still present or not
  adequately addressed. New issues you find this round add to the count.

Informational comments do **not** count toward Unresolved.

## Required summary block

The review body MUST end with this exact block (the loop parses it with a regex):

```
<!-- claude-review:summary -->
Confidence: N/5
Critical: N
Suggestions: N
Unresolved: N
<!-- /claude-review:summary -->
```

No other markup may follow the closing marker. If you omit this block, the loop will skip
and a human will have to drive review manually.
