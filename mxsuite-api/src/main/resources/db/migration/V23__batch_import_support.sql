-- Add batch import tracking columns to project_data_uploads
ALTER TABLE project_data_uploads
    ADD COLUMN total_file_size BIGINT,
    ADD COLUMN import_status VARCHAR(30) NOT NULL DEFAULT 'NONE',
    ADD COLUMN import_progress_pct INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN imported_row_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN import_error TEXT,
    ADD COLUMN chunks_received INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN chunks_total INTEGER NOT NULL DEFAULT 0;
