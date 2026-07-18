import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type {
  AskUserQuestionAnnotation,
  AskUserQuestionItemUi,
  AskUserQuestionResponse,
  AskUserQuestionUi,
} from "@shared/types";
import type { Messages } from "./i18n";

/** Local draft answer for one question. */
interface DraftAnswer {
  /** Selected option labels (radio → 0–1; checkbox → 0–n). */
  labels: string[];
  /** Other freeform selected. */
  otherSelected: boolean;
  /** Freeform notes when Other is used. */
  notes: string;
}

function emptyDraft(): DraftAnswer {
  return { labels: [], otherSelected: false, notes: "" };
}

function isAnswered(d: DraftAnswer): boolean {
  if (d.labels.length > 0) return true;
  return d.otherSelected && d.notes.trim().length > 0;
}

function draftToLabels(d: DraftAnswer): string[] {
  if (d.labels.length > 0) return [...d.labels];
  if (d.otherSelected && d.notes.trim()) return ["Other"];
  return [];
}

export function AskUserQuestionModal({
  request,
  m,
  onSubmit,
}: {
  request: AskUserQuestionUi;
  m: Messages;
  onSubmit: (response: AskUserQuestionResponse) => void;
}) {
  const questions = request.questions;
  const [step, setStep] = useState(0);
  const [drafts, setDrafts] = useState<DraftAnswer[]>(() =>
    questions.map(() => emptyDraft()),
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const otherInputRef = useRef<HTMLInputElement | null>(null);

  // Reset wizard when a new questionnaire arrives.
  useEffect(() => {
    setStep(0);
    setDrafts(request.questions.map(() => emptyDraft()));
  }, [request.requestId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    rootRef.current?.focus();
  }, [request.requestId, step]);

  const total = questions.length;
  const safeStep = Math.min(step, Math.max(0, total - 1));
  const q: AskUserQuestionItemUi | undefined = questions[safeStep];
  const draft = drafts[safeStep] ?? emptyDraft();
  const multi = Boolean(q?.multiSelect);
  const isLast = safeStep >= total - 1;
  const isFirst = safeStep <= 0;
  const planMode = request.mode === "plan";

  const focusedPreview = useMemo(() => {
    if (!q || multi) return undefined;
    const label = draft.labels[0];
    if (!label) return undefined;
    return q.options.find((o) => o.label === label)?.preview;
  }, [q, multi, draft.labels]);

  const updateDraft = useCallback(
    (index: number, next: DraftAnswer) => {
      setDrafts((prev) => {
        const copy = prev.slice();
        while (copy.length < questions.length) copy.push(emptyDraft());
        copy[index] = next;
        return copy;
      });
    },
    [questions.length],
  );

  const selectSingle = (label: string) => {
    updateDraft(safeStep, {
      labels: [label],
      otherSelected: false,
      notes: draft.notes,
    });
  };

  const toggleMulti = (label: string) => {
    const set = new Set(draft.labels);
    if (set.has(label)) set.delete(label);
    else set.add(label);
    updateDraft(safeStep, {
      ...draft,
      labels: Array.from(set),
      // Keep Other independent in multi-select.
    });
  };

  const selectOther = () => {
    if (multi) {
      updateDraft(safeStep, {
        ...draft,
        otherSelected: !draft.otherSelected,
      });
    } else {
      updateDraft(safeStep, {
        labels: [],
        otherSelected: true,
        notes: draft.notes,
      });
      queueMicrotask(() => otherInputRef.current?.focus());
    }
  };

  const setNotes = (notes: string) => {
    updateDraft(safeStep, {
      ...draft,
      notes,
      otherSelected: multi ? draft.otherSelected || notes.trim().length > 0 : true,
      labels: multi ? draft.labels : [],
    });
  };

  const buildPartialAnswers = (): Record<string, string> => {
    const partial: Record<string, string> = {};
    questions.forEach((qi, i) => {
      const d = drafts[i] ?? emptyDraft();
      const labels = draftToLabels(d);
      if (labels.length === 0) return;
      partial[qi.question] = labels.join(", ");
    });
    return partial;
  };

  const buildAccepted = (): AskUserQuestionResponse => {
    const answers: Record<string, string[]> = {};
    const annotations: Record<string, AskUserQuestionAnnotation> = {};

    questions.forEach((qi, i) => {
      const d = drafts[i] ?? emptyDraft();
      if (!isAnswered(d)) return;

      const labels = draftToLabels(d);
      if (labels.length === 0) return;
      answers[qi.question] = labels;

      const isSingle = !qi.multiSelect;
      let preview: string | undefined;
      if (isSingle && d.labels[0]) {
        preview = qi.options.find((o) => o.label === d.labels[0])?.preview;
      }
      const notes =
        d.otherSelected && d.notes.trim() ? d.notes.trim() : undefined;
      // Freeform-only already maps labels to ["Other"]; notes go in annotations.
      // When multi-select with both options + other notes, still attach notes.
      if (preview || notes) {
        annotations[qi.question] = {
          ...(preview ? { preview } : {}),
          ...(notes ? { notes } : {}),
        };
      }
    });

    return {
      outcome: "accepted",
      answers,
      ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
    };
  };

  const canProceed = q ? isAnswered(draft) : false;

  const goNext = () => {
    if (!canProceed) return;
    if (isLast) {
      onSubmit(buildAccepted());
      return;
    }
    setStep((s) => Math.min(s + 1, total - 1));
  };

  const goPrev = () => {
    setStep((s) => Math.max(0, s - 1));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onSubmit({ outcome: "cancelled" });
      return;
    }
    // Don't steal keys while typing in Other / freeform.
    const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea") {
      if (e.key === "Enter" && !e.shiftKey && canProceed && isLast) {
        e.preventDefault();
        goNext();
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (canProceed) goNext();
      return;
    }
    if (e.key === "ArrowLeft" && !isFirst) {
      e.preventDefault();
      goPrev();
      return;
    }
    if (e.key === "ArrowRight" && canProceed && !isLast) {
      e.preventDefault();
      goNext();
    }
  };

  if (!q) return null;

  return (
    <div
      className="askq-overlay"
      role="presentation"
      onMouseDown={(e) => {
        // Click on backdrop does not cancel (explicit Cancel / Esc only).
        if (e.target === e.currentTarget) {
          rootRef.current?.focus();
        }
      }}
    >
      <div
        ref={rootRef}
        className="askq-modal"
        role="dialog"
        aria-modal="true"
        aria-label={m.askqTitle}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <div className="askq-head">
          <div className="askq-head-text">
            <div className="askq-kicker">
              {planMode ? m.askqKickerPlan : m.askqKicker}
            </div>
            <div className="askq-progress">
              {m.askqProgress
                .replace("{i}", String(safeStep + 1))
                .replace("{n}", String(total))}
            </div>
          </div>
          <button
            type="button"
            className="askq-close"
            onClick={() => onSubmit({ outcome: "cancelled" })}
            title={m.askqCancel}
            aria-label={m.askqCancel}
          >
            ×
          </button>
        </div>

        <div className="askq-steps" aria-hidden>
          {questions.map((_, i) => (
            <span
              key={i}
              className={`askq-step-dot ${i === safeStep ? "active" : ""} ${
                isAnswered(drafts[i] ?? emptyDraft()) ? "done" : ""
              }`}
            />
          ))}
        </div>

        <div className="askq-question" title={q.question}>
          {q.question}
        </div>
        {multi ? (
          <div className="askq-multi-hint">{m.askqMultiHint}</div>
        ) : null}

        <div className="askq-options" role={multi ? "group" : "radiogroup"}>
          {q.options.map((opt) => {
            const selected = draft.labels.includes(opt.label);
            return (
              <button
                key={opt.label}
                type="button"
                role={multi ? "checkbox" : "radio"}
                aria-checked={selected}
                className={`askq-option ${selected ? "selected" : ""}`}
                onClick={() =>
                  multi ? toggleMulti(opt.label) : selectSingle(opt.label)
                }
              >
                <span className="askq-option-mark" aria-hidden>
                  {multi ? (selected ? "☑" : "☐") : selected ? "●" : "○"}
                </span>
                <span className="askq-option-body">
                  <span className="askq-option-label">{opt.label}</span>
                  {opt.description ? (
                    <span className="askq-option-desc">{opt.description}</span>
                  ) : null}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            role={multi ? "checkbox" : "radio"}
            aria-checked={draft.otherSelected}
            className={`askq-option askq-option-other ${
              draft.otherSelected ? "selected" : ""
            }`}
            onClick={selectOther}
          >
            <span className="askq-option-mark" aria-hidden>
              {multi
                ? draft.otherSelected
                  ? "☑"
                  : "☐"
                : draft.otherSelected
                  ? "●"
                  : "○"}
            </span>
            <span className="askq-option-body">
              <span className="askq-option-label">{m.askqOther}</span>
              <span className="askq-option-desc">{m.askqOtherHint}</span>
            </span>
          </button>

          {draft.otherSelected ? (
            <input
              ref={otherInputRef}
              className="askq-other-input"
              type="text"
              value={draft.notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={m.askqOtherPlaceholder}
              onClick={(e) => e.stopPropagation()}
            />
          ) : null}
        </div>

        {focusedPreview ? (
          <pre className="askq-preview" title={focusedPreview}>
            {focusedPreview}
          </pre>
        ) : null}

        <div className="askq-foot">
          <div className="askq-nav">
            <button
              type="button"
              className="btn ghost"
              disabled={isFirst}
              onClick={goPrev}
            >
              {m.askqBack}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!canProceed}
              onClick={goNext}
            >
              {isLast ? m.askqSubmit : m.askqNext}
            </button>
          </div>

          {planMode ? (
            <div className="askq-plan-actions">
              <button
                type="button"
                className="btn ghost"
                title={m.askqChatAboutHint}
                onClick={() =>
                  onSubmit({
                    outcome: "chat_about_this",
                    partial_answers: buildPartialAnswers(),
                  })
                }
              >
                {m.askqChatAbout}
              </button>
              <button
                type="button"
                className="btn ghost"
                title={m.askqSkipInterviewHint}
                onClick={() =>
                  onSubmit({
                    outcome: "skip_interview",
                    partial_answers: buildPartialAnswers(),
                  })
                }
              >
                {m.askqSkipInterview}
              </button>
            </div>
          ) : null}

          <div className="askq-hint">{m.askqHint}</div>
        </div>
      </div>
    </div>
  );
}
