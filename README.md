# Kids Tunes

A small local scan receiver for a DIY NFC/RFID music box.

Phase 1 receives fake scan events, stores them in SQLite, and shows recent scans in a browser.
Phase 2 adds known card assignments so a scanned tag can be named and recognized later.
Phase 3 adds fake/log-only actions for known cards.
Phase 4 adds an optional multi-device Sonos executor for basic `play` and `stop` commands.
Phase 5 adds receiver profiles so the same card can route to different speakers/accounts based on which reader scanned it.
Phase 6 adds an optional ESPHome bridge. It can connect to the existing tag reader without flashing new firmware and has successfully created a scan from an Android phone tap.

For the current handoff, immediate next steps, and roadmap, start with [NEXT.md](NEXT.md).
For older background detail, see [PROJECT_STATUS.md](PROJECT_STATUS.md).

## Run Locally On Windows

Install dependencies once:

```powershell
npm install
```

Start the app:

```powershell
npm start
```

Open:

```text
http://localhost:8787
```

Health check:

```text
http://localhost:8787/health
```

## Fake A Scan

PowerShell:

```powershell
$body = '{"reader_id":"tagreader-c6c6e4","tag_id":"08-9F-69-C8"}'
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:8787/api/scan `
  -ContentType "application/json" `
  -Body $body
```

Then refresh:

```text
http://localhost:8787
```

Unknown tags can be assigned directly from the table. Enter a card name, optionally add notes, and save.
Known cards can also be given fake actions from the Known cards section. When a known tag is scanned and its action is enabled, the app records an action event with status `would_run`.
Sonos commands only send to a real speaker after Sonos is enabled and a target Sonos device is added in the Sonos devices section.
Receivers map a `reader_id` to a friendly profile, child name, default Sonos device, and later a Spotify account.

The ESPHome reader bridge can be enabled from the browser UI. For the current tag reader, use host/IP `192.168.5.87` and reader ID `tagreader-c6c6e4`. The bridge listens to ESPHome logs and Home Assistant service/event messages. If it detects a tag ID, it creates a normal scan event with source `esphome`.

The bridge has a watchdog. It reconnects automatically if the ESPHome connection reports `disconnected` or `error`, if a connection attempt gets stuck, or after a long scheduled refresh interval. The Reader page also has a `Reconnect Reader` button for a manual reconnect without restarting Kids Tunes.

Current ESPHome status: the app can connect to the reader, receive `esphome.tag_scanned` events, and create normal scans from them. Repeated Google Pixel 10 taps created scans successfully, but each tap produced a different tag ID, so the phone is useful for debugging rather than as a stable card.

For Pixel-based testing, the app has a temporary reader test action. Unknown `esphome` scans from `tagreader-c6c6e4` can run the selected test action without assigning the changing Pixel tag IDs as permanent cards.

End-to-end playback has been proven with:

```text
Pixel tap -> ESPHome reader -> Kids Tunes -> NAS MP3 URL -> Sonos Move
```

The first successful NAS media URL was:

```text
http://192.168.5.55/Kids-Tunes-Test/02%20Babe%20I%27m%20Gonna%20Leave%20You.mp3
```

Recent scans as JSON:

```text
http://localhost:8787/api/scans
```

## Docker

```powershell
docker compose up --build
```

The SQLite database is stored at:

```text
%LOCALAPPDATA%\Kids Tunes\kids_tunes.db
```

When running in Docker, the SQLite database is stored at:

```text
data/kids_tunes.db
```

## API

`POST /api/scan`

```json
{
  "reader_id": "tagreader-c6c6e4",
  "tag_id": "08-9F-69-C8"
}
```

`GET /api/scans`

Returns recent scan events, including known/unknown status and card details when assigned.

`GET /api/cards`

Returns known cards.

`GET /api/receivers`

Returns receiver profiles.

`POST /api/receivers`

Creates or updates a receiver profile.

```json
{
  "reader_id": "tagreader-c6c6e4",
  "name": "Eabha receiver",
  "child_name": "Eabha",
  "default_sonos_host": "192.168.5.15",
  "spotify_account_label": "Eabha Spotify",
  "enabled": true
}
```

`POST /api/cards`

Creates or updates a card assignment.

```json
{
  "tag_id": "08-9F-69-C8",
  "name": "Frozen Songs",
  "notes": "Temporary test card"
}
```

`GET /api/cards/08-9F-69-C8`

Returns one known card by tag ID.

`POST /api/actions`

Creates or updates a fake action for a known card.

```json
{
  "tag_id": "08-9F-69-C8",
  "action_type": "pretend_play",
  "action_target": "Frozen soundtrack",
  "enabled": true
}
```

Supported action types:

```text
none
pretend_play
stop
sleep_timer
sonos_play
sonos_play_url
sonos_stop
spotify_play
spotify_pause
stop_all
```

Stop action meanings:

```text
sonos_stop     Stops the selected Sonos speaker only.
sonos_play_url Plays an http/https audio URL on the receiver's default Sonos speaker.
spotify_play   Plays a Spotify track, album, playlist, or episode URI/URL through Spotify Connect.
               The app sets the configured start volume first, then starts track/episode playback from the beginning.
               Scanning the same recently active card again pauses playback.
spotify_pause  Pauses Spotify account playback on the configured default Spotify Connect device.
stop_all       Stops the selected Sonos speaker now, and logs that Spotify pause is not configured yet.
```

## Spotify Test Setup

Spotify playback uses the Spotify Web API and requires a Spotify Developer app plus a Premium account.

Set this redirect URI in the Spotify Developer app:

```text
http://127.0.0.1:8787/spotify/callback
```

If Spotify shows `redirect_uri: Not matching configuration`, the Developer app is missing that exact callback URL. Add it in the Spotify Developer Dashboard and save the app settings, then click `Connect Spotify` again in Kids Tunes.

If playback fails with `invalid_client` after changing `.env`, the saved Spotify token was issued for a different Developer app. Click `Connect Spotify` again so Kids Tunes stores a fresh token for the current Client ID/Secret.

Create a local `.env` file from the sample:

```powershell
Copy-Item .env.example .env
notepad .env
```

Put your real Spotify Developer values into `.env`:

```text
SPOTIFY_CLIENT_ID=your-client-id
SPOTIFY_CLIENT_SECRET=your-client-secret
```

Then start the app with:

```powershell
npm.cmd start
```

Then open the UI and use the Spotify section to connect the account. The first Spotify test can target a listed Spotify Connect device such as an Echo speaker. Spotify track, album, playlist, and episode URLs are accepted. The Spotify section also stores the default device ID and a safe start volume, which defaults to `30`.

The Media page can also import a Spotify playlist into the local media library. After this feature was added, Spotify auth requests `playlist-read-private`; reconnect Spotify once after restarting so the saved token has the playlist scope.

Playlist import API:

`POST /api/spotify/import-playlist`

```json
{
  "playlist_url": "https://open.spotify.com/playlist/..."
}
```

After media is imported, the Media page can assign a physical card:

1. Click `Assign Next Card` beside an unassigned Spotify media item.
2. Scan an unknown RFID/NFC card within 15 minutes.
3. Kids Tunes creates the card, sets an enabled `spotify_play` action, and links it to the media item.

Known cards are protected during this flow. If a known card is scanned while an assignment is pending, the app records a blocked assignment event and leaves the pending assignment open.

Assignment APIs:

```text
GET  /api/media/pending-assignment
POST /api/media/assign-next
POST /api/media/assign-next/cancel
```

Playlist artwork caching:

- Playlist import tries to cache Spotify artwork into `data/spotify-artwork/`.
- The Media page has a `Cache Missing Artwork` button for older imports or failed downloads.
- Successful caches update `media_items.local_artwork_path`.
- Cached artwork is local data and is ignored by Git.

Artwork cache API:

```text
POST /api/media/cache-artwork
```

Sonos actions can target a specific Sonos device or `Receiver default speaker`. Receiver default uses the `reader_id` on the scan to choose the speaker.

`GET /api/actions/08-9F-69-C8`

Returns the fake action for a tag.

`GET /api/action-events`

Returns recent fake action events created by scans.

`GET /api/settings/sonos`

Returns Sonos executor settings.

`POST /api/settings/sonos`

Enables or disables real Sonos commands globally.

```json
{
  "sonos_enabled": true
}
```

`POST /api/sonos/devices`

Adds or updates a named Sonos device.

```json
{
  "name": "Living Room",
  "host": "192.168.5.40",
  "enabled": true
}
```

`POST /api/sonos/test`

Sends a direct test command to a configured Sonos speaker. If there is exactly one enabled device, `host` can be omitted.

```json
{
  "command": "stop",
  "host": "192.168.5.40"
}
```

Supported test commands:

```text
stop
play
```

`GET /api/settings/esphome`

Returns ESPHome bridge settings and current connection status.

`POST /api/settings/esphome`

Saves ESPHome bridge settings and starts or stops the bridge.

```json
{
  "esphome_host": "192.168.5.28",
  "reader_id": "tagreader-c6c6e4",
  "esphome_enabled": true
}
```

`GET /health`

Returns service, database, and ESPHome bridge status.

## Notes

This version intentionally avoids Spotify, NAS audio, and Home Assistant as required integrations. Sonos support is limited to direct local-network `play` and `stop` commands. ESPHome support is currently a native API bridge for the current firmware rather than a replacement firmware.

Node currently marks its built-in SQLite module as experimental. The start script suppresses that warning, and the app is intentionally small enough that we can switch to a dependency-backed SQLite library later if that becomes useful.
