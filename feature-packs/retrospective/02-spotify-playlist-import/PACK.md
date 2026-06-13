# Retrospective Validation Pack: Spotify Playlist Import

Status: integrated draft, needs real Spotify validation.

Commit:

```text
18e605e Add Spotify playlist import foundation
1235ebf Document playlist import next steps
```

## What Changed

- `/media` has an "Import Spotify playlist" form.
- `POST /api/spotify/import-playlist` imports playlist tracks/episodes into `media_items`.
- Spotify auth now requests `playlist-read-private`.
- Imported rows include playlist source fields.

## Validation Steps

1. Restart app with Spotify env vars present.
2. Reconnect Spotify from the UI.
3. Confirm `/api/spotify/status` lists `playlist-read-private`.
4. Import a small public playlist.
5. Import a private playlist if available.
6. Confirm rows appear in `/media`.
7. Confirm duplicate import does not duplicate media rows.
8. Confirm imported track/episode metadata looks right.

## Risks

- Existing refresh token may not include the new scope until reauthorization.
- Spotify playlists can contain local/unavailable items.
- Episode and track metadata differ.
- Large playlists may be slow.

## Fix Candidates

- Better scope warning in UI.
- Import progress or count feedback.
- Playlist filter on `/media`.
- Better handling for unavailable items.
