import type { GatewayEvent, Session, WsServerMessage } from "@koan/protocol";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "./api";

type LiveContextValue = {
  connected: boolean;
  events: Record<string, GatewayEvent[]>;
  sessions: Session[];
  subscribe: (sessionId: string, initial?: GatewayEvent[]) => () => void;
  notices: Array<{ id: string; sessionId: string; text: string }>;
  dismissNotice: (id: string) => void;
};

const LiveContext = createContext<LiveContextValue | null>(null);

const CURSORS_KEY = "koan-event-cursors";
const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;
export const MAX_ACTIVE_SESSION_EVENTS = 2000;

export function LiveProvider(
  { children, sessions }: { children: React.ReactNode; sessions: Session[] },
) {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<Record<string, GatewayEvent[]>>({});
  const eventsRef = useRef<Record<string, GatewayEvent[]>>({});
  const [liveSessions, setLiveSessions] = useState(sessions);
  const [notices, setNotices] = useState<
    Array<{ id: string; sessionId: string; text: string }>
  >([]);
  const socketRef = useRef<WebSocket | null>(null);
  const cursorsRef = useRef<Record<string, number>>(storedCursors());
  const eventSeqsRef = useRef<Record<string, Set<number>>>({});
  const activeSessionRef = useRef<string | null>(null);

  const mergeEvents = useCallback((incoming: GatewayEvent[], bounded = true) => {
    if (!incoming.length) return;
    setLiveSessions((current) =>
      current.map((session) => {
        const latest = incoming
          .filter((event) =>
            event.sessionId === session.id && event.seq > session.lastSeq
          )
          .sort((a, b) => b.seq - a.seq)[0];
        if (!latest) return session;
        const statusEvent = incoming
          .filter((event) =>
            event.sessionId === session.id && event.type === "session.status"
          )
          .sort((a, b) => b.seq - a.seq)[0];
        const titleEvent = incoming
          .filter((event) =>
            event.sessionId === session.id && event.type === "message.user" &&
            event.payload.sessionTitle
          )
          .sort((a, b) => b.seq - a.seq)[0];
        return {
          ...session,
          ...(statusEvent
            ? { status: statusEvent.payload.status as Session["status"] }
            : {}),
          ...(titleEvent
            ? { title: String(titleEvent.payload.sessionTitle) }
            : {}),
          lastSeq: latest.seq,
          updatedAt: latest.createdAt,
        };
      }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    );
    const retained = retainActiveSessionEvents(incoming, activeSessionRef.current);
    if (!retained.length) return;
    const next = mergeEventBatch(
      eventsRef.current,
      retained,
      eventSeqsRef.current,
      bounded ? MAX_ACTIVE_SESSION_EVENTS : undefined,
    );
    if (next === eventsRef.current) return;
    eventsRef.current = next;
    setEvents(next);
  }, []);

  const updateCursor = useCallback((sessionId: string, seq: number) => {
    cursorsRef.current[sessionId] = Math.max(
      cursorsRef.current[sessionId] ?? 0,
      seq,
    );
    persistCursors(cursorsRef.current);
  }, []);

  const resync = useCallback(async (sessionId: string) => {
    let hasMore = true;
    let after = cursorsRef.current[sessionId] ?? 0;
    while (hasMore) {
      const result = await api.eventsAfter(sessionId, after);
      mergeEvents(result.events);
      const last = result.events.at(-1);
      if (last) {
        after = last.seq;
        updateCursor(sessionId, last.seq);
      }
      hasMore = result.hasMore && result.events.length > 0;
    }
  }, [mergeEvents, updateCursor]);

  const connect = useCallback(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    let opened = false;
    let resyncing = false;
    let lastMessageAt = Date.now();
    let heartbeat: number | undefined;
    socketRef.current = socket;
    socket.onopen = () => {
      opened = true;
      lastMessageAt = Date.now();
      setConnected(true);
      socket.send(
        JSON.stringify({ type: "subscribe", cursors: cursorsRef.current }),
      );
      void api.sessions().then(({ sessions }) => {
        if (
          socketRef.current !== socket || socket.readyState !== WebSocket.OPEN
        ) return;
        setLiveSessions((current) =>
          reconcileSessionSnapshots(current, sessions)
        );
        const missing = missingSessionCursors(cursorsRef.current, sessions);
        for (const [sessionId, cursor] of Object.entries(missing)) {
          updateCursor(sessionId, cursor);
        }
        if (Object.keys(missing).length) {
          socket.send(JSON.stringify({ type: "subscribe", cursors: missing }));
        }
      }).catch(() => undefined);
      heartbeat = window.setInterval(() => {
        if (
          socketRef.current !== socket || socket.readyState !== WebSocket.OPEN
        ) return;
        if (websocketHeartbeatExpired(lastMessageAt)) {
          clearInterval(heartbeat);
          setConnected(false);
          socket.close();
          window.setTimeout(() => {
            if (socketRef.current === socket) connect();
          }, 1500);
          return;
        }
        socket.send(JSON.stringify({ type: "ping" }));
      }, HEARTBEAT_INTERVAL_MS);
    };
    socket.onmessage = (message) => {
      lastMessageAt = Date.now();
      const data = JSON.parse(String(message.data)) as WsServerMessage;
      if (data.type === "session.created") {
        const session = data.session;
        setLiveSessions((current) => upsertSession(current, session));
        updateCursor(session.id, session.lastSeq);
        socket.send(JSON.stringify({
          type: "subscribe",
          cursors: { [session.id]: session.lastSeq },
        }));
        void api.sessions().then(({ sessions }) =>
          setLiveSessions((current) =>
            reconcileSessionSnapshots(current, sessions)
          )
        ).catch(() => undefined);
        return;
      }
      if (data.type === "event") {
        const event = data.event;
        updateCursor(event.sessionId, event.seq);
        mergeEvents([event]);
        if (
          [
            "turn.completed",
            "approval.requested",
            "question.requested",
            "turn.failed",
          ].includes(event.type) &&
          !location.pathname.endsWith(`/sessions/${event.sessionId}`)
        ) {
          const text = event.type === "turn.completed"
            ? "Agent finished a turn"
            : event.type === "approval.requested"
            ? "Agent needs approval"
            : event.type === "question.requested"
            ? "Agent has a question"
            : "Agent turn failed";
          setNotices((
            current,
          ) => [
            ...current.filter((item) => item.sessionId !== event.sessionId),
            {
              id: `${event.sessionId}-${event.seq}`,
              sessionId: event.sessionId,
              text,
            },
          ]);
        }
      }
      if (data.type === "resync_required" && !resyncing) {
        resyncing = true;
        clearInterval(heartbeat);
        socket.close();
        void recoverEventResync(
          () => resync(data.sessionId),
          () => {
            if (socketRef.current === socket) connect();
          },
        );
      }
    };
    socket.onclose = (event) => {
      clearInterval(heartbeat);
      setConnected(false);
      if (socketRef.current !== socket) return;
      if (resyncing) return;
      void websocketRecovery(event.code, opened).then((action) => {
        if (socketRef.current !== socket) return;
        if (action === "pair") {
          socketRef.current = null;
          location.assign("/pair");
          return;
        }
        window.setTimeout(() => {
          if (socketRef.current === socket) connect();
        }, 1500);
      });
    };
  }, [mergeEvents, resync, updateCursor]);

  useEffect(() => {
    let changed = false;
    for (const session of sessions) {
      if (cursorsRef.current[session.id] !== undefined) continue;
      cursorsRef.current[session.id] = session.lastSeq;
      changed = true;
    }
    if (changed) {
      globalThis.localStorage?.setItem(
        CURSORS_KEY,
        JSON.stringify(cursorsRef.current),
      );
    }
  }, [sessions]);

  useEffect(() => {
    setLiveSessions((current) => reconcileSessionSnapshots(current, sessions));
  }, [sessions]);

  useEffect(() => {
    connect();
    return () => {
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
    };
  }, [connect]);

  const subscribe = useCallback(
    (sessionId: string, initial: GatewayEvent[] = []) => {
      const activating = activeSessionRef.current !== sessionId;
      if (activating) {
        activeSessionRef.current = sessionId;
        const existing = eventsRef.current[sessionId];
        eventsRef.current = existing ? { [sessionId]: existing } : {};
        eventSeqsRef.current = existing
          ? { [sessionId]: new Set(existing.map((event) => event.seq)) }
          : {};
        setEvents(eventsRef.current);
      }
      const lastSeq = subscriptionCursor(
        cursorsRef.current[sessionId] ?? 0,
        initial.at(-1)?.seq,
        activating,
      );
      cursorsRef.current[sessionId] = lastSeq;
      mergeEvents(initial, false);
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: "subscribe",
            cursors: { [sessionId]: lastSeq },
          }),
        );
      }
      return () => {
        if (activeSessionRef.current !== sessionId) return;
        activeSessionRef.current = null;
        eventsRef.current = {};
        eventSeqsRef.current = {};
        setEvents({});
      };
    },
    [mergeEvents],
  );

  const dismissNotice = useCallback(
    (id: string) =>
      setNotices((current) => current.filter((item) => item.id !== id)),
    [],
  );
  return (
    <LiveContext
      value={{
        connected,
        events,
        sessions: liveSessions,
        subscribe,
        notices,
        dismissNotice,
      }}
    >
      {children}
    </LiveContext>
  );
}

export function mergeEventBatch(
  current: Record<string, GatewayEvent[]>,
  incoming: GatewayEvent[],
  indexes: Record<string, Set<number>>,
  maxEvents?: number,
): Record<string, GatewayEvent[]> {
  const additions = new Map<string, GatewayEvent[]>();
  for (const event of incoming) {
    const existing = current[event.sessionId] ?? [];
    const index = indexes[event.sessionId] ??= new Set(
      existing.map((item) => item.seq),
    );
    if (index.has(event.seq)) continue;
    index.add(event.seq);
    const group = additions.get(event.sessionId) ?? [];
    group.push(event);
    additions.set(event.sessionId, group);
  }
  if (!additions.size) return current;
  const next = { ...current };
  for (const [sessionId, events] of additions) {
    const existing = current[sessionId] ?? [];
    let previous = existing.at(-1)?.seq ?? 0;
    const appendOnly = events.every((event) => {
      const ordered = event.seq > previous;
      previous = event.seq;
      return ordered;
    });
    const merged = appendOnly
      ? [...existing, ...events]
      : [...existing, ...events].sort((a, b) => a.seq - b.seq);
    next[sessionId] = maxEvents && merged.length > maxEvents
      ? merged.slice(-maxEvents)
      : merged;
    if (next[sessionId].length !== merged.length) {
      indexes[sessionId] = new Set(next[sessionId].map((event) => event.seq));
    }
  }
  return next;
}

export function retainActiveSessionEvents(
  incoming: GatewayEvent[],
  activeSessionId: string | null,
): GatewayEvent[] {
  return activeSessionId
    ? incoming.filter((event) => event.sessionId === activeSessionId)
    : [];
}

export function subscriptionCursor(
  storedCursor: number,
  initialLastSeq: number | undefined,
  activating: boolean,
): number {
  return activating && initialLastSeq !== undefined
    ? initialLastSeq
    : Math.max(storedCursor, initialLastSeq ?? 0);
}

export function shouldReconnectWebSocket(closeCode: number): boolean {
  return closeCode !== 4001;
}

export function websocketHeartbeatExpired(
  lastMessageAt: number,
  now = Date.now(),
  timeoutMs = HEARTBEAT_TIMEOUT_MS,
): boolean {
  return now - lastMessageAt > timeoutMs;
}

export function upsertSession(current: Session[], session: Session): Session[] {
  return [session, ...current.filter((item) => item.id !== session.id)]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function reconcileSessionSnapshots(
  current: Session[],
  snapshots: Session[],
): Session[] {
  return snapshots.map((session) => {
    const live = current.find((item) => item.id === session.id);
    return live && live.lastSeq > session.lastSeq ? live : session;
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function missingSessionCursors(
  cursors: Record<string, number>,
  sessions: Session[],
): Record<string, number> {
  return Object.fromEntries(
    sessions.filter((session) => cursors[session.id] === undefined)
      .map((session) => [session.id, session.lastSeq]),
  );
}

export async function websocketRecovery(
  closeCode: number,
  opened: boolean,
  authenticate: typeof api.authStatus = api.authStatus,
): Promise<"pair" | "reconnect"> {
  if (!shouldReconnectWebSocket(closeCode)) return "pair";
  if (opened) return "reconnect";
  try {
    return (await authenticate()).paired ? "reconnect" : "pair";
  } catch {
    return "reconnect";
  }
}

export async function recoverEventResync(
  resync: () => Promise<void>,
  reconnect: () => void,
  scheduleRetry: (callback: () => void, delay: number) => unknown =
    window.setTimeout,
): Promise<void> {
  try {
    await resync();
    reconnect();
  } catch {
    scheduleRetry(reconnect, 1500);
  }
}

function storedCursors(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(CURSORS_KEY) ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function persistCursors(
  cursors: Record<string, number>,
  storage?: Pick<Storage, "setItem">,
): void {
  try {
    (storage ?? globalThis.localStorage)?.setItem(CURSORS_KEY, JSON.stringify(cursors));
  } catch { /* cursor persistence must not interrupt live events */ }
}

export function useLive() {
  const value = useContext(LiveContext);
  if (!value) throw new Error("useLive must be used inside LiveProvider");
  return value;
}
