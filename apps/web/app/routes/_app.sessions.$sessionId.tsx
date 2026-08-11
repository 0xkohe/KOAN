import type {
  Approval,
  Attachment,
  GatewayEvent,
  QuestionRequest,
} from "@koan/protocol";
import {
  ArrowLeft,
  GitCompareArrows,
  Paperclip,
  Send,
  Square,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLoaderData } from "react-router";
import { ApprovalSheet } from "../components/approval-sheet";
import { Message, type TimelineItem } from "../components/message";
import { QuestionSheet } from "../components/question-sheet";
import { api } from "../lib/api";
import { useLive } from "../lib/live";

export async function clientLoader(
  { params }: { params: { sessionId?: string } },
) {
  return api.session(params.sessionId!);
}

export function meta(
  { data }: { data?: Awaited<ReturnType<typeof clientLoader>> },
) {
  return [{ title: `${data?.session.title ?? "Session"} — KOAN` }];
}

export default function SessionPage() {
  const initial = useLoaderData<typeof clientLoader>();
  return <SessionContent key={initial.session.id} initial={initial} />;
}

function SessionContent(
  { initial }: { initial: Awaited<ReturnType<typeof clientLoader>> },
) {
  const { t } = useTranslation();
  const { subscribe, events: liveEvents, connected, sessions } = useLive();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [locallyResolvedApprovals, setLocallyResolvedApprovals] = useState<
    Set<string>
  >(
    () => new Set(),
  );
  const [locallyResolvedQuestions, setLocallyResolvedQuestions] = useState<
    Set<string>
  >(
    () => new Set(),
  );
  const [hasMoreEvents, setHasMoreEvents] = useState(initial.hasMoreEvents);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const visibleTailRef = useRef({ sessionId: "", seq: 0 });
  const idempotencyKeyRef = useRef<string | null>(null);
  const events = liveEvents[initial.session.id] ?? initial.events;
  useEffect(() => subscribe(initial.session.id, initial.events), [
    initial.session.id,
    initial.events,
    subscribe,
  ]);
  const tailSeq = eventTailSequence(events);
  useEffect(() => {
    const lastEvent = events.at(-1);
    const previous = visibleTailRef.current;
    const tailAdvanced = previous.sessionId !== initial.session.id ||
      (lastEvent?.seq ?? 0) > previous.seq;
    visibleTailRef.current = {
      sessionId: initial.session.id,
      seq: lastEvent?.seq ?? 0,
    };
    if (tailAdvanced) {
      endRef.current?.scrollIntoView({
        behavior: lastEvent?.type.includes("delta") ? "auto" : "smooth",
      });
    }
  }, [initial.session.id, tailSeq]);
  const timeline = useMemo(() => buildTimeline(events), [events]);
  const currentSession = sessions.find((session) =>
    session.id === initial.session.id
  );
  const status = resolveSessionStatus(
    currentSession?.status,
    events,
    initial.session.status,
  );
  const running = ["running", "queued", "waiting_approval", "waiting_input"]
    .includes(status);
  const approval = useMemo(
    () => activeApproval(events, initial.approvals, locallyResolvedApprovals),
    [events, initial.approvals, locallyResolvedApprovals],
  );
  const question = useMemo(
    () => activeQuestion(events, initial.questions, locallyResolvedQuestions),
    [events, initial.questions, locallyResolvedQuestions],
  );
  const title = currentSession?.title ?? initial.session.title;
  const canLoadOlder = hasMoreEvents ||
    Boolean(events.length && events[0].seq > 1);

  async function send() {
    if (!canSubmitTurn(text, sending, uploading, running)) return;
    setSending(true);
    const prompt = text;
    const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();
    idempotencyKeyRef.current = idempotencyKey;
    setText("");
    try {
      await api.startTurn(initial.session.id, {
        text: prompt,
        attachmentIds: attachments.map((item) => item.id),
      }, idempotencyKey);
      idempotencyKeyRef.current = null;
      setAttachments([]);
    } catch (error) {
      setText(prompt);
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  }
  async function addFiles(files: FileList | null) {
    if (!files) return;
    const selected = [...files].slice(0, 5 - attachments.length);
    if (!selected.length) return;
    setUploading(true);
    try {
      for (const file of selected) {
        try {
          const uploaded = await api.upload(file, initial.session.id);
          idempotencyKeyRef.current = null;
          setAttachments((current) => [...current, uploaded]);
        } catch (error) {
          alert(error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      setUploading(false);
    }
  }
  async function showDiff() {
    const result = await api.diff(initial.session.id);
    setDiff(result.diff);
    setDiffError(result.error ?? null);
  }
  async function removeAttachment(file: Attachment) {
    try {
      await api.deleteAttachment(file.id);
      idempotencyKeyRef.current = null;
      setAttachments((items) => items.filter((item) => item.id !== file.id));
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  }
  async function loadOlder() {
    const first = events[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const result = await api.eventsBefore(initial.session.id, first.seq);
      subscribe(initial.session.id, result.events);
      setHasMoreEvents(result.hasMore);
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <div className="chat-page">
      <header className="chat-header">
        <Link to="/" className="icon-button">
          <ArrowLeft size={19} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1>{title}</h1>
          <p>
            {initial.session.projectName} · {initial.session.agentId}
            <span className={`connection-dot ${connected ? "online" : ""}`} />
          </p>
        </div>
        <button
          className="icon-button"
          onClick={showDiff}
          title="Working tree diff"
        >
          <GitCompareArrows size={19} />
        </button>
      </header>
      <div className="message-stream">
        {canLoadOlder && (
          <button
            className="button-secondary mx-auto"
            disabled={loadingOlder}
            onClick={loadOlder}
          >
            {loadingOlder ? "Loading…" : "Load earlier messages"}
          </button>
        )}
        {!timeline.length && (
          <div className="chat-empty">
            <span className="agent-mark large">K</span>
            <h2>What would you like to build?</h2>
            <p>Your agent runs on the PC that hosts this Gateway.</p>
          </div>
        )}
        {timeline.map((item) => <Message key={item.key} item={item} />)}
        {running && !["waiting_approval", "waiting_input"].includes(status) && (
          <div className="working">
            <span />
            <span />
            <span /> {status === "queued" ? "Queued" : "Agent is working"}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="composer-wrap">
        {attachments.length > 0 && (
          <div className="attachment-list">
            {attachments.map((file) => (
              <span key={file.id}>
                {file.name}
                <button onClick={() => void removeAttachment(file)}>
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer">
          <label className="composer-icon">
            <Paperclip size={19} />
            <input
              className="sr-only"
              type="file"
              multiple
              disabled={uploading}
              accept={ATTACHMENT_ACCEPT}
              onChange={(event) => {
                const input = event.currentTarget;
                void addFiles(input.files).finally(() => input.value = "");
              }}
            />
          </label>
          <textarea
            rows={1}
            value={text}
            onChange={(event) => {
              idempotencyKeyRef.current = null;
              setText(event.target.value);
            }}
            placeholder={t("messagePlaceholder")}
            onKeyDown={(event) => {
              if (shouldSubmitComposer(event.nativeEvent)) {
                event.preventDefault();
                void send();
              }
            }}
          />
          {running
            ? (
              <button
                className="send-button stop"
                onClick={() => api.cancel(initial.session.id)}
                title={t("stop")}
              >
                <Square size={14} fill="currentColor" />
              </button>
            )
            : (
              <button
                className="send-button"
                disabled={!text.trim() || sending || uploading}
                onClick={send}
                title={t("send")}
              >
                <Send size={17} />
              </button>
            )}
        </div>
        <p className="composer-note">
          Review agent changes and commands before approving them.
        </p>
      </div>
      {approval && (
        <ApprovalSheet
          approval={approval}
          onResolved={() =>
            setLocallyResolvedApprovals((current) =>
              new Set(current).add(approval.id)
            )}
        />
      )}
      {question && (
        <QuestionSheet
          key={question.id}
          request={question}
          onResolved={() =>
            setLocallyResolvedQuestions((current) =>
              new Set(current).add(question.id)
            )}
        />
      )}
      {diff !== null && (
        <div
          className="drawer-backdrop"
          onClick={() => setDiff(null)}
        >
          <aside
            className="diff-drawer"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">Git working tree</span>
                <h2>Changes</h2>
              </div>
              <button className="icon-button" onClick={() => setDiff(null)}>
                <X size={19} />
              </button>
            </header>
            {diffError
              ? <div className="empty-state error-text">{diffError}</div>
              : diff
              ? <pre className="diff-view">{diff}</pre>
              : <div className="empty-state">No uncommitted changes</div>}
          </aside>
        </div>
      )}
    </div>
  );
}

export function canSubmitTurn(
  text: string,
  sending: boolean,
  uploading: boolean,
  running: boolean,
): boolean {
  return Boolean(text.trim()) && !sending && !uploading && !running;
}

export function shouldSubmitComposer(
  event: Pick<KeyboardEvent, "isComposing" | "key" | "shiftKey">,
): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}

export function resolveSessionStatus(
  liveStatus: string | undefined,
  events: GatewayEvent[],
  initialStatus: string,
): string {
  return liveStatus ??
    [...events].reverse().find((event) => event.type === "session.status")
      ?.payload.status as string ??
    initialStatus;
}

export function eventTailSequence(events: GatewayEvent[]): number {
  return events.at(-1)?.seq ?? 0;
}

export const ATTACHMENT_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/*",
  "application/json",
  "application/xml",
  ".bash",
  ".c",
  ".cjs",
  ".cpp",
  ".env",
  ".gql",
  ".go",
  ".graphql",
  ".h",
  ".hpp",
  ".ini",
  ".java",
  ".js",
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
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
].join(",");

export function buildTimeline(events: GatewayEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const index = new Map<string, number>();
  for (const event of events) {
    const turn = String(event.payload.turnId ?? event.seq);
    if (event.type === "message.user") {
      items.push({
        key: `user-${event.seq}`,
        role: "user",
        text: String(event.payload.text ?? ""),
      });
    }
    if (event.type === "message.assistant.delta") {
      mergeText(
        `assistant-${turn}`,
        "assistant",
        String(event.payload.text ?? ""),
      );
    }
    if (event.type === "agent.thought.delta") {
      mergeText(`thought-${turn}`, "thought", String(event.payload.text ?? ""));
    }
    if (event.type === "message.assistant.completed") {
      const position = index.get(`assistant-${turn}`);
      if (position !== undefined) items[position].complete = true;
    }
    if (event.type === "tool.started") {
      const key = `tool-${String(event.payload.id ?? event.seq)}`;
      index.set(key, items.length);
      items.push({ key, role: "tool", event });
    }
    if (event.type === "tool.updated" || event.type === "tool.completed") {
      const key = `tool-${
        String(event.payload.id ?? event.payload.toolCallId ?? event.seq)
      }`;
      const position = index.get(key);
      if (position !== undefined) {
        const previous = items[position].event;
        items[position] = {
          key,
          role: "tool",
          event: previous
            ? { ...event, payload: { ...previous.payload, ...event.payload } }
            : event,
        };
      } else {
        index.set(key, items.length);
        items.push({ key, role: "tool", event });
      }
    }
    if (
      event.type === "turn.failed" ||
      event.type === "system.notice" && event.payload.level !== "debug" &&
        event.payload.level !== "plan"
    ) items.push({ key: `notice-${event.seq}`, role: "notice", event });
  }
  return items;
  function mergeText(key: string, role: "assistant" | "thought", text: string) {
    const position = index.get(key);
    if (position === undefined || position !== items.length - 1) {
      const segmentKey = position === undefined
        ? key
        : `${key}-${items.length}`;
      index.set(key, items.length);
      items.push({ key: segmentKey, role, text });
    } else items[position].text = (items[position].text ?? "") + text;
  }
}

function activeApproval(
  events: GatewayEvent[],
  initial: Approval[],
  locallyResolved: Set<string>,
): Approval | null {
  const resolved = new Set(locallyResolved);
  for (
    const event of events.filter((event) => event.type === "approval.resolved")
  ) {
    resolved.add(String(event.payload.approvalId));
  }
  const requested = events.filter((event) =>
    event.type === "approval.requested"
  ).map((event) => event.payload as unknown as Approval);
  return [...initial, ...requested].reverse().find((approval) =>
    !resolved.has(approval.id)
  ) ?? null;
}

function activeQuestion(
  events: GatewayEvent[],
  initial: QuestionRequest[],
  locallyResolved: Set<string>,
): QuestionRequest | null {
  const resolved = new Set(locallyResolved);
  for (
    const event of events.filter((event) => event.type === "question.resolved")
  ) {
    resolved.add(String(event.payload.questionId));
  }
  const requested = events.filter((event) =>
    event.type === "question.requested"
  ).map((event) => event.payload as unknown as QuestionRequest);
  return [...initial, ...requested].reverse().find((question) =>
    !resolved.has(question.id)
  ) ?? null;
}
