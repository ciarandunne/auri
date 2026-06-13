# Playback History Test Plan

Not integrated.

## Fake/Data Tests

1. Simulate a successful Spotify play event.
2. Simulate a pause event from second tap.
3. Simulate a failed Spotify play.
4. Confirm filters return expected rows.
5. Confirm `/activity` still loads with many events.

## Laptop Tests

1. Scan a known Spotify card.
2. Confirm playback event records card, media, receiver, target, status.
3. Tap same card again.
4. Confirm pause event is recorded.
5. Turn off or hide target device.
6. Scan again and confirm failure event is clear.

## Failure Cases

- Card has Spotify action but no media item link.
- Receiver is missing.
- Spotify device ID changed.
- Playback starts after retry.
