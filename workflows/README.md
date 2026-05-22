# workflows

Reusable GitHub Actions workflows that can be installed into any of my repos. Unlike
`skills/` (symlinked into `~/.claude/skills/`), workflows must physically live in the target
repo's `.github/` directory — so each one ships with a small `install.sh` that copies it in.

## Available workflows

| Workflow | Purpose | Install |
|---|---|---|
| [`claude-review-loop/`](claude-review-loop/) | Automated PR review + fix loop using the Claude GitHub App, billed against your Pro/Max subscription. | `claude-review-loop/install.sh /path/to/repo` |

## Adding a new workflow

Each workflow lives in its own subdirectory with this layout:

```
<workflow-name>/
├── README.md            # what it does, requirements, customization
├── install.sh           # idempotent installer: `install.sh /path/to/target/repo`
├── source/              # exact files that get copied into the target repo
│   └── .github/...      # mirrors the target's filesystem layout
└── docs/
    └── decisions.md     # design rationale
```

Conventions:

- `install.sh` must be idempotent and ask before overwriting.
- All files under `source/` mirror their final path in the target repo.
- Documentation snippets that need to be appended to a target's `AGENTS.md` / `CLAUDE.md`
  use HTML-comment markers (e.g. `<!-- workflow-name:begin -->`) for idempotent append.
- Workflows are one-shot scaffolds: the target repo owns the copies. Updates are
  done by re-running `install.sh` and reviewing the diff.
