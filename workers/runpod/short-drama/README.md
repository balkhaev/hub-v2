# Runpod short-drama worker

One serverless endpoint handles two payloads:

```text
render_shot
assemble_short_drama
```

`render_shot` resolves a versioned ComfyUI API workflow, downloads Hub-signed Persona references, renders candidate takes, uploads them to S3-compatible storage, and returns a manifest with technical quality scores.

`assemble_short_drama` downloads Hub-selected takes, normalizes resolution, frame rate, codecs and audio layout with FFmpeg, concatenates them in shot order, uploads `final.mp4`, and returns the final asset metadata.

## Container

The default image is useful for assembly or for talking to a reachable ComfyUI service:

```bash
docker build -t hub-short-drama-worker workers/runpod/short-drama
```

For a self-contained GPU endpoint, build on a base image that already contains ComfyUI, its models and custom nodes:

```bash
docker build \
  --build-arg BASE_IMAGE=<your-comfyui-gpu-image> \
  -t <registry>/hub-short-drama-worker:<tag> \
  workers/runpod/short-drama
```

The image must start ComfyUI before `handler.py`, or `COMFYUI_URL` must target a reachable service. In a production image, use a small supervisor or entrypoint script to start both processes and wait for the ComfyUI health endpoint before starting the Runpod handler.

## Required environment

```env
OUTPUT_BUCKET=luv-media
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=auto
```

For R2 or MinIO:

```env
OUTPUT_ENDPOINT_URL=https://<account>.r2.cloudflarestorage.com
OUTPUT_PUBLIC_BASE_URL=https://media.example.com
```

Worker settings:

```env
COMFYUI_URL=http://127.0.0.1:8188
WORKFLOW_DIR=/workflows
COMFYUI_INPUT_DIR=/comfyui/input
COMFYUI_TIMEOUT_SECONDS=1800
COMFYUI_POLL_SECONDS=2
OUTPUT_PREFIX=hub-generations
OUTPUT_URL_TTL_SECONDS=604800
QUALITY_EVALUATOR_URL=
```

Without `OUTPUT_PUBLIC_BASE_URL`, the worker returns a presigned object URL. For production publishing and long review windows, return company-controlled CDN URLs instead.

## Endpoint configuration

Recommended initial Runpod Serverless settings:

```text
active workers: 0
max workers: small explicit cost cap
queue delay: tuned for cold-start tolerance
FlashBoot/cached models: enabled when available
```

Hub submits asynchronous jobs and stores every provider job ID. The same endpoint can render shots and assemble the final file, but the task field keeps both contracts explicit.

## Output contract

Shot render:

```json
{
  "task": "render_shot",
  "hubGenerationId": "gen_...",
  "shotId": "shot-01",
  "outputs": [
    {
      "id": "gen_...-take-1",
      "url": "https://media.example/...mp4",
      "sha256": "...",
      "durationSeconds": 4.2,
      "width": 1080,
      "height": 1920,
      "quality": {
        "total": 0.91,
        "technical": 0.91,
        "evaluator": "technical-v1"
      }
    }
  ]
}
```

Final assembly:

```json
{
  "task": "assemble_short_drama",
  "creativeJobId": "cjob_...",
  "creativeVersionId": "cver_...",
  "url": "https://media.example/.../final.mp4",
  "sha256": "...",
  "durationSeconds": 43.8,
  "width": 1080,
  "height": 1920,
  "shotCount": 10
}
```

The built-in score is a technical baseline, not a creative-quality guarantee. Configure `QUALITY_EVALUATOR_URL` for identity similarity, motion artifacts, lip-sync, framing, continuity and predicted-retention scoring.
