# Volume Limits Pack

Status: forward feature pack, not integrated.

## Goal

Make playback volume safer and more predictable, especially for a child's bedroom.

The feature should support:

- Seeing the current reported Spotify/Echo volume where Spotify exposes it.
- Setting a start volume used before playback begins.
- Setting a maximum allowed volume.
- Clamping Kids Tunes playback commands so they never intentionally start above the max.
- Making volume behavior receiver-aware later, so Eabha and Liam can have different safe limits.

## Design Position

Volume safety is a guardrail, not a fancy audio mixer.

First integration should keep this simple:

- global default start volume
- global max volume
- optional per-receiver override later
- visible current/default/max values on `/devices`

## Proposed Scope For First Integration

- Add a max Spotify volume setting.
- Keep existing start volume setting.
- Clamp start volume to max before playback.
- Add a "Refresh current volume" action for the configured Spotify device.
- Display:
  - current reported volume
  - start volume
  - max volume
  - target device name/ID

## Not In First Integration

- No continuous monitoring loop.
- No per-song volume.
- No automatic background correction if a child changes volume manually.
- No Alexa-specific APIs.
- No Sonos volume work unless Spotify Connect does not cover the target.

## Open Questions

- Should max volume be global or receiver-specific first?
- What should the default max be? Possible first value: 35%.
- Should an empty start volume mean "do not change volume", or should safety require a start volume?
- Should "same card second tap pause" leave volume unchanged?

## Integration Notes

The live app already has:

- `spotify_start_volume_percent`
- `sendSpotifySetVolume(volumePercent, deviceId)`
- `sendSpotifyPlay(...)`
- `getSpotifyDevices()`
- `/settings/spotify-playback`
- `/devices` page

Prefer extending these rather than adding a separate volume subsystem.

## Risks

- Spotify device volume support differs by device.
- The API can report `supports_volume: false`.
- Echo/Spotify can be stale or not active until woken.
- Volume update may succeed but playback transfer can still fail.

## Proposed Integration Order

1. Validate the current Echo Dot appears in `/api/spotify/devices`.
2. Add `spotify_max_volume_percent` setting.
3. Clamp `getSpotifyStartVolumePercent()` or the call site in `sendSpotifyPlay`.
4. Add current-volume display to Spotify settings.
5. Add a manual refresh endpoint.
6. Test with Echo volume at high value, then scan a card and verify Kids Tunes sets a safer value.
