import type { Session } from "@koan/protocol";
import { Bot, ChevronRight } from "lucide-react";
import { href, Link } from "react-router";

export function SessionList({ sessions }: { sessions: Session[] }) {
  if (!sessions.length) {
    return <div className="empty-state">No sessions yet</div>;
  }
  return (
    <div className="divide-y divide-hairline overflow-hidden rounded-[18px] border border-hairline bg-surface">
      {sessions.map((session) => (
        <Link
          key={session.id}
          to={href("/sessions/:sessionId", { sessionId: session.id })}
          className="group flex items-center gap-3 px-4 py-3.5 hover:bg-hover"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-canvas text-muted">
            <Bot size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium">
              {session.title}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted">
              {session.projectName} · {session.agentId}
            </span>
          </span>
          <StatusDot status={session.status} />
          <ChevronRight
            className="text-faint transition-transform group-hover:translate-x-0.5"
            size={17}
          />
        </Link>
      ))}
    </div>
  );
}

export function StatusDot({ status }: { status: Session["status"] }) {
  const active = ["running", "waiting_approval", "waiting_input", "queued"]
    .includes(status);
  return (
    <span
      title={status}
      className={`size-2 rounded-full ${
        active ? "bg-blue" : status === "failed" ? "bg-red" : "bg-hairline"
      }`}
    />
  );
}
