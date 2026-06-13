-- Printable Label Queue draft schema notes.
-- This is not applied automatically.

-- Existing column:
-- media_items.print_status TEXT NOT NULL DEFAULT 'not_printed'

-- Proposed allowed values:
-- not_printed
-- queued
-- pdf_generated
-- printed

-- Optional future table if generated PDF history becomes useful:
CREATE TABLE IF NOT EXISTS print_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'draft',
  output_pdf_path TEXT NOT NULL DEFAULT '',
  output_html_path TEXT NOT NULL DEFAULT '',
  item_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS print_job_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  print_job_id INTEGER NOT NULL,
  media_item_id INTEGER NOT NULL,
  position_index INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (print_job_id) REFERENCES print_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE
);
