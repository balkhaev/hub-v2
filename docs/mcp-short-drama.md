# Short drama agent workflow

Hub lets Codex or Claude Code turn a natural-language request into a traceable short-drama production job rather than an untracked text answer.

## End-to-end flow

```text
Codex / Claude Code
  └── project stdio MCP
       ├── discover Persona/NPC cards
       ├── author 2–6 genuinely different story candidates
       └── hub_create_short_drama
            └── CreativeJob
                 ├── validate brief and rights context
                 ├── normalize candidate scripts
                 ├── score hook, emotion, clarity, retention and feasibility
                 ├── refine the winner until threshold or iteration limit
                 ├── freeze ideal CreativeVersion
                 ├── build timed shot plan
                 ├── create one GenerationRequest per shot
                 ├── Runpod render_shot jobs
                 ├── select strongest take per shot
                 ├── build ordered assembly manifest
                 ├── Runpod assemble_short_drama job
                 └── finalAsset MP4 + Hub review page
```

A `CreativeJob` is larger than a `GenerationRequest`. It owns the brief, candidate scripts, evaluation history, ideal version, shot lineage, provider jobs, selected renders, assembly manifest and final asset.

## Start Hub

```bash
cp .env.example .env
npm run check
npm run dev
```

Without Runpod credentials, Hub still creates the ideal script, scorecard, timed shot plan and idempotent shot generations. The job stops truthfully at `ready_for_generation`.

Enable automatic rendering and final assembly:

```env
RUNPOD_API_KEY=<secret>
RUNPOD_ENDPOINT_ID=<queue-endpoint-id>
```

The bundled Runpod client submits asynchronous queue jobs and reconciles their status. The reference worker lives in:

```text
workers/runpod/short-drama/
```

It supports two explicit tasks:

```text
render_shot
assemble_short_drama
```

The worker needs a real versioned ComfyUI API workflow, model/custom-node image, and S3-compatible output storage. Those weights, credentials and production workflow JSON are intentionally not committed.

## Claude Code

The repository includes project-scoped `.mcp.json`. Claude Code asks for approval before enabling it.

Manual registration remains available:

```bash
claude mcp add luv-hub --scope project \
  --env HUB_API_URL=http://127.0.0.1:3000 \
  --env HUB_WORKSPACE_ID=ws_demo \
  --env HUB_ACTOR_ID=claude-code \
  -- node apps/mcp/src/server.mjs
```

## Codex

The repository includes `.codex/config.toml`:

```toml
[mcp_servers.luv-hub]
command = "node"
args = ["apps/mcp/src/server.mjs"]
env = { HUB_API_URL = "http://127.0.0.1:3000", HUB_WORKSPACE_ID = "ws_demo", HUB_ACTOR_ID = "codex" }
```

The same server can be registered through the Codex MCP CLI when a global configuration is preferred.

## Example request

```text
Сделай 45-секундную шорт-драму для Reels.
Героиня видит на экране партнёра сообщение, отправленное год назад.
Используй NPC Mira, сохрани лицо и одежду. Подготовь три драматургически
разные версии, выбери лучшую через Hub и верни финальный ролик.
```

The repository instructions tell the coding agent to author several complete candidates before calling Hub. A candidate includes:

```text
title
logline
hook
3–8 beats
dialogue
payoff
```

Hub remains the independent evaluator and canonical owner of the selected production version.

Expected tool sequence:

```text
hub_list_personas             # when a saved character is requested
hub_create_short_drama
hub_get_short_drama
hub_reconcile_short_drama     # refresh shot or assembly provider jobs
```

## MCP tools

### `hub_create_short_drama`

Creates an idempotent Creative Job and returns a compact production result:

- Creative Job ID, status, stage, progress and Hub URL;
- ideal script and scorecard;
- timed shot plan;
- shot-level generation IDs;
- selected renders and assembly manifest when available;
- final asset metadata after assembly.

The full losing-candidate and iteration history remains in Hub rather than consuming the coding agent's context window.

### `hub_get_short_drama`

Reads canonical state without changing provider jobs.

### `hub_reconcile_short_drama`

Refreshes all shot jobs or the final assembly job. When all shot renders succeed, Hub selects the highest-scoring take for each shot. When assembly is configured, Hub then submits the selected ordered package and eventually exposes `finalAsset`.

### `hub_list_personas`

Returns compact reusable Persona/NPC metadata. Requests can pin exact Persona versions and references for reproducible face, wardrobe and rights lineage. Persona bindings are optional; generic casting uses the same production pipeline with an empty binding list.

## Quality loop

The first inspectable script evaluator uses these weights:

```text
hook                18%
emotional arc       18%
retention           18%
clarity             13%
persona continuity  12%
platform fit        10%
feasibility          7%
brand safety         4%
```

The interface is designed for stronger adapters later: LLM script judging, identity similarity, motion artifacts, lip-sync, framing, continuity, audio quality and predicted retention can be added without changing the Creative Job contract.

The Runpod worker returns a technical quality baseline for each take. An optional `QUALITY_EVALUATOR_URL` can replace the final score with a vision-based evaluator. Hub selects takes deterministically from the returned scores and records the provider output used.

## Truthful status semantics

- `planning`: Hub is creating or linking the production package.
- `ready_for_generation`: ideal script and shot plan exist; provider rendering is not active.
- `generating`: shot rendering or final MP4 assembly is queued/running.
- `evaluating`: provider results exist, but a complete selected manifest is not yet available.
- `ready_for_review`: a final MP4 exists when assembly is configured; without assembly, an explicitly identified selected render package and assembly manifest are ready.
- `completed`: a human or approved automation accepted/mastered the result.
- `failed`: shot creation, dispatch, rendering, selection or assembly failed with recorded diagnostics.

Agents must never describe `ready_for_generation` as a completed video, and must not claim a mastered final file merely because individual shot renders exist.

## Privacy and reproducibility

- Every shot stores its Creative Job, Creative Version and `shotId` lineage.
- Persona/version/reference and current consent decisions are frozen into generation snapshots.
- Runpod receives Persona media through workspace-bound, purpose-bound, expiring signed URLs.
- Worker reference files use unique names and are removed in `finally`, including timeout and failure paths.
- Provider IDs, raw manifests, hashes, selected take IDs and final asset metadata remain canonical Hub state.
- Reusing an idempotency key with different normalized input returns a conflict instead of starting duplicate paid work.
