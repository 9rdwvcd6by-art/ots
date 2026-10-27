/* =========================================================
   src/utils/statusLabels.js
   Status keys are workflow-step names. One source of truth.
   ========================================================= */

export const STATUS_LABELS = {
  pending_verifier: "Pending Verifier",
  pending_confirmer: "Pending Confirmer",
  pending_initial_approver: "Pending Initial Approver",
  approved: "Approved",
  rejected_verifier: "Rejected by Verifier",
  rejected_confirmer: "Rejected by Confirmer",
  rejected_initial_approver: "Rejected by Initial Approver",
  rejected_final_approver: "Rejected by Final Approver",
  pending_initial_approver_internal: "Internal · Pending Initial Approver",
  pending_final_approver_internal: "Internal · Pending Final Approver",
  approved_final_approver: "Internal · Approved",
  withdrawn_internal: "Internal · Withdrawn",
};

export const STATUS_BADGE = {
  pending_verifier: "badge badge-pending",
  pending_confirmer: "badge badge-pending",
  pending_initial_approver: "badge badge-pending",
  approved: "badge badge-approved",
  rejected_verifier: "badge badge-rejected",
  rejected_confirmer: "badge badge-rejected",
  rejected_initial_approver: "badge badge-rejected",
  rejected_final_approver: "badge badge-rejected",
  pending_initial_approver_internal: "badge badge-pending",
  pending_final_approver_internal: "badge badge-pending",
  approved_final_approver: "badge badge-approved",
  withdrawn_internal: "badge",
};

export const STATUS_FLOW = {
  pending: [
    "pending_verifier",
    "pending_confirmer",
    "pending_initial_approver",
  ],
  pendingInternal: [
    "pending_initial_approver_internal",
    "pending_final_approver_internal",
  ],
  approved: ["approved", "approved_final_approver"],
  rejected: [
    "rejected_verifier",
    "rejected_confirmer",
    "rejected_initial_approver",
    "rejected_final_approver",
  ],
};

export const ALL_PENDING = [...STATUS_FLOW.pending, ...STATUS_FLOW.pendingInternal];
export const ALL_APPROVED = [...STATUS_FLOW.approved];

export function isInternalStatus(status) {
  return (
    status === "pending_initial_approver_internal" ||
    status === "pending_final_approver_internal" ||
    status === "approved_final_approver" ||
    status === "rejected_final_approver" ||
    status === "withdrawn_internal"
  );
}