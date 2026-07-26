BEGIN;

CREATE TYPE persona_subject_type AS ENUM (
  'fictional',
  'brand_character',
  'consenting_adult'
);

CREATE TYPE persona_status AS ENUM ('active', 'archived');
CREATE TYPE persona_consent_status AS ENUM ('not_required', 'attested', 'verified', 'revoked');
CREATE TYPE generation_status AS ENUM (
  'draft',
  'ready_for_dispatch',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled'
);

CREATE TABLE workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE personas (
  id text PRIMARY KEY CHECK (id ~ '^per_[a-f0-9]{32}$'),
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug text NOT NULL,
  display_name text NOT NULL,
  subject_type persona_subject_type NOT NULL,
  status persona_status NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  visual_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent_status persona_consent_status NOT NULL,
  consent_basis text,
  consent_attested_by text,
  consent_attested_at timestamptz,
  age_confirmed boolean NOT NULL DEFAULT false,
  primary_reference_id text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug),
  CHECK (
    subject_type <> 'consenting_adult'
    OR (
      age_confirmed = true
      AND consent_status IN ('attested', 'verified')
      AND consent_basis IS NOT NULL
      AND consent_attested_by IS NOT NULL
    )
  )
);

CREATE TABLE persona_references (
  id text PRIMARY KEY CHECK (id ~ '^pref_[a-f0-9]{32}$'),
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  persona_id text NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  kind text NOT NULL DEFAULT 'source_photo',
  label text NOT NULL,
  notes text,
  object_key text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png', 'image/webp')),
  file_name text,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (persona_id, version)
);

ALTER TABLE personas
  ADD CONSTRAINT personas_primary_reference_fk
  FOREIGN KEY (primary_reference_id)
  REFERENCES persona_references(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX persona_references_workspace_hash_idx
  ON persona_references(workspace_id, sha256);

CREATE TABLE generation_requests (
  id text PRIMARY KEY CHECK (id ~ '^gen_[a-f0-9]{32}$'),
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status generation_status NOT NULL DEFAULT 'draft',
  provider text NOT NULL DEFAULT 'runpod',
  provider_job_id text,
  input jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE generation_persona_bindings (
  generation_id text NOT NULL REFERENCES generation_requests(id) ON DELETE CASCADE,
  ordinal smallint NOT NULL CHECK (ordinal >= 0),
  persona_id text NOT NULL REFERENCES personas(id),
  persona_version integer NOT NULL CHECK (persona_version > 0),
  reference_id text NOT NULL REFERENCES persona_references(id),
  reference_sha256 char(64) NOT NULL CHECK (reference_sha256 ~ '^[a-f0-9]{64}$'),
  role text NOT NULL DEFAULT 'subject',
  reference_strength numeric(4,3) NOT NULL DEFAULT 0.800 CHECK (
    reference_strength >= 0 AND reference_strength <= 1
  ),
  preserve_face boolean NOT NULL DEFAULT true,
  preserve_wardrobe boolean NOT NULL DEFAULT false,
  snapshot jsonb NOT NULL,
  PRIMARY KEY (generation_id, ordinal),
  UNIQUE (generation_id, persona_id)
);

CREATE TABLE outbox_events (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX outbox_events_unpublished_idx
  ON outbox_events(occurred_at)
  WHERE published_at IS NULL;

COMMIT;
