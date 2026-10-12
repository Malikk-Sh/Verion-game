#!/usr/bin/env python3
"""Generate game art through the TOOKEN.club GPT Image API and save validated PNG files.

Authentication
  * Cloud sessions: the egress proxy injects the key for tooken.club (Network secrets),
    so no Authorization header is needed.
  * Elsewhere: set TOOKEN_API_KEY; it is sent only as a header and never printed or saved.

Budget
  Every paid request is counted per task in artifacts/asset_gen/budget.json (git-ignored).
  The default limit is 5 requests per task (--task / ASSET_GEN_TASK). Raise it with
  --max-requests or ASSET_GEN_MAX_REQUESTS only after the user approved the budget.

Examples
  python3 scripts/generate_asset.py generate --task iron-ingot \
      --prompt "..." --out docs/art/generated/iron_ingot.png --transparent --size 1024x1024
  python3 scripts/generate_asset.py edit --task hero-walk --image hero_idle.png \
      --prompt "same character, left foot forward" --out hero_walk_1.png --transparent
  python3 scripts/generate_asset.py generate --dry-run --prompt "..." --out x.png

Post-processing (background removal, trimming, nearest-neighbor scaling, atlases,
validation) lives in scripts/sprite_tools.py; --transparent here falls back to it
automatically when the API returns an opaque image.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import io
import json
import mimetypes
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import sprite_tools  # noqa: E402

API_BASE = os.environ.get("TOOKEN_API_BASE", "https://tooken.club/v1")
DEFAULT_MODEL = "gpt-image-2.5-sunburst"
DEFAULT_LIMIT = 5
BUDGET_FILE = ROOT / "artifacts" / "asset_gen" / "budget.json"
LOG_FILE = ROOT / "artifacts" / "asset_gen" / "requests.jsonl"
DEFAULT_MANIFEST = ROOT / "docs" / "art" / "generated" / "MANIFEST.json"
# Appended when a cut-out is requested so the fallback chroma key has a clean, uniform backdrop.
CHROMA_HINT = (" Transparent background; if any backdrop is rendered it must be one perfectly flat uniform solid"
               " {name} ({hex}) colour filling the whole canvas,"
               " no gradient, no floor, no cast shadow, no vignette; the subject must not contain this colour.")


class ApiError(RuntimeError):
    def __init__(self, status: int, message: str, retry_after: float | None = None,
                 retryable: bool | None = None, billing: str | None = None, concurrency: str | None = None):
        super().__init__(f"HTTP {status}: {message}" + (f" [{billing}]" if billing else ""))
        self.status = status
        self.message = message
        self.retry_after = retry_after
        self.retryable = retryable
        self.billing = billing
        self.concurrency = concurrency  # "active/limit" for the API key, when reported


def _ssl_context() -> ssl.SSLContext:
    ca = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
    return ssl.create_default_context(cafile=ca) if ca and Path(ca).is_file() else ssl.create_default_context()


def _headers(content_type: str) -> dict[str, str]:
    h = {"Content-Type": content_type, "Accept": "application/json", "User-Agent": "vireon-asset-gen/1"}
    key = os.environ.get("TOOKEN_API_KEY", "").strip()
    if key:  # Fallback outside the cloud proxy; the value is never logged.
        h["Authorization"] = f"Bearer {key}"
    return h


def _redact(text: str) -> str:
    key = os.environ.get("TOOKEN_API_KEY", "").strip()
    return text.replace(key, "***") if key else text


def _post(path: str, body: bytes, content_type: str, timeout: float) -> dict:
    req = urllib.request.Request(f"{API_BASE}{path}", data=body, headers=_headers(content_type), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        err: object = raw
        try:
            err = json.loads(raw).get("error", raw)
            msg = err.get("message", json.dumps(err)) if isinstance(err, dict) else str(err)
        except (ValueError, AttributeError):
            msg = raw[:500]
        info = err if isinstance(err, dict) else {}
        try:
            retry_after = float(e.headers.get("Retry-After", "")) if e.headers else None
        except ValueError:
            retry_after = None
        hdr = e.headers or {}
        conc = (f"{hdr.get('X-Ratelimit-Active-Concurrent')}/{hdr.get('X-Ratelimit-Limit-Concurrent')}"
                if hdr.get("X-Ratelimit-Limit-Concurrent") else None)
        raise ApiError(e.code, _redact(msg), retry_after, info.get("retryable"), info.get("billing"), conc) from None


def _multipart(fields: dict[str, str], files: list[tuple[str, Path]]) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    out = io.BytesIO()
    for k, v in fields.items():
        out.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    for k, p in files:
        ctype = mimetypes.guess_type(p.name)[0] or "image/png"
        out.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"; filename="{p.name}"\r\n'
                  f"Content-Type: {ctype}\r\n\r\n".encode())
        out.write(p.read_bytes())
        out.write(b"\r\n")
    out.write(f"--{boundary}--\r\n".encode())
    return out.getvalue(), f"multipart/form-data; boundary={boundary}"


# ---------------------------------------------------------------- budget
def _budget_take(task: str, n: int, limit: int) -> int:
    BUDGET_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(BUDGET_FILE.read_text()) if BUDGET_FILE.exists() else {}
    used = int(data.get(task, 0))
    if used + n > limit:
        sys.exit(f"Budget stop: task '{task}' already used {used}/{limit} paid requests. "
                 "Ask the user to approve more, then pass --max-requests N.")
    data[task] = used + n
    BUDGET_FILE.write_text(json.dumps(data, indent=1, ensure_ascii=False))
    return used + n


def _budget_refund(task: str, n: int) -> None:
    data = json.loads(BUDGET_FILE.read_text()) if BUDGET_FILE.exists() else {}
    data[task] = max(0, int(data.get(task, 0)) - n)
    BUDGET_FILE.write_text(json.dumps(data, indent=1, ensure_ascii=False))


def _log(entry: dict) -> None:
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------- manifest
def _rel(p: Path) -> str:
    try:
        return str(p.resolve().relative_to(ROOT))
    except ValueError:
        return str(p)


def _manifest_add(manifest: Path, entry: dict) -> None:
    manifest.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(manifest.read_text()) if manifest.exists() else {"generator": "TOOKEN.club GPT Image", "assets": []}
    data["assets"] = [a for a in data["assets"] if a.get("path") != entry["path"]] + [entry]
    manifest.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------- main flow
def run(args: argparse.Namespace) -> int:
    out = Path(args.out)
    if out.suffix.lower() != ".png":
        sys.exit("--out must be a .png path (convert to WebP afterwards with sprite_tools.py webp)")
    if out.exists() and not args.overwrite:
        sys.exit(f"{out} exists; reuse it or pass --overwrite (avoid regenerating approved assets)")
    prompt = args.prompt if args.prompt else Path(args.prompt_file).read_text(encoding="utf-8")
    key_color = sprite_tools.parse_color(args.key_color)
    if args.transparent and not args.no_chroma_hint:
        prompt += CHROMA_HINT.format(name=args.key_color_name, hex=args.key_color)

    fields: dict[str, object] = {"model": args.model, "prompt": prompt, "n": args.n, "size": args.size,
                                 "output_format": "png"}
    if args.quality:
        fields["quality"] = args.quality
    if args.transparent and args.api_background:
        fields["background"] = "transparent"

    if args.dry_run:
        shown = dict(fields)
        print(json.dumps({"endpoint": f"{API_BASE}/images/{args.cmd if args.cmd == 'edit' else 'generations'}",
                          "images": getattr(args, "image", None) or [], **shown}, indent=2, ensure_ascii=False))
        return 0

    limit = int(args.max_requests or os.environ.get("ASSET_GEN_MAX_REQUESTS") or DEFAULT_LIMIT)
    task = args.task or os.environ.get("ASSET_GEN_TASK") or "default"
    used = _budget_take(task, args.n, limit)
    print(f"[budget] task '{task}': request {used}/{limit}", file=sys.stderr)

    t0 = time.time()
    dropped_background = False
    for attempt in range(args.retries + 1):
        try:
            if args.cmd == "edit":
                files = [("image[]" if len(args.image) > 1 else "image", Path(p)) for p in args.image]
                if args.mask:
                    files.append(("mask", Path(args.mask)))
                body, ctype = _multipart({k: str(v) for k, v in fields.items()}, files)
                resp = _post("/images/edits", body, ctype, args.timeout)
            else:
                resp = _post("/images/generations", json.dumps(fields).encode(), "application/json", args.timeout)
            break
        except ApiError as e:
            unsupported_bg = e.status == 400 and "background" in e.message.lower() and "background" in fields
            if unsupported_bg:  # The API rejected the parameter before generating; retry without it.
                print(f"[api] background=transparent rejected ({e.message}); retrying with chroma key", file=sys.stderr)
                fields.pop("background")
                dropped_background = True
                continue
            transient = e.retryable is True or e.status in (429, 500, 502, 503, 504)
            if transient and e.retryable is not False and attempt < args.retries:
                # TOOKEN allows 2 concurrent requests per key and answers Retry-After: 1 even while both
                # slots are held by slow generations, so back off for real instead of hammering it.
                wait = min(max(e.retry_after or 0, 20 * (attempt + 1)), 180)
                conc = f" (concurrent {e.concurrency})" if e.concurrency else ""
                print(f"[api] {e}{conc}; retry {attempt + 1}/{args.retries} in {wait:.0f}s", file=sys.stderr)
                time.sleep(wait)
                continue
            if e.status in (400, 401, 403, 404, 422, 429) or (e.billing and "не списаны" in e.billing):
                _budget_refund(task, args.n)  # Rejected / rate-limited requests are not billed.
            _log({"time": dt.datetime.now().isoformat(timespec="seconds"), "task": task, "ok": False,
                  "status": e.status, "error": e.message, "billing": e.billing, "out": _rel(out)})
            print(f"[api] error {e}", file=sys.stderr)
            return 2
        except (urllib.error.URLError, TimeoutError) as e:
            _log({"time": dt.datetime.now().isoformat(timespec="seconds"), "task": task, "ok": False,
                  "error": str(e), "out": _rel(out)})
            print(f"[net] {e}", file=sys.stderr)
            return 3

    items = resp.get("data") or []
    if not items or not items[0].get("b64_json"):
        print(f"[api] unexpected response keys: {list(resp)}; data[0] keys: {list(items[0]) if items else []}", file=sys.stderr)
        return 4

    out.parent.mkdir(parents=True, exist_ok=True)
    saved = []
    for i, it in enumerate(items):
        path = out if i == 0 else out.with_name(f"{out.stem}_{i + 1}{out.suffix}")
        raw = base64.b64decode(it["b64_json"])
        if raw[:8] != b"\x89PNG\r\n\x1a\n":
            print(f"[warn] item {i} is not PNG-signed; re-encoding to PNG", file=sys.stderr)
            raw = sprite_tools.to_png_bytes(raw)
        raw_path = path.with_name(path.stem + ".raw.png") if args.transparent else path
        raw_path.write_bytes(raw)
        info = {"apiTransparent": None, "backgroundRemoval": None}
        if args.transparent:
            alpha = sprite_tools.alpha_stats(raw_path)
            info["apiTransparent"] = alpha["transparent_ratio"] > 0.02
            if info["apiTransparent"]:
                raw_path.replace(path)
            else:
                rep = sprite_tools.remove_background(raw_path, path, key=None if args.auto_key else key_color,
                                                     tolerance=args.tolerance)
                info["backgroundRemoval"] = rep
                if not args.keep_raw:
                    raw_path.unlink()
        report = sprite_tools.validate(path, require_alpha=args.transparent, expect_size=None)
        if not report["ok"]:
            print(f"[check] {path}: {report['problems']}", file=sys.stderr)
        entry = {
            "path": _rel(path), "date": dt.date.today().isoformat(), "model": args.model,
            "endpoint": "images/edits" if args.cmd == "edit" else "images/generations",
            "size": args.size, "quality": args.quality, "prompt": prompt,
            "references": [_rel(Path(p)) for p in (getattr(args, "image", None) or [])],
            "width": report["width"], "height": report["height"], "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), **info,
            "revisedPrompt": it.get("revised_prompt"), "checks": report,
        }
        if not args.no_manifest:
            _manifest_add(Path(args.manifest), entry)
        saved.append(entry)
    _log({"time": dt.datetime.now().isoformat(timespec="seconds"), "task": task, "ok": True,
          "seconds": round(time.time() - t0, 1), "outputs": [s["path"] for s in saved],
          "backgroundParamDropped": dropped_background, "usage": resp.get("usage")})
    print(json.dumps([{k: s[k] for k in ("path", "width", "height", "bytes", "apiTransparent", "checks")} for s in saved],
                     indent=2, ensure_ascii=False))
    return 0 if all(s["checks"]["ok"] for s in saved) else 5


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("generate", "edit"):
        p = sub.add_parser(name)
        g = p.add_mutually_exclusive_group(required=True)
        g.add_argument("--prompt")
        g.add_argument("--prompt-file")
        p.add_argument("--out", required=True, help="target .png")
        p.add_argument("--model", default=DEFAULT_MODEL)
        p.add_argument("--size", default="1024x1024", help="1024x1024, 1536x1024, 1024x1536 or auto")
        p.add_argument("--quality", default="high", help="low|medium|high|auto ('' to omit)")
        p.add_argument("--n", type=int, default=1)
        p.add_argument("--transparent", action="store_true", help="sprite cut-out: request alpha, chroma-key fallback")
        p.add_argument("--no-api-background", dest="api_background", action="store_false",
                       help="do not send background=transparent (use chroma key only)")
        p.add_argument("--no-chroma-hint", action="store_true", help="do not append the flat-backdrop sentence")
        p.add_argument("--key-color", default="#FF00FF")
        p.add_argument("--key-color-name", default="magenta")
        p.add_argument("--auto-key", action="store_true", help="estimate the backdrop colour from the borders")
        p.add_argument("--tolerance", type=float, default=60.0)
        p.add_argument("--keep-raw", action="store_true", help="keep <name>.raw.png before background removal")
        p.add_argument("--task", help="budget bucket (one user task)")
        p.add_argument("--max-requests", type=int, help="approved per-task limit (default 5)")
        p.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
        p.add_argument("--no-manifest", action="store_true")
        p.add_argument("--overwrite", action="store_true")
        p.add_argument("--timeout", type=float, default=300)
        p.add_argument("--retries", type=int, default=3, help="retries for 429/5xx (honours Retry-After)")
        p.add_argument("--dry-run", action="store_true", help="print the request, spend nothing")
        if name == "edit":
            p.add_argument("--image", action="append", required=True, help="reference image(s), repeatable")
            p.add_argument("--mask", help="optional PNG mask (transparent = editable)")
    args = ap.parse_args()
    if args.n < 1:
        ap.error("--n must be >= 1")
    if args.n > 1:
        print("[budget] n>1 bills several images in one request; each image counts against the budget",
              file=sys.stderr)
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
