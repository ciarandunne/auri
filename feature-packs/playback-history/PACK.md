# Playback History Pack

Status: forward feature pack, not integrated.

## Goal

Track what Kids Tunes tried to play, pause, assign, or stop, and where it happened.

The history should answer:

- Which card was scanned?
- Which media item was requested?
- Which receiver saw the scan?
- Which Spotify/Sonos speaker/device was targeted?
- Did playback start, pause, fail, retry, or get blocked?
- When did it happen?

## Design Position

This should be a durable audit trail, not just logs.

`action_events` already exists and is useful, but a dedicated playback history model may be clearer once playback becomes richer.

First integration can extend `action_events` or add a `playback_events` table. Prefer the smallest reliable option after reviewing current data.

## Proposed Scope For First Integration

- Add a filterable `/activity` history view focused on playback.
- Store media item ID when known.
- Store receiver ID/name when known.
- Store target device ID/name when known.
- Store status and message.
- Keep raw Spotify URI/action target.

## Not In First Integration

- No analytics dashboard.
- No charts.
- No child profile summaries.
- No cloud sync.

## Open Questions

- Should assignment events live in playback history or only action history?
- Should pause events link back to the play event they paused?
- How long should history be retained?
- Should failed attempts be more visible than successful plays?

## Integration Notes

Current app has:

- `scan_events`
- `action_events`
- `media_items`
- `card_media_assignments`
- receiver lookup during scan
- Spotify active playback settings

The quickest path may be enriching `action_events` before creating a new table.

## Risks

- Too much logging can make `/activity` noisy.
- SQLite rows can grow forever.
- Some playback actions may not know the final Spotify device name.
- Existing Sonos and Spotify action paths differ.

## Proposed Integration Order

1. Audit current `action_events` data after real laptop testing.
2. Decide whether to extend `action_events` or create `playback_events`.
3. Add media/receiver/target fields.
4. Add `/activity` filters.
5. Add retention/export later only if needed.
