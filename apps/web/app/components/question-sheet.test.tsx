import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { QuestionSheet } from "./question-sheet";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("QuestionSheet", () => {
  it("masks secret free-text answers", () => {
    const { container } = render(
      <QuestionSheet
        request={{
          id: "request",
          sessionId: "session",
          turnId: "turn",
          status: "pending",
          createdAt: "2026-01-01",
          questions: [{
            id: "token",
            header: "Token",
            prompt: "Enter a token",
            options: [],
            multiSelect: false,
            allowFreeText: true,
            secret: true,
          }],
        }}
        onResolved={() => {}}
      />,
    );

    const input = container.querySelector("input");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "off");
  });

  it("collects all questions before resolving the request", async () => {
    const resolve = vi.spyOn(api, "resolveQuestion").mockResolvedValue(
      {} as never,
    );
    render(
      <QuestionSheet
        request={{
          id: "request",
          sessionId: "session",
          turnId: "turn",
          status: "pending",
          createdAt: "2026-01-01",
          questions: [
            {
              id: "language",
              header: "Language",
              prompt: "Choose a language",
              options: [{ id: "ts", label: "TypeScript" }],
              multiSelect: false,
              allowFreeText: true,
              secret: false,
            },
            {
              id: "features",
              header: "Features",
              prompt: "Choose features",
              options: [{ id: "lint", label: "Lint" }, {
                id: "test",
                label: "Tests",
              }],
              multiSelect: true,
              allowFreeText: false,
              secret: false,
            },
          ],
        }}
        onResolved={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "TypeScript" }));
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(screen.getByRole("heading", { name: "Features" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Lint" }));
    fireEvent.click(screen.getByRole("button", { name: "Tests" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));

    await waitFor(() =>
      expect(resolve).toHaveBeenCalledWith("request", {
        answers: { language: ["TypeScript"], features: ["Lint", "Tests"] },
        cancelled: false,
      })
    );
  });
});
