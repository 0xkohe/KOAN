import type {
  AgentId,
  AgentModelOption,
  AgentState,
  Approval,
  ApprovalDecision,
  Attachment,
  GatewayEvent,
  Project,
  QuestionAnswer,
  QuestionRequest,
  Session,
  StartTurnInput,
} from "@koan/protocol";

type FetchOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, unknown> | null;
};

async function request<T>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const body = options.body && !(options.body instanceof FormData) &&
      typeof options.body !== "string"
    ? JSON.stringify(options.body)
    : options.body;
  const response = await fetch(path, {
    ...options,
    body: body as BodyInit | null | undefined,
    headers: {
      ...(body && !(body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
      ...(!["GET", "HEAD"].includes(options.method ?? "GET")
        ? { "x-koan-csrf": "1" }
        : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !location.pathname.startsWith("/pair")) {
      location.assign("/pair");
    }
    throw new Error(
      data.error?.message ?? `Request failed (${response.status})`,
    );
  }
  return data as T;
}

export const api = {
  authStatus: () =>
    request<{ paired: boolean; device: { id: string; name: string } | null }>(
      "/api/v1/auth/status",
    ),
  pair: (code: string, name: string) =>
    request<{ device: { id: string; name: string } }>("/api/v1/auth/pair", {
      method: "POST",
      body: { code, name },
    }),
  logout: () => request("/api/v1/auth/logout", { method: "POST" }),
  newPairingCode: () =>
    request<{ code: string; expiresAt: string }>("/api/v1/auth/pairing-code", {
      method: "POST",
    }),
  devices: () =>
    request<
      {
        devices: Array<
          { id: string; name: string; createdAt: string; lastSeenAt: string }
        >;
      }
    >("/api/v1/devices"),
  revokeDevice: (id: string) =>
    request(`/api/v1/devices/${id}`, { method: "DELETE" }),
  agents: () => request<{ agents: AgentState[] }>("/api/v1/agents"),
  agentModels: (agentId: AgentId, projectId: string) =>
    request<{ models: AgentModelOption[] }>(
      `/api/v1/agents/${agentId}/models?projectId=${encodeURIComponent(projectId)}`,
    ),
  roots: () => request<{ roots: string[] }>("/api/v1/roots"),
  projects: () => request<{ projects: Project[] }>("/api/v1/projects"),
  project: (id: string) =>
    request<{ project: Project; sessions: Session[] }>(
      `/api/v1/projects/${id}`,
    ),
  createProject: (path: string, name?: string) =>
    request<{ project: Project }>("/api/v1/projects", {
      method: "POST",
      body: { path, name },
    }),
  sessions: () => request<{ sessions: Session[] }>("/api/v1/sessions"),
  session: (id: string) =>
    request<
      {
        session: Session;
        events: GatewayEvent[];
        hasMoreEvents: boolean;
        approvals: Approval[];
        questions: QuestionRequest[];
      }
    >(`/api/v1/sessions/${id}`),
  eventsAfter: (id: string, after: number) =>
    request<{ events: GatewayEvent[]; hasMore: boolean }>(
      `/api/v1/sessions/${id}/events?after=${after}`,
    ),
  eventsBefore: (id: string, before: number) =>
    request<{ events: GatewayEvent[]; hasMore: boolean }>(
      `/api/v1/sessions/${id}/events?before=${before}`,
    ),
  createSession: (
    projectId: string,
    agentId: string,
    model?: string,
    mode?: string,
    autoApprove = false,
  ) =>
    request<{ session: Session }>("/api/v1/sessions", {
      method: "POST",
      body: {
        projectId,
        agentId,
        model: model || undefined,
        mode: mode || undefined,
        autoApprove,
      },
    }),
  renameSession: (id: string, title: string) =>
    request(`/api/v1/sessions/${id}`, { method: "PATCH", body: { title } }),
  startTurn: (id: string, input: StartTurnInput, idempotencyKey: string) =>
    request<{ turnId: string }>(`/api/v1/sessions/${id}/turns`, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: input,
    }),
  cancel: (id: string) =>
    request(`/api/v1/sessions/${id}/cancel`, { method: "POST" }),
  resolveApproval: (id: string, decision: ApprovalDecision) =>
    request(`/api/v1/approvals/${id}/resolve`, {
      method: "POST",
      body: decision,
    }),
  resolveQuestion: (id: string, answer: QuestionAnswer) =>
    request(`/api/v1/questions/${id}/resolve`, {
      method: "POST",
      body: answer,
    }),
  diff: (id: string) =>
    request<{ diff: string; scope?: string; error?: string }>(
      `/api/v1/sessions/${id}/diff`,
    ),
  upload: async (file: File, sessionId?: string): Promise<Attachment> => {
    const form = new FormData();
    form.set("file", file);
    if (sessionId) form.set("sessionId", sessionId);
    return (await request<{ attachment: Attachment }>("/api/v1/attachments", {
      method: "POST",
      body: form,
    })).attachment;
  },
  deleteAttachment: (id: string) =>
    request(`/api/v1/attachments/${id}`, { method: "DELETE" }),
};
