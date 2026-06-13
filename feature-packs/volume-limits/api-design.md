# Volume Limits API Draft

Not integrated.

## Save Spotify Volume Settings

Extend existing:

```text
POST /api/settings/spotify-playback
```

Request:

```json
{
  "default_device_id": "spotify-device-id",
  "start_volume_percent": 15,
  "max_volume_percent": 35
}
```

Validation:

- blank `start_volume_percent` may mean "unchanged"
- `max_volume_percent` should be a whole number 0-100 or blank
- if both are set, `start_volume_percent` cannot exceed `max_volume_percent`

## Get Current Target Volume

```text
GET /api/spotify/volume
```

Response:

```json
{
  "ok": true,
  "device": {
    "id": "spotify-device-id",
    "name": "Eabha Echo Dot",
    "volume_percent": 21,
    "supports_volume": true
  },
  "settings": {
    "start_volume_percent": 15,
    "max_volume_percent": 35
  }
}
```

Implementation idea:

- call `/me/player/devices`
- match saved `spotify_default_device_id`
- return the matching device if present

## Set Volume Manually

```text
POST /api/spotify/volume
```

Request:

```json
{
  "volume_percent": 20
}
```

Validation:

- whole number 0-100
- if max volume is configured, requested value must be at or below max unless explicit admin override exists
