import { ArrowRight, FolderKanban, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { NewSessionDialog } from "../components/new-session";
import { SessionList } from "../components/session-list";
import { useAppData } from "../lib/app-context";

export function meta() {
  return [{ title: "KOAN — Agent Gateway" }];
}

export default function Dashboard() {
  const data = useAppData();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="page page-narrow">
      <header className="page-header">
        <div>
          <span className="eyebrow">Your workspace</span>
          <h1>Good to see you.</h1>
          <p>Continue a coding session from any device in your tailnet.</p>
        </div>
        <button
          className="button-primary desktop-only"
          onClick={() => setOpen(true)}
        >
          <Plus size={17} />
          {t("newSession")}
        </button>
      </header>
      {!data.projects.length && (
        <section className="hero-card">
          <span className="icon-well">
            <Sparkles size={22} />
          </span>
          <div>
            <h2>Connect your first project</h2>
            <p>Register a folder inside one of the Gateway’s allowed roots.</p>
          </div>
          <Link className="button-secondary" to="/projects">
            Open projects <ArrowRight size={16} />
          </Link>
        </section>
      )}
      <section className="mt-10">
        <div className="section-heading">
          <h2>{t("recentSessions")}</h2>
          <Link to="/projects" className="text-link">
            <FolderKanban size={15} />
            {t("projects")}
          </Link>
        </div>
        <SessionList sessions={data.sessions.slice(0, 12)} />
      </section>
      <NewSessionDialog
        projects={data.projects}
        agents={data.agents}
        open={open}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
