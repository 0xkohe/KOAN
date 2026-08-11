import { describe, expect, it } from "vitest";
import type { GatewayEvent } from "@koan/protocol";
import {
  ATTACHMENT_ACCEPT,
  buildTimeline,
  canSubmitTurn,
  eventTailSequence,
  resolveSessionStatus,
  shouldSubmitComposer,
} from "../routes/_app.sessions.$sessionId";

describe("session timeline", () => {
  it("preserves tool metadata when a completion event only carries status", () => {
    const events: GatewayEvent[] = [
      event(1, "tool.started", {
        id: "tool-1",
        title: "Run tests",
        command: "pnpm test",
      }),
      event(2, "tool.completed", { id: "tool-1", status: "completed" }),
    ];

    const tool = buildTimeline(events).find((item) => item.role === "tool");

    expect(tool?.event?.type).toBe("tool.completed");
    expect(tool?.event?.payload).toMatchObject({
      id: "tool-1",
      title: "Run tests",
      command: "pnpm test",
      status: "completed",
    });
  });

  it("keeps assistant text on both sides of a tool in event order", () => {
    const timeline = buildTimeline([
      event(1, "message.assistant.delta", { turnId: "turn", text: "Before" }),
      event(2, "tool.started", { id: "tool-1", title: "Run tests" }),
      event(3, "tool.completed", { id: "tool-1", status: "completed" }),
      event(4, "message.assistant.delta", { turnId: "turn", text: "After" }),
    ]);

    expect(timeline.map((item) => item.role)).toEqual([
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(timeline.map((item) => item.text ?? null)).toEqual([
      "Before",
      null,
      "After",
    ]);
  });

  it("blocks turn submission while another turn is active", () => {
    expect(canSubmitTurn("next prompt", false, false, true)).toBe(false);
    expect(canSubmitTurn("next prompt", false, false, false)).toBe(true);
  });

  it("does not submit Enter while an IME composition is active", () => {
    expect(
      shouldSubmitComposer({
        key: "Enter",
        shiftKey: false,
        isComposing: true,
      }),
    ).toBe(false);
    expect(
      shouldSubmitComposer({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
      }),
    ).toBe(true);
  });

  it("keeps the live session status when bounded timeline history no longer contains it", () => {
    expect(
      resolveSessionStatus("running", [
        event(2, "message.assistant.delta", { text: "next" }),
      ], "idle"),
    )
      .toBe("running");
  });

  it("tracks the event tail when a bounded window keeps the same length", () => {
    expect(eventTailSequence([
      event(1, "message.assistant.delta", { text: "one" }),
      event(2, "message.assistant.delta", { text: "two" }),
    ])).toBe(2);
    expect(eventTailSequence([
      event(2, "message.assistant.delta", { text: "two" }),
      event(3, "message.assistant.delta", { text: "three" }),
    ])).toBe(3);
  });

  it("allows source-file extensions supported by the Gateway", () => {
    expect(ATTACHMENT_ACCEPT).toContain(".ts");
    expect(ATTACHMENT_ACCEPT).toContain(".py");
    expect(ATTACHMENT_ACCEPT).toContain(".md");
    expect(ATTACHMENT_ACCEPT).toContain(".yaml");
  });
});

function event(
  seq: number,
  type: GatewayEvent["type"],
  payload: Record<string, unknown>,
): GatewayEvent {
  return {
    sessionId: "session",
    seq,
    type,
    payload,
    createdAt: new Date(seq).toISOString(),
  };
}
