# Playback History API Draft

Not integrated.

## List Playback Events

```text
GET /api/playback-events?limit=100&status=failed&receiver_id=1
```

Response:

```json
{
  "ok": true,
  "events": [
    {
      "id": 1,
      "created_at": "2026-06-13T18:00:00.000Z",
      "event_type": "spotify_play",
      "status": "sent",
      "card_name": "Deep Blue Sea: Whale",
      "media_title": "Buddy the Blue Whale",
      "receiver_name": "Eabha receiver",
      "target_device_name": "Eabha Echo Dot",
      "provider_uri": "spotify:episode:..."
    }
  ]
}
```

## Filter Options

- `limit`
- `status`
- `event_type`
- `receiver_id`
- `tag_id`
- `provider`
- `q` text search

## Export Later

Potential future endpoint:

```text
GET /api/playback-events.csv
```
