# Printable Label Queue API Draft

Not integrated.

## Update Print Status

```text
POST /api/media/print-status
```

Request:

```json
{
  "media_item_id": 123,
  "print_status": "queued"
}
```

Response:

```json
{
  "ok": true,
  "media_item": {
    "id": 123,
    "print_status": "queued"
  }
}
```

Validation:

- `media_item_id` must exist.
- `print_status` must be one of `not_printed`, `queued`, `pdf_generated`, `printed`.

## Generate Queued Print Sheet

```text
POST /api/print-sheets/generate
```

Request:

```json
{
  "status": "queued",
  "label_size_mm": 48,
  "box_size_mm": 50,
  "gap_mm": 12
}
```

Response:

```json
{
  "ok": true,
  "print_sheet": {
    "item_count": 9,
    "html_path": "data/print-sheets/labels-2026-06-13-001.html",
    "pdf_path": "data/print-sheets/labels-2026-06-13-001.pdf"
  }
}
```

Validation:

- Only include media with `local_artwork_path`.
- Return a clear error if no queued items have cached artwork.
- Keep generated paths inside `data/print-sheets/`.

## Open API Question

For the first integration, the browser route may be enough. API can follow once the generator is stable.
