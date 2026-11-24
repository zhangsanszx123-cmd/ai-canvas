ALTER TABLE ac_tasks ADD COLUMN IF NOT EXISTS attachment_ids jsonb NOT NULL DEFAULT '[]';
