# Tasklist

A Krad ADE extension that turns the implementation plans written by the
`improve` skill (`plans/README.md` + `plans/NNN-*.md`) into a task list tab.

- **See** every plan of the group as a task with its status, priority, effort and dependencies.
- **Read and edit** a plan (Markdown) and its status in `plans/README.md`.
- **Run** a task with a coding agent (Claude Code, Codex or opencode): one at a time, several in
  parallel (each in its own git worktree), or in an **auto-run** session that works through the
  ready tasks in dependency order.

The extension activates in groups that contain `plans/README.md`. Open it with **Tasklist: Open**
(`Ctrl+Alt+Shift+T`, `Cmd+Alt+Shift+T` on macOS), the **Tasks** sidebar view, the titlebar button, or the group's context menu.

## Install

1. In Krad ADE open **Settings → Extensions → Add folder** and pick this folder.
2. Trust the extension: it declares the `terminals` permission, which it uses to open the agent
   terminals that run tasks.

`dist/main.js` is committed, so nothing needs to be installed to run it.

## Use

- **The Tasks page**: **Tasks** in the left nav shows the full Tasklist for the group whose
  folder has `plans/` (with several groups, the group button next to the title switches group). It
  selects tasks on its own; **Open in a tab** opens the same group's tab.
- **Open the tab**: **Open in a tab** on the Tasks page, the **Tasklist** titlebar button, the
  **Tasklist: Open** command, the group's context menu (or the context menu of
  `plans/README.md`), or `Ctrl+Alt+Shift+T`. One tab per group; the page and the tab show the same
  data and refresh together.
- **Write plans with `/improve`**: **Write plans with /improve** (the magic button) opens the chosen agent with `/improve <what you
  typed>` (empty = full audit; or `plan <what to build>`, `quick`, `security`, `next` ...).
  **Reconcile** runs `/improve reconcile` to check the plans against the code. Both need the
  improve skill installed for that agent: <https://github.com/shadcn/improve>. **New task** writes
  an empty plan by hand and adds a TODO row.
- **Read and edit**: click a task in the list to read its plan (the **Tasks** filter narrows the
  list to To do, Running, Done or Blocked; the task's pane has Run, Run in worktree, Compare agents
  and the editors). The plan shows one section at a time, picked above the text: **All** (the whole
  plan), then Overview and each `##` heading. It opens on the first section; for a long plan read
  whole, **Open in Krad's viewer** opens the file in Krad (its Markdown preview). **Edit in editor**
  opens the file in Krad's editor; **Edit with a prompt** (the magic button) asks what should change and opens the chosen
  agent on that plan file only, to rewrite it without carrying it out. **Change status** writes
  `plans/README.md` (BLOCKED and REJECTED ask for a one-line reason). The views refresh when a plan
  file is saved, and for an hour after an agent was asked to edit a plan, whenever `plans/` changes.
- **Narrow windows**: the header and the action rows wrap onto more lines. The layout button in the
  header stacks the panes (tasks on top, the plan under them) or puts them side by side again.
- **Run one**: **Run** (or **Run next**) opens an agent terminal in the group folder with a prompt
  that points at the plan, and sets the row to IN PROGRESS. The agent sets the row to DONE or
  BLOCKED when it finishes; if it stops without doing so the task needs review and stays
  IN PROGRESS.
- **Run in a worktree**: the same in `<group>.worktrees/<id>-<slug>` on branch
  `tasklist/<id>-<slug>`; the outcome is mirrored into the group's index. Merging the branch is up to
  you (Krad's Changes view). Uncommitted plan edits are not in the worktree.
- **Compare agents**: pick 2–4 agents; they run the task with `krad variants run` and you compare
  them in Krad's Variants view.
- **Auto-run**: works through every ready task (TODO with its dependencies DONE) in id order,
  `max-parallel` at a time (more than 1 uses a worktree per task and needs git). With
  `stop-on-failure` on, it stops when a task ends blocked or needing review. **Stop** ends the
  session; agents already running keep working.
- **Agent states** come from `krad agents watch --json`; set **Krad CLI** if `krad` is not on PATH.

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

Every agent in Krad gets two tools to read and update the task list:

- `tasklist_list` — list the tasks of the group, one per line:
  `<id> <status> <title> after: <deps> <plan path>` (tab-separated), after a first line `plans: <dir>`.
- `tasklist_set_status` — set the status of one task in `plans/README.md` (`id`, `status`, optional
  one-line `note`).

## Develop

```sh
npm install
npm test        # typecheck, bundle to dist/main.js, run the tests
```

Commit the rebuilt `dist/` with every change to `src/` — Krad runs `dist/main.js` directly.

## License

MIT — see [LICENSE-MIT](LICENSE-MIT).
