import { useState } from "react";
import type { PlanApprovalUi } from "@shared/types";
import type { Messages } from "./i18n";

type Props = {
  approval: PlanApprovalUi;
  m: Messages;
  onRespond: (
    requestId: string,
    outcome: "approved" | "cancelled" | "abandoned",
    feedback?: string,
  ) => void;
};

/**
 * Floating plan-approval card that sits directly above the composer
 * (matching the ChatGPT-style "Approve this plan?" surface). The same
 * approval state is still reflected in the right-side Plan panel as a
 * small badge, but the actual decision UI lives here so users see it
 * right where they'll be typing their next message.
 */
export function PlanApprovalCard({ approval, m, onRespond }: Props) {
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const hasPlan = approval.hasPlan;

  return (
    <div className="plan-approval-card" role="region" aria-label={m.planApprovalTitle}>
      <div className="plan-approval-card-head">
        <span className="plan-approval-card-title">
          {hasPlan ? m.planApprovalTitle : m.planApprovalEmptyTitle}
        </span>
        <button
          type="button"
          className="plan-approval-card-collapse"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand" : "Collapse"}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "▾" : "▴"}
        </button>
      </div>
      {!collapsed ? (
        <>
          <div className="plan-approval-card-hint">
            {hasPlan ? m.planApprovalHint : m.planApprovalEmptyHint}
          </div>
          {showFeedback ? (
            <div className="plan-approval-feedback">
              <textarea
                className="plan-approval-feedback-input"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder={m.planApprovalFeedbackPlaceholder}
                rows={3}
                autoFocus
              />
              <div className="plan-approval-feedback-actions">
                <button
                  type="button"
                  className="plan-approval-btn secondary"
                  onClick={() => {
                    setShowFeedback(false);
                    setFeedback("");
                  }}
                >
                  {m.planApprovalCancelFeedback}
                </button>
                <button
                  type="button"
                  className="plan-approval-btn primary"
                  disabled={!feedback.trim()}
                  onClick={() => {
                    onRespond(approval.requestId, "cancelled", feedback.trim());
                    setShowFeedback(false);
                    setFeedback("");
                  }}
                >
                  {m.planApprovalSendFeedback}
                </button>
              </div>
            </div>
          ) : (
            <div className="plan-approval-actions">
              <button
                type="button"
                className="plan-approval-btn primary"
                onClick={() => onRespond(approval.requestId, "approved")}
              >
                {m.planApprovalApprove}
              </button>
              <button
                type="button"
                className="plan-approval-btn secondary"
                onClick={() => setShowFeedback(true)}
              >
                {m.planApprovalRequestChanges}
              </button>
              <button
                type="button"
                className="plan-approval-btn danger"
                onClick={() => onRespond(approval.requestId, "abandoned")}
              >
                {m.planApprovalAbandon}
              </button>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}