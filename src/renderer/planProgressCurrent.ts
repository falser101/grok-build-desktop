/**
 * Pure helpers for the composer plan/todo progress pill.
 * Kept free of React so Node contract tests can import the same logic.
 */

export type TodoStatusLike =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled"
  | string;

export interface TodoLike {
  status: TodoStatusLike;
  content?: string;
}

/**
 * Index of the task the pill should highlight as "current":
 * first in_progress, else first pending. -1 when none.
 */
export function selectCurrentTodoIndex(todos: TodoLike[]): number {
  let firstInProgress = -1;
  let firstPending = -1;
  for (let i = 0; i < todos.length; i++) {
    const s = todos[i]?.status;
    if (s === "in_progress" && firstInProgress < 0) firstInProgress = i;
    else if (s === "pending" && firstPending < 0) firstPending = i;
  }
  if (firstInProgress >= 0) return firstInProgress;
  return firstPending;
}

/** True when the pill should render (has incomplete todos and a current step). */
export function shouldShowPlanProgress(todos: TodoLike[]): boolean {
  if (!todos.length) return false;
  let done = 0;
  for (const t of todos) {
    if (t.status === "completed" || t.status === "cancelled") done++;
  }
  if (done >= todos.length) return false;
  return selectCurrentTodoIndex(todos) >= 0;
}

/** Hover tip text: only the current running/pending task content. */
export function currentTaskHoverText(
  todos: TodoLike[],
  fallback = "",
): string {
  const idx = selectCurrentTodoIndex(todos);
  if (idx < 0) return fallback;
  const content = todos[idx]?.content?.trim();
  return content || fallback;
}
