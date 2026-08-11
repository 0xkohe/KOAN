import assert from "node:assert/strict";
import { sendWebSocket } from "../src/server.ts";

Deno.test("WebSocket sends are rejected by closing slow consumers", () => {
  const sent: string[] = [];
  const closed: Array<[number, string]> = [];
  const socket = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 1024,
    send: (data: string) => sent.push(data),
    close: (code?: number, reason?: string) => closed.push([code ?? 0, reason ?? ""]),
  };

  assert.equal(sendWebSocket(socket, "event", 1024), false);
  assert.deepEqual(sent, []);
  assert.deepEqual(closed, [[1013, "Slow consumer"]]);
});

Deno.test("WebSocket sends remain available below the buffer limit", () => {
  const sent: string[] = [];
  const socket = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 1019,
    send: (data: string) => sent.push(data),
    close: () => assert.fail("socket should remain open"),
  };

  assert.equal(sendWebSocket(socket, "event", 1024), true);
  assert.deepEqual(sent, ["event"]);
});

Deno.test("WebSocket buffer limits include the UTF-8 size of the outgoing message", () => {
  const sent: string[] = [];
  const closed: Array<[number, string]> = [];
  const socket = {
    readyState: WebSocket.OPEN,
    bufferedAmount: 1019,
    send: (data: string) => sent.push(data),
    close: (code?: number, reason?: string) => closed.push([code ?? 0, reason ?? ""]),
  };

  assert.equal(sendWebSocket(socket, "日本", 1024), false);
  assert.deepEqual(sent, []);
  assert.deepEqual(closed, [[1013, "Slow consumer"]]);
});
