-- V30: Add source tracking to semantic_decisions for AI-generated decisions
ALTER TABLE semantic_decisions ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'MANUAL';

CREATE INDEX idx_decisions_project_source_status
    ON semantic_decisions(project_id, source, decision_status);
