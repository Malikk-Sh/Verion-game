#!/usr/bin/env python3
"""Pillow/numpy helpers for generated game art: background removal, trim, scaling, atlases, checks.

Commands
  remove-bg  IN OUT [--key #FF00FF | --auto-key] [--tolerance 60]   chroma-key cut-out with soft, despilled edges
  trim       IN OUT [--pad 8] [--square]                            crop to visible pixels
  resize     IN OUT --size 128x128 [--pixel]                        fit inside size; --pixel = nearest-neighbor, integer factor
  webp       IN OUT [--quality 90]                                  RGBA WebP for the Vite game (project convention)
  atlas      OUT.png FRAME... [--cols N] [--cell WxH] [--anim name:0-3:120] [--pixel]
             packs frames on a fixed grid and writes OUT.json (frames + animations); never trust a model-drawn grid
  split      SHEET OUTDIR --cols C --rows R                          cut an existing sheet into equal frames
  check      FILE... [--alpha] [--size WxH]                         PNG/WebP validity, size, transparency, edge bleed

Requires Pillow and numpy (pip install pillow numpy).
"""
from __future__ import annotations

import argparse
import io
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def parse_color(s: str) -> tuple[int, int, int]:
    s = s.strip().lstrip("#")
    if len(s) != 6:
        raise ValueError(f"colour must be #RRGGBB, got {s!r}")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def to_png_bytes(raw: bytes) -> bytes:
    buf = io.BytesIO()
    Image.open(io.BytesIO(raw)).save(buf, "PNG")
    return buf.getvalue()


def _rgba(path: Path | str) -> Image.Image:
    im = Image.open(path)
    im.load()
    return im.convert("RGBA")


def alpha_stats(path: Path | str) -> dict:
    a = np.asarray(_rgba(path))[:, :, 3]
    return {"transparent_ratio": float((a < 8).mean()), "opaque_ratio": float((a > 247).mean())}


def estimate_key(rgb: np.ndarray) -> tuple[int, int, int]:
    """Median colour of a 4-px border ring: the backdrop the model actually painted."""
    ring = np.concatenate([rgb[:4].reshape(-1, 3), rgb[-4:].reshape(-1, 3),
                           rgb[:, :4].reshape(-1, 3), rgb[:, -4:].reshape(-1, 3)])
    return tuple(int(v) for v in np.median(ring, axis=0))  # type: ignore[return-value]


def remove_background(src: Path | str, dst: Path | str, key: tuple[int, int, int] | None = None,
                      tolerance: float = 60.0, soft: float | None = None) -> dict:
    """Remove the backdrop connected to the image border (plus enclosed holes of the exact key colour).

    Edge pixels between `tolerance` and `tolerance + soft` RGB distance get partial alpha and the key
    colour is un-mixed from them (despill), so cut-outs have no coloured fringe.
    """
    im = _rgba(src)
    arr = np.asarray(im).astype(np.float32)
    rgb = arr[:, :, :3]
    key = key or estimate_key(rgb.astype(np.uint8))
    soft = tolerance if soft is None else soft
    k = np.array(key, np.float32)
    dist = np.sqrt(((rgb - k) ** 2).sum(axis=2))
    near = dist < tolerance + soft

    # Flood from the border through "near key" pixels only; a 1-px padded frame joins all border seeds.
    h, w = near.shape
    m = Image.new("L", (w + 2, h + 2), 255)
    m.paste(Image.fromarray((near * 255).astype(np.uint8)), (1, 1))
    ImageDraw.floodfill(m, (0, 0), 128, thresh=0)
    connected = np.asarray(m)[1:-1, 1:-1] == 128
    # Holes (e.g. between arm and body) are removed only when they are clearly the key colour.
    holes = (dist < tolerance * 0.6) & ~connected
    hole_px = int(holes.sum())
    region = connected | holes

    alpha = arr[:, :, 3] / 255.0
    ramp = np.clip((dist - tolerance) / max(soft, 1e-3), 0.0, 1.0)
    new_a = np.where(region, ramp, 1.0) * alpha
    # Despill: observed = a*fg + (1-a)*key  ->  fg = (observed - (1-a)*key) / a
    a3 = np.clip(new_a, 1e-3, 1.0)[:, :, None]
    fg = np.where((region & (new_a > 0))[:, :, None], (rgb - (1 - a3) * k) / a3, rgb)
    out = np.dstack([np.clip(fg, 0, 255), new_a * 255]).astype(np.uint8)
    out[out[:, :, 3] == 0, :3] = 0
    Image.fromarray(out, "RGBA").save(dst, "PNG", optimize=True)
    a = out[:, :, 3]
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    rep = {"key": "#%02X%02X%02X" % key, "tolerance": tolerance, "removed_ratio": round(float((a == 0).mean()), 4),
           "subject_ratio": round(float((a > 247).mean()), 4), "hole_pixels": hole_px,
           "border_opaque_ratio": round(float((border > 32).mean()), 4)}
    rep["ok"] = 0.03 < rep["subject_ratio"] < 0.97 and rep["border_opaque_ratio"] < 0.05
    return rep


def trim(src: Path | str, dst: Path | str, pad: int = 8, square: bool = False) -> tuple[int, int]:
    im = _rgba(src)
    bbox = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if not bbox:
        raise ValueError(f"{src}: fully transparent")
    im = im.crop(bbox)
    w, h = im.size
    W, H = (max(w, h),) * 2 if square else (w, h)
    canvas = Image.new("RGBA", (W + 2 * pad, H + 2 * pad), (0, 0, 0, 0))
    canvas.paste(im, ((W - w) // 2 + pad, (H - h) // 2 + pad))
    canvas.save(dst, "PNG", optimize=True)
    return canvas.size


def resize(src: Path | str, dst: Path | str, size: tuple[int, int], pixel: bool = False) -> tuple[int, int]:
    """Fit inside size keeping aspect. Pixel art uses nearest-neighbor with an integer factor when possible."""
    im = _rgba(src)
    w, h = im.size
    f = min(size[0] / w, size[1] / h)
    if pixel:
        f = math.floor(f) if f >= 1 else 1 / math.ceil(1 / f)
        res = Image.NEAREST
    else:
        res = Image.LANCZOS
    nw, nh = max(1, round(w * f)), max(1, round(h * f))
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    out.paste(im.resize((nw, nh), res), ((size[0] - nw) // 2, (size[1] - nh) // 2))
    out.save(dst, "PNG", optimize=True)
    return nw, nh


def to_webp(src: Path | str, dst: Path | str, quality: int = 90) -> int:
    _rgba(src).save(dst, "WEBP", quality=quality, method=6, exact=False)
    return Path(dst).stat().st_size


def build_atlas(out: Path | str, frames: list[Path], cols: int | None = None, cell: tuple[int, int] | None = None,
                anims: list[str] | None = None, pixel: bool = False, pad: int = 2) -> dict:
    """Pack frames into a fixed grid with bottom-centre alignment (stable feet across a walk cycle)."""
    ims = [_rgba(p) for p in frames]
    cw = cell[0] if cell else max(i.width for i in ims)
    ch = cell[1] if cell else max(i.height for i in ims)
    cols = cols or math.ceil(math.sqrt(len(ims)))
    rows = math.ceil(len(ims) / cols)
    sheet = Image.new("RGBA", (cols * (cw + pad) + pad, rows * (ch + pad) + pad), (0, 0, 0, 0))
    meta: dict = {"image": Path(out).name, "size": {"w": sheet.width, "h": sheet.height},
                  "cell": {"w": cw, "h": ch}, "frames": {}, "animations": {}}
    for n, (p, im) in enumerate(zip(frames, ims)):
        if im.width > cw or im.height > ch:
            f = min(cw / im.width, ch / im.height)
            im = im.resize((max(1, int(im.width * f)), max(1, int(im.height * f))), Image.NEAREST if pixel else Image.LANCZOS)
        x0 = pad + (n % cols) * (cw + pad)
        y0 = pad + (n // cols) * (ch + pad)
        sheet.paste(im, (x0 + (cw - im.width) // 2, y0 + ch - im.height))
        key = Path(p).stem if Path(p).stem not in meta["frames"] else f"{Path(p).stem}_{n}"
        meta["frames"][key] = {"x": x0, "y": y0, "w": cw, "h": ch, "index": n}
    for spec in anims or []:  # name:first-last:ms
        name, rng, ms = spec.split(":")
        a, b = (int(v) for v in rng.split("-"))
        if not 0 <= a <= b < len(frames):
            raise ValueError(f"animation {name}: range {a}-{b} outside frames 0-{len(frames) - 1}")
        meta["animations"][name] = {"frames": list(range(a, b + 1)), "frameMs": int(ms), "loop": True}
    sheet.save(out, "PNG", optimize=True)
    Path(out).with_suffix(".json").write_text(json.dumps(meta, indent=2) + "\n")
    return meta


def split_sheet(sheet: Path | str, outdir: Path | str, cols: int, rows: int) -> list[Path]:
    im = _rgba(sheet)
    if im.width % cols or im.height % rows:
        raise ValueError(f"{im.width}x{im.height} sheet is not divisible into {cols}x{rows} equal frames")
    cw, ch = im.width // cols, im.height // rows
    Path(outdir).mkdir(parents=True, exist_ok=True)
    out = []
    for r in range(rows):
        for c in range(cols):
            p = Path(outdir) / f"frame_{r * cols + c:02d}.png"
            im.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)).save(p, "PNG")
            out.append(p)
    return out


def validate(path: Path | str, require_alpha: bool = False, expect_size: tuple[int, int] | None = None) -> dict:
    """Decode fully, then check size, alpha and that the subject does not touch the frame edges."""
    problems: list[str] = []
    p = Path(path)
    try:
        with Image.open(p) as probe:
            probe.verify()
        im = Image.open(p)
        im.load()
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "problems": [f"cannot decode: {e}"], "width": 0, "height": 0}
    rep: dict = {"format": im.format, "mode": im.mode, "width": im.width, "height": im.height}
    if expect_size and im.size != tuple(expect_size):
        problems.append(f"size {im.size} != {tuple(expect_size)}")
    a = np.asarray(im.convert("RGBA"))[:, :, 3]
    rep["hasAlpha"] = bool((a < 250).any())
    rep["transparentRatio"] = round(float((a < 8).mean()), 4)
    if require_alpha:
        if not rep["hasAlpha"]:
            problems.append("no transparency")
        border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
        rep["edgeOpaqueRatio"] = round(float((border > 32).mean()), 4)
        if rep["edgeOpaqueRatio"] > 0.02:
            problems.append("subject or backdrop touches the canvas edge (cropped frame / leftover background)")
        vis = a > 8
        rep["subjectRatio"] = round(float(vis.mean()), 4)
        if rep["subjectRatio"] < 0.02:
            problems.append("subject too small / nearly empty")
        bbox = Image.fromarray((vis * 255).astype(np.uint8)).getbbox()
        rep["bbox"] = list(bbox) if bbox else None
        rep["semiTransparentRatio"] = round(float(((a > 8) & (a < 247)).mean()), 4)
    rep["problems"] = problems
    rep["ok"] = not problems
    return rep


def _size(s: str) -> tuple[int, int]:
    w, h = s.lower().split("x")
    return int(w), int(h)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("remove-bg"); p.add_argument("src"); p.add_argument("dst")
    p.add_argument("--key", default="#FF00FF"); p.add_argument("--auto-key", action="store_true")
    p.add_argument("--tolerance", type=float, default=60.0)
    p = sub.add_parser("trim"); p.add_argument("src"); p.add_argument("dst")
    p.add_argument("--pad", type=int, default=8); p.add_argument("--square", action="store_true")
    p = sub.add_parser("resize"); p.add_argument("src"); p.add_argument("dst")
    p.add_argument("--size", required=True); p.add_argument("--pixel", action="store_true")
    p = sub.add_parser("webp"); p.add_argument("src"); p.add_argument("dst"); p.add_argument("--quality", type=int, default=90)
    p = sub.add_parser("atlas"); p.add_argument("out"); p.add_argument("frames", nargs="+")
    p.add_argument("--cols", type=int); p.add_argument("--cell"); p.add_argument("--anim", action="append")
    p.add_argument("--pixel", action="store_true")
    p = sub.add_parser("split"); p.add_argument("sheet"); p.add_argument("outdir")
    p.add_argument("--cols", type=int, required=True); p.add_argument("--rows", type=int, required=True)
    p = sub.add_parser("check"); p.add_argument("files", nargs="+"); p.add_argument("--alpha", action="store_true")
    p.add_argument("--size")
    a = ap.parse_args()

    if a.cmd == "remove-bg":
        rep = remove_background(a.src, a.dst, None if a.auto_key else parse_color(a.key), a.tolerance)
        print(json.dumps(rep, indent=2)); return 0 if rep["ok"] else 1
    if a.cmd == "trim":
        print(trim(a.src, a.dst, a.pad, a.square)); return 0
    if a.cmd == "resize":
        print(resize(a.src, a.dst, _size(a.size), a.pixel)); return 0
    if a.cmd == "webp":
        print(to_webp(a.src, a.dst, a.quality), "bytes"); return 0
    if a.cmd == "atlas":
        meta = build_atlas(a.out, [Path(f) for f in a.frames], a.cols, _size(a.cell) if a.cell else None, a.anim, a.pixel)
        print(json.dumps({"size": meta["size"], "frames": len(meta["frames"])})); return 0
    if a.cmd == "split":
        print("\n".join(map(str, split_sheet(a.sheet, a.outdir, a.cols, a.rows)))); return 0
    ok = True
    for f in a.files:
        rep = validate(f, a.alpha, _size(a.size) if a.size else None)
        ok &= rep["ok"]
        print(f, json.dumps(rep))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
