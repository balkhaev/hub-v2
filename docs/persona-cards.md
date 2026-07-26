# Persona / NPC Cards

## Goal

A content operator should be able to upload one source photo, name the visual identity, and reliably reuse that identity in later image and video generations. The card behaves like an NPC card in a game: a stable identity with visual anchors, versioned references, rights metadata, and explicit generation bindings.

## Terms

- **Persona** — reusable visual identity, not a login account and not a Luv end user.
- **Reference** — immutable source image attached to the persona.
- **Primary reference** — the reference selected for new generation requests.
- **Persona version** — increments whenever references or identity metadata changes.
- **Generation snapshot** — frozen copy of the persona version and reference hash used by one request.

## Why one photo is enough for v1

The first card stores the original image and optional human-authored visual anchors. It does not require face embeddings or a trained LoRA. A Runpod workflow can start with IP-Adapter, InstantID, PuLID, or another reference-conditioned pipeline later. The Hub contract is deliberately model-neutral:

```text
persona_id
persona_version
reference_id
reference_sha256
reference_strength
preserve_face
preserve_wardrobe
visual_profile
```

The worker adapter translates that stable contract into the inputs expected by a specific workflow.

## Version and lineage rules

1. Original media blobs are immutable and content-addressed by SHA-256.
2. Adding a new photo creates a new `persona_reference`; it never replaces a blob.
3. Setting a new primary reference increments `persona.version`.
4. A generation request snapshots the current persona and reference.
5. Updating the persona later cannot change a historical generation.
6. Generated assets should record the originating `generation_id`, `persona_id`, `persona_version`, and reference hashes.

This produces a lineage chain:

```text
Persona v2
  └── Reference v2 (sha256:...)
       └── Generation request
            └── Runpod job
                 └── Asset version
                      └── Social publication
                           └── Metrics
```

## Consent and subject classes

The API supports three initial classes:

- `fictional` — synthetic or fictional NPC; consent is not required.
- `brand_character` — company-controlled mascot or character; rights should be recorded operationally.
- `consenting_adult` — real adult subject; the card requires `ageConfirmed`, consent basis, and attestor.

The implementation intentionally does not identify people, search for matches, or infer a person's real-world identity. It stores a reference selected by an authorized operator for generation use.

Recommended production additions:

- signed release document asset;
- validity period and territory;
- allowed channels and content classes;
- revocation state;
- approver identity;
- audit event for every generation and publication using the persona.

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
    "imageUrl": "https://...",
    "immutableTraits": ["green eyes"],
    "consentStatus": "not_required",
    "reference": {
      "id": "pref_...",
      "version": 2,
      "sha256": "..."
    }
  },
  "actions": [
    { "command": "generation.use_persona", "input": { "personaId": "per_..." } },
    { "command": "persona.add_reference", "input": { "personaId": "per_..." } }
  ]
}
```

The server re-authorizes every command. The image URL and widget snapshot are presentation data; canonical state is loaded by entity ID.

## Runpod handoff

The next adapter should consume a generation record in `ready_for_dispatch`, mint short-lived read URLs for the snapshotted reference objects, and submit a serverless job:

```json
{
  "jobId": "gen_...",
  "workflow": { "id": "persona-reference-v1", "version": "sha256:..." },
  "input": {
    "prompt": "...",
    "outputType": "video",
    "aspectRatio": "9:16"
  },
  "personas": [
    {
      "personaId": "per_...",
      "personaVersion": 2,
      "referenceId": "pref_...",
      "referenceSha256": "...",
      "referenceUrl": "<short-lived signed URL>",
      "referenceStrength": 0.8,
      "preserveFace": true
    }
  ],
  "outputUpload": { "manifestUrl": "<signed URL>" }
}
```

The worker must upload outputs to company-controlled storage before returning. Runpod status and webhooks update the same generation entity and chat widget.

## Security boundaries

- Object keys are workspace-scoped.
- Local serving rejects path traversal.
- Only JPEG, PNG, and WebP are accepted; MIME and file signatures must agree.
- Production object access should use short-lived signed URLs rather than permanent public URLs.
- Social and Runpod credentials never enter the agent prompt.
- Persona use should be denied after consent revocation or archive.
- Marketing personas must remain separate from private Luv user data.
