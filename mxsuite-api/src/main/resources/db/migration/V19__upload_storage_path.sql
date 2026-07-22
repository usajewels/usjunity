-- Add storage_path column to project_data_uploads for tracking uploaded file location
ALTER TABLE project_data_uploads
    ADD COLUMN storage_path VARCHAR(1000);
