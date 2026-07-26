# Short drama agent workflow

This slice lets a developer ask Codex or Claude Code to create a short drama through Hub rather than receiving an untracked text answer.

## End-to-end flow

```text
Codex / Claude Code
  └── stdio MCP: hub_create_short_drama
       └── Hub Creative Job
            ├── normalize creative brief
            ├── create 2–6 story variants
            ├── score hook, emotion, clarity, retention, continuity and feasibility
            ├── refine until threshold or iteration limit
            ├── select ideal production version
            ├── build timed shot plan
            ├── create one generation request per shot
            └── dispatch to Runpod when configured
```

A Creative Job is larger than a Generation Request. One short drama owns a versioned script package and multiple shot-level generation requests.

## Start Hub

```bash
cp .env.example .env
npm run check
npm run dev
```

Without Runpod credentials, Hub still creates and scores the ideal script and shot plan and leaves the job in `ready_for_generation`.

To enable automatic async dispatch:

```env
RUNPOD_API_KEY=<secret>
RUNPOD_ENDPOINT_ID=<queue-endpoint-id>
```

The endpoint should use zero active workers and an appropriate max-worker cap. Hub submits asynchronous `/run` jobs and reconciles them through `/status/{job-id}`.

## Claude Code

The repository includes `.mcp.json`. After cloning, Claude Code asks for approval before enabling the project-scoped server. You can also add it explicitly:

```bash
claude mcp add luv-hub --scope project \
  --env HUB_API_URL=http://127.0.0.1:3000 \
  --env HUB_WORKSPACE_ID=ws_demo \
  --env HUB_ACTOR_ID=claude-code \
  -- node apps/mcp/src/server.mjs
```

## Codex

Register the same stdio server in Codex:

```bash
codex mcp add luv-hub \
  --env HUB_API_URL=http://127.0.0.1:3000 \
  --env HUB_WORKSPACE_ID=ws_demo \
  --env HUB_ACTOR_ID=codex \
  -- node apps/mcp/src/server.mjs
```

Equivalent `~/.codex/config.toml` configuration:

```toml
[mcp_servers.luv-hub]
command = "node"
args = ["/absolute/path/to/hub-v2/apps/mcp/src/server.mjs"]
env = { HUB_API_URL = "http://127.0.0.1:3000", HUB_WORKSPACE_ID = "ws_demo", HUB_ACTOR_ID = "codex" }
```

## Example agent request

```text
Сделай 45-секундную шорт-драму для Reels.
Героиня видит на экране партнёра сообщение, которое было отправлено год назад.
Используй NPC Mira, сохрани лицо и одежду. Нужны три сценарных варианта,
сильный hook до второй секунды и финал, который зацикливается на первый кадр.
```

Expected tool sequence:

```text
hub_list_personas
hub_create_short_drama
hub_get_short_drama
hub_reconcile_short_drama   # after Runpod has had time to work
```

## MCP tools

### `hub_create_short_drama`

Creates an idempotent Creative Job. The response includes:

- `creativeJob.id`
- status, stage and progress
- all story-evaluation iterations
- the selected `idealVersion`
- scorecard and threshold decision
- timed shot plan
- shot-level generation IDs
- Hub review URL

### `hub_get_short_drama`

Reads canonical state without changing provider jobs.

### `hub_reconcile_short_drama`

Refreshes the Runpod status of every shot generation and updates aggregate job progress.

### `hub_list_personas`

Returns reusable Persona/NPC cards. Agent prompts should pin explicit persona versions and references when reproducibility matters.

## Quality loop

The first evaluator is deterministic and inspectable. It scores:

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

This is intentionally an interface, not the final evaluator. Later adapters can add LLM script review, vision-based render review, lip-sync checks, identity similarity, motion artifacts, audio quality and predicted retention without changing the Creative Job API.

## Truthful status semantics

- `ready_for_generation`: ideal script and shot plan exist; no provider render is running.
- `generating`: one or more Runpod jobs are queued or running.
- `ready_for_review`: all shot renders completed and can be inspected in Hub.
- `completed`: a human or approved automation accepted the assembled final version.

Agents must not describe `ready_for_generation` as a completed video.
