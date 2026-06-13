-- Parent Mobile Control draft schema notes.
-- This is not applied automatically.

-- First version may not need schema changes.

-- Optional future setting:
-- app_settings.parent_control_default_receiver_id
-- app_settings.parent_control_enabled

-- Optional future favorites:
CREATE TABLE IF NOT EXISTS parent_control_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_item_id INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE
);
