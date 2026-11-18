# Tasklist

A Krad ADE extension that turns the implementation plans written by the
`improve` skill (`plans/README.md` + `plans/NNN-*.md`) into a task list tab.

- **See** every plan of the group as a task with its status, priority, effort and dependencies.
- **Read and edit** a plan (Markdown) and its status in `plans/README.md`.
- **Run** a task with a coding agent (Claude Code, Codex or opencode): one at a time, several in
  parallel (each in its own git worktree), or in an **auto-run** session that works through the
  ready tasks in dependency order.

The extension activates in groups that contain `plans/README.md`. Open it with **Tasklist: Open**
(`Ctrl+Alt+Shift+T`, `Cmd+Alt+Shift+T` on macOS), the titlebar button, or the group's context menu.

## Install

1. In Krad ADE open **Settings → Extensions → Add folder** and pick this folder.
2. Trust the extension: it declares the `terminals` permission, which it uses to open the agent
   terminals that run tasks.

`dist/main.js` is committed, so nothing needs to be installed to run it.

## Settings

| Key | Title | Type | Default | Meaning |
|-----|-------|------|---------|---------|
| `harness` | Agent | choice (`claude`, `codex`, `opencode`) | `claude` | The coding agent that runs a task. |
| `execution-style` | How an agent runs a plan | choice (`direct`, `improve`) | `direct` | Direct: the agent follows the plan itself. Improve: the agent runs `/improve execute <plan>`, which dispatches an executor and reviews its diff. |
| `extra-args` | Extra agent arguments | text | (empty) | Added before the prompt, split on spaces, e.g. `--model sonnet`. |
| `max-parallel` | Parallel agents in an auto-run | number (1–8) | `1` | 1 runs tasks one after another in the group folder; more runs each task in its own git worktree. |
| `stop-on-failure` | Stop the auto-run when a task is blocked or needs review | toggle | on | |
| `krad-path` | Krad CLI | text | `krad` | The krad CLI used to follow agent states, by name on PATH or as a full path. |

## Agent tools

- `tasklist_list` — list the tasks of the group with their status, dependencies and plan file.
- `tasklist_set_status` — set the status of one task in `plans/README.md`.

## Develop

```sh
npm install
npm test        # typecheck, bundle to dist/main.js, run the tests
```

Commit the rebuilt `dist/` with every change to `src/` — Krad runs `dist/main.js` directly.

## License

MIT — see [LICENSE-MIT](LICENSE-MIT).
