# Draft Code Notes

This folder is for printable-label draft code that should not be wired into the live app until laptop integration time.

Starting point:

- Existing script: `scripts/create-label-test-sheet.mjs`

Potential integration path:

1. Copy that script into a more general generator.
2. Read queued media from SQLite.
3. Generate timestamped HTML/PDF files.
4. Return paths to the app.

Do not assume draft code is production-ready. Treat it as scaffolding.
