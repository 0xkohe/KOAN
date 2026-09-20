import { ChevronUp, Folder, LoaderCircle, Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useRevalidator } from "react-router";
import { api, type DirectoryListing } from "../lib/api";
import { useAppData } from "../lib/app-context";

export default function Projects() {
  const { projects, roots, defaultPath: configuredDefaultPath } = useAppData();
  const { t } = useTranslation();
  const revalidator = useRevalidator();
  const defaultPath = configuredDefaultPath ?? roots[0] ?? "";
  const [path, setPath] = useState(defaultPath);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [browseError, setBrowseError] = useState("");
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const browseRequest = useRef(0);
  const browse = useCallback(async (nextPath: string) => {
    if (!nextPath) return;
    const request = ++browseRequest.current;
    setBrowsing(true);
    setBrowseError("");
    try {
      const result = await api.directories(nextPath);
      if (request !== browseRequest.current) return;
      setListing(result);
      setPath(result.path);
      setQuery("");
    } catch (reason) {
      if (request !== browseRequest.current) return;
      setBrowseError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (request === browseRequest.current) setBrowsing(false);
    }
  }, []);
  useEffect(() => {
    void browse(defaultPath);
    return () => {
      browseRequest.current++;
    };
  }, [browse, defaultPath]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.createProject(path, name || undefined);
      setPath(defaultPath);
      setName("");
      void browse(defaultPath);
      await revalidator.revalidate();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  const activeRoot = rootContaining(listing?.path ?? path, roots) ?? defaultPath;
  const visibleDirectories = listing?.directories.filter((directory) =>
    directory.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  ) ?? [];
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
        className="surface project-connect mt-8"
        onSubmit={submit}
      >
        <div className="directory-browser-header">
          <div className="min-w-0">
            <span className="directory-browser-label">{t("chooseFolder")}</span>
            <code title={listing?.path ?? path}>{listing?.path ?? path}</code>
          </div>
          {roots.length > 0 && (
            <label className="field directory-root-select">
              <span>{t("allowedRoot")}</span>
              <select
                aria-label={t("allowedRoot")}
                value={activeRoot}
                onChange={(event) => void browse(event.target.value)}
                disabled={browsing}
              >
                {roots.map((root) => <option key={root} value={root}>{root}</option>)}
              </select>
            </label>
          )}
        </div>

        <label className="directory-search">
          <Search size={17} />
          <input
            aria-label={t("searchFolders")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("searchFolders")}
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label={t("clearSearch")}>
              <X size={16} />
            </button>
          )}
        </label>

        <div className="directory-browser" aria-busy={browsing}>
          {listing?.parent && (
            <button
              type="button"
              className="directory-row directory-parent"
              onClick={() => void browse(listing.parent!)}
              disabled={browsing}
            >
              <ChevronUp size={18} />
              <span>{t("upOneLevel")}</span>
            </button>
          )}
          {visibleDirectories.map((directory) => (
            <button
              type="button"
              className="directory-row"
              key={directory.path}
              onClick={() => void browse(directory.path)}
              disabled={browsing}
            >
              <Folder size={18} />
              <span>{directory.name}</span>
            </button>
          ))}
          {browsing && !listing && (
            <div className="directory-status">
              <LoaderCircle className="spin" size={18} />
              {t("browsingFolders")}
            </div>
          )}
          {!browsing && listing && !listing.directories.length && (
            <p className="directory-status">{t("noSubfolders")}</p>
          )}
          {!browsing && listing && Boolean(query) && Boolean(listing.directories.length) &&
            !visibleDirectories.length && (
            <p className="directory-status">{t("noMatchingFolders")}</p>
          )}
        </div>
        {listing?.truncated && <p className="field-note">{t("folderListTruncated")}</p>}
        {browseError && <p className="error-text">{browseError}</p>}

        <div className="project-fields">
          <label className="field">
            <span>{t("path")}</span>
            <span className="path-entry">
              <input
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="/home/me/projects/app"
                required
              />
              <button
                type="button"
                className="button-secondary"
                onClick={() => void browse(path)}
                disabled={browsing || !path}
              >
                {t("browse")}
              </button>
            </span>
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
          <button className="button-primary project-connect-button" disabled={busy || !path}>
            <Plus size={17} />
            {busy ? "Connecting…" : t("connectProject")}
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
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

function rootContaining(path: string, roots: string[]) {
  return [...roots]
    .sort((left, right) => right.length - left.length)
    .find((root) => {
      if (path === root) return true;
      const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
      return path.startsWith(root.endsWith(separator) ? root : `${root}${separator}`);
    });
}
