import { FolderKanban, Home, Plus, Settings, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  href,
  Link,
  NavLink,
  Outlet,
  redirect,
  useLoaderData,
  useMatch,
} from "react-router";
import { Brand } from "../components/brand";
import { IconLabel } from "../components/icons";
import { NewSessionDialog } from "../components/new-session";
import { api } from "../lib/api";
import { LiveProvider, useLive } from "../lib/live";

export async function clientLoader() {
  const auth = await api.authStatus();
  if (!auth.paired) throw redirect("/pair");
  const [{ projects }, { sessions }, { agents }, { roots }] = await Promise.all([
    api.projects(),
    api.sessions(),
    api.agents(),
    api.roots(),
  ]);
  return { auth, projects, sessions, agents, roots };
}

export default function AppLayout() {
  const data = useLoaderData<typeof clientLoader>();
  return (
    <LiveProvider sessions={data.sessions}>
      <Shell data={data} />
    </LiveProvider>
  );
}

function Shell({ data }: { data: Awaited<ReturnType<typeof clientLoader>> }) {
  const { t } = useTranslation();
  const { connected, notices, dismissNotice, sessions } = useLive();
  const inSession = useMatch("/sessions/:sessionId");
  const [newOpen, setNewOpen] = useState(false);
  const links = [
    { to: href("/"), label: "Home", icon: Home, end: true },
    {
      to: href("/projects"),
      label: t("projects"),
      icon: FolderKanban,
      end: false,
    },
    { to: href("/settings"), label: t("settings"), icon: Settings, end: false },
  ];
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="px-3 py-3">
          <Brand />
        </div>
        <button
          className="button-primary mx-2 mt-3 justify-center"
          onClick={() => setNewOpen(true)}
        >
          <Plus size={16} />
          {t("newSession")}
        </button>
        <nav className="mt-4 space-y-1 px-2">
          {links.map(({ to, label, icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`}
            >
              <IconLabel icon={icon}>{label}</IconLabel>
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-hairline px-3 py-4 text-xs text-muted">
          <span
            className={`mr-2 inline-block size-2 rounded-full ${
              connected ? "bg-green" : "bg-amber"
            }`}
          />
          {connected ? t("connected") : t("reconnecting")}
        </div>
      </aside>
      <main className="main-pane">
        <Outlet context={{ ...data, sessions }} />
      </main>
      <nav className="bottom-nav">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `bottom-nav-item ${isActive ? "active" : ""}`}
          >
            <Icon size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      {!inSession && (
        <button
          className="mobile-new"
          aria-label={t("newSession")}
          onClick={() => setNewOpen(true)}
        >
          <Plus size={22} />
        </button>
      )}
      <NewSessionDialog
        projects={data.projects}
        agents={data.agents}
        open={newOpen}
        onClose={() => setNewOpen(false)}
      />
      <div className="toast-stack">
        {notices.map((notice) => (
          <div className="toast" key={notice.id}>
            <Link
              to={`/sessions/${notice.sessionId}`}
              onClick={() => dismissNotice(notice.id)}
            >
              <strong>{notice.text}</strong>
              <span>Open session</span>
            </Link>
            <button onClick={() => dismissNotice(notice.id)}>
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
