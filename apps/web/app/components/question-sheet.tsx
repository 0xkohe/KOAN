import type { QuestionRequest } from "@koan/protocol";
import { CircleHelp, X } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";

export function QuestionSheet(
  { request, onResolved }: { request: QuestionRequest; onResolved: () => void },
) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const question = request.questions[step];

  function toggle(label: string) {
    setError("");
    if (!question.multiSelect) setCustom("");
    setSelected((current) =>
      question.multiSelect
        ? current.includes(label)
          ? current.filter((value) => value !== label)
          : [...current, label]
        : [label]
    );
  }

  async function next() {
    const customValue = custom.trim();
    const values = question.multiSelect
      ? [...selected, ...(customValue ? [customValue] : [])]
      : customValue
      ? [customValue]
      : selected.slice(0, 1);
    if (!values.length) {
      setError("Choose an option or enter an answer.");
      return;
    }
    const nextAnswers = { ...answers, [question.id]: values };
    if (step < request.questions.length - 1) {
      setAnswers(nextAnswers);
      setSelected([]);
      setCustom("");
      setStep((value) => value + 1);
      return;
    }
    setBusy(true);
    try {
      await api.resolveQuestion(request.id, {
        answers: nextAnswers,
        cancelled: false,
      });
      onResolved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await api.resolveQuestion(request.id, { answers: {}, cancelled: true });
      onResolved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="approval-sheet question-sheet">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-blue-soft text-blue">
            <CircleHelp size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <span className="eyebrow">
              Question {step + 1} of {request.questions.length}
            </span>
            <h3>{question.header}</h3>
            <p>{question.prompt}</p>
          </div>
          <button
            className="icon-button"
            disabled={busy}
            aria-label="Cancel questions"
            onClick={cancel}
          >
            <X size={18} />
          </button>
        </div>
        <div className="question-options">
          {question.options.map((option) => (
            <button
              type="button"
              key={option.id}
              className={`question-option ${
                selected.includes(option.label) ? "active" : ""
              }`}
              aria-pressed={selected.includes(option.label)}
              disabled={busy}
              onClick={() => toggle(option.label)}
            >
              <strong>{option.label}</strong>
              {option.description && <span>{option.description}</span>}
            </button>
          ))}
        </div>
        {question.allowFreeText && (
          <label className="field mt-3">
            <span>Other answer</span>
            <input
              type={question.secret ? "password" : "text"}
              autoComplete={question.secret ? "off" : undefined}
              value={custom}
              disabled={busy}
              onChange={(event) => {
                setCustom(event.target.value);
                if (!question.multiSelect && event.target.value) {
                  setSelected([]);
                }
              }}
            />
          </label>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="mt-4 flex justify-end">
          <button className="button-primary" disabled={busy} onClick={next}>
            {step === request.questions.length - 1
              ? "Submit answers"
              : "Next question"}
          </button>
        </div>
      </div>
    </div>
  );
}
