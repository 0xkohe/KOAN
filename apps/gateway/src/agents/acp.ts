import { JsonLineRpc, type JsonObject } from "./json-lines.ts";
import type { AgentModelOption } from "../../../../packages/protocol/src/index.ts";
import { type AgentAdapter, type RunContext, withTimeout } from "./types.ts";

export class AcpAdapter implements AgentAdapter {
  capabilities = { approvals: true, attachments: true, resume: true, models: true };

  constructor(
    public id: "kiro" | "cline" | "opencode",
    public command: string,
    private args: string[],
  ) {}

  async models(cwd: string): Promise<AgentModelOption[]> {
    const rpc = new JsonLineRpc(this.command, this.args, cwd, { jsonRpcVersion: "2.0" });
    try {
      return await withTimeout(
        (async () => {
          await rpc.call("initialize", {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
            clientInfo: { name: "KOAN", title: "KOAN Agent Gateway", version: "0.1.0" },
          });
          const setup = await rpc.call("session/new", { cwd, mcpServers: [] });
          return advertisedModels(setup);
        })(),
        10_000,
        `${this.id} model discovery timed out`,
      );
    } finally {
      await rpc.stop();
    }
  }

  async run(context: RunContext): Promise<void> {
    const rpc = new JsonLineRpc(this.command, this.args, context.cwd, { jsonRpcVersion: "2.0" });
    let sessionId = context.agentSessionId;
    const abort = () => {
      const cancel = sessionId ? rpc.notify("session/cancel", { sessionId }) : Promise.resolve();
      void cancel.catch(() => {}).then(() => rpc.stop()).catch(() => {});
    };
    context.signal.addEventListener("abort", abort, { once: true });
    rpc.onStderr = (line) => context.emit("system.notice", { level: "debug", message: line });
    rpc.onNotification = (message) => this.update(message, context);
    rpc.onRequest = (message) => this.request(message, context);
    try {
      await rpc.call("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "KOAN", title: "KOAN Agent Gateway", version: "0.1.0" },
      });
      let setup: JsonObject | null = null;
      if (sessionId) {
        try {
          setup = await rpc.call("session/load", { sessionId, cwd: context.cwd, mcpServers: [] });
        } catch {
          sessionId = null;
        }
      }
      if (!sessionId) {
        setup = await rpc.call("session/new", { cwd: context.cwd, mcpServers: [] });
        sessionId = String(setup?.sessionId);
        context.saveAgentSessionId(sessionId);
      }
      setup = await this.applyConfig(rpc, sessionId, setup, "model", context.model);
      await this.applyConfig(rpc, sessionId, setup, "mode", context.mode);
      const files = context.attachments.filter((file) => !file.mediaType.startsWith("image/"));
      const images = context.attachments.filter((file) => file.mediaType.startsWith("image/"));
      const attachmentNote = files.length
        ? `\n\nAttached local files:\n${files.map((file) => `- ${file.name}: ${file.path}`).join("\n")}`
        : "";
      const imageNote = images.length
        ? `\n\nAttached images:\n${images.map((file) => `- ${file.name}`).join("\n")}`
        : "";
      const result = await rpc.call("session/prompt", {
        sessionId,
        prompt: [
          { type: "text", text: context.prompt + attachmentNote + imageNote },
          ...await Promise.all(images.map(async (file) => ({
            type: "image",
            data: (await Deno.readFile(file.path)).toBase64(),
            mimeType: file.mediaType,
          }))),
        ],
      });
      if (result?.stopReason === "cancelled") throw new DOMException("Cancelled", "AbortError");
    } finally {
      context.signal.removeEventListener("abort", abort);
      await rpc.stop();
    }
  }

  private async applyConfig(
    rpc: JsonLineRpc,
    sessionId: string,
    setup: JsonObject | null,
    category: "model" | "mode",
    requested: string | null,
  ): Promise<JsonObject | null> {
    if (!requested) return setup;
    const advertised = category === "model" ? setup?.models : setup?.modes;
    const advertisedOptions = category === "model" ? advertised?.availableModels : advertised?.availableModes;
    if (Array.isArray(advertisedOptions)) {
      const valueKey = category === "model" ? "modelId" : "id";
      if (!advertisedOptions.some((option: JsonObject) => option[valueKey] === requested)) {
        throw new Error(`${requested} is not an advertised ${this.id} ${category}`);
      }
      const currentValue = category === "model" ? advertised?.currentModelId : advertised?.currentModeId;
      if (currentValue !== requested) {
        await rpc.call(`session/set_${category}`, {
          sessionId,
          [category === "model" ? "modelId" : "modeId"]: requested,
        });
      }
      return setup;
    }
    const options = Array.isArray(setup?.configOptions) ? setup.configOptions as JsonObject[] : [];
    const config = options.find((option) => option.id === category) ??
      options.find((option) => option.category === category);
    if (!config) {
      throw new Error(`${this.id} did not advertise an ACP ${category} configuration option`);
    }
    const values = Array.isArray(config.options) ? config.options as JsonObject[] : [];
    if (!values.some((option) => option.value === requested)) {
      throw new Error(`${requested} is not an advertised ${this.id} ${category}`);
    }
    if (config.currentValue === requested) return setup;
    return await rpc.call("session/set_config_option", {
      sessionId,
      configId: String(config.id),
      value: requested,
    });
  }

  private update(message: JsonObject, context: RunContext) {
    if (message.method !== "session/update") return;
    const update = message.params?.update ?? {};
    const kind = update.sessionUpdate ?? update.type;
    if (kind === "agent_message_chunk") {
      context.emit("message.assistant.delta", { text: contentText(update.content) });
    } else if (kind === "agent_thought_chunk") {
      context.emit("agent.thought.delta", { text: contentText(update.content) });
    } else if (kind === "tool_call") {
      context.emit("tool.started", {
        id: update.toolCallId,
        title: update.title ?? update.name ?? "Tool",
        kind: update.kind,
        rawInput: update.rawInput,
      });
    } else if (kind === "tool_call_update") {
      const status = update.status;
      context.emit(status === "completed" || status === "failed" ? "tool.completed" : "tool.updated", update);
    } else if (kind === "plan") {
      context.emit("system.notice", { level: "plan", entries: update.entries });
    } else if (kind) {
      context.emit("system.notice", { level: "debug", message: `ACP update: ${kind}` });
    }
  }

  private async request(message: JsonObject, context: RunContext) {
    if (message.method !== "session/request_permission") return { outcome: { outcome: "cancelled" } };
    const options = (message.params?.options ?? []).map((option: JsonObject) => ({
      id: String(option.optionId),
      label: String(option.name ?? option.kind ?? "Allow"),
      kind: String(option.kind).includes("reject") ? "deny" as const : "allow" as const,
    }));
    const decision = await context.approve({
      requestKey: String(message.id),
      title: message.params?.toolCall?.title ?? "Agent permission",
      description: message.params?.toolCall?.description,
      command: message.params?.toolCall?.rawInput?.command,
      options: options.length ? options : [
        { id: "allow_once", label: "Allow once", kind: "allow" },
        { id: "deny", label: "Deny", kind: "deny" },
      ],
    });
    return { outcome: { outcome: "selected", optionId: decision.optionId } };
  }
}

export function advertisedModels(setup: JsonObject | null): AgentModelOption[] {
  const advertised = setup?.models;
  if (Array.isArray(advertised?.availableModels)) {
    return advertised.availableModels.flatMap((model: JsonObject) => {
      const id = String(model.modelId ?? "").trim();
      if (!id) return [];
      const description = String(model.description ?? "").trim();
      return [{
        id,
        label: String(model.name ?? model.displayName ?? id),
        ...(description ? { description } : {}),
        ...(advertised.currentModelId === id ? { isDefault: true } : {}),
      }];
    });
  }
  const options = Array.isArray(setup?.configOptions) ? setup.configOptions as JsonObject[] : [];
  const config = options.find((option) => option.id === "model") ??
    options.find((option) => option.category === "model" && option.id !== "provider");
  const values = Array.isArray(config?.options) ? config.options as JsonObject[] : [];
  return values.flatMap((model) => {
    const id = String(model.value ?? "").trim();
    if (!id) return [];
    const description = String(model.description ?? "").trim();
    return [{
      id,
      label: String(model.name ?? model.label ?? id),
      ...(description ? { description } : {}),
      ...(config?.currentValue === id ? { isDefault: true } : {}),
    }];
  });
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && "text" in content) {
    return String((content as { text: unknown }).text);
  }
  return "";
}
