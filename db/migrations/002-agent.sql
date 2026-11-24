ALTER TABLE ac_assets ADD COLUMN IF NOT EXISTS filename text;
ALTER TABLE ac_nodes ALTER COLUMN task_id DROP NOT NULL;
ALTER TABLE ac_tasks ADD COLUMN IF NOT EXISTS reference_asset_ids jsonb NOT NULL DEFAULT '[]';
ALTER TABLE ac_projects ADD COLUMN IF NOT EXISTS agent_messages jsonb NOT NULL DEFAULT '[]';
ALTER TABLE ac_projects ADD COLUMN IF NOT EXISTS agent_lease_until timestamptz;
