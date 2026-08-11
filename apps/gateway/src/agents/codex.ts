import type { QuestionPrompt } from "../../../../packages/protocol/src/index.ts";
import { JsonLineRpc, type JsonObject } from "./json-lines.ts";
import type { AgentAdapter, RunContext } from "./types.ts";

export class CodexAdapter implements AgentAdapter {
  id = "codex" as const;
  command = "codex";
  capabilities = { approvals: true, attachments: true, resume: true, models: true };

  async run(context: RunContext): Promise<void> {
    const rpc = new JsonLineRpc(this.command, ["app-server"], context.cwd);
    let threadId = context.agentSessionId;
    let turnId: string | null = null;
    const done = Promise.withResolvers<void>();
    void done.promise.catch(() => {});
    const abort = () => {
      if (threadId && turnId) rpc.call("turn/interrupt", { threadId, turnId }).catch(() => {});
      else rpc.stop();
      done.reject(new DOMException("Cancelled", "AbortError"));
    };
    context.signal.addEventListener("abort", abort, { once: true });
    rpc.onStderr = (line) => context.emit("system.notice", { level: "debug", message: line });
    rpc.onNotification = (message) => {
      const method = String(message.method ?? "");
      const lowerMethod = method.toLowerCase();
      const params = message.params ?? {};
      if (lowerMethod.includes("agentmessage") && lowerMethod.endsWith("delta")) {
        context.emit("message.assistant.delta", { text: params.delta ?? "" });
      } else if (
        (lowerMethod.includes("reasoning") || lowerMethod.includes("plan")) &&
        lowerMethod.endsWith("delta")
      ) {
        context.emit("agent.thought.delta", { text: params.delta ?? "" });
      } else if (method === "item/started" && isTool(params.item)) {
        context.emit("tool.started", normalizeItem(params.item));
      } else if (method === "item/completed" && isTool(params.item)) {
        context.emit("tool.completed", normalizeItem(params.item));
      } else if (method === "turn/diff/updated") context.emit("diff.updated", { diff: params.diff ?? "" });
      else if (method === "turn/completed") {
        const error = codexTurnCompletionError(params.turn);
        if (error) done.reject(error);
        else done.resolve();
      } else if (method === "turn/failed" || (method === "error" && !isRetryableCodexError(params))) {
        done.reject(new Error(params.error?.message ?? params.message ?? "Codex turn failed"));
      }
    };
    rpc.onRequest = async (message: JsonObject) => {
      const params = message.params ?? {};
      if (message.method === "item/tool/requestUserInput") {
        const questions: QuestionPrompt[] = (params.questions ?? []).map(normalizeCodexQuestion);
        if (!questions.length) return { answers: {} };
        const answer = await context.ask({
          requestKey: String(message.id),
          questions,
        });
        if (answer.cancelled) return { answers: {} };
        return {
          answers: Object.fromEntries(
            questions.map((question) => [question.id, { answers: answer.answers[question.id] ?? [] }]),
          ),
        };
      }
      if (message.method === "mcpServer/elicitation/request") return codexMcpElicitationDecline();
      if (!String(message.method).toLowerCase().includes("approval")) return {};
      const permissionsRequest = message.method === "item/permissions/requestApproval";
      const decision = await context.approve({
        requestKey: String(message.id),
        title: permissionsRequest ? "Grant permissions" : params.command ? "Run command" : "Apply changes",
        description: codexPermissionDescription(params),
        command: Array.isArray(params.command) ? params.command.join(" ") : params.command,
        options: permissionsRequest
          ? [
            { id: "accept", label: "Allow once", kind: "allow" },
            { id: "acceptForSession", label: "Allow for session", kind: "allow" },
            { id: "decline", label: "Deny", kind: "deny" },
          ]
          : codexApprovalOptions(params),
      });
      if (permissionsRequest) {
        const accepted = decision.optionId !== "decline";
        return {
          permissions: accepted
            ? {
              ...(params.permissions?.network ? { network: params.permissions.network } : {}),
              ...(params.permissions?.fileSystem ? { fileSystem: params.permissions.fileSystem } : {}),
            }
            : {},
          scope: decision.scope === "session" ? "session" : "turn",
        };
      }
      return { decision: decision.optionId };
    };
    try {
      await rpc.call("initialize", {
        clientInfo: { name: "koan", title: "KOAN", version: "0.1.0" },
        capabilities: { experimentalApi: true },
      });
      await rpc.notify("initialized");
      if (threadId) {
        try {
          await rpc.call("thread/resume", { threadId });
        } catch {
          threadId = null;
        }
      }
      if (!threadId) {
        const thread = await rpc.call("thread/start", {
          cwd: context.cwd,
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
          model: context.model ?? undefined,
        });
        threadId = String(thread.thread?.id ?? thread.threadId);
        context.saveAgentSessionId(threadId);
      }
      let prompt = context.prompt;
      if (context.attachments.some((file) => !file.mediaType.startsWith("image/"))) {
        prompt += `\n\nAttached local files:\n${
          context.attachments.filter((file) => !file.mediaType.startsWith("image/"))
            .map((file) => `- ${file.name}: ${file.path}`).join("\n")
        }`;
      }
      const input = [
        { type: "text", text: prompt, text_elements: [] },
        ...context.attachments.filter((file) => file.mediaType.startsWith("image/"))
          .map((file) => ({ type: "localImage", path: file.path })),
      ];
      const turn = await rpc.call("turn/start", { threadId, input, model: context.model ?? undefined });
      turnId = String(turn.turn?.id ?? turn.turnId);
      await Promise.race([
        done.promise,
        rpc.status.then((status) => {
          throw new Error(
            `Codex app-server exited before turn completion (code ${status.code}${
              status.signal ? `, signal ${status.signal}` : ""
            })`,
          );
        }),
      ]);
    } finally {
      context.signal.removeEventListener("abort", abort);
      await rpc.stop();
    }
  }
}

export function isRetryableCodexError(params: JsonObject): boolean {
  return params.willRetry === true;
}

export function codexMcpElicitationDecline() {
  return { action: "decline", content: null, _meta: null } as const;
}

export function codexTurnCompletionError(turn: JsonObject | undefined): Error | null {
  if (turn?.status === "completed") return null;
  if (turn?.status === "failed") return new Error(turn.error?.message ?? "Codex turn failed");
  if (turn?.status === "interrupted") return new Error("Codex turn interrupted");
  return new Error(`Codex turn ended with unexpected status: ${String(turn?.status ?? "unknown")}`);
}

export function codexPermissionDescription(params: JsonObject): string {
  const details = [params.reason ?? params.description].filter(Boolean).map(String);
  for (
    const [field, label] of [
      ["permissions", "Requested permissions"],
      ["additionalPermissions", "Additional permissions"],
      ["networkApprovalContext", "Network approval context"],
      ["proposedExecpolicyAmendment", "Proposed execution policy amendment"],
      ["proposedNetworkPolicyAmendments", "Proposed network policy amendments"],
    ] as const
  ) {
    if (params[field] !== undefined && params[field] !== null) {
      details.push(`${label}:\n${JSON.stringify(params[field], null, 2)}`);
    }
  }
  if (params.grantRoot !== undefined) details.push(`Grant root: ${String(params.grantRoot)}`);
  if (params.commandActions !== undefined) {
    details.push(`Command actions:\n${JSON.stringify(params.commandActions, null, 2)}`);
  }
  return details.join("\n\n") || "Codex requested additional permissions.";
}

export function codexApprovalOptions(params: JsonObject) {
  const defaults = ["accept", "acceptForSession", "decline"];
  const decisions = Array.isArray(params.availableDecisions)
    ? params.availableDecisions.filter((value: unknown): value is string => typeof value === "string")
    : defaults;
  const labels: Record<string, string> = {
    accept: "Allow once",
    acceptForSession: "Allow for session",
    decline: "Deny",
    cancel: "Deny and stop",
  };
  const options = decisions.filter((decision) => decision in labels).map((decision) => ({
    id: decision,
    label: labels[decision],
    kind: decision === "decline" || decision === "cancel" ? "deny" as const : "allow" as const,
  }));
  if (!options.length) throw new Error("Codex did not advertise a supported approval decision");
  return options;
}

export function normalizeCodexQuestion(
  question: JsonObject,
  questionIndex: number,
): QuestionPrompt {
  return {
    id: String(question.id ?? `question-${questionIndex}`),
    header: String(question.header ?? "Agent question"),
    prompt: String(question.question ?? "Choose an answer"),
    options: (question.options ?? []).map((option: JsonObject, optionIndex: number) => ({
      id: `option-${optionIndex}`,
      label: String(option.label),
      description: option.description ? String(option.description) : undefined,
    })),
    multiSelect: Boolean(question.multiSelect),
    allowFreeText: Boolean(question.isOther),
    secret: Boolean(question.isSecret),
  };
}

function normalizeItem(item: JsonObject = {}) {
  return {
    id: item.id,
    title: item.type ?? "Agent activity",
    kind: item.type,
    status: item.status,
    command: item.command,
    output: item.aggregatedOutput ?? item.output,
    changes: item.changes,
  };
}

function isTool(item: JsonObject = {}) {
  return [
    "commandExecution",
    "fileChange",
    "mcpToolCall",
    "dynamicToolCall",
    "collabAgentToolCall",
    "webSearch",
    "imageView",
    "imageGeneration",
  ].includes(item.type);
}
