# Kids Tunes Next Steps

Use this file as the first handoff note when picking up the project in a new chat window.

## Read These First

1. `NEXT.md` - canonical handoff, immediate state, and next actions.
2. `PROJECT_STATUS.md` - older background/history only.
3. `README.md` - local run/test instructions and endpoint examples.
4. `M5DIAL_PLAN.md` - plan and evidence for buying/testing two M5Dial receivers.
5. `server.js` - current app implementation.

## Current State

Kids Tunes is a local Node/SQLite app running at:

```text
http://127.0.0.1:8787/
```

The current prototype can:

- Receive ESPHome tag scans from the Adonno-style PN532 reader.
- Store scans/cards/actions in SQLite.
- Maintain a first-pass media library table synced from existing Spotify card actions.
- Assign physical cards to Spotify episode URLs.
- Play Spotify content on the configured Echo Dot.
- Start Spotify tracks/episodes from the beginning.
- Set Spotify start volume to 15%.
- Pause Spotify when the same recently active card is scanned again.
- Auto-send the ESPHome `TagReader Buzzer Enabled = OFF` switch command on bridge connect.

Hardware direction: buy two M5Dial devices, one as Eabha's upgraded receiver and one as Liam's receiver. See `M5DIAL_PLAN.md`.

The SQLite database lives at:

```text
C:\Users\ciara\AppData\Local\Kids Tunes\kids_tunes.db
```

The app is normally started manually from PowerShell with:

```powershell
npm.cmd start
```

Spotify credentials are set as PowerShell environment variables before starting the app. Do not assume a new terminal has them.

## Immediate Next Action

Restart the app so the latest Spotify reliability patch takes effect.

In the PowerShell window that is currently running Kids Tunes:

```powershell
Ctrl+C
npm.cmd start
```

Then test one card with a single tap.

Important: do not immediately tap the same card twice unless testing stop/pause, because the second tap of the same active card is intentionally treated as pause.

The intended stop behavior is: tap the active card a second time. We do not currently plan to add a separate stop card.

## Latest Code Change Not Yet Restarted

`server.js` has been patched so Spotify play commands are now verified:

- Transfer playback to the configured Echo Dot.
- Wait briefly.
- Set starting volume.
- Send play from the beginning.
- Poll Spotify to confirm playback is actually active.
- Retry once if Spotify accepts the command but playback does not start.
- Log a failure if Spotify still reports paused/no active playback.

Before this patch, Spotify could return success while the Echo Dot ended up paused or inactive.

## Current Playback Target

The current Spotify Connect target is the Echo Dot in Eabha's room.

Saved default device ID:

```text
96f469f9-839d-4314-b326-9336e8714ef2_amzn_1
```

Device name seen in Spotify:

```text
Eabha's Office Dot
```

Echo/Amazon Spotify device IDs may change after unplugging, moving rooms, or re-linking devices. If playback fails with `Device not found`, refresh `/api/spotify/devices`, choose the current Echo Dot device, save it as the default playback target, and test again.

## Current Reader Target

The current ESPHome reader is:

```text
reader_id: tagreader-c6c6e4
current IP seen during testing: 192.168.5.87
```

Known ESPHome buzzer switch key:

```text
1985256757
```

The app currently sends that switch OFF on ESPHome bridge connect.

## Physical Cards Added

The Deep Blue Sea cards are assigned to Spotify episode URLs:

- Deep Blue Sea: Seastar
- Deep Blue Sea: Whale
- Deep Blue Sea: Squid
- Deep Blue Sea: Crab
- Deep Blue Sea: Seahorse
- Deep Blue Sea: Dolphin

If a future chat needs the exact tag IDs or URLs, query the cards API first. `PROJECT_STATUS.md` may contain older background detail, but `NEXT.md` is the standard handoff file.

Spotify artwork and metadata for the current Deep Blue Sea cards has been fetched to:

```text
data/spotify-artwork/
```

The folder includes one image per assigned Spotify episode plus:

```text
data/spotify-artwork/manifest.json
```

The reusable refresh script is:

```powershell
node --disable-warning=ExperimentalWarning scripts/fetch-spotify-artwork.mjs
```

Note: `data/*` is currently ignored by Git, so these downloaded artwork files are saved locally but are not part of a future commit unless we intentionally change `.gitignore`.

A three-artwork printable test sheet has been generated here:

```text
data/print-sheets/spotify-artwork-test-sheet.pdf
```

The matching HTML source is:

```text
data/print-sheets/spotify-artwork-test-sheet.html
```

The generator script is:

```powershell
node scripts/create-label-test-sheet.mjs
```

The test sheet uses three uncropped Spotify artwork images at 48 mm square, with whitespace between labels for scissor cutting.

The media library foundation has started. Existing Spotify card actions are synced into:

```text
media_items
card_media_assignments
```

The read-only API endpoint is:

```text
GET /api/media
```

The home page also has a first-pass Media library section showing title, Spotify type, URI/artwork path, assignment status, and print status.

The first UI cleanup pass has started:

- The UI is now split into separate pages instead of one long page:
  - `/media`
  - `/cards`
  - `/activity`
  - `/devices`
  - `/reader`
- `/` redirects to `/media`.
- A top navigation bar links between the pages and marks the active page.
- Media, card, scan, and action-event tables have simple client-side search filters.
- The Media library can show local Spotify artwork thumbnails through `/assets/spotify-artwork/...`.

## Useful Checks

Check app health:

```powershell
curl.exe -s http://127.0.0.1:8787/health
```

Check recent scans:

```powershell
curl.exe -s "http://127.0.0.1:8787/api/scans?limit=5"
```

Check recent action events:

```powershell
curl.exe -s "http://127.0.0.1:8787/api/action-events?limit=8"
```

Check Spotify devices:

```powershell
curl.exe -s http://127.0.0.1:8787/api/spotify/devices
```

## Near-Term Roadmap

1. Restart and validate the new Spotify verification/retry behavior.
2. Create an initial Git checkpoint/commit so the current working code is preserved before larger changes.
3. Add clearer UI feedback for the last card action, especially play vs pause vs failed.
4. Add a visible "play/pause toggle" explanation or status indicator so second-tap pause is obvious.
5. Continue reorganizing the UI into clearer task-focused areas:
   - Assign cards/tags to Spotify tracks, episodes, or local media.
   - Manage assigned tracks/tags in a dedicated list.
   - Add and manage devices, including receivers, speakers, and Spotify targets.
   - Provide a filterable/searchable activity log.
   - Keep setup/configuration separate from day-to-day card management.
   - Continue refining each page now that the one-long-page structure has been split up.
6. Add a Spotify/Echo volume panel showing the current reported Echo volume and easier volume controls:
   - Set the starting playback volume.
   - Set a maximum allowed volume level.
   - Clamp playback commands so Kids Tunes never intentionally starts above the max volume.
   - Consider periodically correcting the Echo back down if Spotify reports it above the max.
7. Add a one-click manual "test selected Spotify device" button in the UI.
8. Add a mobile-friendly parent web app/control surface:
   - Trigger assigned songs/stories manually from a phone.
   - Control volume for the active receiver/speaker.
   - Pause/stop current playback.
   - Show current/last playing item.
   - Keep admin setup separate from simple parent controls.
9. Expand the media library into a full Spotify playlist-to-card assignment flow:
   - Pick a Spotify playlist in the app.
   - Import playlist items into the `media_items` table.
   - Store Spotify URL/URI, title, artist/show, album, duration, artwork URL, and local artwork path.
   - Show tracks/episodes from that playlist with metadata.
   - Show assignment status for each item, such as unassigned, assigned, or retired.
   - Show print status for each item, such as not printed, queued for print, PDF generated, or printed.
   - Tap an "assign next scanned card" button beside a track.
   - The next card scanned is assigned to that Spotify item.
   - This will likely need extra Spotify read scopes beyond the current playback-only scopes.
10. Add printable artwork labels/card sheets:
   - Use fetched Spotify artwork.
   - Generate a PDF sheet sized for card stickers/labels.
   - Target credit-card-sized cards with labels slightly smaller than CR80 card size.
   - Use the Spotify artwork exactly as-is: uncropped, unstretched, no text overlay, no badges.
   - Lay out square artwork labels with enough whitespace between them to cut cleanly with scissors.
   - Optionally add print/cut guides outside the artwork area, not on top of the image.
   - Track whether a printable page has been generated for each media item.
11. Add playback history/reporting:
   - Track what song/episode/story was played.
   - Track when playback was requested.
   - Track which card triggered it.
   - Track which receiver handled it.
   - Track which speaker/device was targeted.
   - Include result status, such as played, paused, failed, or retried.
12. Add device health/status dashboard:
   - Show each receiver's last seen time.
   - Show ESPHome/M5Dial connectivity.
   - Show Spotify authorization/device visibility.
   - Show configured speaker reachability where possible.
13. Add content collections:
   - Group media into collections such as Deep Blue Sea, Bedtime, Disney, Christmas, and favorites.
   - Use collections for browsing, filtering, printable labels, and playlist/card assignment.
14. Make the app automatically recover when a saved Spotify device ID changes by matching the Echo Dot by name.
15. Add a Windows auto-start option so the app does not depend on manually running `npm.cmd start`.
16. Add an admin restart/control option once the app has a proper runner:
   - Prefer a process manager, Windows service/task, or Docker restart policy.
   - Then the web UI can safely offer "Restart app" without losing the process.
   - Avoid a fragile self-restart button while the app is only launched manually with `npm.cmd start`.
17. Later, move toward Synology Docker deployment for always-on home use.
18. Test M5Dial RFID receiver firmware, starting with ESPHome and falling back to Arduino/PlatformIO if needed.
19. Later, add a second receiver profile for Liam while keeping one shared card catalog.
20. Later, support receiver-specific Spotify accounts and speakers while preserving the same card-to-content mapping.

## Deployment Direction

Do not deploy this app to Vercel as the main runtime. It needs local network access to the ESPHome reader, Spotify Connect devices, Sonos devices, and eventually NAS media.

Better deployment path:

1. Keep running locally on Windows while iterating.
2. Add Windows auto-start once behavior is stable.
3. Move to Synology Docker when the prototype is reliable.

## Cautions For Future Work

- Do not modify or flash the ESP firmware unless explicitly requested.
- Do not restart the app from a new shell unless Spotify env vars are present.
- Do not log or commit Spotify client secrets.
- The Echo Dot can appear/disappear or change IDs in Spotify device lists.
- The same-card second tap currently means pause, not replay.
- A separate stop card is not planned right now; the active card is its own stop/pause control.
- The running app may differ from `server.js` until it has been restarted.
