# Kids Tunes Next Steps

Use this file as the first handoff note when picking up the project in a new chat window.

## Read These First

1. `NEXT.md` - canonical handoff, immediate state, and next actions.
2. `feature-packs/README.md` - remote-work process and prepared feature/validation packs.
3. `PROJECT_STATUS.md` - older background/history only.
4. `README.md` - local run/test instructions and endpoint examples.
5. `M5DIAL_PLAN.md` - plan and evidence for buying/testing two M5Dial receivers.
6. `server.js` - current app implementation.

## Remote Work Rule

When working away from the laptop/hardware, prefer feature packs over live app changes.

Remote mode:

- Do not change live app behavior unless explicitly requested.
- Prepare feature packs under `feature-packs/`.
- Include design, draft code, schema/API notes, UI notes, risks, and laptop test plans.
- Use retrospective validation packs for integrated drafts that still need real-world proof.

Laptop mode:

- Pick one pack.
- Integrate or validate it deliberately.
- Test with real Spotify, Echo, ESP reader, RFID cards, NAS, or browser as required.
- Fix what breaks before starting the next pack.

Current first forward-looking pack:

```text
feature-packs/printable-label-queue/
```

Additional forward-looking packs prepared for later:

```text
feature-packs/volume-limits/
feature-packs/playback-history/
feature-packs/parent-mobile-control/
feature-packs/m5dial-receiver/
feature-packs/spotify-multi-account/
```

Current retrospective validation packs:

```text
feature-packs/retrospective/01-multi-page-ui/
feature-packs/retrospective/02-spotify-playlist-import/
feature-packs/retrospective/03-next-card-assignment/
feature-packs/retrospective/04-playlist-artwork-caching/
```

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

Spotify credentials should now live in a local `.env` file. Copy `.env.example` to `.env`, add the real Spotify Developer client id and secret, then restart with `npm.cmd start`. The `.env` file is ignored by git.

## Immediate Next Action

Paused on June 13, 2026 after a restart. Current symptom: presenting a physical card makes the reader show a green light, but nothing plays.

When resuming, do not start by repeatedly scanning cards in the bedroom. First verify the quiet/server-side pieces:

1. Confirm `.env` contains the real Spotify Developer `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`.
2. Restart Kids Tunes from the project folder:

In the PowerShell window that is currently running Kids Tunes:

```powershell
Ctrl+C
npm.cmd start
```

3. Open `http://127.0.0.1:8787/media` and confirm the Spotify section shows `Connected account: ciaran.dunne2`.
4. If Spotify import/playback reports `invalid_client`, check `.env` first. It means the saved Spotify token exists, but the current app credentials used to refresh it are wrong or missing.
5. Check the recent scans/action events after one card tap:
   - If no scan appears, the ESP bridge or reader connection is the problem.
   - If a scan appears but no action event appears, the card/action mapping is the problem.
   - If an action event appears with a Spotify error, Spotify auth/device routing is the problem.
   - If an action event says pause/stop, the app may think that card is already active; tap behavior is intentionally "same active card pauses".
6. Confirm the default Spotify device is still `Eabha's Office Dot` / device id `96f469f9-839d-4314-b326-9336e8714ef2_amzn_1`.

Then reconnect Spotify from the app so the token includes the new `playlist-read-private` scope:

1. Open `http://127.0.0.1:8787/media`.
2. Use the Spotify connect/login link shown in the import panel or Spotify settings.
3. Complete the Spotify authorization flow.
4. Return to `/media`.
5. Paste a Spotify playlist URL into the "Import Spotify playlist" form.
6. Click "Import Playlist".
7. Confirm the Media table fills with playlist tracks/episodes.
8. Check that imported rows show:
   - title
   - artist/show
   - Spotify URI
   - assignment status
   - print status
   - imported playlist source

If import fails with a scope/auth error, reconnect Spotify again after confirming the app was restarted with the latest code.

After playlist import works, test one existing physical card with a single tap.

Important: do not immediately tap the same card twice unless testing stop/pause, because the second tap of the same active card is intentionally treated as pause.

The intended stop behavior is: tap the active card a second time. We do not currently plan to add a separate stop card.

## When Back At The Laptop

Test the new playlist import and next-card assignment flow end to end:

1. Restart Kids Tunes:

```powershell
Ctrl+C
npm.cmd start
```

2. Open:

```text
http://127.0.0.1:8787/media
```

3. Reconnect Spotify from the UI so the token has `playlist-read-private`.
4. Paste a Spotify playlist URL into "Import Spotify playlist".
5. Click "Import Playlist".
6. Confirm playlist items appear in the Media table.
7. Pick one unassigned item and click "Assign Next Card".
8. Confirm the pending assignment banner appears.
9. Tap one blank physical card on the RFID reader.
10. Confirm the card appears as assigned to that media item.
11. Tap that same card once to play it.
12. Tap that same card a second time to pause/stop it.

Safety check: if a known card is tapped during pending assignment, Kids Tunes should not overwrite it. It should log a blocked `assign_media` event and keep waiting for a blank/unknown card.

If playback does not start after assignment, check `/activity` first. It should show whether the scan assigned the card, tried playback, or hit a Spotify/device error.

## Latest Code Changes Not Yet Restarted

`server.js` has recent changes that require an app restart:

- Multi-page UI refinements.
- Spotify playlist import foundation on `/media`.
- Playlist-to-card "Assign Next Card" flow.
- New Spotify OAuth scope: `playlist-read-private`.
- Spotify play command verification/retry behavior.

Spotify play commands are now verified:

- Transfer playback to the configured Echo Dot.
- Wait briefly.
- Set starting volume.
- Send play from the beginning.
- Poll Spotify to confirm playback is actually active.
- Retry once if Spotify accepts the command but playback does not start.
- Log a failure if Spotify still reports paused/no active playback.

Before this patch, Spotify could return success while the Echo Dot ended up paused or inactive.

Playlist import now:

- accepts a Spotify playlist URL on `/media`;
- imports tracks/episodes into `media_items`;
- stores playlist source fields;
- avoids duplicates by Spotify URI;
- exposes `POST /api/spotify/import-playlist`.

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
- The nav now shows compact counts/status for each area.
- Activity, Devices, and Reader have page-specific grid layouts instead of a single stacked dashboard.
- Reader bridge settings and the reader test action now live in separate panels.
- Media, card, scan, and action-event tables have simple client-side search filters.
- The Media library can show local Spotify artwork thumbnails through `/assets/spotify-artwork/...`.

The Spotify playlist import foundation has started:

- `/media` now has an "Import Spotify playlist" panel.
- The app can import Spotify playlist tracks/episodes into the `media_items` table.
- Imported media rows store playlist source fields:
  - `imported_from_provider_uri`
  - `imported_from_title`
  - `imported_at`
- Duplicate imports are safe because `media_items.provider_uri` is unique.
- JSON API endpoint:

```text
POST /api/spotify/import-playlist
```

Example payload:

```json
{
  "playlist_url": "https://open.spotify.com/playlist/..."
}
```

Important: Spotify auth now requests `playlist-read-private`. After restarting with this code, reconnect Spotify once from the app so the token has the new playlist scope.

The playlist-to-card assignment foundation has started:

- `/media` now shows an "Assign Next Card" button beside unassigned Spotify media items.
- Pressing the button stores one pending assignment for 15 minutes.
- The Media library shows a pending banner with the selected title and expiry time.
- The next unknown scanned card is automatically:
  - created as a known card;
  - named from the media item title;
  - given an enabled `spotify_play` action;
  - linked in `card_media_assignments`;
  - recorded as an `assign_media` action event;
  - cleared from the pending state.
- If a known card is scanned while an assignment is pending, Kids Tunes does not overwrite it and does not run its playback action. It records a blocked `assign_media` event and leaves the pending assignment open.
- Pending assignment API endpoints:

```text
GET  /api/media/pending-assignment
POST /api/media/assign-next
POST /api/media/assign-next/cancel
```

Example start-assignment payload:

```json
{
  "media_item_id": 1
}
```

Next playlist step: test this with a real imported playlist and physical blank card, then improve the UI feedback after assignment.

Playlist artwork caching has started:

- Playlist import now tries to download each imported Spotify track/episode artwork immediately.
- Cached artwork is saved under:

```text
data/spotify-artwork/
```

- `media_items.local_artwork_path` is filled when caching succeeds.
- `/media` uses the local artwork path for thumbnails.
- `data/spotify-artwork/manifest.json` is updated/merged for cached items.
- `/media` has a "Cache Missing Artwork" button for older imports or failed artwork downloads.
- JSON API endpoint:

```text
POST /api/media/cache-artwork
```

The cache endpoint checks media items with an `artwork_url` but no `local_artwork_path`, downloads what it can, updates the database, and returns cached/skipped/failed counts.

Note: `data/*` is ignored by Git. Cached artwork is local machine state unless we intentionally change that later.

## Best Next Build Choices

After the restart/reconnect/import test above, the best next implementation choices are:

1. Playlist-to-card assignment flow:
   - Foundation done: "Assign Next Card" button beside each unassigned Spotify media item on `/media`.
   - Foundation done: pending assignment stored in app settings with a 15-minute expiry.
   - Foundation done: next unknown card creates the card, sets `spotify_play`, and links `card_media_assignments`.
   - Foundation done: known cards are protected from accidental overwrite.
   - Next: test with a real imported playlist and physical blank card.
   - Next: add richer success/failure feedback directly on `/media` after scan.

2. Playlist artwork caching:
   - Foundation done: playlist import attempts to download artwork into `data/spotify-artwork/`.
   - Foundation done: `media_items.local_artwork_path` is filled on successful cache.
   - Foundation done: `/media` has a "Cache Missing Artwork" button.
   - Foundation done: filenames are stable/readable, based on Spotify title plus type/ID.
   - Next: test with a real Spotify playlist after reconnecting Spotify.
   - Next: use cached artwork as the source for printable sheets.

3. Printable label queue:
   - Add print statuses: `not_printed`, `queued`, `pdf_generated`, `printed`.
   - Add buttons to queue selected media items for print.
   - Generate a PDF sheet from queued artwork with whitespace between labels for cutting.
   - Keep artwork uncropped and unstretched.

4. Parent control page:
   - Add a simple mobile-friendly page for parents.
   - Show assigned media as large tap targets.
   - Allow play/pause and volume control from a phone.
   - Keep admin setup pages separate.

Recommended next build: do item 3 next. Printable label queue is the next step toward playlist -> cards -> artwork -> print sheet.

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
   - Foundation started: paste a Spotify playlist URL in `/media`.
   - Foundation started: import playlist items into the `media_items` table.
   - Foundation started: store Spotify URL/URI, title, artist/show, album, duration, and artwork URL.
   - Next: fetch/cache imported artwork locally.
   - Show tracks/episodes from that playlist with metadata.
   - Show assignment status for each item, such as unassigned, assigned, or retired.
   - Show print status for each item, such as not printed, queued for print, PDF generated, or printed.
   - Tap an "assign next scanned card" button beside a track.
   - The next card scanned is assigned to that Spotify item.
   - Spotify now requests `playlist-read-private`, so users must reconnect Spotify after restart.
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
