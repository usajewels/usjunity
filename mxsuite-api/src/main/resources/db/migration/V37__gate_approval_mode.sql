-- Add configurable approval mode to phase gates
-- Modes: AUTO (immediate), MEMBER_ONLY (tenant admin), COACH_ONLY (coach/admin), BOTH (member + coach)
ALTER TABLE phase_gates
    ADD COLUMN IF NOT EXISTS approval_mode VARCHAR(20) NOT NULL DEFAULT 'AUTO';
