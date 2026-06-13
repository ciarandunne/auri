-- Playback History draft schema notes.
-- This is not applied automatically.

-- Option A: extend action_events.
ALTER TABLE action_events ADD COLUMN media_item_id INTEGER;
ALTER TABLE action_events ADD COLUMN receiver_id INTEGER;
ALTER TABLE action_events ADD COLUMN receiver_name TEXT NOT NULL DEFAULT '';
ALTER TABLE action_events ADD COLUMN target_device_id TEXT NOT NULL DEFAULT '';
ALTER TABLE action_events ADD COLUMN target_device_name TEXT NOT NULL DEFAULT '';
ALTER TABLE action_events ADD COLUMN provider TEXT NOT NULL DEFAULT '';
ALTER TABLE action_events ADD COLUMN provider_uri TEXT NOT NULL DEFAULT '';

-- Option B: create dedicated playback_events.
CREATE TABLE IF NOT EXISTS playback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER,
  tag_id TEXT NOT NULL DEFAULT '',
  card_name TEXT NOT NULL DEFAULT '',
  media_item_id INTEGER,
  media_title TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  provider_uri TEXT NOT NULL DEFAULT '',
  receiver_id INTEGER,
  receiver_name TEXT NOT NULL DEFAULT '',
  target_device_id TEXT NOT NULL DEFAULT '',
  target_device_name TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (scan_id) REFERENCES scan_events(id) ON DELETE SET NULL,
  FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_playback_events_created_at
ON playback_events(created_at DESC);
