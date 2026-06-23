# Parent Mobile Control UI Notes

Not integrated.

## Page

Route:

```text
/control
```

First viewport:

- current/last playback
- pause button
- volume if available
- receiver selector if more than one receiver exists

Main content:

- grid/list of assigned media
- artwork thumbnail
- title
- large play button

## Mobile Constraints

- Buttons must be easy to tap.
- No dense admin tables.
- Avoid tiny metadata.
- Keep setup links away from normal controls.

## Access Note

From a phone, `127.0.0.1` means the phone itself, not the laptop.

For mobile testing, Auri must be reachable at the laptop LAN IP or later on Synology.
