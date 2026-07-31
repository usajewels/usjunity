-- Track who resolved validation issues and when
ALTER TABLE validation_issues
    ADD COLUMN resolved_by VARCHAR(255),
    ADD COLUMN resolved_by_name VARCHAR(255),
    ADD COLUMN resolved_at TIMESTAMP;
