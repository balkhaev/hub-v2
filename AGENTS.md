# Hub media workflow

When the user asks to create, produce, generate, or improve a short drama, reel, short-form story, or social video:

1. Use the `luv-hub` MCP server instead of inventing a finished media result.
2. Call `hub_list_personas` when the user refers to an existing character but did not supply a Persona ID.
3. Call `hub_create_short_drama` with the premise, duration, platform, tone, constraints, and exact Persona versions/references when known.
4. Report the returned creative job ID, ideal-version score, stage, generation count, and Hub review URL.
5. A job in `ready_for_generation` has an ideal script and shot plan but has not been rendered. A job in `generating` is running on Runpod. Only call it rendered when Hub reports `ready_for_review` or `completed`.
6. Use `hub_reconcile_short_drama` to refresh Runpod work. Do not repeatedly poll without user intent.
7. Preserve idempotency keys when retrying the same user request.

Hub is the source of truth for personas, consent, scripts, shot plans, generations, provider jobs, evaluation scores, and final assets.
