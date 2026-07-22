/**
 * Pure draft → response helpers for ask_user_question UI.
 * Shared by AskUserQuestionModal and Node/tsx contract tests.
 */
import type {
  AskUserQuestionAnnotation,
  AskUserQuestionItemUi,
  AskUserQuestionResponse,
} from "@shared/types";

export interface DraftAnswer {
  labels: string[];
  otherSelected: boolean;
  notes: string;
}

export function emptyDraft(): DraftAnswer {
  return { labels: [], otherSelected: false, notes: "" };
}

export function isAnswered(d: DraftAnswer): boolean {
  if (d.labels.length > 0) return true;
  return d.otherSelected && d.notes.trim().length > 0;
}

export function draftToLabels(d: DraftAnswer): string[] {
  if (d.labels.length > 0) return [...d.labels];
  if (d.otherSelected && d.notes.trim()) return ["Other"];
  return [];
}

export function buildAcceptedFromDrafts(
  questions: AskUserQuestionItemUi[],
  drafts: DraftAnswer[],
): AskUserQuestionResponse {
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
}
