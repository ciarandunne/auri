# Printable Label Queue UI Notes

Not integrated.

## Media Page Changes

Add a print action column or extend the existing Print column.

For each media item:

- `not_printed` with cached artwork: show `Queue`.
- `not_printed` without cached artwork: show `Cache artwork first`.
- `queued`: show `Remove from Queue`.
- `pdf_generated`: show `Mark Printed` and maybe `Queue Again`.
- `printed`: show `Printed`.

At the top of `/media`, add a small print panel:

- queued count
- cached artwork count
- `Generate Print Sheet` button
- link to last generated PDF if available

## Copy

Use plain action labels:

- Queue
- Remove
- Generate Sheet
- Mark Printed

Avoid explaining how the feature works inside the app. The state and controls should be obvious.

## Layout

Keep it compact. The media table is already dense. Avoid a large decorative print dashboard.

## First Physical Test

Generate one sheet with three images first.

Confirm:

- no image cropping
- square artwork
- enough whitespace between images
- printer does not scale the PDF
- cut labels fit on the cards
