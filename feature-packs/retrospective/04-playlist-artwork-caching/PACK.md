# Retrospective Validation Pack: Playlist Artwork Caching

Status: integrated draft, needs real Spotify artwork validation.

Commit:

```text
3488f69 Add playlist artwork caching
```

## What Changed

- Playlist import tries to download artwork immediately.
- `/media` has "Cache Missing Artwork".
- `POST /api/media/cache-artwork` downloads missing artwork.
- `media_items.local_artwork_path` is updated on success.
- `data/spotify-artwork/manifest.json` is updated/merged.

## Validation Steps

1. Restart app.
2. Import a real Spotify playlist.
3. Confirm imported rows have local thumbnails.
4. Click "Cache Missing Artwork".
5. Confirm result summary updates.
6. Confirm files exist under `data/spotify-artwork/`.
7. Confirm no fake test image remains in manifest.
8. Confirm `/media` thumbnails still load after restart.

## Known Cleanup Note

A smoke-test image may remain locally if OneDrive keeps a lock:

```text
data/spotify-artwork/test-song--track-7ouMYWpwJ422jRcDASZB7P.jpg
```

It is ignored by Git and should not be in the manifest. Delete it later if Windows releases the lock.

## Risks

- OneDrive can lock generated files.
- Artwork download can fail or timeout.
- Remote image content type may not match expectation.
- `data/*` is local and ignored by Git.

## Fix Candidates

- Move generated/cache data outside OneDrive.
- Add retry count and clearer UI result.
- Add cleanup tool for orphaned artwork.
