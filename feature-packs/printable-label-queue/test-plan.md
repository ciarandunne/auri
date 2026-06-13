# Printable Label Queue Test Plan

Not integrated.

## Fake/Data Tests

1. Create or import three media items with `local_artwork_path`.
2. Set their `print_status` to `queued`.
3. Generate a print sheet.
4. Confirm HTML and PDF output paths are under `data/print-sheets/`.
5. Confirm output includes only queued items with cached artwork.
6. Confirm queued items become `pdf_generated`.

## Layout Tests

1. Open generated HTML.
2. Confirm each artwork image is square.
3. Confirm images are uncropped and unstretched.
4. Confirm there is whitespace between labels.
5. Confirm no text overlays the artwork.

## Laptop/Physical Tests

1. Print one page at 100% scale.
2. Measure printed artwork with a ruler.
3. Cut one label.
4. Place it on a physical card.
5. Confirm visual fit and readability for a five-year-old.
6. Only then print a larger batch.

## Failure Cases

- No queued items.
- Queued item has no cached artwork.
- PDF generation fails.
- Output path blocked by OneDrive.
- Printer scaling changes physical dimensions.
