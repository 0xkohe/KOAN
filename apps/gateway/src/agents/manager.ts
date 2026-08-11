import type { AgentId, AgentState } from "../../../../packages/protocol/src/index.ts";
import { AcpAdapter } from "./acp.ts";
import { ClaudeAdapter } from "./claude.ts";
import { CodexAdapter } from "./codex.ts";
import type { AgentAdapter } from "./types.ts";

const labels: Record<AgentId, string> = {
  codex: "Codex",
  claude: "Claude",
  kiro: "Kiro",
  cline: "Cline",
  opencode: "OpenCode",
};

export class AgentManager {
  readonly adapters: Record<AgentId, AgentAdapter> = {
    codex: new CodexAdapter(),
    claude: new ClaudeAdapter(),
    kiro: new AcpAdapter("kiro", "kiro-cli", ["acp"]),
    cline: new AcpAdapter("cline", "cline", ["--acp", "--auto-approve", "false"]),
    opencode: new AcpAdapter("opencode", "opencode", ["acp"]),
  };
  #states: AgentState[] = [];

  async probe(): Promise<AgentState[]> {
    this.#states = await Promise.all(
      Object.values(this.adapters).map(async (adapter) => {
        if (adapter.id === "claude") {
          return {
            id: adapter.id,
            label: labels[adapter.id],
            available: true,
            version: "Agent SDK",
            reason: null,
            capabilities: adapter.capabilities,
          };
        }
        const candidates = adapter.id === "opencode" ? ["opencode", "opencode-cli"] : [adapter.command];
        for (const command of candidates) {
          try {
            const version = await probeCommandVersion(command);
            if (!version) continue;
            adapter.command = command;
            return {
              id: adapter.id,
              label: labels[adapter.id],
              available: true,
              version,
              reason: null,
              capabilities: adapter.capabilities,
            };
          } catch { /* try the next executable alias */ }
        }
        return {
          id: adapter.id,
          label: labels[adapter.id],
          available: false,
          version: null,
          reason: `${candidates.join(" or ")} is not installed or not allowed`,
          capabilities: adapter.capabilities,
        };
      }),
    );
    return this.#states;
  }

  states() {
    return this.#states;
  }
  adapter(id: AgentId) {
    return this.adapters[id];
  }
  available(id: AgentId) {
    return this.#states.find((state) => state.id === id)?.available ?? false;
  }
}

export async function probeCommandVersion(
  command: string,
  timeoutMs = 3_000,
): Promise<string | null> {
  const child = new Deno.Command(command, {
    args: ["--version"],
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const output = child.output();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    output,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch { /* already exited */ }
        resolve(null);
      }, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  if (!result) {
    await output.catch(() => undefined);
    return null;
  }
  if (!result.success) return null;
  return new TextDecoder().decode(result.stdout.length ? result.stdout : result.stderr)
    .trim().split("\n").at(-1) || "installed";
}
