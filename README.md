# Hub v2

Chat-first content operations platform for Luv. Hub keeps reusable visual identities, creative versions, media generations, provider jobs, review state, publishing lineage and analytics as canonical entities behind a conversational interface.

## What works

### Persona / NPC identity

- Create a reusable NPC card from one JPEG, PNG or WebP reference photo.
- Store original references as immutable, content-addressed objects.
- Maintain immutable `PersonaVersion` revisions while the current Persona remains editable.
- Label references by purpose: identity, appearance, wardrobe, pose or style.
- Record visual anchors, identity locks, negative traits and generation notes.
- Record adult age/consent attestation, expiry, allowed media and commercial-use scope.
- Pin an exact historical persona version and reference in image or video generation requests.
- Serve private persona images through short-lived, workspace-bound signed URLs.

### Short drama production

- Use Hub from Codex or Claude Code through a project-scoped stdio MCP server.
- Ask the coding agent in natural language to make a short drama.
- Let the agent author several meaningfully different scripts.
- Normalize, score, refine and version the candidates inside Hub.
- Select an ideal script, hook, beat structure and timed shot plan.
- Create one idempotent video-generation request per shot.
- Support generic casting or exact Persona/version/reference bindings.
- Dispatch shot renders to Runpod Serverless when configured.
- Select the strongest provider output for each shot.
- Build an ordered assembly manifest.
- Dispatch final FFmpeg assembly and return a final MP4 asset through MCP and Hub widgets.

## Ask from Codex or Claude Code

The repository includes:

```text
.mcp.json          Claude Code project MCP configuration
.codex/config.toml Codex project MCP configuration
AGENTS.md          media-production rules for coding agents
CLAUDE.md          Claude-specific production rules
```

Start Hub:

```bash
cp .env.example .env
npm run check
npm run dev
```

Then ask the coding agent:

```text
Сделай 45-секундную шорт-драму для Reels.
Героиня видит на экране партнёра сообщение, отправленное год назад.
Используй NPC Mira, сохрани лицо и одежду. Подготовь три разные версии,
выбери лучшую через Hub и верни финальный ролик.
```

The expected tool flow is:

```text
hub_list_personas
hub_create_short_drama
hub_get_short_drama
hub_reconcile_short_drama
```

Claude Code asks for approval before enabling the project `.mcp.json`. Codex reads the project `.codex/config.toml`; the same server can also be registered globally through each client's MCP commands.

## Truthful creative status

```text
planning              brief is being prepared
ready_for_generation  ideal script and shot plan exist; no provider render is active
generating            shot rendering or final assembly is active
evaluating            provider results exist but selection/manifest is incomplete
ready_for_review       final MP4 exists, or an explicit render package exists without assembly
completed              a human or approved automation accepted the final version
failed                 a render, selection or assembly stage failed
```

Agents must not call `ready_for_generation` a finished video.

## Runpod

Set both values to enable automatic dispatch:

```env
RUNPOD_API_KEY=...
RUNPOD_ENDPOINT_ID=...
```

The reference worker is in:

```text
workers/runpod/short-drama/
```

One endpoint supports:

```text
render_shot
assemble_short_drama
```

It resolves a versioned ComfyUI API workflow, downloads signed Persona references, uploads candidate takes to S3/R2/MinIO, returns technical or external quality scores, normalizes selected clips with FFmpeg and uploads `final.mp4`.

## Identity model

```text
Persona (current aggregate)
├── PersonaVersion v1 (immutable)
│   └── Reference A (immutable SHA-256)
├── PersonaVersion v2 (immutable)
│   ├── Reference A
│   └── Reference B (new primary)
└── current version = 2

CreativeJob
└── CreativeVersion (ideal script and shot plan)
    ├── Generation shot-01
    │   └── PersonaVersion v1 + Reference A + consent decision + seed + hashes
    ├── Generation shot-02
    └── Assembly manifest
        └── Final asset
```

Changing the current Persona never mutates an earlier generation. Current consent can still block new use of any historical revision.

## Local state

Requirements: Node.js 22 or newer.

```text
data/
├── hub.json
└── objects/<workspace>/persona-references/<hash-prefix>/<sha256>.<ext>
```

The local atomic JSON adapter is for development. PostgreSQL migrations define the production schema.

## Production configuration

```env
HUB_REQUIRE_CONTEXT_HEADERS=true
HUB_MEDIA_SIGNING_SECRET=<at-least-24-random-characters>
HUB_ALLOWED_ORIGINS=https://hub.example.com
HUB_PUBLIC_ORIGIN=https://hub.example.com
HUB_MEDIA_URL_TTL_SECONDS=300
HUB_GENERATION_MEDIA_URL_TTL_SECONDS=1800
HUB_MEDIA_MAX_URL_TTL_SECONDS=3600
```

Authenticated context is currently represented by trusted application-boundary headers:

```http
x-workspace-id: ws_...
x-actor-id: usr_...
```

These headers are an integration seam for OIDC/SSO and must not be accepted directly from an untrusted public proxy.

## API

```text
GET  /health
GET  /api/v1/personas
POST /api/v1/personas
GET  /api/v1/personas/:personaId
POST /api/v1/personas/:personaId/references
POST /api/v1/generations
GET  /api/v1/generations/:generationId
POST /api/v1/generations/:generationId/dispatch
POST /api/v1/generations/:generationId/reconcile
GET  /api/v1/creative-jobs
POST /api/v1/creative-jobs
GET  /api/v1/creative-jobs/:creativeJobId
POST /api/v1/creative-jobs/:creativeJobId/reconcile
GET  /media/references/:referenceId?workspace=...&purpose=...&expires=...&signature=...
```

Generation and Creative Job retries accept an idempotency key. Reusing it with identical normalized input returns the original entity; reusing it for different input returns `409 idempotency_conflict`.

## Repository map

```text
apps/api/                         Hub HTTP API and orchestration
apps/mcp/                         Codex/Claude stdio MCP server
apps/web/                         chat-style interface and widget renderer
packages/contracts/               validation and typed widget contracts
database/migrations/              PostgreSQL production schema
workers/runpod/short-drama/       render and final-assembly worker
docs/persona-cards.md             identity and consent model
docs/mcp-short-drama.md           agent and MCP workflow
docs/architecture.md              wider Hub architecture
```

## Design invariants

- A chat message or widget is never the source of truth.
- Original reference files and PersonaVersion records are immutable.
- Every generation freezes its identity inputs and current authorization decision.
- Every shot stores its Creative Job, Creative Version and shot lineage.
- Object keys and credentials never enter agent prompts or public widget payloads.
- Provider retries and user retries are idempotent.
- A final asset is only reported when provider output actually exists.
- Workspace context is included in storage, signatures, queries and database constraints.
