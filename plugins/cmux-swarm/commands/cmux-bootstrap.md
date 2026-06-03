---
description: Ensure the cmux CLI is installed before orchestrating a swarm — detect it, and if missing, offer to install via Homebrew (or print the download link). Run this before /cmux-swarm:create-swarm.
allowed-tools: Bash, AskUserQuestion
---

# cmux bootstrap

Make sure the `cmux` CLI is available, since `/cmux-swarm:create-swarm` drives the swarm
through it. This is install-if-missing: silent when cmux is already present.

## 1. Detect

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" check-cmux
```

- Prints a path (e.g. `/Applications/cmux.app/Contents/Resources/bin/cmux`) → already
  installed. Report "cmux is installed at `<path>`" and stop.
- Prints `MISSING` → continue to step 2.

## 2. Offer to install (only if MISSING)

Ask the user whether to install cmux (AskUserQuestion: "Install cmux now?" → Yes / No). On **Yes**:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" install-cmux
```

This runs `brew install --cask cmux`. If Homebrew is not present, the script prints the
download link instead — relay it to the user and stop. On **No**, stop without installing.

## 3. Confirm

Re-run `check-cmux` and report the final state. Note that `/cmux-swarm:create-swarm` must run
**inside** a cmux session, so after a fresh install the user should relaunch Claude inside cmux.
