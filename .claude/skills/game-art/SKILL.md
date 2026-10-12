---
name: game-art
description: Create game graphics (sprites, item icons, characters, animation frames, textures, backgrounds, props, UI elements) with GPT Image through the TOOKEN.club API, then cut out, trim, scale, pack into atlases, validate and wire them into the game. Use automatically whenever game development work needs a new or replacement raster asset, a sprite sheet/animation, a texture or a UI image — the user does not write prompts; Claude acts as the game artist.
---

# Game art via TOOKEN.club GPT Image

Claude is the game's artist as well as its programmer. When a task needs graphics, decide which
images are required, write the prompts yourself, generate, post-process, validate, integrate and
check them in the running game. Do not ask the user for prompts.

## Tools

- `scripts/generate_asset.py` — API client (`generate`, `edit`), PNG decoding, budget, manifest.
- `scripts/sprite_tools.py` — Pillow/numpy: `remove-bg`, `trim`, `resize [--pixel]`, `webp`,
  `atlas`, `split`, `check`.
- Requires Python 3 with Pillow and numpy (`pip install pillow numpy` if missing).

API: `POST https://tooken.club/v1/images/generations` and `/v1/images/edits`, model
`gpt-image-2.5-sunburst` (the only TOOKEN image model with edits), PNG, image in `data[0].b64_json`.
Auth: in cloud sessions the network proxy injects the key (Network secrets) — send no
Authorization header. Elsewhere set `TOOKEN_API_KEY`; the script sends it as a header only.
Never print, log, commit or write the key into files.

Known API behaviour (tested 12.10.2026):
- Concurrency limit is 2 requests per key (`X-Ratelimit-Limit-Concurrent`). A 429 with
  `Retry-After: 1` usually means both slots are busy; the script backs off 20 s, 40 s, … .
  Rate-limited and rejected requests report `billing: "Токены не списаны"` and are refunded to the
  local budget counter. Run generations one at a time, never in parallel.
- Upstream 502 ("upstream request failed") happens; the script retries.
- Documented parameters: generations — `model`, `prompt`; edits — multipart `image`/`image[]`
  (≤16), optional `mask`, `n=1`, `size=auto`, `output_format=png`. The script omits `size`,
  `quality`, `background` unless passed (`--size`, `--quality`, `--api-background`).
- Transparency is not documented: `--transparent` uses a flat #FF00FF backdrop in the prompt plus
  chroma-key removal; `--api-background` additionally tries `background=transparent`. The script
  always verifies alpha.

## Workflow

1. **Study the project first**: engine/renderer, how assets are imported (here: Vite static
   imports, `src/ui/art.ts` `ITEM_ART`), folder layout, formats/sizes (here: WebP RGBA 512×512 for
   UI sprites), existing manifests (`docs/art/ui/*.json`) and the approved art style. Reuse
   existing suitable assets — never regenerate an approved asset without a reason from the user.
2. **Plan the list** of images with target path, size, background and purpose. If it needs more
   than 5 paid requests, ask the user to approve the budget first (state the count).
3. **Write the prompt** (English works best). Always state: art style (copy the project style block
   verbatim for consistency), subject, view/angle, pose, framing ("single centered isolated object,
   fully visible, ~80–86% of canvas, generous margins"), lighting direction, palette, and negatives
   (no text, no UI, no floor, no cast shadow, no other objects). One asset per request — never ask
   the model to draw a grid/sheet of frames.
4. **Generate**:
   ```bash
   python3 scripts/generate_asset.py generate --task <short-task-id> --transparent \
     --prompt "..." --out docs/art/generated/<name>.png
   # preview the request for free: add --dry-run
   ```
   Try `--size 1536x1024`/`1024x1536` for backgrounds (undocumented; drop it if rejected). Raw PNG
   sources live under `docs/art/generated/` (or the project's art-source folder); every result is
   appended to `docs/art/generated/MANIFEST.json` with prompt, model, sizes and SHA-256.
5. **Look at the result** (Read the PNG) and judge it: silhouette readable at the in-game size,
   style match, no cropped parts, no text artefacts, clean edges. Regenerate only if it fails and
   budget allows.
6. **Post-process** with `sprite_tools.py`: `trim --square --pad 16`, `resize --size 512x512`
   (`--pixel` = nearest-neighbor with integer factors for pixel art — never smooth-scale pixel art),
   `webp` for this project's runtime format.
7. **Validate**: `python3 scripts/sprite_tools.py check --alpha --size 512x512 <files>` — decodes
   fully, checks dimensions, real transparency, nothing touching canvas edges, non-empty subject.
8. **Integrate and verify in the game**: import the file where the engine expects it, run the
   project's build and browser checks (`npx --no-install tsc --noEmit`, `npx --no-install vite build`,
   the relevant `npm run verify:*`), and look at a screenshot of the asset in place.
9. Record provenance in the relevant manifest/doc and mention new assets to the user.

## Transparency and background removal

`--transparent` asks for a flat magenta backdrop (and with `--api-background` also for API alpha).
If the returned image has no alpha, `remove_background` flood-fills from the borders through
key-coloured pixels, removes clearly key-coloured enclosed holes, ramps alpha across the soft edge
and un-mixes the key colour (despill). It reports `subject_ratio`/`border_opaque_ratio`; `ok:false`
means inspect visually. For non-magenta backdrops use `--auto-key` (median border colour). Avoid
magenta in subjects that need cut-outs; pick another `--key-color` then.

## Animation frames and characters

- Generate a hero/base frame first. For further frames call `edit` with the base frame as
  `--image` and describe only the pose change ("same character, same outfit, colours, proportions,
  scale and camera; left foot forward, mid-stride"). Keep the camera and framing identical.
- Each frame is its own request → plan the budget (e.g. 4-frame walk = 1 base + 3 edits).
- Cut out, then `trim` all frames with the same padding, then normalise in `atlas` with a fixed
  `--cell` (bottom-centre alignment keeps feet stable). The atlas JSON stores frame rectangles and
  animations (`--anim walk:0-3:120`). Build sheets programmatically; never trust a model-drawn grid.
  To reuse an existing sheet, `split --cols --rows`.
- Check frame-to-frame consistency visually (assemble a contact sheet with `atlas`) before integration.

## Budget and safety

- Default: at most 5 paid requests per user task (`--task`; counter in git-ignored
  `artifacts/asset_gen/budget.json`). For more, ask the user, then pass `--max-requests N`.
- `--n 2+` counts each image. Prefer one image per request.
- Request log: `artifacts/asset_gen/requests.jsonl` (no secrets).
- Outputs never overwrite existing files unless `--overwrite` is given deliberately.
