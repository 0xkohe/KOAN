import assert from "node:assert/strict";
import { join } from "node:path";
import type { AgentId, GatewayEvent } from "../../../packages/protocol/src/index.ts";
import type { AgentAdapter, RunContext } from "../src/agents/types.ts";
import { Store } from "../src/db.ts";
import { Scheduler } from "../src/scheduler.ts";

Deno.test("scheduler serializes turns from the same project", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-scheduler-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const first = store.createSession(project.id, "codex");
    const second = store.createSession(project.id, "codex");
    const order: string[] = [];
    const adapter: AgentAdapter = {
      id: "codex",
      command: "fake",
      capabilities: { approvals: true, attachments: true, resume: true, models: true },
      async run(context: RunContext) {
        order.push(`start:${context.prompt}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push(`end:${context.prompt}`);
      },
    };
    const manager = { adapter: (_id: AgentId) => adapter };
    const scheduler = new Scheduler(store, manager as never, () => {}, [directory]);
    scheduler.enqueue(first.id, "one", { text: "one", attachmentIds: [] });
    scheduler.enqueue(second.id, "two", { text: "two", attachmentIds: [] });
    await waitUntil(() => store.getSession(second.id)?.status === "idle");
    assert.deepEqual(order, ["start:one", "end:one", "start:two", "end:two"]);
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("scheduler revalidates a project path immediately before launch", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-scheduler-path-" });
  const root = join(directory, "root");
  const outside = join(directory, "outside");
  const projectPath = join(root, "project");
  try {
    Deno.mkdirSync(projectPath, { recursive: true });
    Deno.mkdirSync(outside);
    const store = new Store(join(directory, "data"));
    const project = store.createProject("KOAN", projectPath);
    const session = store.createSession(project.id, "codex");
    let launched = false;
    const adapter: AgentAdapter = {
      id: "codex",
      command: "fake",
      capabilities: { approvals: true, attachments: true, resume: true, models: true },
      run() {
        launched = true;
        return Promise.resolve();
      },
    };
    Deno.removeSync(projectPath);
    Deno.symlinkSync(outside, projectPath);
    const scheduler = new Scheduler(
      store,
      { adapter: () => adapter } as never,
      () => {},
      [root],
    );

    scheduler.enqueue(session.id, "turn", { text: "run", attachmentIds: [] });
    await waitUntil(() => store.getSession(session.id)?.status === "failed");
    assert.equal(launched, false);
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("cancelling during path validation does not launch the adapter", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-scheduler-cancel-path-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    let launched = false;
    const adapter: AgentAdapter = {
      id: "codex",
      command: "fake",
      capabilities: { approvals: true, attachments: true, resume: true, models: true },
      run() {
        launched = true;
        return Promise.resolve();
      },
    };
    const scheduler = new Scheduler(store, { adapter: () => adapter } as never, () => {}, [directory]);

    scheduler.enqueue(session.id, "turn", { text: "run", attachmentIds: [] });
    assert.equal(scheduler.cancel(session.id), true);
    await waitUntil(() => store.getSession(session.id)?.status === "idle");
    assert.equal(launched, false);
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("cancelling an approval wait releases the project queue", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-cancel-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const first = store.createSession(project.id, "codex");
    const second = store.createSession(project.id, "codex");
    const adapter: AgentAdapter = {
      id: "codex",
      command: "fake",
      capabilities: { approvals: true, attachments: true, resume: true, models: true },
      async run(context: RunContext) {
        if (context.prompt === "approve") {
          await context.approve({
            requestKey: "request",
            title: "Run command",
            options: [{ id: "deny", label: "Deny", kind: "deny" }],
          });
        }
      },
    };
    const manager = { adapter: (_id: AgentId) => adapter };
    const scheduler = new Scheduler(store, manager as never, () => {}, [directory]);
    scheduler.enqueue(first.id, "one", { text: "approve", attachmentIds: [] });
    scheduler.enqueue(second.id, "two", { text: "continue", attachmentIds: [] });
    await waitUntil(() => store.pendingApprovals(first.id).length === 1);
    const approvalId = store.pendingApprovals(first.id)[0].id;
    assert.equal(scheduler.cancel(first.id), true);
    await waitUntil(() => store.getSession(second.id)?.status === "idle");
    assert.equal(store.getSession(first.id)?.status, "idle");
    assert.equal(store.getApproval(approvalId)?.status, "cancelled");
    assert.equal(store.pendingApprovals(first.id).length, 0);
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("cancelling an active session also cancels all of its queued turns", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-cancel-queued-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    let runs = 0;
    const adapter: AgentAdapter = {
      id: "codex",
      command: "fake",
      capabilities: { approvals: true, attachments: true, resume: true, models: true },
      run: (context: RunContext) =>
        new Promise<void>((resolve) => {
          runs++;
          context.signal.addEventListener("abort", () => resolve(), { once: true });
        }),
    };
    const scheduler = new Scheduler(store, { adapter: () => adapter } as never, () => {}, [directory]);
    const active = scheduler.enqueue(session.id, "active", { text: "active", attachmentIds: [] });
    const queued = scheduler.enqueue(session.id, "queued", { text: "queued", attachmentIds: [] });
    await waitUntil(() => runs === 1);

    assert.equal(scheduler.cancel(session.id), true);
    await waitUntil(() => store.getSession(session.id)?.status === "idle");

    assert.equal(runs, 1);
    assert.deepEqual(
      [active.turnId, queued.turnId].map((id) =>
        (store.db.prepare("SELECT status FROM turns WHERE id=?").get(id) as { status: string }).status
      ),
      ["cancelled", "cancelled"],
    );
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("a cancelled last queued turn does not disconnect the active project queue", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-cancel-last-queued-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const first = store.createSession(project.id, "codex");
    const cancelled = store.createSession(project.id, "codex");
    const last = store.createSession(project.id, "codex");
    const runs: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const adapter: AgentAdapter = {
      id: "codex",
      command: "fake",
      capabilities: { approvals: true, attachments: true, resume: true, models: true },
      async run(context: RunContext) {
        runs.push(context.prompt);
        if (context.prompt === "first") {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
      },
    };
    const scheduler = new Scheduler(store, { adapter: () => adapter } as never, () => {}, [directory]);
    scheduler.enqueue(first.id, "first-turn", { text: "first", attachmentIds: [] });
    await waitUntil(() => releaseFirst !== undefined);
    scheduler.enqueue(cancelled.id, "cancelled-turn", { text: "cancelled", attachmentIds: [] });

    assert.equal(scheduler.cancel(cancelled.id), true);
    scheduler.enqueue(last.id, "last-turn", { text: "last", attachmentIds: [] });
    releaseFirst!();
    await waitUntil(() => store.getSession(last.id)?.status === "idle");

    assert.deepEqual(runs, ["first", "last"]);
    assert.equal(store.getSession(cancelled.id)?.status, "idle");
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("agent failure cancels outstanding approval and question prompts", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-failed-prompts-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    let approvalPromise: ReturnType<RunContext["approve"]> | undefined;
    let questionPromise: ReturnType<RunContext["ask"]> | undefined;
    const adapter: AgentAdapter = {
      id: "codex",
      command: "fake",
      capabilities: { approvals: true, attachments: true, resume: true, models: true },
      run(context: RunContext) {
        approvalPromise = context.approve({
          requestKey: "approval",
          title: "Run command",
          options: [{ id: "deny", label: "Deny", kind: "deny" }],
        });
        questionPromise = context.ask({
          requestKey: "question",
          questions: [{
            id: "choice",
            header: "Choice",
            prompt: "Choose",
            options: [],
            multiSelect: false,
            allowFreeText: true,
            secret: false,
          }],
        });
        void approvalPromise.catch(() => {});
        void questionPromise.catch(() => {});
        return Promise.reject(new Error("agent failed"));
      },
    };
    const events: GatewayEvent[] = [];
    const scheduler = new Scheduler(
      store,
      { adapter: () => adapter } as never,
      (event) => events.push(event),
      [directory],
    );

    scheduler.enqueue(session.id, "turn", { text: "fail", attachmentIds: [] });
    await waitUntil(() => store.getSession(session.id)?.status === "failed");

    assert.equal(store.pendingApprovals(session.id).length, 0);
    assert.equal(store.pendingQuestions(session.id).length, 0);
    assert.equal(events.some((event) => event.type === "approval.resolved"), true);
    assert.equal(events.some((event) => event.type === "question.resolved"), true);
    await assert.rejects(approvalPromise!, { name: "AbortError" });
    await assert.rejects(questionPromise!, { name: "AbortError" });
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("scheduler returns every normalized user answer", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-question-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    let received: Record<string, string[]> | undefined;
    const adapter: AgentAdapter = {
      id: "codex",
      command: "fake",
      capabilities: { approvals: true, attachments: true, resume: true, models: true },
      async run(context: RunContext) {
        const answer = await context.ask({
          requestKey: "questions",
          questions: [
            {
              id: "language",
              header: "Language",
              prompt: "Which?",
              options: [],
              multiSelect: false,
              allowFreeText: true,
              secret: false,
            },
            {
              id: "features",
              header: "Features",
              prompt: "Which?",
              options: [],
              multiSelect: true,
              allowFreeText: true,
              secret: false,
            },
          ],
        });
        received = answer.answers;
      },
    };
    const scheduler = new Scheduler(store, { adapter: () => adapter } as never, () => {}, [directory]);
    scheduler.enqueue(session.id, "turn", { text: "ask", attachmentIds: [] });
    await waitUntil(() => store.pendingQuestions(session.id).length === 1);
    const question = store.pendingQuestions(session.id)[0];
    assert.equal(
      scheduler.resolveQuestion(question.id, {
        answers: { language: ["TypeScript"], features: ["Lint", "Tests"] },
        cancelled: false,
      }),
      true,
    );
    await waitUntil(() => store.getSession(session.id)?.status === "idle");
    assert.deepEqual(received, { language: ["TypeScript"], features: ["Lint", "Tests"] });
    assert.equal(store.getQuestion(question.id)?.status, "answered");
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("an adapter that resolves after abort is recorded as cancelled", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-abort-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    let adapterStarted = false;
    const adapter: AgentAdapter = {
      id: "codex",
      command: "fake",
      capabilities: { approvals: true, attachments: true, resume: true, models: true },
      run: (context: RunContext) =>
        new Promise<void>((resolve) => {
          adapterStarted = true;
          context.signal.addEventListener("abort", () => resolve(), { once: true });
        }),
    };
    const events: GatewayEvent[] = [];
    const scheduler = new Scheduler(
      store,
      { adapter: () => adapter } as never,
      (event) => events.push(event),
      [directory],
    );
    const { turnId } = scheduler.enqueue(session.id, "turn", { text: "wait", attachmentIds: [] });
    await waitUntil(() => adapterStarted);
    assert.equal(scheduler.cancel(session.id), true);
    await waitUntil(() => store.getSession(session.id)?.status === "idle");
    assert.equal(events.some((event) => event.type === "turn.cancelled"), true);
    assert.equal(events.some((event) => event.type === "turn.completed"), false);
    assert.equal(
      (store.db.prepare("SELECT status FROM turns WHERE id=?").get(turnId) as { status: string }).status,
      "cancelled",
    );
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("scheduler shutdown aborts and awaits active adapters", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-shutdown-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    let started = false;
    let stopped = false;
    const adapter: AgentAdapter = {
      id: "codex",
      command: "fake",
      capabilities: { approvals: true, attachments: true, resume: true, models: true },
      run: (context: RunContext) =>
        new Promise<void>((resolve) => {
          started = true;
          context.signal.addEventListener("abort", () => {
            stopped = true;
            resolve();
          }, { once: true });
        }),
    };
    const scheduler = new Scheduler(store, { adapter: () => adapter } as never, () => {}, [directory]);
    scheduler.enqueue(session.id, "turn", { text: "wait", attachmentIds: [] });
    await waitUntil(() => started);

    await scheduler.shutdown();

    assert.equal(stopped, true);
    assert.throws(
      () => scheduler.enqueue(session.id, "another", { text: "again", attachmentIds: [] }),
      /GATEWAY_SHUTTING_DOWN/,
    );
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("scheduler publishes queued and approval-resolution status transitions", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-status-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const first = store.createSession(project.id, "codex");
    const second = store.createSession(project.id, "codex");
    let releaseFirst!: () => void;
    const adapter: AgentAdapter = {
      id: "codex",
      command: "fake",
      capabilities: { approvals: true, attachments: true, resume: true, models: true },
      async run(context: RunContext) {
        if (context.sessionId === first.id) {
          await new Promise<void>((resolve) => releaseFirst = resolve);
          return;
        }
        await context.approve({
          requestKey: "approval",
          title: "Continue",
          options: [{ id: "allow", label: "Allow", kind: "allow" }],
        });
      },
    };
    const events: GatewayEvent[] = [];
    const scheduler = new Scheduler(
      store,
      { adapter: () => adapter } as never,
      (event) => events.push(event),
      [directory],
    );
    scheduler.enqueue(first.id, "first", { text: "first", attachmentIds: [] });
    scheduler.enqueue(second.id, "second", { text: "second", attachmentIds: [] });
    await waitUntil(() => typeof releaseFirst === "function");
    assert.equal(
      events.some((event) =>
        event.sessionId === second.id && event.type === "session.status" && event.payload.status === "queued"
      ),
      true,
    );
    releaseFirst();
    await waitUntil(() => store.pendingApprovals(second.id).length === 1);
    assert.equal(
      scheduler.resolveApproval(store.pendingApprovals(second.id)[0].id, {
        optionId: "allow",
        scope: "once",
      }),
      true,
    );
    await waitUntil(() => store.getSession(second.id)?.status === "idle");
    assert.deepEqual(
      events.filter((event) => event.sessionId === second.id && event.type === "session.status")
        .map((event) => event.payload.status),
      ["queued", "running", "waiting_approval", "running", "idle"],
    );
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("scheduler stays in approval status until concurrent approvals resolve", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-approvals-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "claude");
    const adapter: AgentAdapter = {
      id: "claude",
      command: "fake",
      capabilities: { approvals: true, attachments: true, resume: true, models: true },
      async run(context: RunContext) {
        await Promise.all([
          context.approve({
            requestKey: "first",
            title: "First",
            options: [{ id: "allow", label: "Allow", kind: "allow" }],
          }),
          context.approve({
            requestKey: "second",
            title: "Second",
            options: [{ id: "allow", label: "Allow", kind: "allow" }],
          }),
        ]);
      },
    };
    const scheduler = new Scheduler(store, { adapter: () => adapter } as never, () => {}, [directory]);
    scheduler.enqueue(session.id, "turn", { text: "approve", attachmentIds: [] });
    await waitUntil(() => store.pendingApprovals(session.id).length === 2);
    const [first, second] = store.pendingApprovals(session.id);

    assert.equal(scheduler.resolveApproval(first.id, { optionId: "allow", scope: "once" }), true);
    assert.equal(store.getSession(session.id)?.status, "waiting_approval");
    assert.equal(scheduler.resolveApproval(second.id, { optionId: "allow", scope: "once" }), true);
    await waitUntil(() => store.getSession(session.id)?.status === "idle");

    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("scheduler stays waiting until mixed approval and question prompts resolve", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-mixed-prompts-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "claude");
    const adapter: AgentAdapter = {
      id: "claude",
      command: "fake",
      capabilities: { approvals: true, attachments: true, resume: true, models: true },
      async run(context: RunContext) {
        for (const suffix of ["first", "second"]) {
          await Promise.all([
            context.approve({
              requestKey: `approval-${suffix}`,
              title: "Approve",
              options: [{ id: "allow", label: "Allow", kind: "allow" }],
            }),
            context.ask({
              requestKey: `question-${suffix}`,
              questions: [{
                id: "answer",
                header: "Answer",
                prompt: "Continue?",
                options: [],
                multiSelect: false,
                allowFreeText: true,
                secret: false,
              }],
            }),
          ]);
        }
      },
    };
    const scheduler = new Scheduler(store, { adapter: () => adapter } as never, () => {}, [directory]);
    scheduler.enqueue(session.id, "turn", { text: "prompt", attachmentIds: [] });
    await waitUntil(() =>
      store.pendingApprovals(session.id).length === 1 && store.pendingQuestions(session.id).length === 1
    );

    const question = store.pendingQuestions(session.id)[0];
    assert.equal(
      scheduler.resolveQuestion(question.id, { answers: { answer: ["yes"] }, cancelled: false }),
      true,
    );
    assert.equal(store.getSession(session.id)?.status, "waiting_approval");
    const approval = store.pendingApprovals(session.id)[0];
    assert.equal(scheduler.resolveApproval(approval.id, { optionId: "allow", scope: "once" }), true);
    await waitUntil(() =>
      store.pendingApprovals(session.id).length === 1 && store.pendingQuestions(session.id).length === 1
    );
    const secondApproval = store.pendingApprovals(session.id)[0];
    assert.equal(scheduler.resolveApproval(secondApproval.id, { optionId: "allow", scope: "once" }), true);
    assert.equal(store.getSession(session.id)?.status, "waiting_input");
    const secondQuestion = store.pendingQuestions(session.id)[0];
    assert.equal(
      scheduler.resolveQuestion(secondQuestion.id, { answers: { answer: ["yes"] }, cancelled: false }),
      true,
    );
    await waitUntil(() => store.getSession(session.id)?.status === "idle");
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("scheduler rejects prompts delivered after cancellation", async () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-late-prompt-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    let context: RunContext | undefined;
    const adapter: AgentAdapter = {
      id: "codex",
      command: "fake",
      capabilities: { approvals: true, attachments: true, resume: true, models: true },
      run: (value) => {
        context = value;
        return new Promise<void>((resolve) =>
          value.signal.addEventListener("abort", () => resolve(), { once: true })
        );
      },
    };
    const scheduler = new Scheduler(store, { adapter: () => adapter } as never, () => {}, [directory]);
    scheduler.enqueue(session.id, "turn", { text: "cancel", attachmentIds: [] });
    await waitUntil(() => context !== undefined);
    assert.equal(scheduler.cancel(session.id), true);
    await waitUntil(() => store.getSession(session.id)?.status === "idle");

    await assert.rejects(() =>
      context!.approve({
        requestKey: "late-approval",
        title: "Late",
        options: [{ id: "allow", label: "Allow", kind: "allow" }],
      }), /Cancelled/);
    await assert.rejects(() =>
      context!.ask({
        requestKey: "late-question",
        questions: [{
          id: "answer",
          header: "Late",
          prompt: "Late?",
          options: [],
          multiSelect: false,
          allowFreeText: true,
          secret: false,
        }],
      }), /Cancelled/);
    assert.equal(store.pendingApprovals(session.id).length, 0);
    assert.equal(store.pendingQuestions(session.id).length, 0);
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
