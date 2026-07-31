-- V36: Add BaseEntity audit columns to chat_files (missed in V35)
ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS last_modified_by UUID;
ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS last_modified_at TIMESTAMPTZ;
ALTER TABLE chat_files ADD COLUMN IF NOT EXISTS administrator_id UUID;
