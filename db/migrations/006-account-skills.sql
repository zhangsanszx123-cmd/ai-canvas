ALTER TABLE ac_skills ALTER COLUMN project_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ac_skills_account_name ON ac_skills(owner_id,name) WHERE project_id IS NULL;
