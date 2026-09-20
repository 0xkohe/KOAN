import "../lib/i18n";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { api } from "../lib/api";
import Projects from "../routes/_app.projects._index";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("defaults the project path to the Gateway's configured starting location", async () => {
  vi.spyOn(api, "directories").mockResolvedValue({
    path: "/workspace/koan",
    parent: null,
    directories: [],
    truncated: false,
  });
  const router = createMemoryRouter([{
    path: "/",
    element: <Outlet context={{
      projects: [],
      roots: ["/"],
      defaultPath: "/workspace/koan",
    }} />,
    children: [{ index: true, element: <Projects /> }],
  }]);

  render(<RouterProvider router={router} />);

  expect(await screen.findByLabelText(/project path/i)).toHaveValue(
    "/workspace/koan",
  );
});

it("navigates through Gateway folders and selects the current path", async () => {
  const directories = vi.spyOn(api, "directories")
    .mockResolvedValueOnce({
      path: "/workspace",
      parent: null,
      directories: [{ name: "project-a", path: "/workspace/project-a" }],
      truncated: false,
    })
    .mockResolvedValueOnce({
      path: "/workspace/project-a",
      parent: "/workspace",
      directories: [{ name: "src", path: "/workspace/project-a/src" }],
      truncated: false,
    });
  const router = createMemoryRouter([{
    path: "/",
    element: <Outlet context={{
      projects: [],
      roots: ["/workspace"],
      defaultPath: "/workspace",
    }} />,
    children: [{ index: true, element: <Projects /> }],
  }]);

  render(<RouterProvider router={router} />);
  fireEvent.click(await screen.findByRole("button", { name: "project-a" }));

  await waitFor(() => expect(directories).toHaveBeenLastCalledWith("/workspace/project-a"));
  expect(screen.getByLabelText(/project path/i)).toHaveValue("/workspace/project-a");
  expect(screen.getByRole("button", { name: /up one level/i })).toBeVisible();
  expect(screen.getByRole("button", { name: "src" })).toBeVisible();
});

it("filters folders in the current directory", async () => {
  vi.spyOn(api, "directories").mockResolvedValue({
    path: "/workspace",
    parent: null,
    directories: [
      { name: "alpha", path: "/workspace/alpha" },
      { name: "beta", path: "/workspace/beta" },
    ],
    truncated: false,
  });
  const router = createMemoryRouter([{
    path: "/",
    element: <Outlet context={{
      projects: [],
      roots: ["/workspace"],
      defaultPath: "/workspace",
    }} />,
    children: [{ index: true, element: <Projects /> }],
  }]);

  render(<RouterProvider router={router} />);
  expect(await screen.findByRole("button", { name: "alpha" })).toBeVisible();
  fireEvent.change(screen.getByLabelText(/filter folders/i), { target: { value: "bet" } });

  expect(screen.queryByRole("button", { name: "alpha" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "beta" })).toBeVisible();
});
