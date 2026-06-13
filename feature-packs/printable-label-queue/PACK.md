# Printable Label Queue Pack

Status: forward feature pack, not integrated.

## Goal

Create a workflow for turning imported/cached Spotify artwork into printable label sheets for physical RFID cards.

The intended user flow:

1. Import a Spotify playlist.
2. Cache artwork locally.
3. Assign some items to cards.
4. Queue selected media items for printing.
5. Generate a PDF sheet of uncropped square artwork labels.
6. Print, cut with scissors, and attach to bank-card-sized RFID cards.
7. Mark items as printed.

## Design Position

Keep Spotify artwork uncropped and unstretched.

Do not overlay text, badges, borders, or decorative elements on top of the artwork.

Use whitespace between labels so they can be cut cleanly. Text metadata can be printed elsewhere on the page, but not touching or covering the artwork.

## Proposed Scope For First Integration

Build the smallest useful version:

- Add print queue controls to `/media`.
- Support statuses:
  - `not_printed`
  - `queued`
  - `pdf_generated`
  - `printed`
- Add a "Queue for Print" button for media with cached artwork.
- Add a "Generate Print Sheet" button.
- Generate one PDF from currently queued items.
- Save generated files under `data/print-sheets/`.
- Update queued rows to `pdf_generated`.

## Not In First Integration

- No sticker printer integration.
- No card backs.
- No custom icons.
- No automatic printer submission.
- No complex layout designer.
- No image editing or cropping.

## Open Questions

- Preferred label size: current test uses 48 mm square artwork in a 50 mm box.
- Should each PDF be all queued items, selected items, or one collection at a time?
- Should items become `printed` manually only, or after PDF generation?
- Should unassigned media be printable, or only assigned cards?

## Integration Notes

The live app already has:

- `media_items.print_status`
- `media_items.local_artwork_path`
- `data/spotify-artwork/`
- `scripts/create-label-test-sheet.mjs`
- `data/print-sheets/` generated output folder

Prefer evolving those instead of inventing a new print model.

## Risks

- Browser/PDF rendering can be flaky on Windows if using a headless browser.
- Artwork files live under ignored `data/*`, so generated PDFs and cached art are local state.
- Layout must be physically accurate in millimetres.
- Printer scaling settings can ruin otherwise-correct PDFs.

## Proposed Integration Order

1. Confirm real playlist import and artwork caching work.
2. Add status update endpoint for `print_status`.
3. Add queue buttons on `/media`.
4. Add a print sheet generator script that reads queued media from SQLite.
5. Add browser route/button to run the generator.
6. Verify generated PDF dimensions.
7. Print a one-page test before bulk label sheets.
