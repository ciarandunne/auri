# Spotify Multi-Account API Draft

Not integrated.

## List Accounts

```text
GET /api/spotify/accounts
```

## Start Login For Account

```text
GET /spotify/accounts/login?purpose=library&label=Ciaran
```

The OAuth `state` should encode a pending connection ID or nonce plus intended label/purpose.

## Save Receiver Playback Account

Extend receiver update:

```json
{
  "id": 1,
  "spotify_account_id": 2
}
```

## Import Playlist

Playlist import should use the library account.

```text
POST /api/spotify/import-playlist
```

Potential request override:

```json
{
  "playlist_url": "https://open.spotify.com/playlist/...",
  "spotify_account_id": 1
}
```

## Playback

Playback should resolve:

```text
scan.reader_id -> receiver -> spotify_account_id -> token
```

Fallback to legacy global token only during migration.
