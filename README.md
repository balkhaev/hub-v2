# Hub v2

Chat-first content operations platform for Luv. The first implementation slice introduces reusable visual identities: one source photo becomes a versioned **Persona / NPC Card**, and every media generation request freezes the exact identity revision, reference and consent decision it used.

## What works

- Create an NPC card from one JPEG, PNG, or WebP reference photo.
- Store original references as immutable, content-addressed objects.
- Maintain immutable `PersonaVersion` revisions while the current Persona remains editable.
- Label references by purpose: identity, appearance, wardrobe, pose or style.
- Record visual anchors, identity locks, negative traits and generation notes.
- Record adult age/consent attestation, expiry, allowed media and commercial-use scope.
- Render typed `persona.card@1` and `generation.request@1` widgets in a chat-oriented interface.
- Pin an exact historical persona version and reference in image or video generation requests.
- Generate stable request/input hashes and make retried generation creation idempotent.
- Serve private persona images through short-lived, HMAC-signed URLs rather than exposing object keys.
- Persist locally with atomic JSON writes; a PostgreSQL migration defines the production schema and tenant-aware constraints.
- Run without third-party runtime dependencies.

Runpod dispatch is intentionally not executed yet. Generation requests stop at `ready_for_dispatch`; this is the durable boundary for the serverless worker adapter.

## Identity model

```text
Persona (current aggregate)
├── PersonaVersion v1 (immutable)
│   └── Reference A (immutable SHA-256)
├── PersonaVersion v2 (immutable)
│   ├── Reference A
│   └── Reference B (new primary)
└── current version = 2

Generation request
└── PersonaVersion v1 + Reference A + consent decision + seed + hashes
```

Changing the current Persona never mutates an earlier generation. A generation may explicitly select an older revision and a reference that existed in that revision.

## Run locally

Requirements: Node.js 22 or newer.

```bash
cp .env.example .env
npm run check
npm run dev
```

Open `http://localhost:3000`, create an NPC card, select it, and submit a generation request from the composer.

Local state is written to:

```text
data/
├── hub.json
└── objects/<workspace>/persona-references/<hash-prefix>/<sha256>.<ext>
```

## Production configuration

The local demo defaults to `ws_demo` and `local-user`. Production mode should require authenticated context and use a unique media-signing secret:

```env
HUB_REQUIRE_CONTEXT_HEADERS=true
HUB_MEDIA_SIGNING_SECRET=<at-least-24-random-characters>
HUB_ALLOWED_ORIGINS=https://hub.example.com
HUB_PUBLIC_ORIGIN=https://hub.example.com
```

Authenticated context is currently represented by trusted headers at the application boundary:

```http
x-workspace-id: ws_...
x-actor-id: usr_...
```

These headers are an integration seam for the future OIDC/SSO layer; they must not be accepted directly from an untrusted public proxy.

## API

```text
GET  /health
GET  /api/v1/personas
POST /api/v1/personas
GET  /api/v1/personas/:personaId
POST /api/v1/personas/:personaId/references
POST /api/v1/generations
GET  /api/v1/generations/:generationId
GET  /media/references/:referenceId?workspace=...&purpose=...&expires=...&signature=...
```

Generation retries can supply an `Idempotency-Key` header or `idempotencyKey` in the body. Reusing a key with identical normalized input returns the original generation; reusing it for different input returns `409 idempotency_conflict`.

Example persona request:

```json
{
  "displayName": "Mira",
  "subjectType": "fictional",
  "visualDescription": "Editorial heroine with a short dark bob",
  "immutableTraits": ["green eyes", "heart-shaped face"],
  "negativeTraits": ["different eye color"],
  "identityLocks": {
    "face": true,
    "hair": true,
    "distinguishingMarks": true
  },
  "sourceImage": {
    "contentType": "image/png",
    "dataBase64": "<base64>",
    "fileName": "mira.png",
    "usage": "identity"
  }
}
```

For a real adult subject, `subjectType: "consenting_adult"` requires explicit adult confirmation, consent basis and attestor. Media type, commercial-use scope and expiry are enforced when a generation is created.

## Repository map

```text
apps/api/                 zero-dependency HTTP API and development adapters
apps/web/                 chat-style interface and widget renderer
packages/contracts/       validation, IDs, generation and widget contracts
database/migrations/      PostgreSQL production schema
docs/persona-cards.md     identity lifecycle, consent and Runpod handoff
docs/architecture.md      wider Hub architecture
```

## Design invariants

- A chat message or widget is never the source of truth.
- Original reference files and PersonaVersion records are immutable.
- Every generation freezes its identity inputs and current authorization decision.
- Object keys and credentials never enter widgets or public API responses.
- Current consent can prevent new use of any historical persona revision.
- Workspace context is included in storage, signatures, queries and database constraints.
