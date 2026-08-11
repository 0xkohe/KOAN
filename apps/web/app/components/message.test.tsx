import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Message } from "./message";

describe("Message", () => {
  it("renders failed tool completions as failures", () => {
    render(
      <Message
        item={{
          key: "tool",
          role: "tool",
          event: {
            sessionId: "session",
            seq: 1,
            type: "tool.completed",
            payload: { title: "Command", status: "failed" },
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        }}
      />,
    );
    expect(screen.getByText("Failed")).toBeVisible();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  });
});
