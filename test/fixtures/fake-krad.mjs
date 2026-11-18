// A stand-in for the krad CLI, run as `node fake-krad.mjs <args>`.
const args = process.argv.slice(2).join(" ");

const agent = {
  environment: "main",
  terminal: 7,
  title: "Claude Code · 7",
  group: "g",
  state: "working",
  harness: "Claude Code",
  is_self: false,
};

if (args === "--version") {
  console.log("0.0.0");
} else if (args === "list --json") {
  console.log(JSON.stringify({ Agents: [agent] }));
} else if (args === "agents watch --json") {
  console.log(
    JSON.stringify({
      AgentSnapshot: { stream: "fake", seq: 1, at: new Date().toISOString(), resync: false, agents: [agent] },
    }),
  );
  setTimeout(() => {
    console.log(
      JSON.stringify({
        AgentEvent: {
          seq: 2,
          kind: "state_changed",
          environment: "main",
          terminal: 7,
          title: agent.title,
          group: agent.group,
          harness: agent.harness,
          previous: "working",
          state: "done",
          coarse_state: "idle",
          reason: "turn_finished",
        },
      }),
    );
    process.exit(0);
  }, 50);
} else {
  console.error(`fake-krad: unknown arguments: ${args}`);
  process.exit(1);
}
