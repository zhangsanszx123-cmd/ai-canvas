CREATE TABLE IF NOT EXISTS ac_projects (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 name text NOT NULL, config jsonb NOT NULL DEFAULT '{"model":"gpt-image-2","size":"1:1","resolution":"1k","n":1}',
 viewport jsonb NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}', version integer NOT NULL DEFAULT 0,
 cover_asset_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ac_projects_owner_updated ON ac_projects(owner_id, updated_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS ac_assets (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 project_id uuid REFERENCES ac_projects(id) ON DELETE CASCADE, object_key text NOT NULL UNIQUE,
 mime text NOT NULL, width integer NOT NULL, height integer NOT NULL, bytes integer NOT NULL,
 source text NOT NULL DEFAULT 'upload', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ac_tasks (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES ac_projects(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 prompt text NOT NULL, reference_asset_id uuid REFERENCES ac_assets(id), config jsonb NOT NULL,
 idempotency_key text NOT NULL, request_hash text NOT NULL, provider_id text,
 status text NOT NULL DEFAULT 'submitting', progress integer NOT NULL DEFAULT 0,
 results jsonb NOT NULL DEFAULT '[]', error text, attempts integer NOT NULL DEFAULT 0,
 lease_until timestamptz, next_poll timestamptz NOT NULL DEFAULT now(), submitted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS ac_tasks_queue ON ac_tasks(status, next_poll);
CREATE INDEX IF NOT EXISTS ac_tasks_project ON ac_tasks(project_id,created_at);
CREATE TABLE IF NOT EXISTS ac_nodes (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES ac_projects(id) ON DELETE CASCADE,
 task_id uuid NOT NULL REFERENCES ac_tasks(id) ON DELETE CASCADE, asset_id uuid REFERENCES ac_assets(id),
 result_index integer NOT NULL DEFAULT 0, x double precision NOT NULL DEFAULT 80, y double precision NOT NULL DEFAULT 80,
 width double precision NOT NULL DEFAULT 480, height double precision NOT NULL DEFAULT 320,
 UNIQUE(task_id,result_index)
);
CREATE TABLE IF NOT EXISTS ac_rate_limits (
 key text PRIMARY KEY, count integer NOT NULL DEFAULT 1, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS ac_worker_health (id text PRIMARY KEY, heartbeat timestamptz NOT NULL);
