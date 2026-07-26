# Hub v2

Chat-first content operations platform for Luv. The first implementation slice introduces reusable visual identities: a source photo becomes a versioned **Persona / NPC Card**, and every media generation request stores an immutable snapshot of the persona and reference used.

## What works

- Create an NPC card from one JPEG, PNG, or WebP reference photo.
- Store the original reference as an immutable content-addressed object.
- Record subject type, consent attestation, visual description, immutable traits, and negative traits.
- Render a typed `persona.card` widget in a chat-oriented web interface.
- Add newer reference photos while preserving previous versions.
- Create an image or video generation request that snapshots the selected persona version and SHA-256 reference.
- Persist locally with atomic JSON writes; a PostgreSQL migration defines the production schema.
- Run without third-party runtime dependencies.

The Runpod dispatch action is intentionally not executed yet. Generation requests stop at `ready_for_dispatch`; this creates the durable boundary needed for the next serverless worker adapter.

## Run locally

Requirements: Node.js 22 or newer.

```bash
cp .env.example .env
npm run check
npm run dev
```

Open `http://localhost:3000`, create an NPC card, select it, and submit a generation request from the composer.

Local state is written to `./data`:

```text
data/
├── hub.json
└── objects/<workspace>/persona-references/<hash-prefix>/<sha256>.<ext>
```

## API

The local demo defaults to `ws_demo` and `local-user`. Production mode should set `HUB_REQUIRE_CONTEXT_HEADERS=true` and provide authenticated context:

```http
x-workspace-id: ws_...
x-actor-id: usr_...
```

Endpoints:

```text
GET  /health
GET  /api/v1/personas
POST /api/v1/personas
GET  /api/v1/personas/:personaId
POST /api/v1/personas/:personaId/references
POST /api/v1/generations
GET  /api/v1/generations/:generationId
```

Example create request:

```json
{
  "displayName": "Mira",
  "subjectType": "fictional",
  "visualDescription": "Editorial heroine with a short dark bob",
  "immutableTraits": ["green eyes", "heart-shaped face"],
  "negativeTraits": ["different eye color"],
  "sourceImage": {
    "contentType": "image/png",
    "dataBase64": "<base64>",
    "fileName": "mira.png"
  }
}
```

For a real adult subject, `subjectType: "consenting_adult"` requires an explicit adult confirmation and consent attestation.

## Repository map

```text
apps/api/                 zero-dependency HTTP API and development adapters
apps/web/                 chat-style interface and widget renderer
packages/contracts/       validation, IDs, generation and widget contracts
database/migrations/      PostgreSQL production schema
docs/persona-cards.md     identity lifecycle and Runpod handoff
docs/architecture.md      wider Hub architecture
```

## Design invariant

A chat message or widget is never the source of truth. Persona, reference, consent, generation, and lineage records are canonical API entities. Widgets contain a projection and named commands only.
