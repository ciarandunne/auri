# Spotify Multi-Account Test Plan

Not integrated.

## Preflight

1. Confirm Ciaran account owns/imports the playlist.
2. Confirm Eabha account can play on Eabha Echo Dot.
3. Confirm Liam account can play on Liam speaker once available.

## Integration Tests

1. Connect Ciaran as library account.
2. Import Kids Tunes playlist.
3. Connect Eabha as playback account.
4. Link Eabha receiver to Eabha playback account.
5. Scan an assigned card on Eabha receiver.
6. Confirm playback uses Eabha account/device.
7. Confirm Ciaran playlist import still works.

## Failure Cases

- Browser logs into the wrong Spotify account.
- Child account lacks playback permission/device visibility.
- Echo device appears under one account but not another.
- Refresh token expires or is revoked.
- Receiver has no playback account configured.
