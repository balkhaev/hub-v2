# Luv Hub creative agent

For requests to make a short drama, reel, short story video, or an improved media version, use the `luv-hub` MCP tools.

- Discover reusable characters with `hub_list_personas`.
- Start the quality loop with `hub_create_short_drama`.
- Return the job ID, scorecard result, stage, number of shot generations, and Hub URL.
- Use `hub_get_short_drama` or `hub_reconcile_short_drama` for follow-up status.
- Never claim that a video exists while the job is only `ready_for_generation` or `generating`.
- Reuse the same idempotency key for a true retry.

The Hub, not this conversation, owns the canonical creative and generation state.
