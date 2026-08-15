import {
  type PermissionUpdate,
  query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentModelOption } from "../../../../packages/protocol/src/index.ts";
import { type AgentAdapter, type RunContext, withTimeout } from "./types.ts";

const automaticReadTools = new Set(["Read", "Glob", "Grep", "WebFetch", "WebSearch", "TodoRead"]);

export class ClaudeAdapter implements AgentAdapter {
  id = "claude" as const;
  command = "claude";
  capabilities = { approvals: true, attachments: true, resume: true, models: true };

  constructor(private queryFactory: typeof query = query) {}

  async models(cwd: string): Promise<AgentModelOption[]> {
    const stream = this.queryFactory({
      prompt: idlePrompt(),
      options: {
        cwd,
        permissionMode: "default",
        settingSources: ["user", "project", "local"],
      },
    });
    try {
      const models = await withTimeout(
        stream.supportedModels(),
        10_000,
        "Claude model discovery timed out",
      );
      return models.map((model) => ({
        id: model.value,
        label: model.displayName,
        ...(model.description ? { description: model.description } : {}),
      }));
    } finally {
      stream.close();
    }
  }

  async run(context: RunContext): Promise<void> {
    const attachmentNote = context.attachments.length
      ? `\n\nAttached local files:\n${
        context.attachments.map((file) => `- ${file.name}: ${file.path}`).join("\n")
      }`
      : "";
    let resume = context.agentSessionId ?? undefined;
    let savedSessionId = context.agentSessionId;
    const saveSessionId = (id: string) => {
      if (id === savedSessionId) return;
      savedSessionId = id;
      context.saveAgentSessionId(id);
    };
    while (true) {
      const stream = this.createQuery(context, context.prompt + attachmentNote, resume);
      const abort = () => void stream.interrupt();
      let progressed = false;
      context.signal.addEventListener("abort", abort, { once: true });
      try {
        for await (const message of stream) {
          progressed ||= isClaudeTurnProgress(message);
          this.consume(message, context, saveSessionId);
        }
        return;
      } catch (error) {
        if (!resume || progressed || context.signal.aborted) throw error;
        resume = undefined;
      } finally {
        context.signal.removeEventListener("abort", abort);
        stream.close();
      }
    }
  }

  private createQuery(context: RunContext, prompt: string, resume?: string) {
    return this.queryFactory({
      prompt,
      options: {
        cwd: context.cwd,
        model: context.model ?? undefined,
        resume,
        permissionMode: "default",
        includePartialMessages: true,
        settingSources: ["user", "project", "local"],
        canUseTool: async (toolName, input, options) => {
          if (shouldAutoAllowClaudeTool(toolName, options.matchedAskRule)) {
            return { behavior: "allow", updatedInput: input };
          }
          if (toolName === "AskUserQuestion") return await this.answerQuestion(input, context);
          const command = toolName === "Bash" ? String(input.command ?? "") : undefined;
          const approvalOptions = claudeApprovalOptions(Boolean(options.suggestions?.length));
          const decision = await context.approve({
            requestKey: options.toolUseID,
            title: options.title ?? options.displayName ?? `Use ${toolName}`,
            description: options.decisionReason ?? `Claude wants to use ${toolName}.`,
            command: command || undefined,
            options: approvalOptions,
          });
          if (decision.optionId === "deny") {
            return { behavior: "deny", message: "Denied from KOAN mobile approval." };
          }
          return {
            behavior: "allow",
            updatedInput: input,
            ...(decision.scope === "session" && options.suggestions?.length
              ? { updatedPermissions: claudeSessionPermissions(options.suggestions) }
              : {}),
          };
        },
      },
    });
  }

  private consume(message: SDKMessage, context: RunContext, saveSessionId: (id: string) => void) {
    if ("session_id" in message && message.session_id) {
      saveSessionId(message.session_id);
    }
    if (message.type === "stream_event") {
      const event = message.event;
      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          context.emit("message.assistant.delta", { text: event.delta.text });
        }
        if (event.delta.type === "thinking_delta") {
          context.emit("agent.thought.delta", { text: event.delta.thinking });
        }
      } else if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        context.emit("tool.started", {
          id: event.content_block.id,
          title: event.content_block.name,
          rawInput: event.content_block.input,
        });
      }
    } else if (message.type === "tool_progress") {
      context.emit("tool.updated", {
        id: message.tool_use_id,
        title: message.tool_name,
        elapsedSeconds: message.elapsed_time_seconds,
      });
    } else if (message.type === "user" && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type !== "tool_result") continue;
        context.emit("tool.completed", {
          id: block.tool_use_id,
          rawOutput: block.content,
          isError: block.is_error ?? false,
        });
      }
    } else if (message.type === "result" && message.subtype !== "success") {
      throw new Error(message.errors.join("\n") || `Claude ended with ${message.subtype}`);
    } else if (message.type === "system" && message.subtype === "permission_denied") {
      context.emit("system.notice", { level: "warning", message: `${message.tool_name} was denied` });
    }
  }

  private async answerQuestion(input: Record<string, unknown>, context: RunContext) {
    const questions = Array.isArray(input.questions) ? input.questions as Array<Record<string, unknown>> : [];
    if (!questions.length) return { behavior: "deny" as const, message: "Question payload was empty." };
    const normalized = questions.map((question, questionIndex) => {
      const choices = Array.isArray(question.options)
        ? question.options as Array<Record<string, unknown>>
        : [];
      return {
        id: `question-${questionIndex}`,
        header: String(question.header ?? "Claude question"),
        prompt: String(question.question ?? "Choose an answer"),
        options: choices.map((choice, optionIndex) => ({
          id: `option-${optionIndex}`,
          label: String(choice.label),
          description: choice.description ? String(choice.description) : undefined,
        })),
        multiSelect: Boolean(question.multiSelect),
        allowFreeText: true,
        secret: false,
      };
    });
    const answer = await context.ask({
      requestKey: crypto.randomUUID(),
      questions: normalized,
    });
    if (answer.cancelled) return { behavior: "deny" as const, message: "Question cancelled." };
    return {
      behavior: "allow" as const,
      updatedInput: {
        ...input,
        answers: Object.fromEntries(
          questions.map((question, index) => [
            String(question.question ?? question.header),
            (answer.answers[`question-${index}`] ?? []).join(", "),
          ]),
        ),
      },
    };
  }
}

function idlePrompt(): AsyncIterable<SDKUserMessage> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<SDKUserMessage>>(() => {}),
    }),
  };
}

export function claudeApprovalOptions(canPersist: boolean) {
  return [
    { id: "allow_once", label: "Allow once", kind: "allow" as const },
    ...(canPersist ? [{ id: "allow_session", label: "Allow for session", kind: "allow" as const }] : []),
    { id: "deny", label: "Deny", kind: "deny" as const },
  ];
}

export function shouldAutoAllowClaudeTool(toolName: string, matchedAskRule: unknown): boolean {
  return automaticReadTools.has(toolName) && !matchedAskRule;
}

export function claudeSessionPermissions(suggestions: PermissionUpdate[]): PermissionUpdate[] {
  return suggestions.map((suggestion) => ({ ...suggestion, destination: "session" }));
}

function isClaudeTurnProgress(message: SDKMessage): boolean {
  return message.type === "assistant" || message.type === "stream_event" ||
    message.type === "tool_progress" ||
    message.type === "user";
}
