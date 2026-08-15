import { Folder, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useRevalidator } from "react-router";
import { api } from "../lib/api";
import { useAppData } from "../lib/app-context";

export default function Projects() {
  const { projects, roots } = useAppData();
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  const defaultPath = roots[0] ?? "";
  const [path, setPath] = useState(defaultPath);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.createProject(path, name || undefined);
      setPath(defaultPath);
      setName("");
      await revalidator.revalidate();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page page-narrow">
      <header className="page-header">
        <div>
          <span className="eyebrow">Workspace</span>
          <h1>{t("projects")}</h1>
          <p>Only folders under an allowed root can be registered.</p>
        </div>
      </header>
      <form
        className="surface mt-8 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end"
        onSubmit={submit}
      >
        <label className="field">
          <span>{t("path")}</span>
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/home/me/projects/app"
            required
          />
        </label>
        <label className="field">
          <span>
            Name <small>(optional)</small>
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My app"
          />
        </label>
        <button className="button-primary" disabled={busy}>
          <Plus size={17} />
          {busy ? "Connecting…" : t("connectProject")}
        </button>
        {error && <p className="error-text md:col-span-3">{error}</p>}
      </form>
      <div className="mt-7 grid gap-3 sm:grid-cols-2">
        {projects.map((project) => (
          <Link
            to={`/projects/${project.id}`}
            key={project.id}
            className="project-card"
          >
            <span className="icon-well">
              <Folder size={20} />
            </span>
            <span className="min-w-0">
              <strong className="block truncate">{project.name}</strong>
              <small className="block truncate text-muted">
                {project.path}
              </small>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
