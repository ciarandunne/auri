# Parent Mobile Control Test Plan

Not integrated.

## Fake/Data Tests

1. Create assigned media items.
2. Open `/control` on desktop narrow viewport.
3. Confirm only assigned/playable items appear.
4. Click play and confirm it calls existing Spotify play path.

## Laptop/Phone Tests

1. Find laptop LAN IP.
2. Start Kids Tunes bound to LAN host if needed.
3. Open `/control` from phone browser.
4. Tap one item.
5. Confirm Echo plays it.
6. Tap pause.
7. Confirm playback pauses.

## Failure Cases

- Phone cannot reach laptop.
- Spotify target missing.
- Item has no playable provider URI.
- Multiple receivers need a default.
