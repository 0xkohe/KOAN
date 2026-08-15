import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import type {
  AgentId,
  Approval,
  GatewayEvent,
  Project,
  QuestionAnswer,
  QuestionPrompt,
  QuestionRequest,
  Session,
} from "../../../packages/protocol/src/index.ts";

type Row = Record<string, unknown>;

export const MAX_EVENT_PAYLOAD_BYTES = 768 * 1024;
const truncationSuffix = "\n\n[Output truncated by KOAN Gateway.]";
const eventTextEncoder = new TextEncoder();

export class Store {
  readonly db: DatabaseSync;
  #lock: Deno.FsFile | null = null;

  constructor(dataDir: string, memory = false) {
    Deno.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    Deno.chmodSync(dataDir, 0o700);
    if (!memory) {
      const lock = Deno.openSync(join(dataDir, "gateway.lock"), { create: true, write: true });
      if (!lock.tryLockSync(true)) {
        lock.close();
        throw new Error("GATEWAY_ALREADY_RUNNING");
      }
      this.#lock = lock;
    }
    try {
      this.db = new DatabaseSync(memory ? ":memory:" : join(dataDir, "koan.sqlite"));
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
      this.migrate();
      this.markInterrupted();
    } catch (error) {
      this.releaseLock();
      throw error;
    }
  }

  close() {
    try {
      this.db.close();
    } finally {
      this.releaseLock();
    }
  }

  private releaseLock() {
    if (!this.#lock) return;
    this.#lock.unlockSync();
    this.#lock.close();
    this.#lock = null;
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'idle',
        model TEXT, mode TEXT, auto_approve INTEGER NOT NULL DEFAULT 0, agent_session_id TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_seq INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT
      );
      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT,
        UNIQUE(session_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS events (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(session_id, seq)
      );
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
        request_key TEXT NOT NULL, title TEXT NOT NULL, description TEXT, command TEXT,
        options TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', decision TEXT,
        created_at TEXT NOT NULL, resolved_at TEXT
      );
      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
        request_key TEXT NOT NULL, questions TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        answers TEXT, created_at TEXT NOT NULL, resolved_at TEXT
      );
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS device_cursors (
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(device_id, session_id)
      );
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL, media_type TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL,
        created_at TEXT NOT NULL, consumed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS events_session_seq ON events(session_id, seq);
      CREATE INDEX IF NOT EXISTS sessions_project_updated ON sessions(project_id, updated_at DESC);
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'));
    `);
    const attachmentColumns = this.db.prepare("PRAGMA table_info(attachments)").all() as Row[];
    if (!attachmentColumns.some((column) => column.name === "consumed_at")) {
      this.db.exec("ALTER TABLE attachments ADD COLUMN consumed_at TEXT");
      this.db.exec("UPDATE attachments SET consumed_at=created_at WHERE consumed_at IS NULL");
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS attachments_draft_created
      ON attachments(created_at) WHERE consumed_at IS NULL;
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, datetime('now'));
    `);
    const sessionColumns = this.db.prepare("PRAGMA table_info(sessions)").all() as Row[];
    if (!sessionColumns.some((column) => column.name === "auto_approve")) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN auto_approve INTEGER NOT NULL DEFAULT 0");
    }
    this.db.exec("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, datetime('now'))");
  }

  private markInterrupted() {
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const sessions = this.db.prepare(
        "SELECT id FROM sessions WHERE status IN ('running','queued','waiting_approval','waiting_input')",
      ).all() as Row[];
      const approvals = this.db.prepare(
        "SELECT id,session_id FROM approvals WHERE status='pending'",
      ).all() as Row[];
      const questions = this.db.prepare(
        "SELECT id,session_id FROM questions WHERE status='pending'",
      ).all() as Row[];
      this.db.prepare(
        "UPDATE turns SET status='interrupted', completed_at=? WHERE status IN ('running','queued')",
      ).run(now);
      this.db.prepare(
        "UPDATE approvals SET status='interrupted',decision='gateway_restart',resolved_at=? WHERE status='pending'",
      ).run(now);
      this.db.prepare(
        `UPDATE questions SET status='interrupted',answers='{"answers":{},"cancelled":true}',resolved_at=?
        WHERE status='pending'`,
      ).run(now);
      this.db.prepare(
        "UPDATE sessions SET status='interrupted', updated_at=? WHERE status IN ('running','queued','waiting_approval','waiting_input')",
      ).run(now);
      for (const approval of approvals) {
        this.insertEvent(String(approval.session_id), "approval.resolved", {
          approvalId: String(approval.id),
          status: "interrupted",
        }, now);
      }
      for (const question of questions) {
        this.insertEvent(String(question.session_id), "question.resolved", {
          questionId: String(question.id),
          status: "interrupted",
        }, now);
      }
      for (const session of sessions) {
        this.insertEvent(String(session.id), "session.status", { status: "interrupted" }, now);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listProjects(): Project[] {
    return (this.db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as Row[]).map(
      projectFromRow,
    );
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE id=?").get(id) as Row | undefined;
    return row ? projectFromRow(row) : null;
  }

  createProject(name: string, path: string): Project {
    const id: string = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO projects(id,name,path,created_at,updated_at) VALUES (?,?,?,?,?)")
      .run(id, name, path, now, now);
    return { id, name, path, createdAt: now, updatedAt: now };
  }

  listSessions(projectId?: string): Session[] {
    const sql = `SELECT s.*, p.name project_name FROM sessions s JOIN projects p ON p.id=s.project_id
      WHERE s.archived_at IS NULL ${projectId ? "AND s.project_id=?" : ""}
      ORDER BY s.updated_at DESC`;
    const rows = (projectId ? this.db.prepare(sql).all(projectId) : this.db.prepare(sql).all()) as Row[];
    return rows.map(sessionFromRow);
  }

  getSession(id: string): Session | null {
    const row = this.db.prepare(`SELECT s.*, p.name project_name FROM sessions s
      JOIN projects p ON p.id=s.project_id WHERE s.id=?`).get(id) as Row | undefined;
    return row ? sessionFromRow(row) : null;
  }

  getSessionWithProject(
    id: string,
  ): (Session & { projectPath: string; agentSessionId: string | null; autoApprove: boolean }) | null {
    const row = this.db.prepare(`SELECT s.*, p.name project_name, p.path project_path FROM sessions s
      JOIN projects p ON p.id=s.project_id WHERE s.id=?`).get(id) as Row | undefined;
    if (!row) return null;
    return {
      ...sessionFromRow(row),
      projectPath: String(row.project_path),
      agentSessionId: row.agent_session_id ? String(row.agent_session_id) : null,
      autoApprove: Boolean(row.auto_approve),
    };
  }

  createSession(
    projectId: string,
    agentId: AgentId,
    model?: string | null,
    mode?: string | null,
    autoApprove = false,
  ): Session {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO sessions(id,project_id,agent_id,title,status,model,mode,auto_approve,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      projectId,
      agentId,
      "New session",
      "idle",
      model ?? null,
      mode ?? null,
      autoApprove ? 1 : 0,
      now,
      now,
    );
    return this.getSession(id)!;
  }

  updateSession(id: string, fields: { title?: string; status?: Session["status"]; agentSessionId?: string }) {
    const now = new Date().toISOString();
    if (fields.title !== undefined) {
      this.db.prepare("UPDATE sessions SET title=?,updated_at=? WHERE id=?").run(fields.title, now, id);
    }
    if (fields.status !== undefined) {
      this.db.prepare("UPDATE sessions SET status=?,updated_at=? WHERE id=?").run(fields.status, now, id);
    }
    if (fields.agentSessionId !== undefined) {
      this.db.prepare("UPDATE sessions SET agent_session_id=?,updated_at=? WHERE id=?").run(
        fields.agentSessionId,
        now,
        id,
      );
    }
  }

  archiveSession(id: string) {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE sessions SET archived_at=?,updated_at=? WHERE id=?").run(now, now, id);
  }

  createTurn(
    sessionId: string,
    key: string,
    prompt: string,
    attachmentIds: string[] = [],
    queued?: { position: number; sessionTitle?: string },
  ): { id: string; duplicate: boolean; events: GatewayEvent[] } {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare("SELECT id FROM turns WHERE session_id=? AND idempotency_key=?").get(
        sessionId,
        key,
      ) as Row | undefined;
      if (existing) {
        this.db.exec("COMMIT");
        return { id: String(existing.id), duplicate: true, events: [] };
      }
      const ids = [...new Set(attachmentIds)];
      if (ids.length) {
        const placeholders = ids.map(() => "?").join(",");
        const attachments = this.db.prepare(
          `SELECT id FROM attachments
          WHERE session_id=? AND consumed_at IS NULL AND id IN (${placeholders})`,
        ).all(sessionId, ...ids) as Row[];
        if (attachments.length !== ids.length) throw new Error("ATTACHMENT_NOT_FOUND");
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      this.db.prepare(
        "INSERT INTO turns(id,session_id,idempotency_key,prompt,status,created_at) VALUES (?,?,?,?,?,?)",
      ).run(id, sessionId, key, prompt, "queued", now);
      if (ids.length) {
        const placeholders = ids.map(() => "?").join(",");
        this.db.prepare(
          `UPDATE attachments SET consumed_at=?
          WHERE session_id=? AND consumed_at IS NULL AND id IN (${placeholders})`,
        ).run(now, sessionId, ...ids);
      }
      const events: GatewayEvent[] = [];
      if (queued) {
        if (queued.sessionTitle) {
          this.db.prepare("UPDATE sessions SET title=?,status='queued',updated_at=? WHERE id=?").run(
            queued.sessionTitle,
            now,
            sessionId,
          );
        } else {
          this.db.prepare("UPDATE sessions SET status='queued',updated_at=? WHERE id=?").run(now, sessionId);
        }
        events.push(
          this.insertEvent(sessionId, "message.user", {
            turnId: id,
            text: prompt,
            attachmentIds,
            ...(queued.sessionTitle ? { sessionTitle: queued.sessionTitle } : {}),
          }, now),
          this.insertEvent(sessionId, "turn.queued", { turnId: id, position: queued.position }, now),
          this.insertEvent(sessionId, "session.status", { status: "queued" }, now),
        );
      }
      this.db.exec("COMMIT");
      return { id, duplicate: false, events };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  updateTurn(id: string, status: string) {
    const now = new Date().toISOString();
    const start = status === "running" ? now : null;
    const completed = ["completed", "failed", "cancelled", "interrupted"].includes(status) ? now : null;
    this.db.prepare(
      `UPDATE turns SET status=?, started_at=COALESCE(started_at,?), completed_at=COALESCE(?,completed_at) WHERE id=?`,
    )
      .run(status, start, completed, id);
  }

  createApproval(input: {
    sessionId: string;
    turnId: string;
    requestKey: string;
    title: string;
    description?: string;
    command?: string;
    options: Array<{ id: string; label: string; kind: "allow" | "deny" }>;
  }) {
    const id: string = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO approvals(id,session_id,turn_id,request_key,title,description,command,options,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      input.sessionId,
      input.turnId,
      input.requestKey,
      input.title,
      input.description ?? null,
      input.command ?? null,
      JSON.stringify(input.options),
      "pending",
      createdAt,
    );
    return {
      id,
      sessionId: input.sessionId,
      turnId: input.turnId,
      title: input.title,
      description: input.description ?? null,
      command: input.command ?? null,
      status: "pending" as const,
      options: input.options,
      createdAt,
    };
  }

  getApproval(id: string): (Approval & { requestKey: string; decision: string | null }) | null {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id=?").get(id) as Row | undefined;
    if (!row) return null;
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      turnId: String(row.turn_id),
      requestKey: String(row.request_key),
      title: String(row.title),
      description: row.description ? String(row.description) : null,
      command: row.command ? String(row.command) : null,
      status: row.status as Approval["status"],
      decision: row.decision ? String(row.decision) : null,
      options: JSON.parse(String(row.options)),
      createdAt: String(row.created_at),
    };
  }

  resolveApproval(id: string, decision: string): boolean {
    const approval = this.getApproval(id);
    const selected = approval?.options.find((option) => option.id === decision);
    if (!approval || !selected) return false;
    const result = this.db.prepare(
      "UPDATE approvals SET status=?,decision=?,resolved_at=? WHERE id=? AND status='pending'",
    )
      .run(selected.kind === "deny" ? "denied" : "approved", decision, new Date().toISOString(), id);
    return Number(result.changes) === 1;
  }

  cancelApproval(id: string): boolean {
    const result = this.db.prepare(
      "UPDATE approvals SET status='cancelled',decision='session_cancelled',resolved_at=? WHERE id=? AND status='pending'",
    ).run(new Date().toISOString(), id);
    return Number(result.changes) === 1;
  }

  pendingApprovals(sessionId: string) {
    return (this.db.prepare(
      "SELECT * FROM approvals WHERE session_id=? AND status='pending' ORDER BY created_at",
    ).all(sessionId) as Row[])
      .map((row) => ({
        id: String(row.id),
        sessionId: String(row.session_id),
        turnId: String(row.turn_id),
        title: String(row.title),
        description: row.description ? String(row.description) : null,
        command: row.command ? String(row.command) : null,
        status: "pending" as const,
        options: JSON.parse(String(row.options)),
        createdAt: String(row.created_at),
      }));
  }

  createQuestion(input: {
    sessionId: string;
    turnId: string;
    requestKey: string;
    questions: QuestionPrompt[];
  }): QuestionRequest {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(
      "INSERT INTO questions(id,session_id,turn_id,request_key,questions,status,created_at) VALUES (?,?,?,?,?,'pending',?)",
    ).run(id, input.sessionId, input.turnId, input.requestKey, JSON.stringify(input.questions), createdAt);
    return {
      id,
      sessionId: input.sessionId,
      turnId: input.turnId,
      status: "pending",
      questions: input.questions,
      createdAt,
    };
  }

  getQuestion(id: string): (QuestionRequest & { requestKey: string; answers: QuestionAnswer | null }) | null {
    const row = this.db.prepare("SELECT * FROM questions WHERE id=?").get(id) as Row | undefined;
    return row ? questionFromRow(row) : null;
  }

  pendingQuestions(sessionId: string): QuestionRequest[] {
    return (this.db.prepare(
      "SELECT * FROM questions WHERE session_id=? AND status='pending' ORDER BY created_at",
    ).all(sessionId) as Row[]).map(questionFromRow);
  }

  resolveQuestion(id: string, answer: QuestionAnswer): boolean {
    const question = this.getQuestion(id);
    if (!question) return false;
    const secretQuestionIds = new Set(
      question.questions.filter((item) => item.secret).map((item) => item.id),
    );
    const persistedAnswer: QuestionAnswer = {
      ...answer,
      answers: Object.fromEntries(
        Object.entries(answer.answers).map(([questionId, values]) => [
          questionId,
          secretQuestionIds.has(questionId) ? values.map(() => "[REDACTED]") : values,
        ]),
      ),
    };
    const status = answer.cancelled ? "cancelled" : "answered";
    const result = this.db.prepare(
      "UPDATE questions SET status=?,answers=?,resolved_at=? WHERE id=? AND status='pending'",
    ).run(status, JSON.stringify(persistedAnswer), new Date().toISOString(), id);
    return Number(result.changes) === 1;
  }

  cancelQuestion(id: string): boolean {
    return this.resolveQuestion(id, { answers: {}, cancelled: true });
  }

  createAttachment(
    input: { sessionId: string | null; name: string; mediaType: string; size: number; path: string },
  ) {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(
      "INSERT INTO attachments(id,session_id,name,media_type,size,path,created_at) VALUES (?,?,?,?,?,?,?)",
    )
      .run(id, input.sessionId, input.name, input.mediaType, input.size, input.path, createdAt);
    return {
      id,
      sessionId: input.sessionId,
      name: input.name,
      mediaType: input.mediaType,
      size: input.size,
      createdAt,
    };
  }

  getAttachment(
    id: string,
  ): { id: string; name: string; mediaType: string; size: number; path: string } | null {
    const row = this.db.prepare("SELECT * FROM attachments WHERE id=?").get(id) as Row | undefined;
    return row
      ? {
        id: String(row.id),
        name: String(row.name),
        mediaType: String(row.media_type),
        size: Number(row.size),
        path: String(row.path),
      }
      : null;
  }

  deleteAttachment(id: string): string | null {
    const attachment = this.db.prepare(
      "SELECT path FROM attachments WHERE id=? AND consumed_at IS NULL",
    ).get(id) as Row | undefined;
    if (!attachment) return null;
    const result = this.db.prepare(
      "DELETE FROM attachments WHERE id=? AND consumed_at IS NULL",
    ).run(id);
    return Number(result.changes) === 1 ? String(attachment.path) : null;
  }

  cleanupDraftAttachments(createdBefore: string): number {
    const drafts = this.db.prepare(
      "SELECT id,path FROM attachments WHERE consumed_at IS NULL AND created_at<?",
    ).all(createdBefore) as Row[];
    let deleted = 0;
    for (const draft of drafts) {
      try {
        Deno.removeSync(String(draft.path));
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          console.error(`Could not remove expired attachment ${String(draft.id)}:`, error);
          continue;
        }
      }
      const result = this.db.prepare(
        "DELETE FROM attachments WHERE id=? AND consumed_at IS NULL AND created_at<?",
      ).run(String(draft.id), createdBefore);
      deleted += Number(result.changes);
    }
    return deleted;
  }

  appendEvent(sessionId: string, type: GatewayEvent["type"], payload: Record<string, unknown>): GatewayEvent {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const event = this.insertEvent(sessionId, type, payload, new Date().toISOString());
      this.db.exec("COMMIT");
      return event;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private insertEvent(
    sessionId: string,
    type: GatewayEvent["type"],
    payload: Record<string, unknown>,
    createdAt: string,
  ): GatewayEvent {
    const row = this.db.prepare("SELECT last_seq FROM sessions WHERE id=?").get(sessionId) as Row;
    const seq = Number(row.last_seq) + 1;
    const boundedPayload = boundEventPayload(payload);
    this.db.prepare("INSERT INTO events(session_id,seq,type,payload,created_at) VALUES (?,?,?,?,?)")
      .run(sessionId, seq, type, JSON.stringify(boundedPayload), createdAt);
    this.db.prepare("UPDATE sessions SET last_seq=?,updated_at=? WHERE id=?").run(
      seq,
      createdAt,
      sessionId,
    );
    return { sessionId, seq, type, payload: boundedPayload, createdAt };
  }

  events(sessionId: string, after = 0, limit = 2000): GatewayEvent[] {
    return (this.db.prepare("SELECT * FROM events WHERE session_id=? AND seq>? ORDER BY seq LIMIT ?")
      .all(sessionId, after, limit) as Row[]).map((row) => ({
        sessionId: String(row.session_id),
        seq: Number(row.seq),
        type: row.type as GatewayEvent["type"],
        payload: JSON.parse(String(row.payload)),
        createdAt: String(row.created_at),
      }));
  }

  eventsBefore(sessionId: string, before?: number, limit = 2000): GatewayEvent[] {
    const rows =
      (before === undefined
        ? this.db.prepare("SELECT * FROM events WHERE session_id=? ORDER BY seq DESC LIMIT ?")
          .all(sessionId, limit)
        : this.db.prepare("SELECT * FROM events WHERE session_id=? AND seq<? ORDER BY seq DESC LIMIT ?")
          .all(sessionId, before, limit)) as Row[];
    return rows.reverse().map(eventFromRow);
  }

  createDevice(name: string, tokenHash: string): { id: string } {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO devices(id,name,token_hash,created_at,last_seen_at) VALUES (?,?,?,?,?)").run(
      id,
      name,
      tokenHash,
      now,
      now,
    );
    return { id };
  }

  deviceByHash(hash: string): { id: string; name: string } | null {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const row = this.db.prepare(
      "SELECT id,name FROM devices WHERE token_hash=? AND revoked_at IS NULL AND last_seen_at>?",
    ).get(hash, cutoff) as Row | undefined;
    if (!row) return null;
    this.db.prepare("UPDATE devices SET last_seen_at=? WHERE id=?").run(
      new Date().toISOString(),
      String(row.id),
    );
    return { id: String(row.id), name: String(row.name) };
  }

  listDevices() {
    return this.db.prepare(
      "SELECT id,name,created_at createdAt,last_seen_at lastSeenAt FROM devices WHERE revoked_at IS NULL ORDER BY last_seen_at DESC",
    ).all();
  }

  revokeDevice(id: string) {
    this.db.prepare("UPDATE devices SET revoked_at=? WHERE id=?").run(new Date().toISOString(), id);
  }
}

export function boundEventPayload(
  payload: Record<string, unknown>,
  maxBytes = MAX_EVENT_PAYLOAD_BYTES,
): Record<string, unknown> {
  const originalBytes = serializedBytes(payload);
  if (originalBytes <= maxBytes) return payload;

  const withMetadata = {
    ...payload,
    truncated: true,
    originalPayloadBytes: originalBytes,
  };
  let low = truncationSuffix.length;
  let high = maxBytes;
  let best: Record<string, unknown> | null = null;
  while (low <= high) {
    const limit = Math.floor((low + high) / 2);
    const candidate = truncateLongStrings(withMetadata, limit);
    if (serializedBytes(candidate) <= maxBytes) {
      best = candidate;
      low = limit + 1;
    } else {
      high = limit - 1;
    }
  }
  if (best) return best;

  const fallback: Record<string, unknown> = {
    truncated: true,
    originalPayloadBytes: originalBytes,
    message: "Event payload omitted because it exceeded the Gateway limit.",
  };
  for (const key of ["id", "turnId", "toolCallId", "title", "kind", "status"]) {
    const value = payload[key];
    if (
      typeof value === "number" || typeof value === "boolean" ||
      typeof value === "string" && serializedBytes(value) <= 1024
    ) {
      fallback[key] = value;
    }
  }
  return fallback;
}

function truncateLongStrings(
  payload: Record<string, unknown>,
  limit: number,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload, (_key, value) => {
    if (typeof value !== "string" || value.length <= limit) return value;
    const prefixLength = Math.max(0, limit - truncationSuffix.length);
    let end = prefixLength;
    if (
      end > 0 && end < value.length &&
      value.charCodeAt(end - 1) >= 0xD800 && value.charCodeAt(end - 1) <= 0xDBFF
    ) end--;
    return value.slice(0, end) + truncationSuffix;
  })) as Record<string, unknown>;
}

function serializedBytes(value: unknown): number {
  return eventTextEncoder.encode(JSON.stringify(value)).byteLength;
}

function projectFromRow(row: Row): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    path: String(row.path),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function eventFromRow(row: Row): GatewayEvent {
  return {
    sessionId: String(row.session_id),
    seq: Number(row.seq),
    type: row.type as GatewayEvent["type"],
    payload: JSON.parse(String(row.payload)),
    createdAt: String(row.created_at),
  };
}

function questionFromRow(row: Row): QuestionRequest & { requestKey: string; answers: QuestionAnswer | null } {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    turnId: String(row.turn_id),
    requestKey: String(row.request_key),
    status: row.status as QuestionRequest["status"],
    questions: JSON.parse(String(row.questions)),
    answers: row.answers ? JSON.parse(String(row.answers)) : null,
    createdAt: String(row.created_at),
  };
}

function sessionFromRow(row: Row): Session {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    projectName: row.project_name ? String(row.project_name) : undefined,
    agentId: row.agent_id as AgentId,
    title: String(row.title),
    status: row.status as Session["status"],
    model: row.model ? String(row.model) : null,
    mode: row.mode ? String(row.mode) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastSeq: Number(row.last_seq),
    unread: 0,
  };
}
