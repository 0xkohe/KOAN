import type { Approval } from "@koan/protocol";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";

export function ApprovalSheet(
  { approval, onResolved }: { approval: Approval; onResolved: () => void },
) {
  const [busy, setBusy] = useState(false);
  async function decide(optionId: string, scope: "once" | "session") {
    setBusy(true);
    try {
      await api.resolveApproval(approval.id, { optionId, scope });
      onResolved();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="approval-sheet">
      <div className="mx-auto max-w-3xl">
        <div className="flex gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-amber-soft text-amber">
            <ShieldAlert size={20} />
          </span>
          <div>
            <span className="eyebrow">Approval required</span>
            <h3>{approval.title}</h3>
            {approval.description && <p>{approval.description}</p>}
          </div>
        </div>
        {approval.command && <pre>{approval.command}</pre>}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          {approval.options.map((option) => (
            <button
              key={option.id}
              className={option.kind === "deny"
                ? "button-secondary"
                : "button-primary"}
              disabled={busy}
              onClick={() =>
                decide(
                  option.id,
                  option.id.toLowerCase().includes("session")
                    ? "session"
                    : "once",
                )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
