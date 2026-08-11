import type { GatewayEvent } from "@koan/protocol";
import {
  CheckCircle2,
  ChevronDown,
  CircleDotDashed,
  TerminalSquare,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type TimelineItem = {
  key: string;
  role: "user" | "assistant" | "thought" | "tool" | "notice";
  text?: string;
  event?: GatewayEvent;
  complete?: boolean;
};

export function Message({ item }: { item: TimelineItem }) {
  if (item.role === "user") {
    return (
      <article className="message-row user">
        <div className="user-bubble">{item.text}</div>
      </article>
    );
  }
  if (item.role === "assistant") {
    return (
      <article className="message-row assistant">
        <div className="agent-mark">K</div>
        <div className="markdown">
          <Markdown remarkPlugins={[remarkGfm]}>
            {item.text || (item.complete ? "" : "…")}
          </Markdown>
        </div>
      </article>
    );
  }
  if (item.role === "thought") return <Thought text={item.text ?? ""} />;
  if (item.role === "tool") return <Tool event={item.event!} />;
  return (
    <div className="notice">{String(item.event?.payload.message ?? "")}</div>
  );
}

function Thought({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="thought">
      <button onClick={() => setOpen(!open)}>
        <CircleDotDashed size={15} />Reasoning{" "}
        <ChevronDown className={open ? "rotate-180" : ""} size={15} />
      </button>
      {open && <p>{text}</p>}
    </div>
  );
}

function Tool({ event }: { event: GatewayEvent }) {
  const done = event.type === "tool.completed";
  const failed = done &&
    (event.payload.status === "failed" || event.payload.isError === true);
  return (
    <div className="tool-card">
      <span className="tool-icon">
        {failed
          ? <XCircle size={16} />
          : done
          ? <CheckCircle2 size={16} />
          : <TerminalSquare size={16} />}
      </span>
      <div className="min-w-0">
        <strong>
          {String(event.payload.title ?? event.payload.kind ?? "Tool")}
        </strong>
        {Boolean(event.payload.command) && (
          <code>{String(event.payload.command)}</code>
        )}
        <small>{failed ? "Failed" : done ? "Completed" : "Running"}</small>
      </div>
    </div>
  );
}
