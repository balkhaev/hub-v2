# ComfyUI workflow contract

Export an API-format ComfyUI workflow as either:

```text
short-drama-shot-v1@1.json
short-drama-shot-v1.json
```

The worker recursively substitutes these exact token strings before submitting the workflow to `POST /prompt`:

```text
{{prompt}}
{{negative_prompt}}
{{seed}}
{{output_count}}
{{width}}
{{height}}
{{reference_0_filename}}
{{reference_1_filename}}
{{reference_2_filename}}
{{reference_3_filename}}
```

Reference files are downloaded from Hub's workspace-bound, generation-purpose signed URLs into `COMFYUI_INPUT_DIR`.

The workflow must emit at least one item under an output node's `videos`, `gifs`, or `images` collection. Video output is recommended for the `short-drama-shot-v1` workflow.

Do not commit model weights, personal reference photos, credentials, or signed media URLs to this directory.
