BEGIN;

CREATE TYPE creative_job_status AS ENUM (
  'planning',
  'ready_for_generation',
  'generating',
  'evaluating',
  'ready_for_review',
  'completed',
  'failed',
  'cancelled'
);

CREATE TABLE creative_jobs (
  id text PRIMARY KEY CHECK (id ~ '^cjob_[a-f0-9]{32}$'),
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type = 'short_drama'),
  idempotency_key text NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  status creative_job_status NOT NULL,
  stage text NOT NULL,
  progress numeric(5,4) NOT NULL CHECK (progress >= 0 AND progress <= 1),
  brief jsonb NOT NULL,
  iterations jsonb NOT NULL DEFAULT '[]'::jsonb,
  evaluator jsonb NOT NULL,
  best_version jsonb,
  stage_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  render_summary jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, idempotency_key),
  UNIQUE (workspace_id, id),
  CHECK ((best_version IS NOT NULL) OR status = 'planning')
);

ALTER TABLE generation_requests
  ADD COLUMN IF NOT EXISTS creative_job_id text,
  ADD COLUMN IF NOT EXISTS creative_version_id text,
  ADD COLUMN IF NOT EXISTS shot_id text,
  ADD COLUMN IF NOT EXISTS provider_state jsonb,
  ADD COLUMN IF NOT EXISTS provider_output jsonb,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE generation_requests
  ADD CONSTRAINT generation_requests_creative_job_fk
  FOREIGN KEY (creative_job_id)
  REFERENCES creative_jobs(id)
  ON DELETE SET NULL;

CREATE INDEX creative_jobs_workspace_updated_idx
  ON creative_jobs(workspace_id, updated_at DESC);

CREATE INDEX generation_requests_creative_job_idx
  ON generation_requests(workspace_id, creative_job_id, shot_id)
  WHERE creative_job_id IS NOT NULL;

COMMIT;
