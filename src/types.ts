/** Status words of the improve skill's plans/README.md status table. */
export const TASK_STATUSES = ["TODO", "IN PROGRESS", "DONE", "BLOCKED", "REJECTED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** One plan file plans/NNN-slug.md, merged with its row in plans/README.md. */
export interface Task {
  id: string;              // "001" — three digits, from the file name
  slug: string;            // "scaffold-extension"
  file: string;            // absolute path of the plan file
  title: string;           // from "# Plan 001: <title>", else the index row, else the slug
  priority: string | null; // "P1" | "P2" | "P3" as written, null when absent
  effort: string | null;   // "S" | "M" | "L"
  risk: string | null;     // "LOW" | "MED" | "HIGH"
  dependsOn: string[];     // ids, e.g. ["001", "002"]; [] for none
  status: TaskStatus;
  statusNote: string | null; // text after the status word, e.g. the BLOCKED reason
}

/** Everything read from one group's plans folder. */
export interface PlanSet {
  root: string;              // the group folder (repository root)
  dir: string | null;        // absolute plans folder, null when none was found
  indexFile: string | null;  // absolute plans/README.md, null when absent
  tasks: Task[];             // sorted by id
  problems: string[];        // human-readable parse warnings
}

export const HARNESSES = ["claude", "codex", "opencode"] as const;
export type Harness = (typeof HARNESSES)[number];

/** States of the Krad agents bus (krad agents list / watch). */
export type AgentState = "idle" | "working" | "waiting-for-input" | "done" | "exited" | "closed";

/** How a task is being executed. */
export type RunMode = "here" | "worktree";

/** One agent run of one task, tracked by the extension. */
export interface RunRecord {
  taskId: string;
  root: string;              // group root the task belongs to
  terminal: number;          // bus terminal id: the chat from krad spawn, or app.openTerminal's id
  harness: Harness;
  mode: RunMode;
  cwd: string;               // where the agent works (root, or the worktree path)
  worktree: string | null;   // absolute worktree path when mode === "worktree"
  branch: string | null;
  state: AgentState | "starting" | "unknown";
  startedAt: string;         // ISO time
  endedAt: string | null;
}

/** Outcome of a finished run, decided from the plan status after the agent stops. */
export type RunVerdict = "done" | "blocked" | "needs-review";
