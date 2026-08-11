import type {
  ApprovalDecision,
  GatewayEvent,
  QuestionAnswer,
  StartTurnInput,
} from "../../../packages/protocol/src/index.ts";
import type { AgentManager } from "./agents/manager.ts";
import type { ApprovalRequest, QuestionInput } from "./agents/types.ts";
import type { Store } from "./db.ts";
import { validateProjectPath } from "./security.ts";

type Job = { sessionId: string; turnId: string; input: StartTurnInput };
type ApprovalWaiter = {
  resolve: (decision: ApprovalDecision) => void;
  reject: (reason: unknown) => void;
  sessionId: string;
};
type QuestionWaiter = {
  resolve: (answer: QuestionAnswer) => void;
  reject: (reason: unknown) => void;
  sessionId: string;
};

export class Scheduler {
  #queues = new Map<string, Job[]>();
  #runningProjects = new Set<string>();
  #controllers = new Map<string, { controller: AbortController; turnId: string }>();
  #approvals = new Map<string, ApprovalWaiter>();
  #questions = new Map<string, QuestionWaiter>();
  #drains = new Set<Promise<void>>();
  #shuttingDown = false;

  constructor(
    private store: Store,
    private agents: AgentManager,
    private publish: (event: GatewayEvent) => void,
    private allowedRoots: string[],
  ) {}

  enqueue(sessionId: string, key: string, input: StartTurnInput) {
    if (this.#shuttingDown) throw new Error("GATEWAY_SHUTTING_DOWN");
    const session = this.store.getSessionWithProject(sessionId);
    if (!session) throw new Error("SESSION_NOT_FOUND");
    let sessionTitle: string | undefined;
    if (session.title === "New session") {
      sessionTitle = input.text.replaceAll("\n", " ").slice(0, 64);
    }
    const queue = this.#queues.get(session.projectId) ?? [];
    const turn = this.store.createTurn(sessionId, key, input.text, input.attachmentIds, {
      position: queue.length + 1,
      sessionTitle,
    });
    if (turn.duplicate) return { turnId: turn.id, duplicate: true };
    queue.push({ sessionId, turnId: turn.id, input });
    this.#queues.set(session.projectId, queue);
    for (const event of turn.events) this.publish(event);
    const drain = this.drain(session.projectId);
    this.#drains.add(drain);
    void drain.finally(() => this.#drains.delete(drain)).catch((error) => console.error(error));
    return { turnId: turn.id, duplicate: false };
  }

  async shutdown() {
    if (!this.#shuttingDown) {
      this.#shuttingDown = true;
      const reason = new DOMException("Gateway shutting down", "AbortError");
      for (const waiter of this.#approvals.values()) waiter.reject(reason);
      for (const waiter of this.#questions.values()) waiter.reject(reason);
      this.#approvals.clear();
      this.#questions.clear();
      for (const { controller } of this.#controllers.values()) controller.abort();
    }
    await Promise.allSettled([...this.#drains]);
  }

  cancel(sessionId: string) {
    let cancelledQueued = false;
    for (const [projectId, queue] of this.#queues) {
      const jobs = queue.filter((job) => job.sessionId === sessionId);
      for (let index = queue.length - 1; index >= 0; index--) {
        if (queue[index].sessionId === sessionId) queue.splice(index, 1);
      }
      for (const job of jobs) {
        cancelledQueued = true;
        this.store.updateTurn(job.turnId, "cancelled");
        this.emit(sessionId, "turn.cancelled", { turnId: job.turnId });
      }
      if (!queue.length && !this.#runningProjects.has(projectId)) this.#queues.delete(projectId);
    }
    const active = this.#controllers.get(sessionId);
    if (active) {
      this.cancelPrompts(sessionId);
      active.controller.abort();
      return true;
    }
    if (cancelledQueued) {
      this.store.updateSession(sessionId, { status: "idle" });
      this.emit(sessionId, "session.status", { status: "idle" });
      return true;
    }
    return false;
  }

  resolveApproval(id: string, decision: ApprovalDecision): boolean {
    const waiter = this.#approvals.get(id);
    if (!waiter || !this.store.resolveApproval(id, decision.optionId)) return false;
    this.#approvals.delete(id);
    this.emit(waiter.sessionId, "approval.resolved", { approvalId: id, ...decision });
    waiter.resolve(decision);
    return true;
  }

  resolveQuestion(id: string, answer: QuestionAnswer): boolean {
    const waiter = this.#questions.get(id);
    if (!waiter || !this.store.resolveQuestion(id, answer)) return false;
    this.#questions.delete(id);
    this.emit(waiter.sessionId, "question.resolved", {
      questionId: id,
      status: answer.cancelled ? "cancelled" : "answered",
    });
    waiter.resolve(answer);
    return true;
  }

  private async drain(projectId: string) {
    if (this.#runningProjects.has(projectId)) return;
    this.#runningProjects.add(projectId);
    try {
      const queue = this.#queues.get(projectId);
      while (!this.#shuttingDown && queue?.length) await this.run(queue.shift()!);
      this.#queues.delete(projectId);
    } finally {
      this.#runningProjects.delete(projectId);
    }
  }

  private async run(job: Job) {
    const session = this.store.getSessionWithProject(job.sessionId);
    if (!session) return;
    const controller = new AbortController();
    this.#controllers.set(job.sessionId, { controller, turnId: job.turnId });
    this.store.updateTurn(job.turnId, "running");
    this.store.updateSession(job.sessionId, { status: "running" });
    this.emit(job.sessionId, "turn.started", { turnId: job.turnId });
    this.emit(job.sessionId, "session.status", { status: "running" });
    try {
      const project = await validateProjectPath(session.projectPath, this.allowedRoots);
      if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      await this.agents.adapter(session.agentId).run({
        sessionId: job.sessionId,
        turnId: job.turnId,
        cwd: project.path,
        prompt: job.input.text,
        attachments: job.input.attachmentIds.map((id) => this.store.getAttachment(id)).filter((
          item,
        ): item is NonNullable<typeof item> => Boolean(item)),
        model: session.model,
        mode: session.mode,
        agentSessionId: session.agentSessionId,
        signal: controller.signal,
        emit: (type, payload) => this.emit(job.sessionId, type, { ...payload, turnId: job.turnId }),
        approve: (request) => this.requestApproval(job, request),
        ask: (request) => this.requestQuestion(job, request),
        saveAgentSessionId: (id) => this.store.updateSession(job.sessionId, { agentSessionId: id }),
      });
      if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      this.store.updateTurn(job.turnId, "completed");
      this.store.updateSession(job.sessionId, { status: "idle" });
      this.emit(job.sessionId, "message.assistant.completed", { turnId: job.turnId });
      this.emit(job.sessionId, "turn.completed", { turnId: job.turnId });
      this.emit(job.sessionId, "session.status", { status: "idle" });
    } catch (error) {
      if (this.#shuttingDown) return;
      const cancelled = controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError");
      this.store.updateTurn(job.turnId, cancelled ? "cancelled" : "failed");
      this.store.updateSession(job.sessionId, { status: cancelled ? "idle" : "failed" });
      this.emit(job.sessionId, cancelled ? "turn.cancelled" : "turn.failed", {
        turnId: job.turnId,
        message: cancelled ? "Cancelled" : error instanceof Error ? error.message : String(error),
      });
      this.emit(job.sessionId, "session.status", { status: cancelled ? "idle" : "failed" });
    } finally {
      this.cancelPrompts(job.sessionId);
      if (this.#controllers.get(job.sessionId)?.turnId === job.turnId) {
        this.#controllers.delete(job.sessionId);
      }
    }
  }

  private requestApproval(job: Job, request: ApprovalRequest): Promise<ApprovalDecision> {
    if (!this.acceptsPrompt(job)) return Promise.reject(new DOMException("Cancelled", "AbortError"));
    const approval = this.store.createApproval({ sessionId: job.sessionId, turnId: job.turnId, ...request });
    this.store.updateSession(job.sessionId, { status: "waiting_approval" });
    this.emit(job.sessionId, "approval.requested", approval);
    this.emit(job.sessionId, "session.status", { status: "waiting_approval" });
    return new Promise((resolve, reject) =>
      this.#approvals.set(approval.id, {
        resolve: (decision) => {
          this.syncPromptStatus(job.sessionId);
          resolve(decision);
        },
        reject,
        sessionId: job.sessionId,
      })
    );
  }

  private requestQuestion(job: Job, request: QuestionInput): Promise<QuestionAnswer> {
    if (!this.acceptsPrompt(job)) return Promise.reject(new DOMException("Cancelled", "AbortError"));
    const question = this.store.createQuestion({ sessionId: job.sessionId, turnId: job.turnId, ...request });
    this.store.updateSession(job.sessionId, { status: "waiting_input" });
    this.emit(job.sessionId, "question.requested", question);
    this.emit(job.sessionId, "session.status", { status: "waiting_input" });
    return new Promise((resolve, reject) =>
      this.#questions.set(question.id, {
        resolve: (answer) => {
          this.syncPromptStatus(job.sessionId);
          resolve(answer);
        },
        reject,
        sessionId: job.sessionId,
      })
    );
  }

  private acceptsPrompt(job: Job): boolean {
    const active = this.#controllers.get(job.sessionId);
    return !this.#shuttingDown && active?.turnId === job.turnId && !active.controller.signal.aborted;
  }

  private syncPromptStatus(sessionId: string) {
    const hasApproval = [...this.#approvals.values()].some((waiter) => waiter.sessionId === sessionId);
    const hasQuestion = [...this.#questions.values()].some((waiter) => waiter.sessionId === sessionId);
    const status = hasApproval ? "waiting_approval" : hasQuestion ? "waiting_input" : "running";
    this.store.updateSession(sessionId, { status });
    this.emit(sessionId, "session.status", { status });
  }

  private cancelPrompts(sessionId: string) {
    const reason = new DOMException("Cancelled", "AbortError");
    for (const [approvalId, waiter] of this.#approvals) {
      if (waiter.sessionId !== sessionId) continue;
      this.#approvals.delete(approvalId);
      this.store.cancelApproval(approvalId);
      this.emit(sessionId, "approval.resolved", { approvalId, status: "cancelled" });
      waiter.reject(reason);
    }
    for (const [questionId, waiter] of this.#questions) {
      if (waiter.sessionId !== sessionId) continue;
      this.#questions.delete(questionId);
      this.store.cancelQuestion(questionId);
      this.emit(sessionId, "question.resolved", { questionId, status: "cancelled" });
      waiter.reject(reason);
    }
  }

  private emit(sessionId: string, type: GatewayEvent["type"], payload: Record<string, unknown>) {
    this.publish(this.store.appendEvent(sessionId, type, payload));
  }
}
