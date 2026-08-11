import assert from "node:assert/strict";

const agents = [
  { name: "Codex", commands: ["codex"] },
  { name: "Kiro", commands: ["kiro-cli"] },
  { name: "Cline", commands: ["cline"] },
  { name: "OpenCode", commands: ["opencode", "opencode-cli"] },
];

Deno.test({
  name: "installed agent CLIs report a version",
  ignore: Deno.env.get("KOAN_AGENT_SMOKE") !== "1",
  async fn() {
    let installed = 0;
    for (const agent of agents) {
      for (const command of agent.commands) {
        try {
          const output = await new Deno.Command(command, {
            args: ["--version"],
            stdout: "piped",
            stderr: "piped",
          }).output();
          if (!output.success) continue;
          installed++;
          console.log(`${agent.name}: ${new TextDecoder().decode(output.stdout).trim() || "installed"}`);
          break;
        } catch (error) {
          if (!(error instanceof Deno.errors.NotFound)) throw error;
        }
      }
    }
    assert.ok(installed > 0, "No supported agent CLI is installed");
  },
});
