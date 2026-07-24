import { memo } from "react";

/**
 * Left accent bar component that mirrors TUI's accent bar rendering:
 * - Running: animated wave gradient
 * - Completed: static colored bar (success green / failure red)
 * - Collapsed: dimmed
 * - Normal: theme accent color
 */
export const AccentBar = memo(function AccentBar({
  status,
  kind = "neutral",
  collapsed = false,
}: {
  status: "running" | "completed" | "failed" | "cancelled" | "neutral";
  kind?: "execute" | "read" | "edit" | "listDir" | "search" | "other" | "neutral";
  collapsed?: boolean;
}) {
  const isRunning = status === "running";
  const isFailed = status === "failed" || status === "cancelled";
  const isSuccess = status === "completed";

  let colorClass = "accent-neutral";
  if (isFailed) colorClass = "accent-fail";
  else if (isSuccess) colorClass = "accent-ok";
  else if (kind === "execute") colorClass = "accent-execute";
  else if (kind === "edit") colorClass = "accent-edit";
  else if (kind === "read") colorClass = "accent-read";
  else if (kind === "search") colorClass = "accent-search";
  else if (kind === "listDir") colorClass = "accent-listdir";

  return (
    <div
      className={`accent-bar ${colorClass}${isRunning ? " accent-running" : ""}${collapsed ? " accent-collapsed" : ""}`}
      aria-hidden="true"
    />
  );
});
