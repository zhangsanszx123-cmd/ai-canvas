CREATE TABLE ac_skills (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 project_id uuid NOT NULL REFERENCES ac_projects(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(name ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(name)<=64),
 description text NOT NULL, source text NOT NULL, body text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,project_id,name)
);
ALTER TABLE ac_tasks ADD COLUMN batch_id uuid;
