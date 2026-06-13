# Volume Limits UI Notes

Not integrated.

## Devices Page

Extend the Spotify panel on `/devices`.

Fields:

- Default device ID
- Start volume
- Max volume
- Current reported volume

Controls:

- Save Spotify
- Refresh Volume
- Set Volume Now

## Display Rules

If Spotify reports `supports_volume: false`, show current volume as unavailable and disable manual set-volume controls.

If current device is not visible, show "Device not currently visible in Spotify Connect".

If start volume is greater than max volume, show a validation error before saving.

## Copy

Use simple labels:

- Current volume
- Start volume
- Max volume
- Refresh
- Set now

Avoid long warnings in the UI. The fields themselves should make the safety model clear.
