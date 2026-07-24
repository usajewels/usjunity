-- Phase time tracking: one row per project per phase, recording start/end timestamps
CREATE TABLE phase_time_entries (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase            VARCHAR(30) NOT NULL CHECK (phase IN ('DISCOVER','MAP','GENERATE','DRY_RUN','MIGRATE','CUT_OVER')),
    started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at     TIMESTAMPTZ,
    created_by       UUID,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_modified_by UUID,
    last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    administrator_id UUID,
    UNIQUE(project_id, phase)
);

CREATE INDEX idx_phase_time_project ON phase_time_entries(project_id);

-- Backfill: create DISCOVER entries for existing projects that have a migration phase set
INSERT INTO phase_time_entries (id, project_id, phase, started_at, created_at, last_modified_at)
SELECT uuid_generate_v4(), p.id, 'DISCOVER', p.created_at, NOW(), NOW()
FROM projects p
WHERE p.migration_phase IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM phase_time_entries pte WHERE pte.project_id = p.id AND pte.phase = 'DISCOVER'
  );

-- For projects past DISCOVER, mark DISCOVER as completed and create entries for subsequent phases
-- We use phase gate cleared_at timestamps where available as completion markers
DO $$
DECLARE
    proj RECORD;
    phases TEXT[] := ARRAY['DISCOVER','MAP','GENERATE','DRY_RUN','MIGRATE','CUT_OVER'];
    phase_idx INT;
    current_idx INT;
    gate_cleared TIMESTAMPTZ;
    prev_end TIMESTAMPTZ;
BEGIN
    FOR proj IN
        SELECT p.id, p.migration_phase, p.created_at
        FROM projects p
        WHERE p.migration_phase IS NOT NULL
          AND p.migration_phase != 'DISCOVER'
    LOOP
        -- Find the index of the current phase
        current_idx := array_position(phases, proj.migration_phase::TEXT);
        prev_end := proj.created_at;

        -- Create entries for all phases up to and including current
        FOR phase_idx IN 1..current_idx LOOP
            -- Try to get the gate cleared_at for this phase as its end time
            SELECT pg.cleared_at INTO gate_cleared
            FROM phase_gates pg
            WHERE pg.project_id = proj.id
              AND pg.phase = phases[phase_idx];

            IF phase_idx < current_idx THEN
                -- Completed phases
                INSERT INTO phase_time_entries (id, project_id, phase, started_at, completed_at, created_at, last_modified_at)
                VALUES (uuid_generate_v4(), proj.id, phases[phase_idx], prev_end,
                        COALESCE(gate_cleared, prev_end + interval '1 second'), NOW(), NOW())
                ON CONFLICT (project_id, phase) DO UPDATE
                    SET completed_at = COALESCE(EXCLUDED.completed_at, phase_time_entries.completed_at);
                prev_end := COALESCE(gate_cleared, prev_end + interval '1 second');
            ELSE
                -- Current phase (still active, no completed_at)
                INSERT INTO phase_time_entries (id, project_id, phase, started_at, created_at, last_modified_at)
                VALUES (uuid_generate_v4(), proj.id, phases[phase_idx], prev_end, NOW(), NOW())
                ON CONFLICT (project_id, phase) DO NOTHING;
            END IF;
        END LOOP;
    END LOOP;
END $$;
