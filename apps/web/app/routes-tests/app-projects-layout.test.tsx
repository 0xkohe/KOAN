import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createMemoryRouter, Outlet, RouterProvider, useOutletContext } from "react-router";
import ProjectsLayout from "../routes/_app.projects";

afterEach(cleanup);

it("preserves the app outlet context for project routes", async () => {
  const router = createMemoryRouter([{
    path: "/",
    element: <Outlet context={{ projectName: "KOAN" }} />,
    children: [{
      element: <ProjectsLayout />,
      children: [{ index: true, element: <ProjectRoute /> }],
    }],
  }]);

  render(<RouterProvider router={router} />);

  expect(await screen.findByText("KOAN")).toBeInTheDocument();
});

function ProjectRoute() {
  const context = useOutletContext<{ projectName: string }>();
  return <p>{context.projectName}</p>;
}
