-- =========================================================
-- V31: SQL Server Staging + S3 Parquet Export tracking
-- =========================================================

ALTER TABLE project_data_uploads
    ADD COLUMN staging_status VARCHAR(30) NOT NULL DEFAULT 'NONE',
    ADD COLUMN staging_db_name VARCHAR(200),
    ADD COLUMN staging_schema_name VARCHAR(200),
    ADD COLUMN staging_error TEXT,
    ADD COLUMN s3_export_status VARCHAR(30) NOT NULL DEFAULT 'NONE',
    ADD COLUMN s3_base_path VARCHAR(1000),
    ADD COLUMN s3_export_error TEXT,
    ADD COLUMN s3_exported_at TIMESTAMPTZ;

CREATE INDEX idx_uploads_staging_status ON project_data_uploads(staging_status)
    WHERE staging_status = 'STAGED';

CREATE INDEX idx_uploads_export_status ON project_data_uploads(s3_export_status)
    WHERE s3_export_status = 'EXPORTED';
