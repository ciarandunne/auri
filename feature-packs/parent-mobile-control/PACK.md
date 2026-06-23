# Parent Mobile Control Pack

Status: forward feature pack, not integrated.

## Goal

Create a phone-friendly page for parents to control Auri without touching RFID cards.

Parents should be able to:

- trigger assigned songs/stories manually;
- pause/stop playback;
- control safe volume;
- see current or last played item;
- avoid admin setup clutter.

## Design Position

This is not the admin app squeezed onto a phone.

It should be a simple control surface:

- big tap targets
- assigned media/cards
- current receiver/speaker
- pause/stop
- volume

## Proposed Scope For First Integration

- Add `/control` page.
- Show assigned media grouped by receiver or collection.
- Play one item on the default Spotify device.
- Pause current Spotify playback.
- Show current active card/media if available.

## Not In First Integration

- No authentication yet unless exposed beyond local network.
- No remote internet access.
- No complex queue management.
- No admin card assignment.

## Open Questions

- Should `/control` default to Eabha's receiver for now?
- Should parent controls show unassigned playlist media?
- Should it control Spotify only first, or Sonos/NAS too?
- Do we need a PIN if accessible on home Wi-Fi?

## Integration Notes

Current app has:

- media library
- card assignments
- Spotify play/pause
- active playback settings
- receiver profiles

This feature should mostly compose existing APIs.

## Risks

- Anyone on the home network could use it unless access control is added.
- Phone browser access to `127.0.0.1` will not work from another device; app must bind to LAN IP or run on NAS/always-on host.
- Spotify target device visibility remains flaky.

## Proposed Integration Order

1. Validate local laptop IP access from phone.
2. Add read-only `/control` mock page.
3. Add manual play buttons for assigned Spotify media.
4. Add pause/stop.
5. Add volume after volume-limits feature is stable.
