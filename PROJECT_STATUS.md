# Kids Tunes Project Status

This is an older background/history document. For current handoff notes, immediate next steps, and the roadmap, use `NEXT.md` as the standard project handoff file.

Last updated: 2026-06-07

## Project Goal

Kids Tunes is a lightweight local replacement for the old Home Assistant-centered RFID-to-Sonos flow.

Target flow:

```text
NFC/RFID tag or card
-> ESPHome tag reader
-> Kids Tunes local app
-> action routing
-> Sonos, Spotify, or local NAS audio
```

The long-term aim is a Toniebox-style system where each card can trigger the same audio on different receivers, while each receiver can route to the right child, speaker, Spotify account, volume limits, and safety behavior.

## Current Target State

The app should eventually support:

- Multiple receivers, for example one for Eabha and one for Liam.
- One shared card catalog, so the same card can mean the same story/song on any receiver.
- Receiver-specific routing, so the same card can play on a different Sonos speaker or Spotify account depending on which reader scanned it.
- Real playback actions for Sonos, Spotify, and eventually NAS-hosted audio.
- Safety controls: global Sonos enable/disable, stop card, sleep timer, volume limits, and a future Spotify pause/stop route.
- Optional Home Assistant compatibility, but Home Assistant should not be the main brain.
- Docker-friendly deployment for a Synology NAS later.

## Current Implementation

The current prototype is a Node app using:

- Node 24
- Node's built-in SQLite module
- `esphome-native-api` for the ESPHome native API bridge
- A plain server-rendered HTML UI
- SQLite storage at `%LOCALAPPDATA%\Kids Tunes\kids_tunes.db` on Windows

The app runs locally at:

```text
http://localhost:8787
```

The port was intentionally chosen because `8000` is often used for other projects.

## What Works

### Local scan receiver

The app accepts fake scans:

```http
POST /api/scan
```

Example:

```json
{
  "reader_id": "tagreader-c6c6e4",
  "tag_id": "08-9F-69-C8"
}
```

Scans are stored in SQLite and shown in the browser UI.

### Card assignment

Unknown tags can be assigned a card name and notes from the UI.

Known tags are displayed as known on later scans.

Known test cards currently include:

- `08-9F-69-C8` as `Android Phone Test`
- `08-C1-14-EE`, `08-A2-A0-36`, `08-BC-25-18`, and `08-A8-58-81` appeared from real ESPHome bridge scans of the same Google Pixel 10
- `PRETEND-001`
- `PRETEND-002`
- `PRETEND-LOWERCASE`

### Pretend tags

Because we do not yet have spare physical cards, pretend tags can be used to test behavior through the UI.

This has allowed us to build and test card assignment, actions, stop-card behavior, and receiver routing before buying or flashing anything.

### Actions

The app supports these action types:

```text
none
pretend_play
stop
sleep_timer
sonos_play
sonos_stop
spotify_pause
stop_all
```

Current behavior:

- `pretend_play`, `stop`, and `sleep_timer` can log intended actions.
- `sonos_stop` can send a real Stop command to Sonos when Sonos is enabled.
- `stop_all` sends Sonos Stop and records that Spotify pause is not configured yet.
- `spotify_pause` can now send a real Spotify pause command to the configured default Spotify Connect device.
- `spotify_play` sets the configured Spotify start volume, then starts tracks and episodes from the beginning. When the same recently active physical card is scanned again, the app pauses Spotify playback instead of restarting it.

### Sonos

One Sonos device has been configured:

```text
Sonos Move
192.168.5.15
```

Sonos support currently uses local Sonos UPnP/SOAP commands against port `1400`.

Important finding:

- Sending Stop directly to the Sonos device can stop playback on the Sonos speaker.
- This does not necessarily stop/pause Spotify account playback in the Spotify app.
- Pausing from the Sonos app behaves differently and can pause Spotify account playback too.

Implication:

Spotify account-level control is likely needed for robust multi-child/multi-receiver behavior.

### Safety switch

The UI includes a global Sonos safety switch.

When Sonos is disabled, actions log what they would have done instead of sending real commands.

When Sonos is enabled, real Sonos commands may be sent to configured enabled Sonos devices.

### Receivers

Receiver profiles exist.

The current receiver is:

```text
Reader ID: tagreader-c6c6e4
Name: Main Receiver
Default Sonos: 192.168.5.15
Spotify account label: Spotify later
```

Receiver routing lets an action target `Receiver default speaker`, so a single card can eventually behave consistently across multiple readers while each receiver chooses its own speaker/account.

### ESPHome bridge

The app has an optional ESPHome reader bridge.

Current reader details:

```text
Host/IP: 192.168.5.87
Reader ID: tagreader-c6c6e4
ESPHome device: adonno.tag_reader version 1.4
PN532 module: detected
ESPHome API port: 6053
```

The reader previously used `192.168.5.28`, but DHCP later moved it to `192.168.5.87`. The bridge can connect to the ESPHome native API and currently reports `connected`.

The reader exposes a software buzzer switch:

```text
Name: TagReader Buzzer Enabled
Switch key: 1985256757
Desired state: OFF
```

Kids Tunes now sends `TagReader Buzzer Enabled = OFF` when the ESPHome bridge connects, because the reader can restore or return to buzzer-on after being unplugged/replugged.

The bridge subscribes to:

- ESPHome logs
- ESPHome Home Assistant service/event messages

The goal is to turn real reader events into normal app scans with source `esphome`.

### Reader test action

Because the Google Pixel 10 produces a different tag ID on each tap, the app now has a temporary reader test action.

Current setting:

```text
Enabled: true
Reader ID: tagreader-c6c6e4
Action: pretend_play
Target: Pixel reader-to-action test
```

This applies only to unknown scans with source `esphome` from that reader. Known card actions still take priority.

A synthetic probe confirmed the path works:

```text
scan_id: 24
tag_id: PIXEL-WILDCARD-PROBE
source: esphome
action_event: pretend_play / would_run
```

### Sonos URL playback

The app now has a `sonos_play_url` action.

Behavior:

```text
scan/card action
-> resolve receiver default Sonos speaker
-> SetAVTransportURI with the configured http/https media URL
-> Play
```

This is intended as the first real NAS/media-to-Sonos test path.

This path has now been proven end to end:

```text
Google Pixel 10 tap
-> ESPHome reader
-> Kids Tunes scan 26
-> reader test action sonos_play_url
-> NAS MP3 URL
-> Sonos Move playback
```

Successful action event:

```text
action_event_id: 17
status: sent
target: http://192.168.5.55/Kids-Tunes-Test/02%20Babe%20I%27m%20Gonna%20Leave%20You.mp3
message: Reader test action: Sent Sonos URL playback to Sonos Move via receiver default
```

Important constraint:

The media URL must be reachable by the Sonos speaker itself. A `localhost` or `127.0.0.1` URL on the laptop will not work for Sonos. A Synology-hosted HTTP/HTTPS file URL, a local web server bound to the LAN IP, or another Sonos-reachable audio URL is needed.

### Spotify playback

The app now has the first Spotify Web API integration path:

```text
Spotify OAuth login
-> Spotify access/refresh token storage
-> spotify_play action
-> Spotify Web API Start/Resume Playback
```

Implemented pieces:

- `GET /spotify/login`
- `GET /spotify/callback`
- `GET /api/spotify/status`
- `GET /api/spotify/devices`
- `POST /api/spotify/play`
- `POST /api/settings/spotify-playback`
- `spotify_play` action type for cards and the reader test action

To test it, create a Spotify Developer app and add this redirect URI:

```text
http://127.0.0.1:8787/spotify/callback
```

Then restart Kids Tunes with:

```powershell
$env:SPOTIFY_CLIENT_ID="your-client-id"
$env:SPOTIFY_CLIENT_SECRET="your-client-secret"
npm start
```

Current status/limitation:

The app can store a default Spotify Connect device ID and send playback to it. A direct API test to `Kitchen Echo Show` returned Spotify's success response (`204 No Content`) for this episode:

```text
https://open.spotify.com/episode/3orQ17tLiUbp54imQQqJtC
```

Sonos devices are not appearing in the Spotify Web API device list, even when they are selectable inside the Spotify app or Sonos app. For Sonos, the NAS URL route is currently more reliable. For Spotify Web API testing, Amazon Echo devices are the best available target so far.

Current working Spotify target:

```text
Eabha's Office Dot
96f469f9-839d-4314-b326-9336e8714ef2_amzn_1
Default start volume: 15%
```

Important Echo Dot device/volume finding:

```text
Spotify can change an Echo device ID after unplug/replug or moving rooms.
When playback failed after the move, Spotify returned Device not found for the old ID.
After waking the Dot in the new room, the new active ID was saved.
Spotify currently reports Eabha's Office Dot supports_volume=true at the new ID.
Kids Tunes now explicitly transfers Spotify playback to the configured Echo device before setting volume and starting playback; implicit `play?device_id=...` alone can return success without reliably waking the Echo session.
```

Working Deep Blue Sea card set:

```text
Deep Blue Sea: Seastar   04-DB-B5-3E-9E-61-80   https://open.spotify.com/episode/3orQ17tLiUbp54imQQqJtC
Deep Blue Sea: Whale     04-FA-FF-3C-9E-61-80   https://open.spotify.com/episode/5n5RBFHCLZ3CDSxtJo4LYT
Deep Blue Sea: Squid     04-4B-02-3D-9E-61-80   https://open.spotify.com/episode/1MaJS8APZSCHljGs1Q9Mg0
Deep Blue Sea: Crab      04-B9-E1-3C-9E-61-80   https://open.spotify.com/episode/2RanugSIMXtA3bVssxTFyL
Deep Blue Sea: Seahorse  04-E0-77-3C-9E-61-80   https://open.spotify.com/episode/79lJx9FreguOS80TfMANkh
Deep Blue Sea: Dolphin   04-16-B9-3C-9E-61-80   https://open.spotify.com/episode/5F102YyodsISgPzqHSOD7d
```

All six cards were tested successfully against Eabha's Office Dot. Each card starts its Spotify episode from the beginning, and scanning the same active card again pauses playback.

## Important ESPHome Findings

Earlier in the project, the Android phone was detected by the reader and gave this tag ID:

```text
08-9F-69-C8
```

During early direct ESPHome bridge tests:

- The reader beeped when the Android phone was placed on it.
- The app stayed connected to the ESPHome API.
- The bridge saw these ESPHome-side messages:

```text
[E][nfc:058]: Error, Can't decode message length.
[E][pn532.mifare_classic:095]: Authentication failed - Block 0x04
HA service undefined
```

After improving the Home Assistant service/event payload logger, a later phone tap worked:

```text
HA event esphome.tag_scanned: tag_id=08-C1-14-EE
```

That created scan `20`:

```text
reader_id: tagreader-c6c6e4
tag_id: 08-C1-14-EE
source: esphome
```

Three follow-up taps with the same Google Pixel 10 produced three more successful scans:

```text
08-A2-A0-36
08-BC-25-18
08-A8-58-81
```

Current interpretation:

- The PN532 is detecting the Android phone.
- The current firmware may still log MIFARE authentication errors while also emitting a usable `esphome.tag_scanned` event.
- The no-firmware-change bridge path is viable.
- The Google Pixel 10 presents different IDs across taps, so it should be treated as a debug trigger rather than a durable card identity.
- Real NTAG cards/stickers are the recommended next hardware step for stable card IDs.

## Current Server State

The app was last restarted successfully after the improved Home Assistant service/event payload logger was added, and that logger successfully captured a real `esphome.tag_scanned` event.

Last known server process:

```text
PID: 52060
URL: http://localhost:8787
ESPHome bridge: connected
Latest real ESPHome scan: 08-A8-58-81
```

If the app is stopped, restart it with:

```powershell
npm start
```

## How To Resume Testing

1. Start the app if it is not already running.
2. Open:

```text
http://localhost:8787
```

3. Confirm the ESPHome reader bridge panel says `connected`.
4. Place the Android phone on the reader.
5. Check whether a new scan appears.
6. If no scan appears, read the recent ESPHome bridge logs in the UI.

The specific thing to look for next is whether the bridge now shows a raw Home Assistant service/event payload containing `08-9F-69-C8` or another tag-like value.

## Known Gaps

### Physical tags

We do not yet have spare physical NFC/RFID cards.

Pretend tags are enough for app-side behavior, but a few real NTAG-style cards would make reader integration much easier to validate.

### ESPHome scan delivery

The app can connect to the reader, but physical Android phone taps are not yet turning into scans through the no-firmware-change ESPHome bridge.

Likely next paths:

- Test the improved HA service/event payload logger.
- Try with a real NFC card/tag if available later.
- Consider a small ESPHome firmware change to send the UID directly to `POST /api/scan`.
- Consider an MQTT route if that is simpler than native API events.

### Spotify

Spotify auth has not been implemented.

This is likely important because direct Sonos Stop does not fully manage Spotify account playback state.

Future design should support multiple Spotify accounts, for example parent accounts or child-specific accounts, and receiver-specific account routing.

### Playback actions

Real playback is not implemented yet.

Current Sonos support is limited to basic local `Play` and `Stop` transport commands.

Spotify exact-track playback, queue management, NAS audio playback, sleep timers, and volume limits are still future work.

### Frontend

The current UI is intentionally simple and functional.

It is good enough for local testing, but future work may split it into clearer sections for:

- Cards
- Receivers
- Actions
- Sonos
- Spotify accounts
- Logs/debugging

## Recommended Next Steps

### Next session

1. Use the Google Pixel 10 as a live reader-to-action trigger through the temporary reader test action.
2. Buy or find a few real NTAG cards/stickers and test whether they produce stable tag IDs.
3. Assign one real card to the working NAS MP3 `sonos_play_url` action.
4. Create/configure a Spotify Developer app and test `spotify_play` using the Pixel reader test action.
5. Add a stop/safety follow-up for URL playback and Spotify playback, such as stopping current playback before starting a new item.
6. Decide whether to keep direct Sonos URL playback as the primary NAS route or add a richer media-library layer.
7. Add a clear "Reader debug" view if needed, so hardware logs do not clutter the main UI.

### Then

1. Decide whether to buy a small pack of NTAG cards/stickers.
2. Decide whether to make a minimal ESPHome firmware change that sends HTTP requests directly to Kids Tunes.
3. Add Spotify auth design before building more real playback behavior.
4. Model playback as card content plus receiver-specific output, rather than binding each card to one speaker/account.

## Architecture Direction

The most promising architecture is:

```text
Card
  -> content/action definition

Receiver
  -> child/profile
  -> default Sonos speaker
  -> Spotify account
  -> volume/safety rules

Scan
  -> reader_id
  -> tag_id
  -> resolves card + receiver
  -> dispatches action
```

This keeps one card reusable across multiple receivers while still allowing Eabha and Liam to have different speakers, accounts, and safety limits.

## Useful Endpoints

```text
GET  /health
GET  /api/scans
POST /api/scan
GET  /api/cards
POST /api/cards
GET  /api/receivers
POST /api/receivers
GET  /api/action-events
POST /api/actions
GET  /api/settings/sonos
POST /api/settings/sonos
GET  /api/settings/esphome
POST /api/settings/esphome
POST /api/sonos/test
```

## Design Principles

- Keep it local-first.
- Keep it easy to debug.
- Avoid Home Assistant as the required brain.
- Avoid a complex frontend until the behavior is settled.
- Prefer fake/pretend test paths before introducing more hardware complexity.
- Keep Synology/Docker deployment in mind.
- Add real integrations only when the app-side model is clear.
