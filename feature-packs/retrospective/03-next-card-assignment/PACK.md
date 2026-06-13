# Retrospective Validation Pack: Next-Card Assignment

Status: integrated draft, needs physical card validation.

Commit:

```text
81dc218 Add next-card media assignment flow
1f455b2 Add laptop test checklist
```

## What Changed

- `/media` shows "Assign Next Card" beside unassigned Spotify media.
- Pending assignment lasts 15 minutes.
- Next unknown scan becomes a known card with enabled `spotify_play`.
- Known cards are protected from overwrite.

## Validation Steps

1. Import playlist media.
2. Click "Assign Next Card" on one unassigned item.
3. Confirm pending banner appears.
4. Tap one blank physical card.
5. Confirm card appears assigned.
6. Tap same card once to play.
7. Tap same card again to pause.
8. Repeat with a known card during pending assignment and confirm it is blocked, not overwritten.

## Risks

- A card the user thinks is blank may already be known.
- Pending assignment may expire while walking to the reader.
- Assignment flow may need clearer success feedback.
- If the scan creates the card, it should not also immediately play.

## Fix Candidates

- Add visible "last assignment result" banner.
- Add longer/shorter configurable pending timeout.
- Add explicit "overwrite known card" flow, but only with confirmation.
