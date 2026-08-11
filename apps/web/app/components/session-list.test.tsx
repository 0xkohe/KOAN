import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import { SessionList } from "./session-list";

describe("SessionList", () => {
  it("renders a file-route-compatible session link", () => {
    const router = createMemoryRouter([{
      path: "*",
      element: (
        <SessionList
          sessions={[{
            id: "session-1",
            projectId: "project-1",
            projectName: "KOAN",
            agentId: "codex",
            title: "Build the gateway",
            status: "idle",
            model: null,
            mode: null,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
            lastSeq: 0,
            unread: 0,
          }]}
        />
      ),
    }]);
    render(<RouterProvider router={router} />);
    expect(screen.getByRole("link", { name: /Build the gateway/ }))
      .toHaveAttribute("href", "/sessions/session-1");
  });
});
