# motion-trace

Review web **animation as data** (not video): easing, timing, overshoot, jank, and
`prefers-reduced-motion` accessibility — for an agent during browsing or E2E testing.

Installed from the agentic-kit marketplace:

```
/plugin marketplace add <agentic-kit repo>
/plugin install motion-trace@agentic-kit
```

On first launch the server installs its own dependencies; the browser self-provisions
on first capture. Nothing manual. To use a remote/hosted browser instead of a local
Chromium, set `MOTION_TRACE_CDP=ws://…` on the server.

Tools: `motion_discover`, `motion_review`, `motion_capture`, `motion_diff`, `motion_prompt`.
The bundled `motion-review` skill teaches the discover → review workflow.
