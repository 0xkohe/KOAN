import type {
  AgentId,
  AgentModelOption,
  GatewayEvent,
  QuestionAnswer,
  QuestionPrompt,
} from "../../../../packages/protocol/src/index.ts";

export type ApprovalRequest = {
  requestKey: string;
  title: string;
  description?: string;
  command?: string;
  options: Array<{ id: string; label: string; kind: "allow" | "deny" }>;
};

export type QuestionInput = {
  requestKey: string;
  questions: QuestionPrompt[];
};

export type RunContext = {
  sessionId: string;
  turnId: string;
  cwd: string;
  prompt: string;
  attachments: Array<{ id: string; name: string; mediaType: string; path: string }>;
  model: string | null;
  mode: string | null;
  agentSessionId: string | null;
  signal: AbortSignal;
  emit: (type: GatewayEvent["type"], payload: Record<string, unknown>) => void;
  approve: (request: ApprovalRequest) => Promise<{ optionId: string; scope: "once" | "session" }>;
  ask: (request: QuestionInput) => Promise<QuestionAnswer>;
  saveAgentSessionId: (id: string) => void;
};

export interface AgentAdapter {
  id: AgentId;
  command: string;
  capabilities: { approvals: boolean; attachments: boolean; resume: boolean; models: boolean };
  models?(cwd: string): Promise<AgentModelOption[]>;
  run(context: RunContext): Promise<void>;
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
