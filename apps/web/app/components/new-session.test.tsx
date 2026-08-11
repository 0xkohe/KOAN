import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { api } from "../lib/api";
import { NewSessionDialog } from "./new-session";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NewSessionDialog", () => {
  it("prevents duplicate submissions while session creation is pending", async () => {
    const create = vi.spyOn(api, "createSession").mockImplementation(() =>
      new Promise(() => {})
    );
    const router = createMemoryRouter([{
      path: "*",
      element: (
        <NewSessionDialog
          projects={[{
            id: "project",
            name: "KOAN",
            path: "/workspace",
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          }]}
          agents={[{
            id: "codex",
            label: "Codex",
            available: true,
            version: "1",
            reason: null,
            capabilities: {
              approvals: true,
              attachments: true,
              resume: true,
              models: true,
            },
          }]}
          open
          onClose={() => {}}
        />
      ),
    }]);
    render(<RouterProvider router={router} />);

    const button = screen.getByRole("button", { name: "Create session" });
    fireEvent.click(button);
    fireEvent.submit(button.closest("form")!);

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  });
});
