import { extname, join, normalize } from "node:path";
import {
  agentIdSchema,
  approvalDecisionSchema,
  createSessionInputSchema,
  type GatewayEvent,
  questionAnswerSchema,
  type Session,
  startTurnInputSchema,
  type WsClientMessage,
  type WsServerMessage,
} from "../../../packages/protocol/src/index.ts";
import type { AgentManager } from "./agents/manager.ts";
import type { PairingAuth } from "./auth.ts";
import type { GatewayConfig } from "./config.ts";
import type { Store } from "./db.ts";
import type { Scheduler } from "./scheduler.ts";
import { sameHostOrigin, validateProjectPath } from "./security.ts";

type SocketState = { socket: WebSocket; deviceId: string; sessions: Set<string> };

export const MAX_WEBSOCKET_BUFFERED_BYTES = 1024 * 1024;
const textEncoder = new TextEncoder();

export function sendWebSocket(
  socket: Pick<WebSocket, "bufferedAmount" | "close" | "readyState" | "send">,
  data: string,
  maxBufferedBytes = MAX_WEBSOCKET_BUFFERED_BYTES,
): boolean {
  if (socket.readyState !== WebSocket.OPEN) return false;
  if (socket.bufferedAmount + textEncoder.encode(data).byteLength > maxBufferedBytes) {
    socket.close(1013, "Slow consumer");
    return false;
  }
  socket.send(data);
  return true;
}

export class GatewayServer {
  #sockets = new Set<SocketState>();

  constructor(
    private config: GatewayConfig,
    private store: Store,
    private auth: PairingAuth,
    private agents: AgentManager,
    private scheduler: Scheduler,
  ) {}

  publish(event: GatewayEvent) {
    const data = JSON.stringify({ type: "event", event });
    for (const state of this.#sockets) {
      if (state.sessions.has(event.sessionId)) sendWebSocket(state.socket, data);
    }
  }

  private broadcast(message: WsServerMessage) {
    const data = JSON.stringify(message);
    for (const state of this.#sockets) {
      sendWebSocket(state.socket, data);
    }
  }

  private publishSessionCreated(session: Session) {
    this.broadcast({ type: "session.created", session });
  }

  async handle(request: Request, peerAddress = "local"): Promise<Response> {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();
    try {
      if (url.pathname === "/api/v1/auth/status" && request.method === "GET") {
        const device = await this.auth.authenticate(request);
        return json({ paired: Boolean(device), device, pairing: device ? null : this.auth.pairingInfo() });
      }
      if (url.pathname === "/api/v1/auth/pair" && request.method === "POST") {
        if (!sameHostOrigin(request)) return apiError(403, "BAD_ORIGIN", "Origin is not allowed", requestId);
        const value = await readJsonBounded(request);
        const body = isRecord(value) ? value : {};
        const result = await this.auth.pair(
          String(body.code ?? ""),
          String(body.name ?? "Mobile device"),
          pairingRateLimitKeys(request, peerAddress),
        );
        if (!result) {
          return apiError(401, "INVALID_PAIRING_CODE", "The pairing code is invalid or expired", requestId);
        }
        return json({ device: result.device }, 200, { "set-cookie": result.cookie });
      }

      if (url.pathname === "/ws") return await this.websocket(request, requestId);
      if (url.pathname.startsWith("/api/")) {
        const device = await this.auth.authenticate(request);
        if (!device) return apiError(401, "UNAUTHENTICATED", "Pair this device first", requestId);
        if (!["GET", "HEAD"].includes(request.method)) {
          if (!sameHostOrigin(request) || request.headers.get("x-koan-csrf") !== "1") {
            return apiError(403, "CSRF", "Request validation failed", requestId);
          }
        }
        return await this.api(request, url, device, requestId);
      }
      return await this.staticFile(request, url.pathname);
    } catch (error) {
      console.error(`[${requestId}]`, error);
      const message = error instanceof Error ? error.message : "Unexpected error";
      const status = message === "RATE_LIMITED"
        ? 429
        : message === "UPLOAD_TOO_LARGE" || message === "REQUEST_BODY_TOO_LARGE"
        ? 413
        : message.includes("NOT_FOUND")
        ? 404
        : 400;
      return apiError(status, message, humanize(message), requestId);
    }
  }

  private async api(
    request: Request,
    url: URL,
    _device: { id: string },
    requestId: string,
  ): Promise<Response> {
    const path = url.pathname;
    if (path === "/api/v1/auth/logout" && request.method === "POST") {
      this.store.revokeDevice(_device.id);
      for (const state of this.#sockets) {
        if (state.deviceId === _device.id) state.socket.close(4001, "Device logged out");
      }
      return json({ ok: true }, 200, { "set-cookie": this.auth.clearCookie() });
    }
    if (path === "/api/v1/auth/pairing-code" && request.method === "POST") {
      return json(this.auth.newPairingCode());
    }
    if (path === "/api/v1/devices" && request.method === "GET") {
      return json({ devices: this.store.listDevices() });
    }
    const revoke = path.match(/^\/api\/v1\/devices\/([^/]+)$/);
    if (revoke && request.method === "DELETE") {
      this.store.revokeDevice(revoke[1]);
      for (const state of this.#sockets) {
        if (state.deviceId === revoke[1]) state.socket.close(4001, "Device revoked");
      }
      return json({ ok: true });
    }

    if (path === "/api/v1/agents" && request.method === "GET") return json({ agents: this.agents.states() });
    const agentModels = path.match(/^\/api\/v1\/agents\/([^/]+)\/models$/);
    if (agentModels && request.method === "GET") {
      const agentId = agentIdSchema.safeParse(agentModels[1]);
      if (!agentId.success) return apiError(404, "AGENT_NOT_FOUND", "Agent not found", requestId);
      if (!this.agents.available(agentId.data)) {
        return apiError(503, "AGENT_UNAVAILABLE", `${agentId.data} is not available`, requestId);
      }
      const project = this.store.getProject(url.searchParams.get("projectId") ?? "");
      if (!project) return apiError(404, "PROJECT_NOT_FOUND", "Project not found", requestId);
      const checked = await validateProjectPath(project.path, this.config.allowedRoots);
      return json({ models: await this.agents.models(agentId.data, checked.path) });
    }
    if (path === "/api/v1/roots" && request.method === "GET") {
      return json({ roots: this.config.allowedRoots });
    }

    if (path === "/api/v1/projects" && request.method === "GET") {
      return json({ projects: this.store.listProjects() });
    }
    if (path === "/api/v1/projects" && request.method === "POST") {
      const body = await request.json();
      const checked = await validateProjectPath(String(body.path ?? ""), this.config.allowedRoots);
      return json({
        project: this.store.createProject(
          String(body.name ?? checked.name).trim() || checked.name,
          checked.path,
        ),
      }, 201);
    }
    const project = path.match(/^\/api\/v1\/projects\/([^/]+)$/);
    if (project && request.method === "GET") {
      const value = this.store.getProject(project[1]);
      if (!value) return apiError(404, "PROJECT_NOT_FOUND", "Project not found", requestId);
      return json({ project: value, sessions: this.store.listSessions(value.id) });
    }

    if (path === "/api/v1/sessions" && request.method === "GET") {
      return json({ sessions: this.store.listSessions(url.searchParams.get("projectId") ?? undefined) });
    }
    if (path === "/api/v1/sessions" && request.method === "POST") {
      const body = createSessionInputSchema.parse(await request.json());
      if (!this.store.getProject(body.projectId)) {
        return apiError(404, "PROJECT_NOT_FOUND", "Project not found", requestId);
      }
      if (!this.agents.available(body.agentId)) {
        return apiError(503, "AGENT_UNAVAILABLE", `${body.agentId} is not available`, requestId);
      }
      const session = this.store.createSession(
        body.projectId,
        body.agentId,
        body.model,
        body.mode,
        body.autoApprove,
      );
      this.publishSessionCreated(session);
      return json({ session }, 201);
    }
    const session = path.match(/^\/api\/v1\/sessions\/([^/]+)$/);
    if (session && request.method === "GET") {
      const value = this.store.getSession(session[1]);
      if (!value) return apiError(404, "SESSION_NOT_FOUND", "Session not found", requestId);
      const events = this.store.eventsBefore(value.id);
      return json({
        session: value,
        events,
        hasMoreEvents: Boolean(events.length && events[0].seq > 1),
        approvals: this.store.pendingApprovals(value.id),
        questions: this.store.pendingQuestions(value.id),
      });
    }
    if (session && request.method === "PATCH") {
      const body = await request.json();
      if (body.title !== undefined) {
        this.store.updateSession(session[1], {
          title: String(body.title).trim().slice(0, 120) || "Untitled",
        });
      }
      if (body.archived === true) this.store.archiveSession(session[1]);
      return json({ session: this.store.getSession(session[1]) });
    }

    const turns = path.match(/^\/api\/v1\/sessions\/([^/]+)\/turns$/);
    if (turns && request.method === "POST") {
      const key = request.headers.get("idempotency-key");
      if (!key) return apiError(400, "MISSING_IDEMPOTENCY_KEY", "Idempotency-Key is required", requestId);
      const input = startTurnInputSchema.parse(await request.json());
      return json(this.scheduler.enqueue(turns[1], key, input), 202);
    }
    const cancel = path.match(/^\/api\/v1\/sessions\/([^/]+)\/cancel$/);
    if (cancel && request.method === "POST") return json({ cancelled: this.scheduler.cancel(cancel[1]) });

    const approval = path.match(/^\/api\/v1\/approvals\/([^/]+)\/resolve$/);
    if (approval && request.method === "POST") {
      const decision = approvalDecisionSchema.parse(await request.json());
      if (!this.scheduler.resolveApproval(approval[1], decision)) {
        return apiError(409, "STALE_APPROVAL", "Approval is no longer pending", requestId);
      }
      return json({ ok: true });
    }
    const question = path.match(/^\/api\/v1\/questions\/([^/]+)\/resolve$/);
    if (question && request.method === "POST") {
      const answer = questionAnswerSchema.parse(await request.json());
      if (!this.scheduler.resolveQuestion(question[1], answer)) {
        return apiError(409, "STALE_QUESTION", "Question is no longer pending", requestId);
      }
      return json({ ok: true });
    }

    const eventPath = path.match(/^\/api\/v1\/sessions\/([^/]+)\/events$/);
    if (eventPath && request.method === "GET") {
      const beforeValue = url.searchParams.get("before");
      if (beforeValue !== null) {
        const before = Number(beforeValue);
        const events = this.store.eventsBefore(eventPath[1], before, 2000);
        return json({ events, hasMore: Boolean(events.length && events[0].seq > 1) });
      }
      const after = Number(url.searchParams.get("after") ?? 0);
      const events = this.store.events(eventPath[1], after, 2001);
      return json({ events: events.slice(0, 2000), hasMore: events.length > 2000 });
    }
    const diffPath = path.match(/^\/api\/v1\/sessions\/([^/]+)\/diff$/);
    if (diffPath && request.method === "GET") return await this.diff(diffPath[1]);

    if (path === "/api/v1/attachments" && request.method === "POST") {
      return await this.upload(request, requestId);
    }
    const attachment = path.match(/^\/api\/v1\/attachments\/([^/]+)$/);
    if (attachment && request.method === "DELETE") {
      const file = this.store.deleteAttachment(attachment[1]);
      if (!file) return apiError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found", requestId);
      await Deno.remove(file).catch(() => undefined);
      return json({ ok: true });
    }

    return apiError(404, "NOT_FOUND", "API route not found", requestId);
  }

  private async websocket(request: Request, requestId: string): Promise<Response> {
    const device = await this.auth.authenticate(request);
    if (!device) return apiError(401, "UNAUTHENTICATED", "Pair this device first", requestId);
    if (!sameHostOrigin(request)) return apiError(403, "BAD_ORIGIN", "Origin is not allowed", requestId);
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return apiError(426, "UPGRADE_REQUIRED", "WebSocket required", requestId);
    }
    const { socket, response } = Deno.upgradeWebSocket(request);
    const state: SocketState = { socket, deviceId: device.id, sessions: new Set() };
    socket.onopen = () => {
      this.#sockets.add(state);
      sendWebSocket(socket, JSON.stringify({ type: "ready", serverTime: new Date().toISOString() }));
    };
    socket.onclose = () => this.#sockets.delete(state);
    socket.onerror = () => this.#sockets.delete(state);
    socket.onmessage = (event) => {
      let value: unknown;
      try {
        value = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const message = parseWsClientMessage(value);
      if (!message) return;
      if (message.type === "ping") return void sendWebSocket(socket, JSON.stringify({ type: "pong" }));
      if (message.type === "subscribe") {
        for (const [sessionId, cursor] of Object.entries(message.cursors)) {
          state.sessions.add(sessionId);
          const events = this.store.events(sessionId, cursor, 2001);
          if (events.length > 2000) {
            sendWebSocket(socket, JSON.stringify({ type: "resync_required", sessionId }));
          } else {
            for (const replay of events) {
              if (!sendWebSocket(socket, JSON.stringify({ type: "event", event: replay }))) break;
            }
          }
        }
      }
    };
    return response;
  }

  private async upload(request: Request, requestId: string): Promise<Response> {
    const form = await readFormDataBounded(request);
    const file = form.get("file");
    if (!(file instanceof File)) return apiError(400, "FILE_REQUIRED", "A file is required", requestId);
    const contents = new Uint8Array(await file.arrayBuffer());
    const allowedImage = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type);
    const text = isUtf8TextAttachment(file, contents);
    const limit = allowedImage ? 10 * 1024 * 1024 : text ? 2 * 1024 * 1024 : 0;
    if (!limit || file.size > limit) {
      return apiError(413, "UNSUPPORTED_ATTACHMENT", "Unsupported file type or file is too large", requestId);
    }
    const id = crypto.randomUUID();
    const directory = join(this.config.dataDir, "attachments");
    await Deno.mkdir(directory, { recursive: true });
    const destination = join(directory, id);
    await Deno.writeFile(destination, contents, { createNew: true });
    let value;
    try {
      value = this.store.createAttachment({
        sessionId: form.get("sessionId") ? String(form.get("sessionId")) : null,
        name: file.name.slice(0, 240),
        mediaType: file.type,
        size: file.size,
        path: destination,
      });
    } catch (error) {
      await Deno.remove(destination).catch(() => undefined);
      throw error;
    }
    return json({ attachment: value }, 201);
  }

  private async diff(sessionId: string) {
    const session = this.store.getSessionWithProject(sessionId);
    if (!session) return json({ diff: "", error: "Session not found" }, 404);
    try {
      const project = await validateProjectPath(session.projectPath, this.config.allowedRoots);
      return json({ ...(await workingTreeDiff(project.path)), scope: "working-tree" });
    } catch (error) {
      return json({ diff: "", error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async staticFile(request: Request, pathname: string): Promise<Response> {
    const safePath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
    let path = join(this.config.webDir, safePath === "/" ? "index.html" : safePath);
    try {
      const info = await Deno.stat(path);
      if (info.isDirectory) path = join(path, "index.html");
      const body = await Deno.readFile(path);
      return staticResponse(body, extname(path));
    } catch {
      if (extname(pathname) || !request.headers.get("accept")?.includes("text/html")) {
        return new Response("Not found", { status: 404 });
      }
      try {
        const body = await Deno.readFile(join(this.config.webDir, "index.html"));
        return staticResponse(body, ".html");
      } catch {
        return new Response("KOAN web build not found. Run `pnpm build` first.", { status: 503 });
      }
    }
  }
}

const MAX_DIFF_BYTES = 5 * 1024 * 1024;
const MAX_UNTRACKED_FILE_BYTES = 1024 * 1024;
const MAX_UPLOAD_BODY_BYTES = 11 * 1024 * 1024;
const SAFE_GIT_CONFIG = ["-c", "core.fsmonitor=false"];
const TEXT_EXTENSIONS = new Set([
  ".bash",
  ".c",
  ".cjs",
  ".cpp",
  ".css",
  ".env",
  ".gql",
  ".go",
  ".graphql",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".md",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
]);
const TEXT_FILENAMES = new Set([
  ".env",
  ".gitignore",
  ".npmrc",
  ".prettierignore",
  "dockerfile",
  "makefile",
]);

export function isUtf8TextAttachment(file: File, contents: Uint8Array): boolean {
  const mediaType = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  const identifiedAsText = mediaType.startsWith("text/") ||
    ["application/json", "application/xml"].includes(mediaType) ||
    TEXT_EXTENSIONS.has(extname(name)) || TEXT_FILENAMES.has(name);
  if (!identifiedAsText || contents.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(contents);
    return true;
  } catch {
    return false;
  }
}

export async function readFormDataBounded(
  request: Request,
  maxBytes = MAX_UPLOAD_BODY_BYTES,
): Promise<FormData> {
  const body = await readBodyBounded(request, maxBytes, "UPLOAD_TOO_LARGE");
  return await new Response(body, {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  }).formData();
}

export async function readJsonBounded(request: Request, maxBytes = 4096): Promise<unknown> {
  const body = await readBodyBounded(request, maxBytes, "REQUEST_BODY_TOO_LARGE");
  return JSON.parse(new TextDecoder().decode(body));
}

async function readBodyBounded(
  request: Request,
  maxBytes: number,
  tooLarge: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error(tooLarge);
  if (!request.body) throw new Error("FILE_REQUIRED");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(tooLarge);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

export function parseWsClientMessage(value: unknown): WsClientMessage | null {
  if (!isRecord(value)) return null;
  if (value.type === "ping") return { type: "ping" };
  if (value.type !== "subscribe" || !isRecord(value.cursors)) return null;
  const cursors: Record<string, number> = {};
  for (const [sessionId, cursor] of Object.entries(value.cursors)) {
    if (typeof cursor !== "number" || !Number.isSafeInteger(cursor) || cursor < 0) return null;
    cursors[sessionId] = cursor;
  }
  return { type: "subscribe", cursors };
}

export async function workingTreeDiff(cwd: string): Promise<{ diff: string; truncated: boolean }> {
  let remaining = MAX_DIFF_BYTES;
  let truncated = false;
  const sections: string[] = [];
  const append = (heading: string, value: string, wasTruncated = false) => {
    if (!value && !wasTruncated) return;
    const prefix = `## ${heading}\n`;
    const available = Math.max(0, remaining - new TextEncoder().encode(prefix).length);
    const bytes = new TextEncoder().encode(value);
    const part = new TextDecoder().decode(bytes.slice(0, available));
    sections.push(prefix + part);
    remaining -= new TextEncoder().encode(prefix + part).length;
    truncated ||= wasTruncated || bytes.length > available;
  };

  const staged = await gitOutput(
    cwd,
    ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--"],
    remaining,
  );
  append("Staged", staged.text, staged.truncated);
  const unstaged = await gitOutput(cwd, ["diff", "--no-ext-diff", "--no-textconv", "--"], remaining);
  append("Unstaged", unstaged.text, unstaged.truncated);

  const untracked = await gitNullDelimitedOutput(
    cwd,
    ["ls-files", "--others", "--exclude-standard", "-z", "--"],
    remaining,
  );
  truncated ||= untracked.truncated;
  for (const path of untracked.values) {
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const info = await lstatIfExists(join(cwd, path));
    if (!info) continue;
    if (!info.isFile || info.size > MAX_UNTRACKED_FILE_BYTES) {
      append(
        "Untracked",
        `${path} (${info.isFile ? `${info.size} bytes, content omitted` : "not a file"})\n`,
      );
      continue;
    }
    const output = await gitOutput(
      cwd,
      ["diff", "--no-index", "--no-ext-diff", "--no-textconv", "--", "/dev/null", path],
      remaining,
      [0, 1],
    );
    append("Untracked", output.text, output.truncated);
  }
  if (truncated) sections.push("\n## Output truncated\nThe working-tree diff exceeded 5 MiB.\n");
  return { diff: sections.join("\n"), truncated };
}

export async function lstatIfExists(path: string): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

export function pairingRateLimitKeys(request: Request, peerAddress: string): string[] {
  const keys = [`peer:${peerAddress}`];
  if (isLoopbackAddress(peerAddress)) {
    const tailscaleLogin = request.headers.get("tailscale-user-login")?.trim().toLowerCase();
    if (tailscaleLogin) keys.push(`tailscale-user:${tailscaleLogin}`);
  }
  return keys;
}

function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "::1" || normalized.startsWith("127.") ||
    normalized.startsWith("::ffff:127.");
}

async function gitOutput(
  cwd: string,
  args: string[],
  limit: number,
  acceptedCodes = [0],
): Promise<{ text: string; truncated: boolean }> {
  if (limit <= 0) return { text: "", truncated: true };
  const child = new Deno.Command("git", {
    args: [...SAFE_GIT_CONFIG, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const stderr = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const available = limit - size;
    if (value.length > available) {
      chunks.push(value.slice(0, Math.max(0, available)));
      truncated = true;
      try {
        child.kill("SIGTERM");
      } catch { /* already exited */ }
      break;
    }
    chunks.push(value);
    size += value.length;
  }
  const status = await child.status;
  const error = await stderr;
  if (!truncated && !acceptedCodes.includes(status.code)) {
    throw new Error(error || `git exited with ${status.code}`);
  }
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { text: new TextDecoder().decode(bytes), truncated };
}

async function gitNullDelimitedOutput(
  cwd: string,
  args: string[],
  limit: number,
): Promise<{ values: string[]; truncated: boolean }> {
  if (limit <= 0) return { values: [], truncated: true };
  const child = new Deno.Command("git", {
    args: [...SAFE_GIT_CONFIG, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const stderr = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  const values: string[] = [];
  let pending = "";
  let size = 0;
  let truncated = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const available = limit - size;
    const chunk = value.slice(0, Math.max(0, available));
    size += chunk.length;
    pending += decoder.decode(chunk, { stream: true });
    const parts = pending.split("\0");
    pending = parts.pop() ?? "";
    values.push(...parts.filter(Boolean));
    if (chunk.length < value.length || size >= limit) {
      truncated = true;
      try {
        child.kill("SIGTERM");
      } catch { /* already exited */ }
      break;
    }
  }
  pending += decoder.decode();
  if (!truncated && pending) values.push(pending);
  const status = await child.status;
  const error = await stderr;
  if (!truncated && !status.success) throw new Error(error || `git exited with ${status.code}`);
  return { values, truncated };
}

function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function apiError(status: number, code: string, message: string, requestId: string) {
  return json({ error: { code, message, requestId } }, status);
}

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function staticResponse(body: Uint8Array<ArrayBuffer>, extension: string): Response {
  if (extension !== ".html") return new Response(body, { headers: staticHeaders(extension) });
  const nonce = crypto.randomUUID();
  const html = new TextDecoder().decode(body).replace(
    /<script(?![^>]*\bnonce=)(?=[\s>])/g,
    `<script nonce="${nonce}"`,
  );
  return new Response(html, { headers: staticHeaders(extension, nonce) });
}

function staticHeaders(extension: string, nonce?: string): HeadersInit {
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
  };
  return {
    "content-type": types[extension] ?? "application/octet-stream",
    "cache-control": extension === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": `default-src 'self'; script-src 'self'${
      nonce ? ` 'nonce-${nonce}'` : ""
    }; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
  };
}
