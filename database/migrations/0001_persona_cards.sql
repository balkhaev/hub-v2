BEGIN;

CREATE TYPE persona_subject_type AS ENUM (
  'fictional',
  'brand_character',
  'consenting_adult'
);

CREATE TYPE persona_status AS ENUM ('active', 'archived');
CREATE TYPE persona_consent_status AS ENUM ('not_required', 'attested', 'verified', 'revoked');
CREATE TYPE persona_reference_usage AS ENUM ('identity', 'appearance', 'wardrobe', 'pose', 'style');
CREATE TYPE generation_usage AS ENUM ('internal_concept', 'organic_social', 'paid_media', 'owned_media');
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
  visual_profile jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(visual_profile) = 'object'),
  consent_status persona_consent_status NOT NULL,
  consent_basis text,
  consent_attested_by text,
  consent_attested_at timestamptz,
  consent_expires_at timestamptz,
  consent_scope jsonb NOT NULL DEFAULT '{"allowedMedia":["image","video"],"commercialUse":false}'::jsonb
    CHECK (jsonb_typeof(consent_scope) = 'object'),
  age_confirmed boolean NOT NULL DEFAULT false,
  primary_reference_id text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, slug),
  CHECK (
    subject_type <> 'consenting_adult'
    OR (
      age_confirmed = true
      AND consent_status IN ('attested', 'verified', 'revoked')
      AND consent_basis IS NOT NULL
      AND consent_attested_by IS NOT NULL
    )
  )
);

CREATE TABLE persona_references (
  id text PRIMARY KEY CHECK (id ~ '^pref_[a-f0-9]{32}$'),
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  persona_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  kind text NOT NULL DEFAULT 'source_photo',
  usage persona_reference_usage NOT NULL DEFAULT 'identity',
  label text NOT NULL,
  notes text,
  object_key text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png', 'image/webp')),
  file_name text,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, persona_id, id),
  UNIQUE (persona_id, version),
  CONSTRAINT persona_references_persona_fk
    FOREIGN KEY (workspace_id, persona_id)
    REFERENCES personas(workspace_id, id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE personas
  ADD CONSTRAINT personas_primary_reference_fk
  FOREIGN KEY (workspace_id, id, primary_reference_id)
  REFERENCES persona_references(workspace_id, persona_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX persona_references_workspace_hash_idx
  ON persona_references(workspace_id, sha256);

CREATE TABLE persona_versions (
  id text PRIMARY KEY CHECK (id ~ '^pver_[a-f0-9]{32}$'),
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  persona_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  display_name text NOT NULL,
  subject_type persona_subject_type NOT NULL,
  visual_profile jsonb NOT NULL CHECK (jsonb_typeof(visual_profile) = 'object'),
  primary_reference_id text NOT NULL,
  reference_ids jsonb NOT NULL CHECK (jsonb_typeof(reference_ids) = 'array'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, persona_id, version),
  CONSTRAINT persona_versions_persona_fk
    FOREIGN KEY (workspace_id, persona_id)
    REFERENCES personas(workspace_id, id)
    ON DELETE CASCADE,
  CONSTRAINT persona_versions_primary_reference_fk
    FOREIGN KEY (workspace_id, persona_id, primary_reference_id)
    REFERENCES persona_references(workspace_id, persona_id, id)
);

CREATE TABLE generation_requests (
  id text PRIMARY KEY CHECK (id ~ '^gen_[a-f0-9]{32}$'),
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  input_hash char(64) NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  status generation_status NOT NULL DEFAULT 'draft',
  usage generation_usage NOT NULL DEFAULT 'internal_concept',
  provider text NOT NULL DEFAULT 'runpod',
  provider_job_id text,
  resolved_model jsonb,
  input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, idempotency_key)
);

CREATE TABLE generation_persona_bindings (
  workspace_id text NOT NULL,
  generation_id text NOT NULL,
  ordinal smallint NOT NULL CHECK (ordinal >= 0),
  persona_id text NOT NULL,
  persona_version integer NOT NULL CHECK (persona_version > 0),
  persona_version_id text NOT NULL REFERENCES persona_versions(id),
  reference_id text NOT NULL,
  reference_sha256 char(64) NOT NULL CHECK (reference_sha256 ~ '^[a-f0-9]{64}$'),
  role text NOT NULL DEFAULT 'subject',
  identity_mode text NOT NULL DEFAULT 'balanced'
    CHECK (identity_mode IN ('strict', 'balanced', 'loose')),
  reference_strength numeric(4,3) NOT NULL DEFAULT 0.800 CHECK (
    reference_strength >= 0 AND reference_strength <= 1
  ),
  preserve_face boolean NOT NULL DEFAULT true,
  preserve_wardrobe boolean NOT NULL DEFAULT false,
  consent_decision jsonb NOT NULL CHECK (jsonb_typeof(consent_decision) = 'object'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  PRIMARY KEY (generation_id, ordinal),
  UNIQUE (generation_id, persona_id),
  CONSTRAINT generation_bindings_generation_fk
    FOREIGN KEY (workspace_id, generation_id)
    REFERENCES generation_requests(workspace_id, id)
    ON DELETE CASCADE,
  CONSTRAINT generation_bindings_persona_version_fk
    FOREIGN KEY (workspace_id, persona_id, persona_version)
    REFERENCES persona_versions(workspace_id, persona_id, version),
  CONSTRAINT generation_bindings_reference_fk
    FOREIGN KEY (workspace_id, persona_id, reference_id)
    REFERENCES persona_references(workspace_id, persona_id, id)
);

CREATE TABLE outbox_events (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX outbox_events_unpublished_idx
  ON outbox_events(occurred_at)
  WHERE published_at IS NULL;

COMMIT;
