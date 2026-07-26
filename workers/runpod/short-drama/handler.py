from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import boto3
import requests
import runpod

COMFYUI_URL = os.getenv("COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")
WORKFLOW_DIR = Path(os.getenv("WORKFLOW_DIR", "/workflows"))
COMFYUI_INPUT_DIR = Path(os.getenv("COMFYUI_INPUT_DIR", "/comfyui/input"))
OUTPUT_BUCKET = os.getenv("OUTPUT_BUCKET")
OUTPUT_PREFIX = os.getenv("OUTPUT_PREFIX", "hub-generations").strip("/")
OUTPUT_PUBLIC_BASE_URL = os.getenv("OUTPUT_PUBLIC_BASE_URL", "").rstrip("/")
OUTPUT_ENDPOINT_URL = os.getenv("OUTPUT_ENDPOINT_URL") or None
OUTPUT_URL_TTL_SECONDS = int(os.getenv("OUTPUT_URL_TTL_SECONDS", "604800"))
COMFYUI_TIMEOUT_SECONDS = int(os.getenv("COMFYUI_TIMEOUT_SECONDS", "1800"))
COMFYUI_POLL_SECONDS = float(os.getenv("COMFYUI_POLL_SECONDS", "2"))
QUALITY_EVALUATOR_URL = os.getenv("QUALITY_EVALUATOR_URL", "").rstrip("/")
FFMPEG_BIN = os.getenv("FFMPEG_BIN", "ffmpeg")
FFPROBE_BIN = os.getenv("FFPROBE_BIN", "ffprobe")


class WorkerError(RuntimeError):
    pass


def _require(value: Any, name: str) -> Any:
    if value is None or value == "":
        raise WorkerError(f"{name} is required")
    return value


def _run(command: list[str], timeout: int = 1800) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise WorkerError(
            f"Command failed ({result.returncode}): {' '.join(command)}\n"
            f"{result.stderr[-4000:]}"
        )
    return result


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _media_info(path: Path) -> dict[str, Any]:
    result = _run(
        [
            FFPROBE_BIN,
            "-v",
            "error",
            "-show_entries",
            "format=duration,size:stream=index,codec_type,width,height,r_frame_rate",
            "-of",
            "json",
            str(path),
        ],
        timeout=60,
    )
    payload = json.loads(result.stdout or "{}")
    streams = payload.get("streams", [])
    video = next(
        (stream for stream in streams if stream.get("codec_type") == "video"),
        {},
    )
    format_info = payload.get("format", {})
    return {
        "durationSeconds": float(format_info.get("duration") or 0),
        "sizeBytes": int(format_info.get("size") or path.stat().st_size),
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
        "hasAudio": any(stream.get("codec_type") == "audio" for stream in streams),
        "frameRate": video.get("r_frame_rate"),
    }


def _aspect_dimensions(aspect_ratio: str) -> tuple[int, int]:
    return {
        "9:16": (1080, 1920),
        "4:5": (1080, 1350),
        "1:1": (1080, 1080),
        "16:9": (1920, 1080),
    }.get(aspect_ratio, (1080, 1920))


def _technical_quality(info: dict[str, Any], aspect_ratio: str) -> float:
    expected_width, expected_height = _aspect_dimensions(aspect_ratio)
    actual_width = max(1, info.get("width") or 1)
    actual_height = max(1, info.get("height") or 1)
    expected_ratio = expected_width / expected_height
    actual_ratio = actual_width / actual_height
    ratio_score = max(0.0, 1.0 - abs(expected_ratio - actual_ratio) / expected_ratio)
    resolution_score = min(
        1.0,
        (actual_width * actual_height) / max(1, expected_width * expected_height),
    )
    duration_score = 1.0 if info.get("durationSeconds", 0) > 0.5 else 0.0
    size_score = min(1.0, info.get("sizeBytes", 0) / 750_000)
    return round(
        0.35 * ratio_score
        + 0.30 * resolution_score
        + 0.20 * duration_score
        + 0.15 * size_score,
        4,
    )


def _s3_client():
    return boto3.client("s3", endpoint_url=OUTPUT_ENDPOINT_URL)


def _upload(path: Path, key: str, content_type: str | None = None) -> dict[str, Any]:
    bucket = _require(OUTPUT_BUCKET, "OUTPUT_BUCKET")
    media_type = content_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    client = _s3_client()
    client.upload_file(
        str(path),
        bucket,
        key,
        ExtraArgs={"ContentType": media_type},
    )
    if OUTPUT_PUBLIC_BASE_URL:
        url = f"{OUTPUT_PUBLIC_BASE_URL}/{key}"
    else:
        url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=OUTPUT_URL_TTL_SECONDS,
        )
    return {
        "url": url,
        "objectKey": key,
        "bucket": bucket,
        "contentType": media_type,
        "sha256": _sha256(path),
        "sizeBytes": path.stat().st_size,
    }


def _download(url: str, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, stream=True, timeout=(15, 300)) as response:
        response.raise_for_status()
        with destination.open("wb") as target:
            shutil.copyfileobj(response.raw, target)
    return destination


def _replace_tokens(value: Any, tokens: dict[str, Any]) -> Any:
    if isinstance(value, dict):
        return {key: _replace_tokens(item, tokens) for key, item in value.items()}
    if isinstance(value, list):
        return [_replace_tokens(item, tokens) for item in value]
    if isinstance(value, str):
        if value in tokens:
            return tokens[value]
        result = value
        for token, replacement in tokens.items():
            result = result.replace(token, str(replacement))
        return result
    return value


def _workflow_path(workflow: dict[str, Any]) -> Path:
    workflow_id = str(_require(workflow.get("id"), "workflow.id"))
    workflow_version = str(workflow.get("version") or "1")
    candidates = [
        WORKFLOW_DIR / f"{workflow_id}@{workflow_version}.json",
        WORKFLOW_DIR / f"{workflow_id}.json",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise WorkerError(
        f"No ComfyUI workflow found for {workflow_id}@{workflow_version}; "
        f"checked {candidates}"
    )


def _queue_comfyui(workflow: dict[str, Any]) -> str:
    response = requests.post(
        f"{COMFYUI_URL}/prompt",
        json={"prompt": workflow, "client_id": f"hub-{uuid.uuid4().hex}"},
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    prompt_id = payload.get("prompt_id")
    if not prompt_id:
        raise WorkerError(f"ComfyUI did not return prompt_id: {payload}")
    return prompt_id


def _wait_for_comfyui(prompt_id: str) -> dict[str, Any]:
    deadline = time.monotonic() + COMFYUI_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        response = requests.get(f"{COMFYUI_URL}/history/{prompt_id}", timeout=30)
        response.raise_for_status()
        payload = response.json()
        history = payload.get(prompt_id)
        if history:
            status = history.get("status", {})
            if status.get("status_str") == "error":
                raise WorkerError(f"ComfyUI workflow failed: {status}")
            if history.get("outputs"):
                return history
        time.sleep(COMFYUI_POLL_SECONDS)
    raise WorkerError(f"ComfyUI prompt {prompt_id} timed out")


def _output_descriptors(history: dict[str, Any]) -> list[dict[str, Any]]:
    descriptors: list[dict[str, Any]] = []
    for node_id, output in history.get("outputs", {}).items():
        for field in ("videos", "gifs", "images"):
            for item in output.get(field, []) or []:
                if item.get("filename"):
                    descriptors.append({"nodeId": node_id, "field": field, **item})
    return descriptors


def _download_comfyui_output(descriptor: dict[str, Any], destination: Path) -> Path:
    query = urlencode(
        {
            "filename": descriptor["filename"],
            "subfolder": descriptor.get("subfolder", ""),
            "type": descriptor.get("type", "output"),
        }
    )
    with requests.get(
        f"{COMFYUI_URL}/view?{query}",
        stream=True,
        timeout=(15, 300),
    ) as response:
        response.raise_for_status()
        with destination.open("wb") as target:
            shutil.copyfileobj(response.raw, target)
    return destination


def _external_quality(output: dict[str, Any], context: dict[str, Any]) -> float | None:
    if not QUALITY_EVALUATOR_URL:
        return None
    response = requests.post(
        QUALITY_EVALUATOR_URL,
        json={"output": output, "context": context},
        timeout=120,
    )
    response.raise_for_status()
    value = response.json().get("total")
    return float(value) if value is not None else None


def _render_shot(payload: dict[str, Any]) -> dict[str, Any]:
    generation = payload.get("generation") or {}
    workflow_spec = payload.get("workflow") or {}
    shot_id = str(payload.get("shotId") or "shot")
    generation_id = str(_require(payload.get("hubGenerationId"), "hubGenerationId"))
    aspect_ratio = str(generation.get("aspectRatio") or "9:16")
    personas = payload.get("personas") or []
    reference_files: list[Path] = []

    try:
        with tempfile.TemporaryDirectory(prefix="hub-shot-") as temporary:
            temporary_dir = Path(temporary)
            COMFYUI_INPUT_DIR.mkdir(parents=True, exist_ok=True)
            for index, persona in enumerate(personas):
                reference_url = persona.get("referenceUrl")
                if not reference_url:
                    continue
                local_reference = (
                    COMFYUI_INPUT_DIR / f"hub-{generation_id}-{index}-{uuid.uuid4().hex}.img"
                )
                reference_files.append(local_reference)
                _download(reference_url, local_reference)

            workflow = json.loads(_workflow_path(workflow_spec).read_text("utf-8"))
            width, height = _aspect_dimensions(aspect_ratio)
            tokens: dict[str, Any] = {
                "{{prompt}}": generation.get("prompt") or "",
                "{{negative_prompt}}": generation.get("negativePrompt") or "",
                "{{seed}}": int(generation.get("seed") or 0),
                "{{output_count}}": int(generation.get("count") or 1),
                "{{width}}": width,
                "{{height}}": height,
            }
            for index, reference_path in enumerate(reference_files):
                tokens[f"{{{{reference_{index}_filename}}}}"] = reference_path.name
            resolved_workflow = _replace_tokens(workflow, tokens)

            started = time.monotonic()
            prompt_id = _queue_comfyui(resolved_workflow)
            history = _wait_for_comfyui(prompt_id)
            descriptors = _output_descriptors(history)
            if not descriptors:
                raise WorkerError(
                    f"ComfyUI prompt {prompt_id} completed without media outputs"
                )

            outputs = []
            for index, descriptor in enumerate(descriptors):
                suffix = Path(descriptor["filename"]).suffix or ".mp4"
                local_output = temporary_dir / f"take-{index + 1}{suffix}"
                _download_comfyui_output(descriptor, local_output)
                info = _media_info(local_output)
                key = (
                    f"{OUTPUT_PREFIX}/creative/"
                    f"{payload.get('creativeJobId') or 'unassigned'}/"
                    f"{shot_id}/{generation_id}/take-{index + 1}{suffix}"
                )
                uploaded = _upload(local_output, key)
                technical_score = _technical_quality(info, aspect_ratio)
                candidate = {
                    "id": f"{generation_id}-take-{index + 1}",
                    **uploaded,
                    **info,
                    "quality": {
                        "total": technical_score,
                        "technical": technical_score,
                        "evaluator": "technical-v1",
                    },
                    "comfyui": {
                        "promptId": prompt_id,
                        "nodeId": descriptor.get("nodeId"),
                    },
                }
                external_score = _external_quality(candidate, payload)
                if external_score is not None:
                    candidate["quality"] = {
                        **candidate["quality"],
                        "total": max(0.0, min(1.0, external_score)),
                        "external": external_score,
                        "evaluator": "external+technical-v1",
                    }
                outputs.append(candidate)

            return {
                "task": "render_shot",
                "hubGenerationId": generation_id,
                "creativeJobId": payload.get("creativeJobId"),
                "creativeVersionId": payload.get("creativeVersionId"),
                "shotId": shot_id,
                "inputHash": payload.get("inputHash"),
                "outputs": outputs,
                "model": {"workflow": workflow_spec},
                "runtimeMs": round((time.monotonic() - started) * 1000),
            }
    finally:
        for reference_path in reference_files:
            try:
                reference_path.unlink(missing_ok=True)
            except OSError:
                pass


def _normalized_clip(source: Path, destination: Path, width: int, height: int) -> Path:
    info = _media_info(source)
    video_filter = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30"
    )
    command = [FFMPEG_BIN, "-y", "-i", str(source)]
    if info["hasAudio"]:
        command.extend(
            [
                "-map",
                "0:v:0",
                "-map",
                "0:a:0",
                "-vf",
                video_filter,
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-ar",
                "48000",
                "-ac",
                "2",
                "-movflags",
                "+faststart",
                str(destination),
            ]
        )
    else:
        duration = max(0.1, info["durationSeconds"])
        command.extend(
            [
                "-f",
                "lavfi",
                "-t",
                str(duration),
                "-i",
                "anullsrc=channel_layout=stereo:sample_rate=48000",
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-vf",
                video_filter,
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
                "-movflags",
                "+faststart",
                str(destination),
            ]
        )
    _run(command)
    return destination


def _assemble_short_drama(payload: dict[str, Any]) -> dict[str, Any]:
    manifest = payload.get("assemblyManifest") or {}
    ordered_shots = sorted(
        manifest.get("orderedShots") or [],
        key=lambda item: item.get("ordinal", 0),
    )
    if not ordered_shots:
        raise WorkerError("assemblyManifest.orderedShots is empty")
    creative_job_id = str(_require(payload.get("creativeJobId"), "creativeJobId"))
    creative_version_id = str(
        _require(payload.get("creativeVersionId"), "creativeVersionId")
    )
    aspect_ratio = str(
        payload.get("aspectRatio") or manifest.get("aspectRatio") or "9:16"
    )
    width, height = _aspect_dimensions(aspect_ratio)

    with tempfile.TemporaryDirectory(prefix="hub-assembly-") as temporary:
        temporary_dir = Path(temporary)
        normalized: list[Path] = []
        started = time.monotonic()
        for index, shot in enumerate(ordered_shots):
            source_url = _require(shot.get("url"), f"orderedShots[{index}].url")
            source = temporary_dir / f"source-{index + 1}.mp4"
            target = temporary_dir / f"normalized-{index + 1}.mp4"
            _download(source_url, source)
            _normalized_clip(source, target, width, height)
            normalized.append(target)

        concat_file = temporary_dir / "concat.txt"
        concat_file.write_text(
            "".join(f"file '{path.as_posix()}'\n" for path in normalized),
            encoding="utf-8",
        )
        final_path = temporary_dir / "final.mp4"
        _run(
            [
                FFMPEG_BIN,
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat_file),
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                str(final_path),
            ]
        )
        info = _media_info(final_path)
        key = (
            f"{OUTPUT_PREFIX}/creative/{creative_job_id}/"
            f"{creative_version_id}/final.mp4"
        )
        uploaded = _upload(final_path, key, "video/mp4")
        return {
            "task": "assemble_short_drama",
            "creativeJobId": creative_job_id,
            "creativeVersionId": creative_version_id,
            **uploaded,
            **info,
            "shotCount": len(normalized),
            "runtimeMs": round((time.monotonic() - started) * 1000),
        }


def handler(event: dict[str, Any]) -> dict[str, Any]:
    payload = event.get("input") or {}
    task = payload.get("task") or "render_shot"
    if task == "render_shot":
        return _render_shot(payload)
    if task == "assemble_short_drama":
        return _assemble_short_drama(payload)
    raise WorkerError(f"Unsupported task: {task}")


runpod.serverless.start({"handler": handler})
