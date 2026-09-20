import type { AgentState, Project, Session } from "@koan/protocol";
import { useOutletContext } from "react-router";

export type AppData = {
  auth: { device: { id: string; name: string } | null };
  projects: Project[];
  sessions: Session[];
  agents: AgentState[];
  roots: string[];
  defaultPath: string;
};
export function useAppData() {
  return useOutletContext<AppData>();
}
