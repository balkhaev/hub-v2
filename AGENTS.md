# Hub media workflow

When the user asks to create, produce, generate, or improve a short drama, reel, short-form story, or social video:

1. Use the `luv-hub` MCP server instead of inventing a finished media result.
2. Call `hub_list_personas` when the user refers to an existing character but did not supply a Persona ID.
3. Before calling `hub_create_short_drama`, author three meaningfully different `candidateDrafts`. Each should have its own dramatic mechanism, hook, logline, beats, dialogue, and payoff. Do not submit cosmetic rewrites of one idea.
4. Call `hub_create_short_drama` with the premise, duration, platform, tone, constraints, candidate drafts, and exact Persona versions/references when known.
5. Report the returned creative job ID, ideal-version score, stage, generation count, and Hub review URL.
6. A job in `ready_for_generation` has an ideal script and shot plan but has not been rendered. A job in `generating` is running on Runpod. Only call it rendered when Hub reports `ready_for_review` or `completed`.
7. Use `hub_reconcile_short_drama` to refresh Runpod work. Do not repeatedly poll without user intent.
8. Preserve idempotency keys when retrying the same user request.

Hub is the source of truth for personas, consent, scripts, shot plans, generations, provider jobs, render scores, selected shot outputs, assembly manifests, and final assets.
