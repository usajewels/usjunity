package com.mxsuite.model.enums;

/**
 * Controls who must approve a phase gate before it can be cleared.
 *
 * AUTO       — conditions met → gate clears immediately (no human sign-off needed)
 * COACH_ONLY — a coach/coach-admin must authorize in the approvals queue
 * BOTH       — member submits first, then coach authorizes; gate clears only when both done
 */
public enum GateApprovalMode {
    AUTO,
    COACH_ONLY,
    BOTH
}
