import { describe, expect, it } from "vitest";
import type { GatewayEvent, Session } from "@koan/protocol";
import {
  mergeEventBatch,
  missingSessionCursors,
  persistCursors,
  reconcileSessionSnapshots,
  recoverEventResync,
  retainActiveSessionEvents,
  shouldReconnectWebSocket,
  subscriptionCursor,
  upsertSession,
  websocketHeartbeatExpired,
  websocketRecovery,
} from "./live";

describe("live events", () => {
  it("appends ordered events and deduplicates them with a sequence index", () => {
    const current = { session: [event(1), event(2)] };
    const indexes: Record<string, Set<number>> = {};

    const next = mergeEventBatch(current, [event(2), event(3)], indexes);

    expect(next.session.map((item) => item.seq)).toEqual([1, 2, 3]);
    expect(indexes.session).toEqual(new Set([1, 2, 3]));
  });

  it("inserts replayed history before newer events", () => {
    const current = { session: [event(3)] };
    const next = mergeEventBatch(current, [event(1), event(2)], {});
    expect(next.session.map((item) => item.seq)).toEqual([1, 2, 3]);
  });

  it("bounds automatically retained events and permits discarded history to be reloaded", () => {
    const indexes: Record<string, Set<number>> = {};
    const bounded = mergeEventBatch(
      {},
      [event(1), event(2), event(3)],
      indexes,
      2,
    );
    expect(bounded.session.map((item) => item.seq)).toEqual([2, 3]);

    const reloaded = mergeEventBatch(bounded, [event(1)], indexes);
    expect(reloaded.session.map((item) => item.seq)).toEqual([1, 2, 3]);
  });

  it("retains detailed events only for the active session", () => {
    const background = { ...event(2), sessionId: "background" };
    expect(retainActiveSessionEvents([event(1), background], "session"))
      .toEqual([event(1)]);
    expect(retainActiveSessionEvents([event(1)], null)).toEqual([]);
  });

  it("replays events received between loading and activating a session", () => {
    expect(subscriptionCursor(12, 10, true)).toBe(10);
    expect(subscriptionCursor(12, 10, false)).toBe(12);
  });

  it("keeps cursor updates in memory when browser persistence fails", () => {
    expect(() =>
      persistCursors({ session: 4 }, {
        setItem: () => {
          throw new DOMException("Storage disabled", "SecurityError");
        },
      })
    ).not.toThrow();
  });

  it("does not reconnect a revoked device", () => {
    expect(shouldReconnectWebSocket(4001)).toBe(false);
    expect(shouldReconnectWebSocket(1006)).toBe(true);
  });

  it("expires WebSockets that stop answering heartbeat pings", () => {
    expect(websocketHeartbeatExpired(1_000, 45_000, 45_000)).toBe(false);
    expect(websocketHeartbeatExpired(1_000, 46_001, 45_000)).toBe(true);
  });

  it("retries reconnection when event resynchronization fails", async () => {
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    let reconnects = 0;
    await recoverEventResync(
      () => Promise.reject(new Error("offline")),
      () => reconnects++,
      (callback, delay) => scheduled.push({ callback, delay }),
    );

    expect(reconnects).toBe(0);
    expect(scheduled[0]?.delay).toBe(1500);
    scheduled[0]?.callback();
    expect(reconnects).toBe(1);
  });

  it("returns to pairing after an unauthenticated WebSocket handshake", async () => {
    await expect(
      websocketRecovery(
        1006,
        false,
        () => Promise.resolve({ paired: false, device: null }),
      ),
    ).resolves.toBe("pair");
    await expect(
      websocketRecovery(
        1006,
        false,
        () =>
          Promise.resolve({
            paired: true,
            device: { id: "device", name: "Phone" },
          }),
      ),
    ).resolves.toBe("reconnect");
  });

  it("adds a session-created notification and preserves newer live metadata", () => {
    const existing = session("existing", 4, "2026-01-01T00:00:00Z");
    const created = session("created", 0, "2026-01-02T00:00:00Z");
    const withCreated = upsertSession([existing], created);
    expect(withCreated.map((item) => item.id)).toEqual(["created", "existing"]);

    const liveCreated = { ...created, lastSeq: 2, status: "running" as const };
    const reconciled = reconcileSessionSnapshots(
      [liveCreated, existing],
      [created, existing],
    );
    expect(reconciled.find((item) => item.id === "created")).toMatchObject({
      lastSeq: 2,
      status: "running",
    });
  });

  it("subscribes sessions discovered after reconnecting", () => {
    expect(missingSessionCursors(
      { existing: 4 },
      [
        session("existing", 5, "2026-01-02T00:00:00Z"),
        session("created-while-offline", 3, "2026-01-03T00:00:00Z"),
      ],
    )).toEqual({ "created-while-offline": 3 });
  });
});

function event(seq: number): GatewayEvent {
  return {
    sessionId: "session",
    seq,
    type: "message.assistant.delta",
    payload: { text: String(seq) },
    createdAt: new Date(seq).toISOString(),
  };
}

function session(id: string, lastSeq: number, updatedAt: string): Session {
  return {
    id,
    projectId: "project",
    agentId: "codex",
    title: "Session",
    status: "idle",
    model: null,
    mode: null,
    createdAt: updatedAt,
    updatedAt,
    lastSeq,
    unread: 0,
  };
}
