import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../lib/i18n";
import { InstallPrompt } from "./install-prompt";

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("InstallPrompt", () => {
  it("offers installation after Chrome reports the PWA as installable", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    render(<InstallPrompt />);

    window.dispatchEvent(installEvent(prompt, "accepted"));

    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    expect(screen.queryByLabelText("Install KOAN")).not.toBeInTheDocument();
  });

  it("can dismiss the installation offer", async () => {
    render(<InstallPrompt />);
    window.dispatchEvent(installEvent(vi.fn(), "dismissed"));

    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByLabelText("Install KOAN")).not.toBeInTheDocument();
  });
});

function installEvent(prompt: () => Promise<void>, outcome: "accepted" | "dismissed") {
  return Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome, platform: "web" }),
  });
}
