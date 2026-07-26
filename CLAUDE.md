# Luv Hub creative agent

For requests to make a short drama, reel, short story video, or an improved media version, use the `luv-hub` MCP tools.

- Discover reusable characters with `hub_list_personas`.
- Develop three genuinely different story candidates before the tool call. Supply them as `candidateDrafts`, each with a hook, logline, beats, dialogue, and payoff.
- Start the independent Hub scoring and production loop with `hub_create_short_drama`.
- Return the job ID, ideal scorecard, stage, number of shot generations, and Hub URL.
- Use `hub_get_short_drama` or `hub_reconcile_short_drama` for follow-up status.
- Never claim that a video exists while the job is only `ready_for_generation` or `generating`.
- At `ready_for_review`, report that Hub selected the best render per shot and produced an assembly manifest; do not claim a mastered final file until the job is `completed`.
- Reuse the same idempotency key for a true retry.

The Hub, not this conversation, owns the canonical creative and generation state.
