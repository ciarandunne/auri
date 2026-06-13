-- Spotify Multi-Account draft schema notes.
-- This is not applied automatically.

CREATE TABLE IF NOT EXISTS spotify_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  spotify_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  profile_url TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL DEFAULT '',
  refresh_token TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL DEFAULT 0,
  scopes TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT 'playback',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Proposed receiver link:
ALTER TABLE receivers ADD COLUMN spotify_account_id INTEGER;

-- Proposed app setting:
-- spotify_library_account_id

-- Legacy migration source:
-- app_settings.spotify_access_token
-- app_settings.spotify_refresh_token
-- app_settings.spotify_expires_at
-- app_settings.spotify_account_id
-- app_settings.spotify_account_display_name
