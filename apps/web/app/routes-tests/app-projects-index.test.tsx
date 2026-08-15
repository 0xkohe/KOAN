import "../lib/i18n";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import Projects from "../routes/_app.projects._index";

afterEach(cleanup);

it("defaults the project path to the Gateway's first allowed root", async () => {
  const router = createMemoryRouter([{
    path: "/",
    element: <Outlet context={{ projects: [], roots: ["/workspace/koan"] }} />,
    children: [{ index: true, element: <Projects /> }],
  }]);

  render(<RouterProvider router={router} />);

  expect(await screen.findByLabelText(/project path/i)).toHaveValue(
    "/workspace/koan",
  );
});
