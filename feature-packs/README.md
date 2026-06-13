# Kids Tunes Feature Packs

Feature packs are the remote-work format for Kids Tunes.

The goal is to prepare design, draft code, schema notes, API notes, UI thinking, risks, and laptop test plans without continuing to reshape the live app while away from the hardware.

## Working Rule

Remote mode:

- Prefer creating or improving files under `feature-packs/`.
- Do not change live app behavior in `server.js` unless explicitly requested.
- Keep each pack scoped to one feature or one validation pass.
- Include enough detail that laptop-time integration starts from a prepared position rather than a blank page.

Laptop mode:

- Pick one pack.
- Integrate deliberately into the live app.
- Test with real Spotify, Echo, ESP reader, cards, NAS, or browser as needed.
- Fix what breaks before moving to another pack.
- Commit the proven integration.

## Pack Types

Forward feature pack:

- A feature not yet integrated into the live app.
- May contain draft code, SQL, API design, UI notes, and a test plan.
- Draft code is not automatically trusted; it is material to adapt during integration.

Retrospective validation pack:

- A feature already drafted into the live app that still needs real-world proof.
- Contains what changed, what could go wrong, the exact laptop validation sequence, and fix/rollback notes.

## Standard Pack Files

Use these where useful:

- `PACK.md` - overview, status, integration notes, risks.
- `schema.sql` - proposed schema changes or schema audit.
- `api-design.md` - endpoints, request/response shapes, edge cases.
- `ui-notes.md` - screens, controls, states, copy.
- `test-plan.md` - fake-data checks and real laptop checks.
- `draft-code/` - scripts, snippets, helpers, or prototypes not wired into the live app.

## Current Packs

Forward packs:

- `printable-label-queue/` - prepare printable artwork label sheets and print status flow.

Retrospective validation packs:

- `retrospective/01-multi-page-ui/`
- `retrospective/02-spotify-playlist-import/`
- `retrospective/03-next-card-assignment/`
- `retrospective/04-playlist-artwork-caching/`
