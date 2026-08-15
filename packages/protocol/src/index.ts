import { z } from "zod";

export const agentIds = [
  "codex",
  "claude",
  "kiro",
  "cline",
  "opencode",
] as const;
export const agentIdSchema = z.enum(agentIds);
export type AgentId = z.infer<typeof agentIdSchema>;

export const agentStateSchema = z.object({
  id: agentIdSchema,
  label: z.string(),
  available: z.boolean(),
  version: z.string().nullable(),
  reason: z.string().nullable(),
  capabilities: z.object({
    approvals: z.boolean(),
    attachments: z.boolean(),
    resume: z.boolean(),
    models: z.boolean(),
  }),
});
export type AgentState = z.infer<typeof agentStateSchema>;

export const agentModelOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
});
export type AgentModelOption = z.infer<typeof agentModelOptionSchema>;

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export const sessionStatusSchema = z.enum([
  "idle",
  "queued",
  "running",
  "waiting_approval",
  "waiting_input",
  "interrupted",
  "failed",
]);
export const sessionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string().optional(),
  agentId: agentIdSchema,
  title: z.string(),
  status: sessionStatusSchema,
  model: z.string().nullable(),
  mode: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastSeq: z.number().int().nonnegative(),
  unread: z.number().int().nonnegative().default(0),
});
export type Session = z.infer<typeof sessionSchema>;

export const attachmentSchema = z.object({
  id: z.string(),
  sessionId: z.string().nullable(),
  name: z.string(),
  mediaType: z.string(),
  size: z.number(),
  createdAt: z.string(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const approvalSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  turnId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  command: z.string().nullable(),
  status: z.enum(["pending", "approved", "denied", "cancelled", "interrupted"]),
  options: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      kind: z.enum(["allow", "deny"]),
    }),
  ),
  createdAt: z.string(),
});
export type Approval = z.infer<typeof approvalSchema>;

export const questionPromptSchema = z.object({
  id: z.string(),
  header: z.string(),
  prompt: z.string(),
  options: z.array(z.object({
    id: z.string(),
    label: z.string(),
    description: z.string().optional(),
  })),
  multiSelect: z.boolean(),
  allowFreeText: z.boolean(),
  secret: z.boolean(),
});
export type QuestionPrompt = z.infer<typeof questionPromptSchema>;

export const questionRequestSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  turnId: z.string(),
  status: z.enum(["pending", "answered", "cancelled", "interrupted"]),
  questions: z.array(questionPromptSchema).min(1),
  createdAt: z.string(),
});
export type QuestionRequest = z.infer<typeof questionRequestSchema>;

export const questionAnswerSchema = z.object({
  answers: z.record(z.string(), z.array(z.string().min(1)).min(1)),
  cancelled: z.boolean().optional().default(false),
});
export type QuestionAnswer = z.infer<typeof questionAnswerSchema>;

export const gatewayEventTypes = [
  "session.status",
  "turn.queued",
  "turn.started",
  "turn.completed",
  "turn.failed",
  "turn.cancelled",
  "message.user",
  "message.assistant.delta",
  "message.assistant.completed",
  "agent.thought.delta",
  "tool.started",
  "tool.updated",
  "tool.completed",
  "approval.requested",
  "approval.resolved",
  "diff.updated",
  "question.requested",
  "question.resolved",
  "system.notice",
] as const;
export const gatewayEventSchema = z.object({
  sessionId: z.string(),
  seq: z.number().int().positive(),
  type: z.enum(gatewayEventTypes),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type GatewayEvent = z.infer<typeof gatewayEventSchema>;

export const createSessionInputSchema = z.object({
  projectId: z.string().min(1),
  agentId: agentIdSchema,
  model: z.string().trim().min(1).nullable().optional(),
  mode: z.string().trim().min(1).nullable().optional(),
  autoApprove: z.boolean().optional().default(false),
});
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;

export const startTurnInputSchema = z.object({
  text: z.string().trim().min(1).max(100_000),
  attachmentIds: z.array(z.string()).max(5).default([]),
});
export type StartTurnInput = z.infer<typeof startTurnInputSchema>;

export const approvalDecisionSchema = z.object({
  optionId: z.string(),
  scope: z.enum(["once", "session"]),
});
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export type ApiError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
};

export type WsClientMessage =
  | { type: "subscribe"; cursors: Record<string, number> }
  | { type: "ping" };

export type WsServerMessage =
  | { type: "ready"; serverTime: string }
  | { type: "event"; event: GatewayEvent }
  | { type: "session.created"; session: Session }
  | { type: "resync_required"; sessionId: string }
  | { type: "pong" };
