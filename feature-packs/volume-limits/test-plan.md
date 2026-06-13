# Volume Limits Test Plan

Not integrated.

## Fake/Data Tests

1. Save start volume 15 and max volume 35.
2. Try saving start volume 60 and max volume 35; expect validation error.
3. Mock Spotify devices with `supports_volume: false`; confirm UI disables set-volume.

## Laptop Tests

1. Start Spotify on the Echo Dot.
2. Set Echo volume high from Spotify app.
3. Refresh current volume in Kids Tunes.
4. Confirm Kids Tunes shows the high current volume.
5. Set max volume 35 and start volume 15.
6. Scan a card.
7. Confirm Echo starts at 15, not the previous high volume.
8. Try manual set-volume above max; confirm it is blocked or clamped.

## Failure Cases

- Echo Dot missing from Spotify devices.
- Spotify reports volume but set-volume fails.
- Device changes ID.
- Token expired or missing scope.
