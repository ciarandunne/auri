-- M5Dial Receiver draft schema notes.
-- This is not applied automatically.

-- First version should use existing receivers table:
-- reader_id
-- name
-- child_name
-- default_sonos_host
-- spotify_account_label
-- enabled

-- Example receiver rows:
-- reader_id: m5dial-eabha
-- name: Eabha M5Dial
-- child_name: Eabha

-- reader_id: m5dial-liam
-- name: Liam M5Dial
-- child_name: Liam

-- Optional future hardware metadata:
ALTER TABLE receivers ADD COLUMN hardware_type TEXT NOT NULL DEFAULT '';
ALTER TABLE receivers ADD COLUMN firmware_version TEXT NOT NULL DEFAULT '';
ALTER TABLE receivers ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT '';
