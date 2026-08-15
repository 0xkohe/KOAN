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
    vi.spyOn(api, "agentModels").mockResolvedValue({ models: [] });
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

    fireEvent.change(screen.getByRole("combobox", { name: /Approvals/ }), {
      target: { value: "auto" },
    });
    const button = screen.getByRole("button", { name: "Create session" });
    fireEvent.click(button);
    fireEvent.submit(button.closest("form")!);

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith("project", "codex", "", "", true);
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  });

  it("loads a different model catalog for each agent", async () => {
    const models = vi.spyOn(api, "agentModels").mockImplementation((agentId) =>
      Promise.resolve({
        models: agentId === "codex"
          ? [{ id: "gpt-example", label: "GPT Example" }]
          : [{ id: "sonnet", label: "Claude Sonnet" }],
      })
    );
    const project = {
      id: "project",
      name: "KOAN",
      path: "/workspace",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };
    const capabilities = {
      approvals: true,
      attachments: true,
      resume: true,
      models: true,
    };
    const router = createMemoryRouter([{
      path: "*",
      element: (
        <NewSessionDialog
          projects={[project]}
          agents={[
            {
              id: "codex",
              label: "Codex",
              available: true,
              version: "1",
              reason: null,
              capabilities,
            },
            {
              id: "claude",
              label: "Claude",
              available: true,
              version: "1",
              reason: null,
              capabilities,
            },
          ]}
          open
          onClose={() => {}}
        />
      ),
    }]);
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("option", { name: "GPT Example" }))
      .toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Agent"), {
      target: { value: "claude" },
    });
    expect(await screen.findByRole("option", { name: "Claude Sonnet" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "GPT Example" }))
      .not.toBeInTheDocument();
    expect(models).toHaveBeenLastCalledWith("claude", "project");
  });
});
