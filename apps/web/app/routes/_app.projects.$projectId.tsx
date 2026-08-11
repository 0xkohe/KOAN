import { ArrowLeft, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import { NewSessionDialog } from "../components/new-session";
import { SessionList } from "../components/session-list";
import { api } from "../lib/api";
import { useAppData } from "../lib/app-context";

export async function clientLoader(
  { params }: { params: { projectId?: string } },
) {
  return api.project(params.projectId!);
}

export default function ProjectDetail() {
  const { project } = useLoaderData<typeof clientLoader>();
  const app = useAppData();
  const sessions = app.sessions.filter((session) =>
    session.projectId === project.id
  );
  const [open, setOpen] = useState(false);
  return (
    <div className="page page-narrow">
      <Link to="/projects" className="back-link">
        <ArrowLeft size={16} />Projects
      </Link>
      <header className="page-header mt-5">
        <div>
          <span className="eyebrow">Project</span>
          <h1>{project.name}</h1>
          <p className="font-mono text-sm">{project.path}</p>
        </div>
        <button
          className="button-primary desktop-only"
          onClick={() => setOpen(true)}
        >
          <Plus size={17} />New session
        </button>
      </header>
      <section className="mt-8">
        <div className="section-heading">
          <h2>Sessions</h2>
        </div>
        <SessionList sessions={sessions} />
      </section>
      <NewSessionDialog
        projects={[project]}
        agents={app.agents}
        open={open}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
