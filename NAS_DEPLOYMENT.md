# Kids Tunes NAS Deployment

Kids Tunes is now running always-on from Synology Container Manager.

Live URL:

```text
http://192.168.5.55:8787/
```

Live health check:

```text
http://192.168.5.55:8787/health
```

## Target

Run Kids Tunes on the Synology NAS instead of the laptop:

```text
RFID reader -> Synology Kids Tunes container -> Spotify/Echo
```

The laptop is now only needed for editing/admin, not for bedtime playback.

Do not leave a laptop-local Kids Tunes process running on `127.0.0.1:8787` while the NAS container is active. Both can connect to the ESPHome reader and double-handle card taps.

## Current Live State

As of June 22, 2026:

- Synology share is mapped in Windows as `Z:`.
- Deployment folder is `Z:\kids-tunes`.
- Synology path is `/volume1/docker/kids-tunes`.
- Container Manager project is running on port `8787`.
- `/health` returns `ok: true`.
- The container database path is `/app/data/kids_tunes.db`.
- ESPHome reader bridge is connected to `192.168.5.87`.
- Spotify is authorized as `ciaran.dunne2`.
- `Eabha's Echo Dot` is visible to Spotify.
- A physical card tap has played successfully through the NAS-hosted app.

## Important Spotify Note

The quickest NAS move is to copy the current SQLite database to the NAS. That database already contains the Spotify refresh token and card/action setup.

If Spotify ever needs to be reconnected from the NAS, there is a redirect issue:

- Spotify permits HTTP only for explicit loopback addresses such as `http://127.0.0.1:8787/spotify/callback`.
- A NAS LAN URL such as `http://192.168.5.55:8787/spotify/callback` may be rejected because it is not HTTPS.
- Later, solve this with an HTTPS reverse proxy/domain, or a temporary local tunnel from the laptop to the NAS.

For the first move, keep using the existing token by migrating the database.

## Files To Put On The NAS

Create a Synology folder such as:

```text
/volume1/docker/kids-tunes
```

The safest way to stage the files on Windows is:

```powershell
cd "C:\Users\ciara\OneDrive\Documents\Kids Tunes"
.\scripts\prepare-nas-deploy.ps1
```

That creates:

```text
C:\Users\ciara\Desktop\kids-tunes-nas
```

Then copy that folder's contents to the Synology folder.

Copy these project files/folders into it:

```text
Dockerfile
docker-compose.yml
package.json
package-lock.json
server.js
.env
data/
```

Do not commit `.env`; it contains Spotify credentials.

## Copy Current Data

On the Windows laptop, the current database is:

```text
C:\Users\ciara\AppData\Local\Kids Tunes\kids_tunes.db
```

Copy it to the NAS deployment folder as:

```text
/volume1/docker/kids-tunes/data/kids_tunes.db
```

Also copy the current app data folder if possible:

```text
C:\Users\ciara\OneDrive\Documents\Kids Tunes\data
```

to:

```text
/volume1/docker/kids-tunes/data
```

That preserves cached Spotify artwork and print sheets.

## Environment File

Create `/volume1/docker/kids-tunes/.env` from `.env.example`.

Minimum:

```env
SPOTIFY_CLIENT_ID=your-client-id
SPOTIFY_CLIENT_SECRET=your-client-secret
HOST=0.0.0.0
PORT=8787
KIDS_TUNES_DB_PATH=/app/data/kids_tunes.db
```

Normally do not set `SPOTIFY_REDIRECT_URI` for the first NAS move. The copied database token should avoid a new Spotify login.

## Start With Docker Compose

From the NAS folder:

```sh
docker compose up -d --build
```

Check logs:

```sh
docker compose logs -f kids-tunes
```

Open from a browser on the home network:

```text
http://192.168.5.55:8787/
```

If the NAS IP changes, use the current NAS IP.

## Validation Checklist

1. Open:

```text
http://192.168.5.55:8787/health
```

2. Confirm the database counts are non-zero.
3. Open:

```text
http://192.168.5.55:8787/spotify
```

4. Confirm the connected account is `ciaran.dunne2`.
5. Open:

```text
http://192.168.5.55:8787/reader
```

6. Confirm the reader bridge connects to `192.168.5.87`.
7. Open:

```text
http://192.168.5.55:8787/api/spotify/devices
```

8. Confirm `Eabha's Echo Dot` is visible.
9. Tap one physical card.
10. Confirm a new scan and action event appear.
11. Confirm audio plays on the Echo.

## Rollback

If anything goes sideways, stop the NAS container:

```sh
docker compose down
```

Then keep using the laptop version:

```powershell
cd "C:\Users\ciara\OneDrive\Documents\Kids Tunes"
npm.cmd start
```

## Later Hardening

- Put the NAS container behind HTTPS for clean Spotify reauthorization.
- Add backup/export instructions for `data/kids_tunes.db`.
- Add an app page showing whether the server is running on laptop or NAS.
- Add clearer diagnostics when the ESPHome bridge reconnects or drops.
