import type { AgentModelOption, AgentState, Project } from "@koan/protocol";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useRevalidator } from "react-router";
import { api } from "../lib/api";

export function NewSessionDialog(
  { projects, agents, open, onClose }: {
    projects: Project[];
    agents: AgentState[];
    open: boolean;
    onClose: () => void;
  },
) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [agentId, setAgentId] = useState(
    agents.find((agent) => agent.available)?.id ?? "",
  );
  const [model, setModel] = useState("");
  const [models, setModels] = useState<AgentModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [mode, setMode] = useState("");
  const [approvalMode, setApprovalMode] = useState<"manual" | "auto">("manual");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const supportsMode = ["kiro", "cline", "opencode"].includes(agentId);
  useEffect(() => {
    setProjectId((current) =>
      projects.some((project) => project.id === current)
        ? current
        : projects[0]?.id ?? ""
    );
  }, [projects]);
  useEffect(() => {
    if (open) setApprovalMode("manual");
  }, [open]);
  useEffect(() => {
    setModel("");
    setModels([]);
    setModelsError("");
    setModelsLoading(false);
    if (!open || !agentId || !projectId) return;
    let active = true;
    setModelsLoading(true);
    void api.agentModels(agentId as AgentState["id"], projectId).then(
      ({ models: available }) => {
        if (active) setModels(available);
      },
      (reason) => {
        if (active) {
          setModelsError(reason instanceof Error ? reason.message : String(reason));
        }
      },
    ).finally(() => {
      if (active) setModelsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [open, agentId, projectId]);
  if (!open) return null;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const { session } = await api.createSession(
        projectId,
        agentId,
        model,
        supportsMode ? mode : "",
        approvalMode === "auto",
      );
      await revalidator.revalidate();
      onClose();
      navigate(`/sessions/${session.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form className="modal-card" onSubmit={submit}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">New session</h2>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <label className="field">
          <span>Project</span>
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            required
          >
            {projects.map((item) => (
              <option value={item.id} key={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Agent</span>
          <select
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
            required
          >
            {agents.map((agent) => (
              <option
                value={agent.id}
                key={agent.id}
                disabled={!agent.available}
              >
                {agent.label}
                {agent.available ? "" : " — unavailable"}
              </option>
            ))}
          </select>
        </label>
        <div
          className={`grid gap-3 ${
            supportsMode ? "grid-cols-2" : "grid-cols-1"
          }`}
        >
          <label className="field">
            <span>
              Model <small>(optional)</small>
            </span>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={modelsLoading}
            >
              <option value="">
                {modelsLoading ? "Loading models…" : "Agent default"}
              </option>
              {models.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.label}{item.isDefault ? " — current default" : ""}
                </option>
              ))}
            </select>
            {modelsError && (
              <small className="field-note">
                Model list unavailable. The agent default will be used.
              </small>
            )}
          </label>
          {supportsMode && (
            <label className="field">
              <span>
                Mode <small>(optional)</small>
              </span>
              <input
                value={mode}
                onChange={(event) => setMode(event.target.value)}
                placeholder="Agent default"
              />
            </label>
          )}
        </div>
        <label className="field">
          <span>Approvals</span>
          <select
            value={approvalMode}
            onChange={(event) =>
              setApprovalMode(event.target.value as "manual" | "auto")}
          >
            <option value="manual">Ask every time</option>
            <option value="auto">Auto-approve</option>
          </select>
          <small className="field-note">
            Auto-approve allows tool and command requests without confirmation for this session.
          </small>
        </label>
        {error && <p className="error-text">{error}</p>}
        <button
          className="button-primary w-full"
          disabled={busy || !projectId || !agentId}
        >
          {busy ? "Creating…" : "Create session"}
        </button>
      </form>
    </div>
  );
}
