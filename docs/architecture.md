# Hub v2 architecture

Hub v2 is a chat-first content operations system for Luv. Humans and agents coordinate in channels, while campaigns, personas, assets, generations, approvals, publications, and analytics remain canonical domain entities.

## Product loop

```text
idea → brief → persona selection → generation → review → approval
     → platform adaptation → publication → metrics → insight → next experiment
```

The first implemented vertical slice is `persona → generation request`. It establishes stable IDs and provenance before GPU and social integrations are added.

## Target topology

```text
Browser chat UI
      │ HTTP / WebSocket
      ▼
Hub API ─────────────── PostgreSQL
  │                         │
  ├── Object storage        └── transactional outbox
  │
  ├── Durable workflows ── Runpod serverless workers
  │
  ├── Publisher adapters ─ social platforms
  │
  └── Analytics collector ─ ClickHouse / dbt / dashboards
```

The current development adapter uses atomic JSON and local object storage so the vertical slice runs with no third-party services. Domain boundaries intentionally match the future PostgreSQL/S3 implementation.

## Core invariants

- Widgets are projections, not state stores.
- Every external action is a named command with authorization, idempotency, and audit.
- Original media is immutable.
- Every generation records model/workflow provenance and persona/reference snapshots.
- Product-private Luv data is separated from marketing/content data.
- Agents receive scoped tools, not infrastructure or social tokens.
- Human approval gates precede public publishing until a policy-specific automation scope is enabled.

## Domain chain

```text
Campaign
  └── Brief
       └── Content item / hypothesis
            └── Persona binding
                 └── Generation request
                      └── Generation run
                           └── Asset / asset version
                                └── Publish intent / social post
                                     └── Metric snapshot / experiment result
```

Stable IDs travel through storage, Runpod payloads, social posts, redirects, and product events. This makes it possible to answer which prompt, model, persona, asset, and post produced a signup or activation.

## Chat and widgets

Agents post versioned widget envelopes. The browser maps `(type, version)` to a renderer. Commands go back to the API:

```text
widget action
  → authenticated command
  → RBAC and policy validation
  → idempotency check
  → durable workflow
  → audit and outbox
  → updated entity projection
```

Initial widget types:

```text
persona.card
generation.request
job.progress
asset.grid
asset.review
approval.card
publish.preview
metric.kpi
metric.timeseries
experiment.result
alert.card
```

## Implementation sequence

1. Foundation: chat shell, typed widgets, persona cards, object lineage, IDs.
2. Runpod: queue, signed reference URLs, worker classes, progress, result ingest.
3. Asset review: annotations, derivatives, approvals, policy checks.
4. Analytics spine: collector, ClickHouse, attribution links, funnel widgets.
5. Publisher sandbox: OAuth, previews, idempotent post, metric import.
6. Multi-platform and closed-loop experiments.

## Runpod boundary

The API should not synchronously hold an HTTP request while a GPU runs. A durable workflow dispatches the job, stores the provider ID, consumes progress/webhooks, reconciles status, and ingests outputs. Serverless endpoints keep minimum workers at zero; the system still accounts for initialization, storage, and execution cost.

Recommended endpoint classes:

```text
image-fast
image-quality
video
utility
```

Personas stay model-neutral. A workflow adapter can map the same persona snapshot to IP-Adapter, InstantID, PuLID, LoRA, or future reference-conditioning methods.

## Analytics spine

Three marts are required:

- content operations: generation latency, failures, cost, approval rate, revision count;
- social performance: views, completion, engagement, clicks, follows;
- Luv funnel: attributed session, signup, activation, revenue, retention.

The common join keys are `campaign_id`, `creative_id`, `generation_id`, `asset_id`, `social_post_id`, `experiment_id`, and optional `persona_id` for creative performance analysis.
