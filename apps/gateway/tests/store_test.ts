import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MAX_EVENT_PAYLOAD_BYTES, Store } from "../src/db.ts";
import { MAX_WEBSOCKET_BUFFERED_BYTES } from "../src/server.ts";

Deno.test("store restricts an existing data directory to its owner", () => {
  const parent = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-permissions-" });
  const directory = join(parent, "data");
  try {
    Deno.mkdirSync(directory, { mode: 0o755 });
    const store = new Store(directory);
    assert.equal((Deno.statSync(directory).mode ?? 0) & 0o777, 0o700);
    store.close();
  } finally {
    Deno.removeSync(parent, { recursive: true });
  }
});

Deno.test("store locks a persistent data directory before recovery", () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-lock-" });
  try {
    const first = new Store(directory);
    assert.throws(() => new Store(directory), /GATEWAY_ALREADY_RUNNING/);
    first.close();
    const reopened = new Store(directory);
    reopened.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("events are durable and monotonically sequenced", () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-store-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    const first = store.appendEvent(session.id, "system.notice", { message: "one" });
    const second = store.appendEvent(session.id, "system.notice", { message: "two" });
    assert.deepEqual([first.seq, second.seq], [1, 2]);
    assert.deepEqual(store.events(session.id, 1).map((event) => event.payload.message), ["two"]);
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("oversized event payloads are bounded before persistence", () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-event-limit-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    const event = store.appendEvent(session.id, "system.notice", {
      message: "x".repeat(MAX_WEBSOCKET_BUFFERED_BYTES * 2),
    });
    const persisted = store.events(session.id)[0];
    const encoder = new TextEncoder();

    assert.equal(event.payload.truncated, true);
    assert.equal(event.payload.originalPayloadBytes, MAX_WEBSOCKET_BUFFERED_BYTES * 2 + 14);
    assert.match(String(event.payload.message), /\[Output truncated by KOAN Gateway\.\]$/);
    assert.ok(encoder.encode(JSON.stringify(event.payload)).byteLength <= MAX_EVENT_PAYLOAD_BYTES);
    assert.ok(
      encoder.encode(JSON.stringify({ type: "event", event })).byteLength < MAX_WEBSOCKET_BUFFERED_BYTES,
    );
    assert.deepEqual(persisted, event);
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("turn idempotency keys are scoped to a session", () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-turn-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    const first = store.createTurn(session.id, "same-key", "hello");
    const second = store.createTurn(session.id, "same-key", "hello again");
    assert.equal(first.id, second.id);
    assert.equal(second.duplicate, true);
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("queued turn bookkeeping is committed with the idempotency record", () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-turn-queue-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    const turn = store.createTurn(session.id, "turn", "hello", [], {
      position: 1,
      sessionTitle: "hello",
    });

    assert.equal(store.getSession(session.id)?.status, "queued");
    assert.equal(store.getSession(session.id)?.title, "hello");
    assert.deepEqual(turn.events.map((event) => event.type), [
      "message.user",
      "turn.queued",
      "session.status",
    ]);
    const duplicate = store.createTurn(session.id, "turn", "ignored", [], { position: 2 });
    assert.equal(duplicate.duplicate, true);
    assert.deepEqual(duplicate.events, []);
    assert.equal(store.events(session.id).length, 3);
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("turn creation consumes attachments atomically", () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-attachment-turn-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    const path = join(directory, "attachment.txt");
    Deno.writeTextFileSync(path, "attached");
    const attachment = store.createAttachment({
      sessionId: session.id,
      name: "attachment.txt",
      mediaType: "text/plain",
      size: 8,
      path,
    });

    store.createTurn(session.id, "turn", "hello", [attachment.id]);

    const row = store.db.prepare("SELECT consumed_at FROM attachments WHERE id=?").get(attachment.id) as {
      consumed_at: string | null;
    };
    assert.ok(row.consumed_at);
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("consumed attachments cannot be deleted", () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-attachment-delete-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    const path = join(directory, "attachment.txt");
    Deno.writeTextFileSync(path, "attached");
    const attachment = store.createAttachment({
      sessionId: session.id,
      name: "attachment.txt",
      mediaType: "text/plain",
      size: 8,
      path,
    });
    store.createTurn(session.id, "turn", "hello", [attachment.id]);

    assert.equal(store.deleteAttachment(attachment.id), null);
    assert.ok(store.getAttachment(attachment.id));
    assert.equal(Deno.readTextFileSync(path), "attached");
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("turn creation rejects unavailable attachments without committing", () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-attachment-invalid-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    const otherSession = store.createSession(project.id, "codex");
    const attachment = store.createAttachment({
      sessionId: otherSession.id,
      name: "other.txt",
      mediaType: "text/plain",
      size: 5,
      path: join(directory, "other.txt"),
    });

    assert.throws(
      () => store.createTurn(session.id, "turn", "hello", [attachment.id]),
      /ATTACHMENT_NOT_FOUND/,
    );
    assert.equal(
      (store.db.prepare("SELECT count(*) count FROM turns").get() as { count: number }).count,
      0,
    );
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("existing attachment tables gain the consumed timestamp column", () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-attachment-migration-" });
  try {
    const legacyPath = join(directory, "legacy.txt");
    Deno.writeTextFileSync(legacyPath, "legacy");
    const database = new DatabaseSync(join(directory, "koan.sqlite"));
    database.exec(`
      CREATE TABLE attachments (
        id TEXT PRIMARY KEY, session_id TEXT, name TEXT NOT NULL, media_type TEXT NOT NULL,
        size INTEGER NOT NULL, path TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);
    database.prepare(
      "INSERT INTO attachments(id,session_id,name,media_type,size,path,created_at) VALUES (?,?,?,?,?,?,?)",
    ).run("legacy", null, "legacy.txt", "text/plain", 6, legacyPath, "2020-01-01T00:00:00.000Z");
    database.close();

    const store = new Store(directory);

    const columns = store.db.prepare("PRAGMA table_info(attachments)").all() as Array<{ name: string }>;
    assert.equal(columns.some((column) => column.name === "consumed_at"), true);
    assert.equal(
      (store.db.prepare("SELECT consumed_at FROM attachments WHERE id='legacy'").get() as {
        consumed_at: string;
      }).consumed_at,
      "2020-01-01T00:00:00.000Z",
    );
    assert.equal(store.cleanupDraftAttachments("2021-01-01T00:00:00.000Z"), 0);
    assert.ok(Deno.statSync(legacyPath).isFile);
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("draft cleanup removes only expired unconsumed attachments", () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-attachment-cleanup-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    const create = (name: string) => {
      const path = join(directory, name);
      Deno.writeTextFileSync(path, name);
      return {
        path,
        attachment: store.createAttachment({
          sessionId: session.id,
          name,
          mediaType: "text/plain",
          size: name.length,
          path,
        }),
      };
    };
    const expired = create("expired.txt");
    const recent = create("recent.txt");
    const consumed = create("consumed.txt");
    const old = "2020-01-01T00:00:00.000Z";
    store.db.prepare("UPDATE attachments SET created_at=? WHERE id IN (?,?)").run(
      old,
      expired.attachment.id,
      consumed.attachment.id,
    );
    store.createTurn(session.id, "turn", "hello", [consumed.attachment.id]);

    assert.equal(store.cleanupDraftAttachments("2021-01-01T00:00:00.000Z"), 1);
    assert.equal(store.getAttachment(expired.attachment.id), null);
    assert.throws(() => Deno.statSync(expired.path), Deno.errors.NotFound);
    assert.ok(store.getAttachment(recent.attachment.id));
    assert.ok(store.getAttachment(consumed.attachment.id));
    assert.ok(Deno.statSync(recent.path));
    assert.ok(Deno.statSync(consumed.path));
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("approval status follows the selected option kind", () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-approval-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    const turn = store.createTurn(session.id, "turn", "hello");
    const approval = store.createApproval({
      sessionId: session.id,
      turnId: turn.id,
      requestKey: "approval",
      title: "Run command",
      options: [
        { id: "accept", label: "Allow", kind: "allow" },
        { id: "decline", label: "Deny", kind: "deny" },
      ],
    });
    assert.equal(store.resolveApproval(approval.id, "decline"), true);
    assert.equal(store.getApproval(approval.id)?.status, "denied");
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("secret question answers are redacted at rest", () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-secret-question-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    const turn = store.createTurn(session.id, "turn", "hello");
    const question = store.createQuestion({
      sessionId: session.id,
      turnId: turn.id,
      requestKey: "secret",
      questions: [{
        id: "token",
        header: "Token",
        prompt: "Enter a token",
        options: [],
        multiSelect: false,
        allowFreeText: true,
        secret: true,
      }],
    });

    assert.equal(
      store.resolveQuestion(question.id, {
        answers: { token: ["plain-text-secret"] },
        cancelled: false,
      }),
      true,
    );
    assert.deepEqual(store.getQuestion(question.id)?.answers, {
      answers: { token: ["[REDACTED]"] },
      cancelled: false,
    });
    assert.equal(
      JSON.stringify(store.db.prepare("SELECT answers FROM questions WHERE id=?").get(question.id)).includes(
        "plain-text-secret",
      ),
      false,
    );
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("restart recovery interrupts pending approvals", () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-restart-" });
  try {
    let store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    const turn = store.createTurn(session.id, "turn", "hello");
    store.updateTurn(turn.id, "running");
    store.updateSession(session.id, { status: "waiting_approval" });
    const approval = store.createApproval({
      sessionId: session.id,
      turnId: turn.id,
      requestKey: "request",
      title: "Run command",
      options: [{ id: "deny", label: "Deny", kind: "deny" }],
    });
    const question = store.createQuestion({
      sessionId: session.id,
      turnId: turn.id,
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
    store.close();

    store = new Store(directory);
    assert.equal(store.getSession(session.id)?.status, "interrupted");
    assert.equal(store.getApproval(approval.id)?.status, "interrupted");
    assert.equal(store.getQuestion(question.id)?.status, "interrupted");
    assert.equal(store.pendingApprovals(session.id).length, 0);
    assert.equal(store.pendingQuestions(session.id).length, 0);
    assert.deepEqual(
      store.events(session.id).map((event) => [event.type, event.payload.status]),
      [
        ["approval.resolved", "interrupted"],
        ["question.resolved", "interrupted"],
        ["session.status", "interrupted"],
      ],
    );
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("event history returns the newest page and paginates backwards", () => {
  const directory = Deno.makeTempDirSync({ dir: "/tmp", prefix: "koan-history-" });
  try {
    const store = new Store(directory);
    const project = store.createProject("KOAN", directory);
    const session = store.createSession(project.id, "codex");
    for (let index = 1; index <= 4001; index++) {
      store.appendEvent(session.id, "system.notice", { index });
    }
    const latest = store.eventsBefore(session.id);
    assert.deepEqual([latest[0].seq, latest.at(-1)?.seq], [2002, 4001]);
    const previous = store.eventsBefore(session.id, latest[0].seq);
    assert.deepEqual([previous[0].seq, previous.at(-1)?.seq], [2, 2001]);
    const oldest = store.eventsBefore(session.id, previous[0].seq);
    assert.deepEqual(oldest.map((event) => event.seq), [1]);
    store.close();
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});
