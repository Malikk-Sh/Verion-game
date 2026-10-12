# Генерация графики через TOOKEN.club

Автономный конвейер ассетов: GPT Image `gpt-image-2.5-sunburst` через TOOKEN.club → Pillow-постобработка → проверка → подключение к игре. Правила для Claude — `CLAUDE.md` и skill `.claude/skills/game-art/SKILL.md`.

## Файлы

| Путь | Назначение |
|---|---|
| `scripts/generate_asset.py` | Запросы `generate` / `edit`, декодирование PNG, повторы, бюджет, манифест |
| `scripts/sprite_tools.py` | `remove-bg`, `trim`, `resize --pixel`, `webp`, `atlas`, `split`, `check` |
| `tools/preview_asset.mjs` | Chromium + Vite: картинка в контейнере `itemArt()` игры на 32/48/96/200 px, снимок `artifacts/asset-preview.png` |
| `docs/art/generated/MANIFEST.json` | Автоматический журнал: prompt, модель, размеры, SHA-256, проверки |
| `artifacts/asset_gen/` | Локальные счётчик бюджета и журнал запросов (в Git не попадают) |

## Быстрый пример

```bash
python3 scripts/generate_asset.py generate --task ingot --transparent \
  --prompt "..." --out docs/art/generated/iron_ingot.png
python3 scripts/sprite_tools.py trim docs/art/generated/iron_ingot.png /tmp/t.png --square --pad 24
python3 scripts/sprite_tools.py resize /tmp/t.png /tmp/r.png --size 512x512
python3 scripts/sprite_tools.py webp /tmp/r.png src/assets/items/iron_ingot.webp
python3 scripts/sprite_tools.py check --alpha --size 512x512 src/assets/items/iron_ingot.webp
VIREON_CHROMIUM_PATH=/opt/pw-browsers/chromium node tools/preview_asset.mjs src/assets/items/iron_ingot.webp
```

## Поведение API (проверено 12.10.2026)

- Ключ в облачной среде подставляет прокси; вне её — `TOOKEN_API_KEY`.
- `/v1/models`: `gpt-image-2.5-sunburst` поддерживает `images/generations` и `images/edits`.
- Лимит ключа — 2 одновременных запроса. При занятых слотах API отвечает 429 с `Retry-After: 1` и `billing: "Токены не списаны"`; скрипт ждёт 20, 40, 60 с… Генерации выполнять последовательно.
- Встречается 502 `upstream request failed`; скрипт повторяет запрос.

## Тестовая генерация

12.10.2026 тест ещё не выполнен. Первый запрос получил два ответа 502 `upstream request failed`. После этого ключ ~35 минут отвечал 429 при `X-Ratelimit-Active-Concurrent: 2/2`: оба слота занимали запросы на стороне TOOKEN. Токены не списаны, изображение не получено. Скрипт и постобработка проверены офлайн (синтетический спрайт: удаление фона, обрезка, nearest-neighbor, атлас), `tools/preview_asset.mjs` проверен на `stone.webp`. Повторить тест, когда слоты освободятся:

```bash
python3 scripts/generate_asset.py generate --task art-pipeline-test --transparent --keep-raw \
  --out docs/art/generated/test/iron_ingot.png --prompt "<промпт слитка из MANIFEST/истории сессии>"
```
