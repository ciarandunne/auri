-- Volume Limits draft schema notes.
-- This is not applied automatically.

-- Recommended first integration: app_settings only.

-- Existing:
-- spotify_start_volume_percent
-- spotify_default_device_id

-- Proposed:
-- spotify_max_volume_percent
-- spotify_last_reported_volume_percent
-- spotify_last_reported_volume_device_id
-- spotify_last_reported_volume_at

-- Optional future per-receiver overrides:
ALTER TABLE receivers ADD COLUMN spotify_start_volume_percent INTEGER;
ALTER TABLE receivers ADD COLUMN spotify_max_volume_percent INTEGER;
