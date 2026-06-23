# Parent Mobile Control API Draft

Not integrated.

## List Control Items

```text
GET /api/control/items
```

Response:

```json
{
  "ok": true,
  "items": [
    {
      "media_item_id": 1,
      "title": "Buddy the Blue Whale",
      "subtitle": "Deep Blue Sea",
      "card_name": "Deep Blue Sea: Whale",
      "artwork_url": "/assets/spotify-artwork/...",
      "provider_uri": "spotify:episode:..."
    }
  ]
}
```

## Play Item

```text
POST /api/control/play
```

Request:

```json
{
  "media_item_id": 1,
  "receiver_id": 1
}
```

## Pause

```text
POST /api/control/pause
```

## Status

```text
GET /api/control/status
```

Should return the active playback state Auri knows about, and optionally Spotify current playback if available.
