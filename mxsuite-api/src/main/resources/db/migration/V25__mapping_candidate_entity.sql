-- V25: Add target_entity to mapping_candidates for entity-aware mappings
ALTER TABLE mapping_candidates ADD COLUMN target_entity VARCHAR(200);
