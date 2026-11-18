import type { SettingsValues } from "@krad-ade/extension";
import { createExtension, ui } from "@krad-ade/extension";
import type { PlanSet } from "./types.js";

// Placeholder program: plans 002–005 replace this with the real task list.
let settings: SettingsValues = {};
let current: PlanSet | null = null;

createExtension({
  async onInitialize(context) {
    settings = await context.app.getSettings();
  },

  onSettingsChanged(values) {
    settings = values;
  },

  commands: {
    "tasklist.open": async (target, context) => {
      let root: string | undefined;
      if (target?.kind === "group") {
        root = target.root;
      } else {
        const workspace = await context.app.workspaceContext();
        root = workspace.groups[0]?.root;
      }
      if (!root) {
        context.app.toast("Open a group first.");
        return;
      }
      await context.app.openView({ view: "tasklist", instance: root, title: "Tasklist" });
    },
  },

  views: {
    tasklist: {
      render() {
        void settings;
        void current;
        return ui.column("root", [ui.text("placeholder", "Tasklist is being built.")]);
      },
    },
  },
});
