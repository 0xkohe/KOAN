import { Outlet, useOutletContext } from "react-router";

export default function ProjectsLayout() {
  return <Outlet context={useOutletContext()} />;
}
