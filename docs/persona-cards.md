# Persona / NPC Cards

## Goal

A content operator uploads one source photo, names the visual identity, and can reliably reuse it in later image and video generations. The card behaves like an NPC card in a game: a stable identity with immutable revisions, visual anchors, reference provenance, rights metadata and explicit generation bindings.

The system stores a selected visual reference. It does not identify a person, search for face matches or infer a real-world identity.

## Domain model

Four records have deliberately different lifecycles:

- **Persona** — current aggregate and stable `persona_id`. It points to the latest revision and primary reference.
- **PersonaVersion** — immutable identity revision. It freezes name, subject class, visual profile, identity locks and the references that existed at that moment.
- **Reference** — immutable source image, content-addressed by SHA-256 and labelled by intended usage.
- **Generation snapshot** — immutable selection of PersonaVersion, Reference, current consent decision, workflow parameters and seed.

```text
Persona per_... (current version 3)
├── PersonaVersion 1
│   └── Reference A / identity
├── PersonaVersion 2
│   ├── Reference A / identity
│   └── Reference B / wardrobe
└── PersonaVersion 3
    ├── Reference A / identity
    ├── Reference B / wardrobe
    └── Reference C / identity (primary)
```

The current Persona may evolve. Historical PersonaVersion records and source files never change.

## Why one photo is enough for v1

The first revision stores the original image and optional human-authored visual anchors. It does not require a face embedding or trained LoRA. A Runpod workflow can later use IP-Adapter, InstantID, PuLID, a LoRA or another reference-conditioned pipeline.

The Hub contract stays model-neutral:

```text
persona_id
persona_version
persona_version_id
reference_id
reference_sha256
reference_usage
reference_strength
identity_mode
preserve_face
preserve_wardrobe
visual_profile
consent_decision
```

The worker adapter translates this stable contract into model-specific nodes and inputs.

## References

Each reference has one usage label:

```text
identity     canonical face/identity anchor
appearance   general appearance or body presentation
wardrobe     clothing or accessories
pose         posture/composition guidance
style        visual treatment rather than identity
```

A new upload always creates a new reference and a new PersonaVersion. Even when it is not selected as primary, the revision changes because the available reference set changed.

For the first Runpod adapter, one primary identity image is sufficient. The data model already supports combining multiple references later with per-reference controls.

## Identity locks

The visual profile distinguishes human-authored traits from explicit preservation controls:

```json
{
  "description": "Editorial heroine with a short dark bob",
  "immutableTraits": ["green eyes", "heart-shaped face"],
  "variableTraits": ["outfit", "location"],
  "negativeTraits": ["different eye colour", "facial tattoo"],
  "generationNotes": "Keep natural skin texture",
  "identityLocks": {
    "face": true,
    "hair": true,
    "body": false,
    "distinguishingMarks": true,
    "voice": false
  }
}
```

`identityMode` on a generation can be `strict`, `balanced` or `loose`. The Runpod adapter will map this plus `referenceStrength` and identity locks to a concrete workflow.

## Version and lineage rules

1. Original media blobs are immutable and content-addressed by SHA-256.
2. Adding a photo creates a new Reference; a blob is never replaced.
3. Every identity/reference-set change creates an immutable PersonaVersion.
4. Reference updates use optimistic concurrency through `expectedPersonaVersion`.
5. A generation may select the latest revision or explicitly pin a historical one.
6. A selected reference must belong to the Persona and must have existed in that PersonaVersion.
7. A generation freezes the exact revision, reference hash, visual profile, consent decision, workflow version and seed.
8. Updating the Persona later cannot change a historical generation.
9. Generated assets must record the originating generation and all frozen identity identifiers.

```text
PersonaVersion v2
  └── Reference v2 (sha256:...)
       └── Generation request (requestHash + inputHash + seed)
            └── Runpod job
                 └── Asset version
                      └── Social publication
                           └── Metrics
```

## Reproducibility and retries

A generation has two hashes:

- `requestHash` — normalized user intent before system-resolved values. It is used to validate idempotent retries.
- `inputHash` — fully resolved generation input including seed and frozen persona snapshots. It identifies what will actually be dispatched.

When an idempotency key is supplied, the default seed is derived deterministically from workspace plus key. An identical retry returns the existing generation. Reusing the key for different normalized input fails with `409 idempotency_conflict`.

The Runpod adapter must resolve and persist the actual model ID/version and container/workflow digest before or during dispatch.

## Consent and subject classes

The initial classes are:

- `fictional` — synthetic or fictional NPC; human consent is not required.
- `brand_character` — company-controlled mascot or character; rights remain an operational requirement.
- `consenting_adult` — real adult subject; requires age confirmation, consent basis and attestor.

Consent for a real subject includes:

```text
status: attested | verified | revoked
allowedMedia: image and/or video
commercialUse: boolean
expiresAt: optional timestamp
basis and attestor
```

Two time dimensions matter:

- PersonaVersion preserves what the visual identity looked like at generation time.
- The **current** Persona consent determines whether a new generation may use that historical revision now.

Therefore revoking or expiring consent prevents new generations from old revisions without rewriting historical records. Existing generated assets and publications require a separate takedown/retention workflow, which is intentionally outside this first slice.

Marketing usages (`organic_social`, `paid_media`, `owned_media`) require `commercialUse=true`. Output type must appear in `allowedMedia`.

Recommended production additions:

- signed model-release document asset;
- territory, platform and content-class scope;
- approver identity and verification workflow;
- revocation reason and effective timestamp;
- takedown workflow for derived assets/publications;
- audit event for every generation and publication using a real subject.

## Widget contract

The chat receives `persona.card@1`:

```json
{
  "type": "persona.card",
  "version": 1,
  "entity": { "kind": "persona", "id": "per_..." },
  "snapshot": {
    "displayName": "Mira",
    "version": 2,
    "imageUrl": "<short-lived signed URL>",
    "immutableTraits": ["green eyes"],
    "identityLocks": { "face": true, "hair": true },
    "consentStatus": "not_required",
    "reference": {
      "id": "pref_...",
      "version": 2,
      "usage": "identity",
      "sha256": "..."
    }
  },
  "actions": [
    {
      "command": "generation.use_persona",
      "input": { "personaId": "per_...", "personaVersion": 2 }
    },
    {
      "command": "persona.add_reference",
      "input": { "personaId": "per_...", "expectedPersonaVersion": 2 }
    }
  ]
}
```

The server re-authorizes every command. The widget is a projection; canonical state is loaded by entity ID.

## Private media access

Persona references are not exposed through permanent public object URLs. The API issues a short-lived HMAC-signed URL bound to:

```text
workspace_id
reference_id
purpose: preview | generation
expires_at
```

The media handler verifies the signature, expiry and purpose, resolves the reference inside the workspace and only then reads its internal object key. Object keys are never returned in public generation payloads.

Production object storage should use the same semantics with presigned S3/R2 URLs or an authenticated media proxy. The signing secret must be unique, rotated operationally and never shared with agents or Runpod jobs.

## Runpod handoff

The adapter consumes a generation in `ready_for_dispatch`, resolves current authorization again, mints short-lived generation-purpose URLs for the frozen reference objects, and submits a serverless job:

```json
{
  "jobId": "gen_...",
  "requestHash": "...",
  "inputHash": "...",
  "workflow": {
    "id": "persona-reference-v1",
    "version": "1",
    "digest": "sha256:..."
  },
  "model": {
    "id": "...",
    "version": "...",
    "digest": "sha256:..."
  },
  "input": {
    "prompt": "...",
    "outputType": "video",
    "aspectRatio": "9:16",
    "seed": 42
  },
  "personas": [
    {
      "personaId": "per_...",
      "personaVersion": 2,
      "personaVersionId": "pver_...",
      "referenceId": "pref_...",
      "referenceSha256": "...",
      "referenceUrl": "<short-lived generation URL>",
      "referenceStrength": 0.8,
      "identityMode": "strict",
      "preserveFace": true
    }
  ],
  "outputUpload": {
    "manifestUrl": "<signed company-controlled upload URL>"
  }
}
```

The worker uploads outputs to company-controlled storage before returning. Webhook delivery is not sufficient by itself; a reconciliation worker must poll unresolved provider jobs. Every callback and state transition must be idempotent.

## Security boundaries

- Workspace context participates in queries, signatures, object keys and composite database constraints.
- Local serving rejects path traversal and never accepts a raw object key from a public URL.
- JPEG, PNG and WebP MIME declarations must match file signatures.
- Persona media uses short-lived signed URLs.
- CORS is restricted to configured origins and security headers are enabled.
- Social and Runpod credentials never enter an agent prompt.
- Current consent and archive state are checked before every new generation.
- Public generation payloads omit internal object keys.
- Marketing personas remain separate from private Luv user data.
