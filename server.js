const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");
const { Connection: EspHomeConnection } = require("esphome-native-api");
const { pb: EspHomePb } = require("esphome-native-api/lib/utils/messages");

loadLocalEnv();

const APP_NAME = "Auri";
const APP_SERVICE_ID = "auri";
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const DB_PATH = process.env.AURI_DB_PATH || getDefaultDatabasePath();
const ESPHOME_SCAN_DEBOUNCE_MS = 2500;
const ESPHOME_WATCHDOG_INTERVAL_MS = 60_000;
const ESPHOME_RECONNECT_BACKOFF_MS = 30_000;
const ESPHOME_CONNECTING_TIMEOUT_MS = 2 * 60_000;
const ESPHOME_CONNECTED_REFRESH_MS = 6 * 60 * 60_000;
const TAGREADER_BUZZER_SWITCH_KEY = 1985256757;
const MEDIA_ASSIGNMENT_TTL_MS = 15 * 60 * 1000;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || `http://127.0.0.1:${PORT}/spotify/callback`;
const SPOTIFY_ARTWORK_DIR = path.join(__dirname, "data", "spotify-artwork");
const SPOTIFY_ARTWORK_MANIFEST_PATH = path.join(SPOTIFY_ARTWORK_DIR, "manifest.json");
const SPOTIFY_SCOPES = [
  "playlist-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
];

function loadLocalEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key]) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

let espHomeBridge = {
  connection: null,
  status: "disabled",
  lastError: "",
  lastLog: "",
  lastTagId: "",
  lastScanAt: "",
  startedAt: "",
  lastReconnectAt: "",
  lastReconnectReason: "",
  reconnectCount: 0,
  watchdogStartedAt: "",
  logHistory: [],
  recentTags: new Map(),
};

let espHomeWatchdogTimer = null;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS scan_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reader_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'api',
    scanned_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_scan_events_scanned_at
  ON scan_events(scanned_at DESC);

  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_cards_tag_id
  ON cards(tag_id);

  CREATE TABLE IF NOT EXISTS card_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id TEXT NOT NULL UNIQUE,
    action_type TEXT NOT NULL DEFAULT 'none',
    action_target TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (tag_id) REFERENCES cards(tag_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_card_actions_tag_id
  ON card_actions(tag_id);

  CREATE TABLE IF NOT EXISTS media_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    media_type TEXT NOT NULL,
    provider_uri TEXT NOT NULL UNIQUE,
    source_url TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    artist_names TEXT NOT NULL DEFAULT '',
    show_name TEXT NOT NULL DEFAULT '',
    album_name TEXT NOT NULL DEFAULT '',
    artwork_url TEXT NOT NULL DEFAULT '',
    local_artwork_path TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER,
    print_status TEXT NOT NULL DEFAULT 'not_printed',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_media_items_provider_uri
  ON media_items(provider_uri);

  CREATE TABLE IF NOT EXISTS card_media_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id TEXT NOT NULL UNIQUE,
    media_item_id INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (tag_id) REFERENCES cards(tag_id) ON DELETE CASCADE,
    FOREIGN KEY (media_item_id) REFERENCES media_items(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_card_media_assignments_media_item_id
  ON card_media_assignments(media_item_id);

  CREATE TABLE IF NOT EXISTS spotify_playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_uri TEXT NOT NULL UNIQUE,
    source_url TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    last_imported_at TEXT NOT NULL DEFAULT '',
    last_total_count INTEGER NOT NULL DEFAULT 0,
    last_imported_count INTEGER NOT NULL DEFAULT 0,
    last_skipped_count INTEGER NOT NULL DEFAULT 0,
    last_cached_artwork_count INTEGER NOT NULL DEFAULT 0,
    last_failed_artwork_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_spotify_playlists_provider_uri
  ON spotify_playlists(provider_uri);

  CREATE TABLE IF NOT EXISTS action_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id INTEGER NOT NULL,
    tag_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_target TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (scan_id) REFERENCES scan_events(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_action_events_created_at
  ON action_events(created_at DESC);

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sonos_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sonos_devices_host
  ON sonos_devices(host);

  CREATE TABLE IF NOT EXISTS receivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reader_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    child_name TEXT NOT NULL DEFAULT '',
    default_sonos_host TEXT NOT NULL DEFAULT '',
    spotify_account_label TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_receivers_reader_id
  ON receivers(reader_id);
`);

ensureColumn("media_items", "imported_from_provider_uri", "TEXT NOT NULL DEFAULT ''");
ensureColumn("media_items", "imported_from_title", "TEXT NOT NULL DEFAULT ''");
ensureColumn("media_items", "imported_at", "TEXT NOT NULL DEFAULT ''");
ensureColumn("media_items", "playlist_status", "TEXT NOT NULL DEFAULT 'active'");

const insertScan = db.prepare(`
  INSERT INTO scan_events (reader_id, tag_id, source, scanned_at)
  VALUES (?, ?, ?, ?)
`);

const selectScans = db.prepare(`
  SELECT
    scan_events.id,
    scan_events.reader_id,
    scan_events.tag_id,
    scan_events.source,
    scan_events.scanned_at,
    cards.id AS card_id,
    cards.name AS card_name,
    cards.notes AS card_notes,
    card_actions.action_type AS configured_action_type,
    card_actions.action_target AS configured_action_target,
    card_actions.enabled AS configured_action_enabled,
    action_events.id AS action_event_id,
    action_events.action_type AS action_event_type,
    action_events.action_target AS action_event_target,
    action_events.status AS action_event_status,
    action_events.message AS action_event_message,
    action_events.created_at AS action_event_created_at,
    receivers.id AS receiver_id,
    receivers.name AS receiver_name,
    receivers.child_name AS receiver_child_name,
    receivers.default_sonos_host AS receiver_default_sonos_host,
    receivers.spotify_account_label AS receiver_spotify_account_label,
    receivers.enabled AS receiver_enabled
  FROM scan_events
  LEFT JOIN cards ON cards.tag_id = scan_events.tag_id
  LEFT JOIN card_actions ON card_actions.tag_id = scan_events.tag_id
  LEFT JOIN action_events ON action_events.scan_id = scan_events.id
  LEFT JOIN receivers ON receivers.reader_id = scan_events.reader_id
  ORDER BY scan_events.scanned_at DESC, scan_events.id DESC
  LIMIT ?
`);

const selectCards = db.prepare(`
  SELECT
    cards.id,
    cards.tag_id,
    cards.name,
    cards.notes,
    cards.created_at,
    cards.updated_at,
    COALESCE(card_actions.action_type, 'none') AS action_type,
    COALESCE(card_actions.action_target, '') AS action_target,
    COALESCE(card_actions.enabled, 0) AS action_enabled
  FROM cards
  LEFT JOIN card_actions ON card_actions.tag_id = cards.tag_id
  ORDER BY cards.updated_at DESC, cards.id DESC
  LIMIT ?
`);

const selectCardByTag = db.prepare(`
  SELECT
    cards.id,
    cards.tag_id,
    cards.name,
    cards.notes,
    cards.created_at,
    cards.updated_at,
    COALESCE(card_actions.action_type, 'none') AS action_type,
    COALESCE(card_actions.action_target, '') AS action_target,
    COALESCE(card_actions.enabled, 0) AS action_enabled
  FROM cards
  LEFT JOIN card_actions ON card_actions.tag_id = cards.tag_id
  WHERE cards.tag_id = ?
`);

const upsertCardStatement = db.prepare(`
  INSERT INTO cards (tag_id, name, notes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(tag_id) DO UPDATE SET
    name = excluded.name,
    notes = excluded.notes,
    updated_at = excluded.updated_at
`);

const selectActionByTag = db.prepare(`
  SELECT id, tag_id, action_type, action_target, enabled, created_at, updated_at
  FROM card_actions
  WHERE tag_id = ?
`);

const upsertActionStatement = db.prepare(`
  INSERT INTO card_actions (tag_id, action_type, action_target, enabled, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(tag_id) DO UPDATE SET
    action_type = excluded.action_type,
    action_target = excluded.action_target,
    enabled = excluded.enabled,
    updated_at = excluded.updated_at
`);

const insertActionEvent = db.prepare(`
  INSERT INTO action_events (scan_id, tag_id, action_type, action_target, status, message, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const selectActionEvents = db.prepare(`
  SELECT id, scan_id, tag_id, action_type, action_target, status, message, created_at
  FROM action_events
  ORDER BY created_at DESC, id DESC
  LIMIT ?
`);

const selectSetting = db.prepare(`
  SELECT value
  FROM app_settings
  WHERE key = ?
`);

const upsertSettingStatement = db.prepare(`
  INSERT INTO app_settings (key, value, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value,
    updated_at = excluded.updated_at
`);

const selectSonosDevices = db.prepare(`
  SELECT id, name, host, enabled, created_at, updated_at
  FROM sonos_devices
  ORDER BY name ASC, id ASC
`);

const selectSonosDeviceByHost = db.prepare(`
  SELECT id, name, host, enabled, created_at, updated_at
  FROM sonos_devices
  WHERE host = ?
`);

const upsertSonosDeviceStatement = db.prepare(`
  INSERT INTO sonos_devices (name, host, enabled, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(host) DO UPDATE SET
    name = excluded.name,
    enabled = excluded.enabled,
    updated_at = excluded.updated_at
`);

const updateSonosDeviceByIdStatement = db.prepare(`
  UPDATE sonos_devices
  SET name = ?, host = ?, enabled = ?, updated_at = ?
  WHERE id = ?
`);

const selectReceivers = db.prepare(`
  SELECT id, reader_id, name, child_name, default_sonos_host, spotify_account_label, enabled, created_at, updated_at
  FROM receivers
  ORDER BY name ASC, id ASC
`);

const selectReceiverByReaderId = db.prepare(`
  SELECT id, reader_id, name, child_name, default_sonos_host, spotify_account_label, enabled, created_at, updated_at
  FROM receivers
  WHERE reader_id = ?
`);

const upsertReceiverStatement = db.prepare(`
  INSERT INTO receivers (reader_id, name, child_name, default_sonos_host, spotify_account_label, enabled, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(reader_id) DO UPDATE SET
    name = excluded.name,
    child_name = excluded.child_name,
    default_sonos_host = excluded.default_sonos_host,
    spotify_account_label = excluded.spotify_account_label,
    enabled = excluded.enabled,
    updated_at = excluded.updated_at
`);

const updateReceiverByIdStatement = db.prepare(`
  UPDATE receivers
  SET reader_id = ?, name = ?, child_name = ?, default_sonos_host = ?, spotify_account_label = ?, enabled = ?, updated_at = ?
  WHERE id = ?
`);

const selectSpotifyActionCards = db.prepare(`
  SELECT
    cards.tag_id,
    cards.name AS card_name,
    card_actions.action_target,
    card_actions.enabled
  FROM card_actions
  JOIN cards ON cards.tag_id = card_actions.tag_id
  WHERE card_actions.action_type = 'spotify_play'
`);

const upsertMediaItemStatement = db.prepare(`
  INSERT INTO media_items (
    provider,
    media_type,
    provider_uri,
    source_url,
    title,
    subtitle,
    artist_names,
    show_name,
    album_name,
    artwork_url,
    local_artwork_path,
    duration_ms,
    imported_from_provider_uri,
    imported_from_title,
    imported_at,
    playlist_status,
    created_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(provider_uri) DO UPDATE SET
    source_url = excluded.source_url,
    title = excluded.title,
    subtitle = excluded.subtitle,
    artist_names = excluded.artist_names,
    show_name = excluded.show_name,
    album_name = excluded.album_name,
    artwork_url = excluded.artwork_url,
    local_artwork_path = excluded.local_artwork_path,
    duration_ms = excluded.duration_ms,
    imported_from_provider_uri = CASE
      WHEN excluded.imported_from_provider_uri != '' THEN excluded.imported_from_provider_uri
      ELSE media_items.imported_from_provider_uri
    END,
    imported_from_title = CASE
      WHEN excluded.imported_from_title != '' THEN excluded.imported_from_title
      ELSE media_items.imported_from_title
    END,
    imported_at = CASE
      WHEN excluded.imported_at != '' THEN excluded.imported_at
      ELSE media_items.imported_at
    END,
    playlist_status = CASE
      WHEN excluded.imported_from_provider_uri != '' THEN excluded.playlist_status
      ELSE media_items.playlist_status
    END,
    updated_at = excluded.updated_at
`);

const selectMediaItemByProviderUri = db.prepare(`
  SELECT *
  FROM media_items
  WHERE provider_uri = ?
`);

const selectMediaItemById = db.prepare(`
  SELECT *
  FROM media_items
  WHERE id = ?
`);

const selectMediaItemsMissingArtwork = db.prepare(`
  SELECT *
  FROM media_items
  WHERE artwork_url != ''
    AND local_artwork_path = ''
  ORDER BY updated_at DESC, id DESC
  LIMIT ?
`);

const updateMediaItemArtworkStatement = db.prepare(`
  UPDATE media_items
  SET local_artwork_path = ?, updated_at = ?
  WHERE id = ?
`);

const updateMediaItemPrintStatusStatement = db.prepare(`
  UPDATE media_items
  SET print_status = ?, updated_at = ?
  WHERE id = ?
`);

const markPlaylistItemsRemovedStatement = db.prepare(`
  UPDATE media_items
  SET playlist_status = 'removed_from_playlist', updated_at = ?
  WHERE imported_from_provider_uri = ?
`);

const upsertSpotifyPlaylistStatement = db.prepare(`
  INSERT INTO spotify_playlists (
    provider_uri,
    source_url,
    name,
    last_imported_at,
    last_total_count,
    last_imported_count,
    last_skipped_count,
    last_cached_artwork_count,
    last_failed_artwork_count,
    created_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(provider_uri) DO UPDATE SET
    source_url = excluded.source_url,
    name = excluded.name,
    last_imported_at = excluded.last_imported_at,
    last_total_count = excluded.last_total_count,
    last_imported_count = excluded.last_imported_count,
    last_skipped_count = excluded.last_skipped_count,
    last_cached_artwork_count = excluded.last_cached_artwork_count,
    last_failed_artwork_count = excluded.last_failed_artwork_count,
    updated_at = excluded.updated_at
`);

const selectSpotifyPlaylists = db.prepare(`
  SELECT *
  FROM spotify_playlists
  ORDER BY last_imported_at DESC, updated_at DESC, id DESC
`);

const upsertCardMediaAssignmentStatement = db.prepare(`
  INSERT INTO card_media_assignments (tag_id, media_item_id, enabled, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(tag_id) DO UPDATE SET
    media_item_id = excluded.media_item_id,
    enabled = excluded.enabled,
    updated_at = excluded.updated_at
`);

const selectMediaItems = db.prepare(`
  SELECT
    media_items.*,
    COUNT(card_media_assignments.id) AS assigned_card_count,
    GROUP_CONCAT(cards.name, ', ') AS assigned_card_names,
    GROUP_CONCAT(cards.tag_id, ', ') AS assigned_tag_ids
  FROM media_items
  LEFT JOIN card_media_assignments ON card_media_assignments.media_item_id = media_items.id
  LEFT JOIN cards ON cards.tag_id = card_media_assignments.tag_id
  GROUP BY media_items.id
  ORDER BY media_items.updated_at DESC, media_items.id DESC
  LIMIT ?
`);

const countScans = db.prepare("SELECT COUNT(*) AS scan_count FROM scan_events");
const countCards = db.prepare("SELECT COUNT(*) AS card_count FROM cards");
const countActionEvents = db.prepare("SELECT COUNT(*) AS action_event_count FROM action_events");
const countReceivers = db.prepare("SELECT COUNT(*) AS receiver_count FROM receivers");
const countMediaItems = db.prepare("SELECT COUNT(*) AS media_item_count FROM media_items");

function getDefaultDatabasePath() {
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "Auri", "auri.db");
  }

  return path.join(__dirname, "data", "auri.db");
}

function ensureColumn(tableName, columnName, columnDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columns.some((column) => column.name === columnName);

  if (!hasColumn) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(html);
}

function sendFile(response, filePath, contentType) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(response, 404, { ok: false, error: "File not found" });
      return;
    }

    response.writeHead(200, {
      "content-type": contentType,
      "cache-control": "public, max-age=300",
    });
    response.end(content);
  });
}

function redirect(response, location) {
  response.writeHead(303, {
    location,
    "cache-control": "no-store",
  });
  response.end();
}

function notFound(response) {
  sendJson(response, 404, { ok: false, error: "Not found" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function contentTypeForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".webp") {
    return "image/webp";
  }

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  if (extension === ".pdf") {
    return "application/pdf";
  }

  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }

  return "application/octet-stream";
}

function localArtworkUrl(localArtworkPath) {
  const normalized = String(localArtworkPath || "").replaceAll("\\", "/");

  if (!normalized.startsWith("data/spotify-artwork/")) {
    return "";
  }

  return `/assets/spotify-artwork/${encodeURIComponent(path.basename(normalized))}`;
}

function formatScanTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function readTextBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 32_768) {
        reject(new Error("Request body is too large"));
        request.destroy();
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function readPayload(request) {
  const body = await readTextBody(request);
  const contentType = request.headers["content-type"] || "";

  if (contentType.includes("application/json")) {
    try {
      return body ? JSON.parse(body) : {};
    } catch {
      throw new Error("Request body must be valid JSON");
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(body));
  }

  return body ? JSON.parse(body) : {};
}

function normalizeTagId(tagId) {
  return typeof tagId === "string" ? tagId.trim().toUpperCase() : "";
}

function normalizeScan(payload) {
  const readerId = typeof payload.reader_id === "string" ? payload.reader_id.trim() : "";
  const tagId = normalizeTagId(payload.tag_id);
  const source = typeof payload.source === "string" && payload.source.trim() ? payload.source.trim() : "api";

  if (!readerId || readerId.length > 128) {
    return { error: "reader_id is required and must be 128 characters or fewer" };
  }

  if (!tagId || tagId.length > 128) {
    return { error: "tag_id is required and must be 128 characters or fewer" };
  }

  if (source.length > 64) {
    return { error: "source must be 64 characters or fewer" };
  }

  return { readerId, tagId, source };
}

function normalizeCard(payload) {
  const tagId = normalizeTagId(payload.tag_id);
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";

  if (!tagId || tagId.length > 128) {
    return { error: "tag_id is required and must be 128 characters or fewer" };
  }

  if (!name || name.length > 160) {
    return { error: "name is required and must be 160 characters or fewer" };
  }

  if (notes.length > 500) {
    return { error: "notes must be 500 characters or fewer" };
  }

  return { tagId, name, notes };
}

function normalizeEnabled(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  if (typeof value !== "string") {
    return false;
  }

  return ["1", "true", "yes", "on", "enabled"].includes(value.trim().toLowerCase());
}

function normalizeAction(payload) {
  const allowedTypes = getAllowedActionTypes();
  const tagId = normalizeTagId(payload.tag_id);
  const normalized = normalizeActionFields(payload, allowedTypes);

  if (!tagId || tagId.length > 128) {
    return { error: "tag_id is required and must be 128 characters or fewer" };
  }

  if (normalized.error) {
    return normalized;
  }

  return { tagId, ...normalized };
}

function getAllowedActionTypes() {
  return new Set([
    "none",
    "pretend_play",
    "stop",
    "sleep_timer",
    "sonos_play",
    "sonos_play_url",
    "sonos_stop",
    "spotify_play",
    "spotify_pause",
    "stop_all",
  ]);
}

function normalizeActionFields(payload, allowedTypes = getAllowedActionTypes()) {
  const actionType = typeof payload.action_type === "string" ? payload.action_type.trim() : "none";
  const sonosTargetHost = normalizeSonosHost(payload.sonos_target_host || "");
  const rawActionTarget = typeof payload.action_target === "string" ? payload.action_target.trim() : "";
  const usesSonosTarget = (actionType === "sonos_play" || actionType === "sonos_stop" || actionType === "stop_all") && sonosTargetHost;
  const actionTarget = usesSonosTarget ? sonosTargetHost : rawActionTarget;
  const enabled = normalizeEnabled(payload.enabled);

  if (!allowedTypes.has(actionType)) {
    return { error: "action_type must be one of none, pretend_play, stop, sleep_timer, sonos_play, sonos_play_url, sonos_stop, spotify_play, spotify_pause, or stop_all" };
  }

  if (actionTarget.length > 500) {
    return { error: "action_target must be 500 characters or fewer" };
  }

  if (actionType === "none" && enabled) {
    return { actionType, actionTarget: "", enabled: false };
  }

  return { actionType, actionTarget, enabled };
}

function normalizeReceiver(payload) {
  const readerId = typeof payload.reader_id === "string" ? payload.reader_id.trim() : "";
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const childName = typeof payload.child_name === "string" ? payload.child_name.trim() : "";
  const defaultSonosHost = normalizeSonosHost(payload.default_sonos_host || "");
  const spotifyAccountLabel =
    typeof payload.spotify_account_label === "string" ? payload.spotify_account_label.trim() : "";
  const enabled = normalizeEnabled(payload.enabled ?? "1");

  if (!readerId || readerId.length > 128) {
    return { error: "reader_id is required and must be 128 characters or fewer" };
  }

  if (!name || name.length > 120) {
    return { error: "name is required and must be 120 characters or fewer" };
  }

  if (childName.length > 120) {
    return { error: "child_name must be 120 characters or fewer" };
  }

  if (defaultSonosHost.length > 255) {
    return { error: "default_sonos_host must be 255 characters or fewer" };
  }

  if (spotifyAccountLabel.length > 160) {
    return { error: "spotify_account_label must be 160 characters or fewer" };
  }

  return {
    readerId,
    name,
    childName,
    defaultSonosHost,
    spotifyAccountLabel,
    enabled,
  };
}

function normalizeReceiverUpdate(payload) {
  const receiver = normalizeReceiver(payload);
  const id = Number(payload.id);

  if (receiver.error) {
    return receiver;
  }

  if (!Number.isInteger(id) || id < 1) {
    return { error: "id is required" };
  }

  return { ...receiver, id };
}

function normalizeEspHomeSettings(payload) {
  const host = normalizeSonosHost(payload.esphome_host || payload.host);
  const readerId =
    typeof (payload.esphome_reader_id || payload.reader_id) === "string" &&
    (payload.esphome_reader_id || payload.reader_id).trim()
      ? (payload.esphome_reader_id || payload.reader_id).trim()
      : host;
  const enabled = normalizeEnabled(payload.esphome_enabled ?? payload.enabled);

  if (!host || host.length > 255) {
    return { error: "esphome_host is required and must be 255 characters or fewer" };
  }

  if (!readerId || readerId.length > 128) {
    return { error: "reader_id is required and must be 128 characters or fewer" };
  }

  return { host, readerId, enabled };
}

function normalizeSonosHost(value) {
  let host = typeof value === "string" ? value.trim() : "";

  if (!host) {
    return "";
  }

  host = host.replace(/^https?:\/\//i, "").split("/")[0].trim();
  return host;
}

function normalizeSonosSettings(payload) {
  const enabled = normalizeEnabled(payload.sonos_enabled);
  return { enabled };
}

function normalizeSonosDevice(payload) {
  const host = normalizeSonosHost(payload.host || payload.sonos_host);
  const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : host;
  const enabled = normalizeEnabled(payload.enabled ?? "1");

  if (!host || host.length > 255) {
    return { error: "host is required and must be 255 characters or fewer" };
  }

  if (!name || name.length > 120) {
    return { error: "name is required and must be 120 characters or fewer" };
  }

  return { host, name, enabled };
}

function normalizeSonosDeviceUpdate(payload) {
  const device = normalizeSonosDevice(payload);
  const id = Number(payload.id);

  if (device.error) {
    return device;
  }

  if (!Number.isInteger(id) || id < 1) {
    return { error: "id is required" };
  }

  return { ...device, id };
}

function getSetting(key, fallback = "") {
  const row = selectSetting.get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  upsertSettingStatement.run(key, String(value), new Date().toISOString());
}

function getSonosSettings() {
  return {
    enabled: getSetting("sonos_enabled", "0") === "1",
  };
}

function saveSonosSettings(settings) {
  setSetting("sonos_enabled", settings.enabled ? "1" : "0");
  return getSonosSettings();
}

function getEspHomeSettings() {
  return {
    host: getSetting("esphome_host", "192.168.5.28"),
    reader_id: getSetting("esphome_reader_id", "tagreader-c6c6e4"),
    enabled: getSetting("esphome_enabled", "0") === "1",
  };
}

function saveEspHomeSettings(settings) {
  setSetting("esphome_host", settings.host);
  setSetting("esphome_reader_id", settings.readerId);
  setSetting("esphome_enabled", settings.enabled ? "1" : "0");
  return getEspHomeSettings();
}

function getReaderTestActionSettings() {
  return {
    enabled: getSetting("reader_test_enabled", "0") === "1",
    reader_id: getSetting("reader_test_reader_id", getEspHomeSettings().reader_id),
    action: {
      type: getSetting("reader_test_action_type", "pretend_play"),
      target: getSetting("reader_test_action_target", "Reader test trigger"),
      enabled: true,
    },
  };
}

function normalizeReaderTestActionSettings(payload) {
  const readerId =
    typeof payload.reader_id === "string" && payload.reader_id.trim()
      ? payload.reader_id.trim()
      : getEspHomeSettings().reader_id;
  const action = normalizeActionFields({
    action_type: payload.action_type,
    action_target: payload.action_target,
    sonos_target_host: payload.sonos_target_host,
    enabled: true,
  });
  const enabled = normalizeEnabled(payload.reader_test_enabled);

  if (!readerId || readerId.length > 128) {
    return { error: "reader_id is required and must be 128 characters or fewer" };
  }

  if (action.error) {
    return action;
  }

  return {
    enabled,
    readerId,
    actionType: action.actionType,
    actionTarget: action.actionTarget,
  };
}

function saveReaderTestActionSettings(settings) {
  setSetting("reader_test_enabled", settings.enabled ? "1" : "0");
  setSetting("reader_test_reader_id", settings.readerId);
  setSetting("reader_test_action_type", settings.actionType);
  setSetting("reader_test_action_target", settings.actionTarget);
  return getReaderTestActionSettings();
}

function getSpotifyConfig() {
  return {
    clientId: process.env.SPOTIFY_CLIENT_ID || "",
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || "",
    redirectUri: SPOTIFY_REDIRECT_URI,
  };
}

function getSpotifyTokens() {
  return {
    accessToken: getSetting("spotify_access_token", ""),
    refreshToken: getSetting("spotify_refresh_token", ""),
    expiresAt: Number(getSetting("spotify_expires_at", "0")) || 0,
  };
}

function getSpotifyAccountSummary() {
  return {
    id: getSetting("spotify_account_id", ""),
    display_name: getSetting("spotify_account_display_name", ""),
    uri: getSetting("spotify_account_uri", ""),
    profile_url: getSetting("spotify_account_profile_url", ""),
    refreshed_at: getSetting("spotify_account_refreshed_at", ""),
  };
}

function getSpotifyStatus() {
  const config = getSpotifyConfig();
  const tokens = getSpotifyTokens();

  return {
    configured: Boolean(config.clientId && config.clientSecret),
    authorized: Boolean(tokens.refreshToken),
    has_access_token: Boolean(tokens.accessToken),
    expires_at: tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : "",
    redirect_uri: config.redirectUri,
    scopes: SPOTIFY_SCOPES,
    default_device_id: getSetting("spotify_default_device_id", ""),
    default_device_name: getSpotifyDefaultDeviceName(),
    start_volume_percent: getSpotifyStartVolumePercent(),
    account: getSpotifyAccountSummary(),
  };
}

function getSpotifyDefaultDeviceName() {
  return getSetting("spotify_default_device_name", "");
}

function normalizeSpotifyDeviceName(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }

  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeSpotifyVolumePercent(value, fallback = "") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const volumePercent = Number(value);

  if (!Number.isInteger(volumePercent) || volumePercent < 0 || volumePercent > 100) {
    return null;
  }

  return volumePercent;
}

function getSpotifyStartVolumePercent() {
  const savedValue = getSetting("spotify_start_volume_percent", "30");
  const volumePercent = normalizeSpotifyVolumePercent(savedValue, "");
  return volumePercent === null ? 30 : volumePercent;
}

function normalizeSpotifyPlaybackSettings(payload) {
  const defaultDeviceId =
    typeof payload.default_device_id === "string" && payload.default_device_id.trim()
      ? payload.default_device_id.trim()
      : "";
  const defaultDeviceName =
    typeof payload.default_device_name === "string"
      ? normalizeSpotifyDeviceName(payload.default_device_name)
      : getSpotifyDefaultDeviceName();
  const startVolumePercent = normalizeSpotifyVolumePercent(payload.start_volume_percent, "");

  if (defaultDeviceId.length > 200) {
    return { error: "default_device_id must be 200 characters or fewer" };
  }

  if (defaultDeviceName.length > 200) {
    return { error: "default_device_name must be 200 characters or fewer" };
  }

  if (startVolumePercent === null) {
    return { error: "start_volume_percent must be a whole number from 0 to 100, or blank" };
  }

  return { defaultDeviceId, defaultDeviceName, startVolumePercent };
}

function saveSpotifyPlaybackSettings(settings) {
  setSetting("spotify_default_device_id", settings.defaultDeviceId);
  setSetting("spotify_default_device_name", settings.defaultDeviceName);
  setSetting("spotify_start_volume_percent", settings.startVolumePercent === "" ? "" : String(settings.startVolumePercent));
  return getSpotifyStatus();
}

function saveSpotifyTokenResponse(tokenResponse) {
  if (tokenResponse.access_token) {
    setSetting("spotify_access_token", tokenResponse.access_token);
  }

  if (tokenResponse.refresh_token) {
    setSetting("spotify_refresh_token", tokenResponse.refresh_token);
  }

  if (tokenResponse.expires_in) {
    setSetting("spotify_expires_at", String(Date.now() + Number(tokenResponse.expires_in) * 1000 - 60000));
  }

  return getSpotifyStatus();
}

function saveSpotifyAccountProfile(profile) {
  setSetting("spotify_account_id", profile.id || "");
  setSetting("spotify_account_display_name", profile.display_name || profile.id || "");
  setSetting("spotify_account_uri", profile.uri || "");
  setSetting("spotify_account_profile_url", profile.external_urls?.spotify || "");
  setSetting("spotify_account_refreshed_at", new Date().toISOString());
  return getSpotifyAccountSummary();
}

async function refreshSpotifyAccountProfile() {
  const profile = await spotifyApiRequest("/me");
  return saveSpotifyAccountProfile(profile);
}

function normalizeSpotifyUri(value) {
  const raw = typeof value === "string" ? value.trim() : "";

  if (!raw) {
    return "";
  }

  if (/^spotify:(track|album|playlist|episode):[A-Za-z0-9]+$/.test(raw)) {
    return raw;
  }

  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    const type = parts[0];
    const id = parts[1];

    if (url.hostname.endsWith("spotify.com") && ["track", "album", "playlist", "episode"].includes(type) && id) {
      return `spotify:${type}:${id}`;
    }
  } catch {
    return "";
  }

  return "";
}

function spotifyPlaybackBodyForUri(uri) {
  if (uri.startsWith("spotify:track:") || uri.startsWith("spotify:episode:")) {
    return { uris: [uri], position_ms: 0 };
  }

  if (uri.startsWith("spotify:album:") || uri.startsWith("spotify:playlist:")) {
    return { context_uri: uri };
  }

  return null;
}

function spotifyMediaTypeFromUri(uri) {
  const parts = String(uri || "").split(":");
  return parts.length >= 3 ? parts[1] : "";
}

function spotifyIdFromUri(uri, expectedType = "") {
  const parts = String(uri || "").split(":");

  if (parts.length < 3 || parts[0] !== "spotify") {
    return "";
  }

  if (expectedType && parts[1] !== expectedType) {
    return "";
  }

  return parts[2] || "";
}

function spotifyUrlForUri(uri) {
  const parts = String(uri || "").split(":");

  if (parts.length < 3 || parts[0] !== "spotify") {
    return "";
  }

  return `https://open.spotify.com/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`;
}

function spotifyImageUrl(images) {
  if (!Array.isArray(images) || !images.length) {
    return "";
  }

  return images[0] && images[0].url ? images[0].url : "";
}

function slugifyFilePart(value, fallback = "spotify-item") {
  const slug = String(value || fallback)
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);

  return slug || fallback;
}

function imageExtensionFromContentType(contentType) {
  const normalized = String(contentType || "").toLowerCase();

  if (normalized.includes("png")) {
    return "png";
  }

  if (normalized.includes("webp")) {
    return "webp";
  }

  return "jpg";
}

function artworkFileNameForMediaItem(item, contentType = "") {
  const mediaType = item.mediaType || item.media_type || spotifyMediaTypeFromUri(item.providerUri || item.provider_uri) || "item";
  const spotifyId = spotifyIdFromUri(item.providerUri || item.provider_uri, mediaType) || slugifyFilePart(item.providerUri || item.provider_uri, "spotify");
  const extension = imageExtensionFromContentType(contentType);
  return `${slugifyFilePart(item.title)}--${slugifyFilePart(mediaType)}-${spotifyId}.${extension}`;
}

function readSpotifyArtworkManifest() {
  if (!fs.existsSync(SPOTIFY_ARTWORK_MANIFEST_PATH)) {
    return { generated_at: "", items: [] };
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(SPOTIFY_ARTWORK_MANIFEST_PATH, "utf8"));
    return {
      generated_at: manifest.generated_at || "",
      items: Array.isArray(manifest.items) ? manifest.items : [],
    };
  } catch {
    return { generated_at: "", items: [] };
  }
}

function writeSpotifyArtworkManifestEntry(item, localArtworkPath) {
  const providerUri = item.providerUri || item.provider_uri || "";

  if (!providerUri) {
    return;
  }

  const manifest = readSpotifyArtworkManifest();
  const mediaType = item.mediaType || item.media_type || spotifyMediaTypeFromUri(providerUri) || "";
  const spotifyId = spotifyIdFromUri(providerUri, mediaType) || "";
  const entry = {
    spotify_uri: providerUri,
    spotify_type: mediaType,
    spotify_id: spotifyId,
    title: item.title || providerUri,
    subtitle: item.subtitle || "",
    show_name: item.showName || item.show_name || "",
    artist_names: item.artistNames || item.artist_names || "",
    album_name: item.albumName || item.album_name || "",
    spotify_url: item.sourceUrl || item.source_url || spotifyUrlForUri(providerUri),
    image_url: item.artworkUrl || item.artwork_url || "",
    artwork_file: localArtworkPath,
  };
  const existingIndex = manifest.items.findIndex((manifestItem) => manifestItem.spotify_uri === providerUri);

  if (existingIndex >= 0) {
    manifest.items[existingIndex] = {
      ...manifest.items[existingIndex],
      ...entry,
    };
  } else {
    manifest.items.push(entry);
  }

  manifest.generated_at = new Date().toISOString();
  fs.mkdirSync(SPOTIFY_ARTWORK_DIR, { recursive: true });
  fs.writeFileSync(SPOTIFY_ARTWORK_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function cacheSpotifyArtworkForMediaItem(item) {
  const artworkUrl = item.artworkUrl || item.artwork_url || "";

  if (!artworkUrl) {
    return { ok: false, skipped: true, reason: "No artwork URL" };
  }

  const existingPath = item.localArtworkPath || item.local_artwork_path || "";

  if (existingPath) {
    return { ok: true, skipped: true, local_artwork_path: existingPath, reason: "Already cached" };
  }

  fs.mkdirSync(SPOTIFY_ARTWORK_DIR, { recursive: true });

  const response = await fetch(artworkUrl, {
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Artwork download failed with HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const fileName = artworkFileNameForMediaItem(item, contentType);
  const filePath = path.join(SPOTIFY_ARTWORK_DIR, fileName);
  const relativePath = path.relative(__dirname, filePath).replace(/\\/g, "/");
  const buffer = Buffer.from(await response.arrayBuffer());

  fs.writeFileSync(filePath, buffer);
  writeSpotifyArtworkManifestEntry(item, relativePath);

  return { ok: true, local_artwork_path: relativePath };
}

function getSpotifyArtworkManifestByUri() {
  const manifest = readSpotifyArtworkManifest();
  return new Map((manifest.items || []).map((item) => [item.spotify_uri, item]));
}

function mediaItemFromSpotifyAction(row, manifestByUri) {
  const providerUri = normalizeSpotifyUri(row.action_target);

  if (!providerUri) {
    return null;
  }

  const manifestItem = manifestByUri.get(providerUri) || {};
  const mediaType = manifestItem.spotify_type || spotifyMediaTypeFromUri(providerUri) || "unknown";

  return {
    provider: "spotify",
    mediaType,
    providerUri,
    sourceUrl: manifestItem.spotify_url || row.action_target || "",
    title: manifestItem.title || row.card_name || providerUri,
    subtitle: manifestItem.subtitle || manifestItem.artist_names || manifestItem.show_name || manifestItem.album_name || "",
    artistNames: manifestItem.artist_names || "",
    showName: manifestItem.show_name || (mediaType === "episode" ? manifestItem.subtitle || "" : ""),
    albumName: manifestItem.album_name || "",
    artworkUrl: manifestItem.image_url || "",
    localArtworkPath: manifestItem.artwork_file || "",
    durationMs: Number.isInteger(manifestItem.duration_ms) ? manifestItem.duration_ms : null,
    enabled: Boolean(row.enabled),
    tagId: row.tag_id,
  };
}

function upsertMediaItem(item) {
  const now = new Date().toISOString();

  upsertMediaItemStatement.run(
    item.provider,
    item.mediaType,
    item.providerUri,
    item.sourceUrl,
    item.title,
    item.subtitle,
    item.artistNames,
    item.showName,
    item.albumName,
    item.artworkUrl,
    item.localArtworkPath,
    item.durationMs,
    item.importedFromProviderUri || "",
    item.importedFromTitle || "",
    item.importedAt || "",
    item.playlistStatus || "active",
    now,
    now,
  );

  return selectMediaItemByProviderUri.get(item.providerUri);
}

function getMediaItemById(id) {
  const mediaItemId = Number(id);

  if (!Number.isInteger(mediaItemId) || mediaItemId < 1) {
    return null;
  }

  return selectMediaItemById.get(mediaItemId) || null;
}

function getPendingMediaAssignment() {
  const raw = getSetting("pending_media_assignment", "");

  if (!raw) {
    return null;
  }

  let pending;

  try {
    pending = JSON.parse(raw);
  } catch {
    setSetting("pending_media_assignment", "");
    return null;
  }

  const expiresAt = Date.parse(pending.expires_at || "");

  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    setSetting("pending_media_assignment", "");
    return null;
  }

  const mediaItem = getMediaItemById(pending.media_item_id);

  if (!mediaItem) {
    setSetting("pending_media_assignment", "");
    return null;
  }

  return {
    media_item_id: mediaItem.id,
    title: mediaItem.title,
    provider_uri: mediaItem.provider_uri,
    created_at: pending.created_at,
    expires_at: pending.expires_at,
    media_item: mediaItem,
  };
}

function setPendingMediaAssignment(mediaItemId) {
  const mediaItem = getMediaItemById(mediaItemId);

  if (!mediaItem) {
    return { error: "media_item_id was not found" };
  }

  if (mediaItem.provider !== "spotify" || !normalizeSpotifyUri(mediaItem.provider_uri)) {
    return { error: "Only Spotify media items can be assigned to a card right now" };
  }

  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + MEDIA_ASSIGNMENT_TTL_MS).toISOString();
  const pending = {
    media_item_id: mediaItem.id,
    title: mediaItem.title,
    provider_uri: mediaItem.provider_uri,
    created_at: createdAt,
    expires_at: expiresAt,
  };

  setSetting("pending_media_assignment", JSON.stringify(pending));
  return getPendingMediaAssignment();
}

function clearPendingMediaAssignment() {
  setSetting("pending_media_assignment", "");
}

function insertAssignmentActionEvent(scanId, tagId, pending, status, message) {
  const createdAt = new Date().toISOString();
  const result = insertActionEvent.run(
    scanId,
    tagId,
    "assign_media",
    pending.provider_uri,
    status,
    message,
    createdAt,
  );

  return {
    id: Number(result.lastInsertRowid),
    scan_id: scanId,
    tag_id: tagId,
    action_type: "assign_media",
    action_target: pending.provider_uri,
    status,
    message,
    created_at: createdAt,
  };
}

function maybeAssignPendingMediaToScan(scanId, scan, existingCard) {
  const pending = getPendingMediaAssignment();

  if (!pending) {
    return null;
  }

  if (existingCard) {
    return {
      card: existingCard,
      actionEvent: insertAssignmentActionEvent(
        scanId,
        scan.tagId,
        pending,
        "blocked",
        `Pending assignment kept open because ${scan.tagId} is already assigned to ${existingCard.name}`,
      ),
      consumed: false,
    };
  }

  const mediaItem = pending.media_item;
  const subtitle = mediaItem.subtitle || mediaItem.artist_names || mediaItem.show_name || mediaItem.album_name || "";
  const notes = subtitle ? `Assigned from media library: ${subtitle}` : "Assigned from media library";
  const card = upsertCard({
    tagId: scan.tagId,
    name: mediaItem.title,
    notes,
  });
  const action = upsertAction({
    tagId: scan.tagId,
    actionType: "spotify_play",
    actionTarget: mediaItem.provider_uri,
    enabled: true,
  });

  if (action.error) {
    return {
      card,
      actionEvent: insertAssignmentActionEvent(scanId, scan.tagId, pending, "failed", action.error),
      consumed: false,
    };
  }

  const now = new Date().toISOString();
  upsertCardMediaAssignmentStatement.run(scan.tagId, mediaItem.id, 1, now, now);
  clearPendingMediaAssignment();

  return {
    card: getCard(scan.tagId),
    actionEvent: insertAssignmentActionEvent(
      scanId,
      scan.tagId,
      pending,
      "assigned",
      `Assigned ${scan.tagId} to ${mediaItem.title}`,
    ),
    consumed: true,
  };
}

function syncMediaLibraryFromExistingActions() {
  const manifestByUri = getSpotifyArtworkManifestByUri();
  const rows = selectSpotifyActionCards.all();

  for (const row of rows) {
    const item = mediaItemFromSpotifyAction(row, manifestByUri);

    if (!item) {
      continue;
    }

    const mediaItem = upsertMediaItem(item);
    const now = new Date().toISOString();
    upsertCardMediaAssignmentStatement.run(item.tagId, mediaItem.id, item.enabled ? 1 : 0, now, now);
  }
}

async function exchangeSpotifyCode(code) {
  const config = getSpotifyConfig();

  if (!config.clientId || !config.clientSecret) {
    throw new Error("SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set before Spotify login");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Spotify token exchange failed with HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  const status = saveSpotifyTokenResponse(payload);
  await refreshSpotifyAccountProfile();
  return status;
}

async function refreshSpotifyAccessToken() {
  const config = getSpotifyConfig();
  const tokens = getSpotifyTokens();

  if (!config.clientId || !config.clientSecret) {
    throw new Error("SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set");
  }

  if (!tokens.refreshToken) {
    throw new Error("Spotify is not authorized yet");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Spotify token refresh failed with HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 240)}`);
  }

  saveSpotifyTokenResponse(payload);
  return getSpotifyTokens().accessToken;
}

async function getSpotifyAccessToken() {
  const tokens = getSpotifyTokens();

  if (tokens.accessToken && tokens.expiresAt > Date.now()) {
    return tokens.accessToken;
  }

  return refreshSpotifyAccessToken();
}

async function spotifyApiRequest(pathname, options = {}) {
  const accessToken = await getSpotifyAccessToken();
  const response = await fetch(`https://api.spotify.com/v1${pathname}`, {
    method: options.method || "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) {
    return { ok: true, status_code: response.status };
  }

  const text = await response.text();
  let payload = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    throw new Error(`Spotify API failed with HTTP ${response.status}: ${text.slice(0, 240)}`);
  }

  return {
    ...payload,
    ok: payload.ok ?? true,
    status_code: response.status,
  };
}

async function getSpotifyDevices() {
  const payload = await spotifyApiRequest("/me/player/devices");
  const devices = payload.devices || [];
  rememberSpotifyDefaultDeviceName(devices);
  return devices;
}

function spotifyDeviceNameMatches(left, right) {
  return normalizeSpotifyDeviceName(left).toLowerCase() === normalizeSpotifyDeviceName(right).toLowerCase();
}

function findSpotifyDeviceById(devices, deviceId) {
  const normalizedId = typeof deviceId === "string" ? deviceId.trim() : "";
  if (!normalizedId) {
    return null;
  }

  return devices.find((device) => device.id === normalizedId) || null;
}

function findSpotifyDeviceByName(devices, deviceName) {
  const normalizedName = normalizeSpotifyDeviceName(deviceName);
  if (!normalizedName) {
    return null;
  }

  const matches = devices.filter((device) => spotifyDeviceNameMatches(device.name, normalizedName));
  return matches.find((device) => device.is_active) || matches.find((device) => !device.is_restricted) || matches[0] || null;
}

function rememberSpotifyDefaultDeviceName(devices, deviceId = getSetting("spotify_default_device_id", "")) {
  const device = findSpotifyDeviceById(devices, deviceId);
  if (!device || !device.name) {
    return;
  }

  if (getSpotifyDefaultDeviceName() !== device.name) {
    setSetting("spotify_default_device_name", device.name);
  }
}

async function resolveSpotifyPlaybackDeviceId(deviceId = getSetting("spotify_default_device_id", "")) {
  const requestedDeviceId = typeof deviceId === "string" ? deviceId.trim() : "";
  const savedDeviceName = getSpotifyDefaultDeviceName();

  if (!requestedDeviceId && !savedDeviceName) {
    return "";
  }

  const devices = await getSpotifyDevices();
  const requestedDevice = findSpotifyDeviceById(devices, requestedDeviceId);

  if (requestedDevice) {
    rememberSpotifyDefaultDeviceName(devices, requestedDeviceId);
    return requestedDeviceId;
  }

  const namedDevice = findSpotifyDeviceByName(devices, savedDeviceName);
  if (!namedDevice) {
    return requestedDeviceId;
  }

  setSetting("spotify_default_device_id", namedDevice.id);
  setSetting("spotify_default_device_name", namedDevice.name);
  return namedDevice.id;
}

async function getSpotifyPlaylist(playlistId) {
  return spotifyApiRequest(`/playlists/${encodeURIComponent(playlistId)}?fields=name,uri,external_urls`);
}

async function getSpotifyPlaylistItems(playlistId) {
  const items = [];
  let offset = 0;
  let total = null;
  const limit = 100;

  do {
    const payload = await spotifyApiRequest(
      `/playlists/${encodeURIComponent(playlistId)}/items?limit=${limit}&offset=${offset}`,
    );
    const pageItems = Array.isArray(payload.items) ? payload.items : [];
    items.push(...pageItems);
    total = Number.isInteger(payload.total) ? payload.total : items.length;
    if (!pageItems.length) {
      break;
    }
    offset += pageItems.length;
  } while (items.length < total);

  return items;
}

function mediaItemFromSpotifyPlaylistEntry(entry, playlist, importedAt) {
  const media = entry && (entry.track || entry.item) ? entry.track || entry.item : null;

  if (!media || media.is_local) {
    return null;
  }

  const mediaType = media.type;

  if (mediaType !== "track" && mediaType !== "episode") {
    return null;
  }

  const providerUri = normalizeSpotifyUri(media.uri) || (media.id ? `spotify:${mediaType}:${media.id}` : "");

  if (!providerUri) {
    return null;
  }

  const artistNames = mediaType === "track" && Array.isArray(media.artists)
    ? media.artists.map((artist) => artist.name).filter(Boolean).join(", ")
    : "";
  const albumName = mediaType === "track" && media.album ? media.album.name || "" : "";
  const showName = mediaType === "episode" && media.show ? media.show.name || "" : "";
  const subtitle = artistNames || showName || albumName || "";
  const artworkUrl = mediaType === "track"
    ? spotifyImageUrl(media.album && media.album.images)
    : spotifyImageUrl(media.images) || spotifyImageUrl(media.show && media.show.images);
  const playlistUri = normalizeSpotifyUri(playlist.uri) || "";
  const playlistTitle = playlist.name || playlistUri || "";

  return {
    provider: "spotify",
    mediaType,
    providerUri,
    sourceUrl: media.external_urls && media.external_urls.spotify ? media.external_urls.spotify : spotifyUrlForUri(providerUri),
    title: media.name || providerUri,
    subtitle,
    artistNames,
    showName,
    albumName,
    artworkUrl,
    localArtworkPath: "",
    durationMs: Number.isInteger(media.duration_ms) ? media.duration_ms : null,
    importedFromProviderUri: playlistUri,
    importedFromTitle: playlistTitle,
    importedAt,
    playlistStatus: "active",
  };
}

function shapeSpotifyPlaylist(row) {
  return {
    id: row.id,
    provider_uri: row.provider_uri,
    source_url: row.source_url,
    name: row.name,
    last_imported_at: row.last_imported_at,
    last_total_count: row.last_total_count,
    last_imported_count: row.last_imported_count,
    last_skipped_count: row.last_skipped_count,
    last_cached_artwork_count: row.last_cached_artwork_count,
    last_failed_artwork_count: row.last_failed_artwork_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getSpotifyPlaylists() {
  const playlists = selectSpotifyPlaylists.all().map(shapeSpotifyPlaylist);
  const lastImport = getLastSpotifyPlaylistImport();
  const lastPlaylist = lastImport && lastImport.playlist ? lastImport.playlist : null;
  const lastProviderUri = lastPlaylist ? normalizeSpotifyUri(lastPlaylist.uri || lastPlaylist.url || "") : "";

  if (lastPlaylist && lastProviderUri && !playlists.some((playlist) => playlist.provider_uri === lastProviderUri)) {
    playlists.push({
      id: `last-${lastProviderUri}`,
      provider_uri: lastProviderUri,
      source_url: lastPlaylist.url || spotifyUrlForUri(lastProviderUri),
      name: lastPlaylist.name || lastProviderUri,
      last_imported_at: lastImport.imported_at || "",
      last_total_count: lastImport.total_count || 0,
      last_imported_count: lastImport.imported_count || 0,
      last_skipped_count: lastImport.skipped_count || 0,
      last_cached_artwork_count: lastImport.cached_artwork_count || 0,
      last_failed_artwork_count: lastImport.failed_artwork_count || 0,
      created_at: lastImport.imported_at || "",
      updated_at: lastImport.imported_at || "",
    });
  }

  return playlists;
}

function saveSpotifyPlaylistImport(result) {
  const playlist = result.playlist || {};
  const providerUri = normalizeSpotifyUri(playlist.uri);

  if (!providerUri) {
    return;
  }

  const now = new Date().toISOString();

  upsertSpotifyPlaylistStatement.run(
    providerUri,
    playlist.url || spotifyUrlForUri(providerUri),
    playlist.name || providerUri,
    result.imported_at || now,
    result.total_count || 0,
    result.imported_count || 0,
    result.skipped_count || 0,
    result.cached_artwork_count || 0,
    result.failed_artwork_count || 0,
    now,
    now,
  );
}

async function importSpotifyPlaylist(uriOrUrl) {
  const playlistUri = normalizeSpotifyUri(uriOrUrl);
  const playlistId = spotifyIdFromUri(playlistUri, "playlist");

  if (!playlistId) {
    throw new Error("Paste a Spotify playlist URL or URI");
  }

  const playlist = await getSpotifyPlaylist(playlistId);
  const playlistInfo = {
    name: playlist.name || playlistUri,
    uri: playlist.uri || playlistUri,
    url: playlist.external_urls && playlist.external_urls.spotify
      ? playlist.external_urls.spotify
      : spotifyUrlForUri(playlistUri),
  };
  const entries = await getSpotifyPlaylistItems(playlistId);
  const importedAt = new Date().toISOString();
  let importedCount = 0;
  let skippedCount = 0;
  let cachedArtworkCount = 0;
  let failedArtworkCount = 0;

  markPlaylistItemsRemovedStatement.run(importedAt, playlistInfo.uri);

  for (const entry of entries) {
    const item = mediaItemFromSpotifyPlaylistEntry(entry, playlistInfo, importedAt);

    if (!item) {
      skippedCount += 1;
      continue;
    }

    try {
      const artworkResult = await cacheSpotifyArtworkForMediaItem(item);

      if (artworkResult.ok && artworkResult.local_artwork_path) {
        item.localArtworkPath = artworkResult.local_artwork_path;

        if (!artworkResult.skipped) {
          cachedArtworkCount += 1;
        }
      }
    } catch {
      failedArtworkCount += 1;
    }

    upsertMediaItem(item);
    importedCount += 1;
  }

  return {
    playlist: playlistInfo,
    imported_count: importedCount,
    skipped_count: skippedCount,
    cached_artwork_count: cachedArtworkCount,
    failed_artwork_count: failedArtworkCount,
    total_count: entries.length,
    imported_at: importedAt,
  };
}

async function getSpotifyCurrentPlayback() {
  return spotifyApiRequest("/me/player");
}

function getSpotifyActivePlayback() {
  return {
    tag_id: getSetting("spotify_active_tag_id", ""),
    uri: getSetting("spotify_active_uri", ""),
    device_id: getSetting("spotify_active_device_id", ""),
    started_at: getSetting("spotify_active_started_at", ""),
  };
}

function setSpotifyActivePlayback(tagId, uri, deviceId) {
  setSetting("spotify_active_tag_id", tagId);
  setSetting("spotify_active_uri", uri);
  setSetting("spotify_active_device_id", deviceId || "");
  setSetting("spotify_active_started_at", new Date().toISOString());
}

function clearSpotifyActivePlayback() {
  setSetting("spotify_active_tag_id", "");
  setSetting("spotify_active_uri", "");
  setSetting("spotify_active_device_id", "");
  setSetting("spotify_active_started_at", "");
}

function isRecentSpotifyActivePlayback(activePlayback) {
  if (!activePlayback.started_at) {
    return false;
  }

  const startedAt = Date.parse(activePlayback.started_at);

  if (!Number.isFinite(startedAt)) {
    return false;
  }

  const maxActiveAgeMs = 6 * 60 * 60 * 1000;
  return Date.now() - startedAt < maxActiveAgeMs;
}

async function shouldPauseActiveSpotifyCard(scan, uri) {
  const activePlayback = getSpotifyActivePlayback();

  if (
    activePlayback.tag_id !== scan.tagId ||
    activePlayback.uri !== uri ||
    !isRecentSpotifyActivePlayback(activePlayback)
  ) {
    return false;
  }

  try {
    const playback = await getSpotifyCurrentPlayback();

    if (playback && playback.status_code !== 204 && playback.is_playing === false) {
      clearSpotifyActivePlayback();
      return false;
    }
  } catch {
    // Echo devices do not always report rich playback state; keep the local toggle useful.
  }

  return true;
}

async function isSpotifyPlayingUri(uri) {
  const playback = await getSpotifyCurrentPlayback();

  if (!playback || playback.status_code === 204 || !playback.is_playing) {
    return false;
  }

  const itemUri = playback.item && playback.item.uri ? playback.item.uri : "";
  const contextUri = playback.context && playback.context.uri ? playback.context.uri : "";
  return itemUri === uri || contextUri === uri;
}

function spotifyPlaybackMatchesRequest(playback, uri, deviceId) {
  if (!playback || playback.status_code === 204 || !playback.is_playing) {
    return false;
  }

  if (deviceId && playback.device && playback.device.id && playback.device.id !== deviceId) {
    return false;
  }

  const itemUri = playback.item && playback.item.uri ? playback.item.uri : "";
  const contextUri = playback.context && playback.context.uri ? playback.context.uri : "";

  if (itemUri || contextUri) {
    return itemUri === uri || contextUri === uri;
  }

  // Some Echo sessions report only "playing" and the active device for a moment after wake-up.
  return true;
}

function summarizeSpotifyPlayback(playback) {
  if (!playback) {
    return "Spotify did not return playback state";
  }

  if (playback.status_code === 204) {
    return "Spotify reported no active playback session";
  }

  const deviceName = playback.device && playback.device.name ? playback.device.name : "unknown device";
  const playingState = playback.is_playing ? "playing" : "paused";
  const itemName = playback.item && playback.item.name ? ` (${playback.item.name})` : "";
  return `Spotify reported ${playingState} on ${deviceName}${itemName}`;
}

async function waitForSpotifyPlaybackStart(uri, deviceId) {
  let lastPlayback = null;

  for (let check = 0; check < 8; check += 1) {
    await wait(500);
    lastPlayback = await getSpotifyCurrentPlayback();

    if (spotifyPlaybackMatchesRequest(lastPlayback, uri, deviceId)) {
      return { ok: true, playback: lastPlayback };
    }
  }

  return { ok: false, playback: lastPlayback };
}

async function sendSpotifyPlay(uriOrUrl, deviceId = getSetting("spotify_default_device_id", "")) {
  const uri = normalizeSpotifyUri(uriOrUrl);
  const body = spotifyPlaybackBodyForUri(uri);
  const startVolumePercent = getSpotifyStartVolumePercent();

  if (!body) {
    throw new Error("Spotify playback needs a Spotify track, album, playlist, or episode URI/URL");
  }

  const resolvedDeviceId = await resolveSpotifyPlaybackDeviceId(deviceId);
  const playbackPath = resolvedDeviceId ? `/me/player/play?device_id=${encodeURIComponent(resolvedDeviceId)}` : "/me/player/play";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (resolvedDeviceId) {
      await sendSpotifyTransferPlayback(resolvedDeviceId);
      await wait(1000);
    }

    if (startVolumePercent !== "") {
      await sendSpotifySetVolume(startVolumePercent, resolvedDeviceId);
      await wait(250);
    }

    await spotifyApiRequest(playbackPath, {
      method: "PUT",
      body,
    });

    const verification = await waitForSpotifyPlaybackStart(uri, resolvedDeviceId);

    if (verification.ok) {
      return {
        ok: true,
        uri,
        device_id: resolvedDeviceId,
        device_name: getSpotifyDefaultDeviceName(),
        start_volume_percent: startVolumePercent,
        verified: true,
        retry_count: attempt - 1,
      };
    }
  }

  const playback = await getSpotifyCurrentPlayback().catch(() => null);
  throw new Error(`Spotify accepted the play command, but playback did not start. ${summarizeSpotifyPlayback(playback)}.`);
}

async function sendSpotifyTransferPlayback(deviceId, play = false) {
  if (!deviceId) {
    return { ok: true, device_id: "" };
  }

  await spotifyApiRequest("/me/player", {
    method: "PUT",
    body: {
      device_ids: [deviceId],
      play,
    },
  });

  return { ok: true, device_id: deviceId };
}

async function sendSpotifySetVolume(volumePercent, deviceId = getSetting("spotify_default_device_id", "")) {
  const normalizedVolume = normalizeSpotifyVolumePercent(volumePercent);
  const resolvedDeviceId = await resolveSpotifyPlaybackDeviceId(deviceId);

  if (normalizedVolume === null || normalizedVolume === "") {
    throw new Error("Spotify volume must be a whole number from 0 to 100");
  }

  const volumePath =
    `/me/player/volume?volume_percent=${encodeURIComponent(normalizedVolume)}` +
    (resolvedDeviceId ? `&device_id=${encodeURIComponent(resolvedDeviceId)}` : "");

  await spotifyApiRequest(volumePath, {
    method: "PUT",
  });

  return { ok: true, volume_percent: normalizedVolume, device_id: resolvedDeviceId };
}

async function sendSpotifyPause(deviceId = getSetting("spotify_default_device_id", "")) {
  const resolvedDeviceId = await resolveSpotifyPlaybackDeviceId(deviceId);
  const pausePath = resolvedDeviceId ? `/me/player/pause?device_id=${encodeURIComponent(resolvedDeviceId)}` : "/me/player/pause";

  await spotifyApiRequest(pausePath, {
    method: "PUT",
  });

  return { ok: true, device_id: resolvedDeviceId };
}

// A restart should not make the next card scan look like a second tap.
clearSpotifyActivePlayback();
syncMediaLibraryFromExistingActions();

function shapeSonosDevice(row) {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    enabled: Boolean(row.enabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getSonosDevices() {
  return selectSonosDevices.all().map(shapeSonosDevice);
}

function getSonosDeviceByHost(host) {
  const device = selectSonosDeviceByHost.get(normalizeSonosHost(host));
  return device ? shapeSonosDevice(device) : null;
}

function upsertSonosDevice(device) {
  const now = new Date().toISOString();
  upsertSonosDeviceStatement.run(device.name, device.host, device.enabled ? 1 : 0, now, now);
  return getSonosDeviceByHost(device.host);
}

function updateSonosDevice(device) {
  updateSonosDeviceByIdStatement.run(
    device.name,
    device.host,
    device.enabled ? 1 : 0,
    new Date().toISOString(),
    device.id,
  );
  return getSonosDeviceByHost(device.host);
}

function resolveSonosDeviceForTest(payload) {
  const requestedHost = normalizeSonosHost(payload.host || payload.sonos_host || payload.device_host);

  if (requestedHost) {
    return getSonosDeviceByHost(requestedHost);
  }

  const enabledDevices = getSonosDevices().filter((device) => device.enabled);
  return enabledDevices.length === 1 ? enabledDevices[0] : null;
}

function shapeReceiver(row) {
  return {
    id: row.id,
    reader_id: row.reader_id,
    name: row.name,
    child_name: row.child_name,
    default_sonos_host: row.default_sonos_host,
    spotify_account_label: row.spotify_account_label,
    enabled: Boolean(row.enabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getReceivers() {
  return selectReceivers.all().map(shapeReceiver);
}

function getReceiver(readerId) {
  const receiver = selectReceiverByReaderId.get(readerId);
  return receiver ? shapeReceiver(receiver) : null;
}

function upsertReceiver(receiver) {
  const now = new Date().toISOString();
  upsertReceiverStatement.run(
    receiver.readerId,
    receiver.name,
    receiver.childName,
    receiver.defaultSonosHost,
    receiver.spotifyAccountLabel,
    receiver.enabled ? 1 : 0,
    now,
    now,
  );
  return getReceiver(receiver.readerId);
}

function updateReceiver(receiver) {
  updateReceiverByIdStatement.run(
    receiver.readerId,
    receiver.name,
    receiver.childName,
    receiver.defaultSonosHost,
    receiver.spotifyAccountLabel,
    receiver.enabled ? 1 : 0,
    new Date().toISOString(),
    receiver.id,
  );
  return getReceiver(receiver.readerId);
}

function resolveSonosTarget(actionTarget, receiver) {
  if (actionTarget === "__receiver_default__") {
    return {
      host: receiver ? normalizeSonosHost(receiver.default_sonos_host) : "",
      source: "receiver_default",
    };
  }

  return {
    host: normalizeSonosHost(actionTarget),
    source: "action_target",
  };
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function rememberEspHomeLog(message) {
  const cleanMessage = stripAnsi(message).trim();

  if (!cleanMessage) {
    return;
  }

  espHomeBridge.lastLog = cleanMessage;
  espHomeBridge.logHistory = [
    {
      at: new Date().toISOString(),
      message: cleanMessage,
    },
    ...espHomeBridge.logHistory,
  ].slice(0, 20);
}

function parseTagIdFromEspHomeLog(message) {
  const text = stripAnsi(message).toUpperCase();
  const candidates = text.match(/\b[0-9A-F]{2}(?:[-:][0-9A-F]{2}){3,}\b/g) || [];
  return candidates.length ? candidates[0].replaceAll(":", "-") : "";
}

function homeAssistantMapToObject(entries) {
  const output = {};

  for (const entry of entries || []) {
    const key = typeof entry.getKey === "function" ? entry.getKey() : entry.key;
    const value = typeof entry.getValue === "function" ? entry.getValue() : entry.value;

    if (key) {
      output[key] = value || "";
    }
  }

  return output;
}

function getHomeAssistantServicePayload(message) {
  const objectPayload = typeof message.toObject === "function" ? message.toObject(false) : message || {};
  const service =
    typeof message.getService === "function"
      ? message.getService()
      : objectPayload.service || objectPayload.serviceName || "";
  const isEvent =
    typeof message.getIsEvent === "function"
      ? message.getIsEvent()
      : Boolean(objectPayload.isEvent || objectPayload.is_event);
  const dataEntries =
    typeof message.getDataList === "function" ? message.getDataList() : objectPayload.dataList || objectPayload.data || [];
  const dataTemplateEntries =
    typeof message.getDataTemplateList === "function"
      ? message.getDataTemplateList()
      : objectPayload.dataTemplateList || objectPayload.data_template || [];
  const variableEntries =
    typeof message.getVariablesList === "function"
      ? message.getVariablesList()
      : objectPayload.variablesList || objectPayload.variables || [];

  return {
    service,
    isEvent,
    data: homeAssistantMapToObject(dataEntries),
    dataTemplate: homeAssistantMapToObject(dataTemplateEntries),
    variables: homeAssistantMapToObject(variableEntries),
    raw: objectPayload,
  };
}

function summarizeHomeAssistantService(message) {
  const payload = getHomeAssistantServicePayload(message);
  const values = [
    ...Object.entries(payload.data),
    ...Object.entries(payload.dataTemplate),
    ...Object.entries(payload.variables),
  ]
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  const type = payload.isEvent ? "HA event" : "HA service";
  const service = payload.service || "unknown";

  if (values) {
    return `${type} ${service}: ${values}`;
  }

  return `${type} ${service}: ${JSON.stringify(payload.raw)}`;
}

function parseTagIdFromHomeAssistantService(message) {
  const payload = getHomeAssistantServicePayload(message);
  return parseTagIdFromEspHomeLog(JSON.stringify(payload));
}

async function recordEspHomeTag(settings, tagId) {
  const now = Date.now();
  const recentKey = `${settings.reader_id}:${tagId}`;
  const lastSeen = espHomeBridge.recentTags.get(recentKey) || 0;

  if (now - lastSeen < ESPHOME_SCAN_DEBOUNCE_MS) {
    return;
  }

  espHomeBridge.recentTags.set(recentKey, now);
  espHomeBridge.lastTagId = tagId;
  espHomeBridge.lastScanAt = new Date().toISOString();

  try {
    await createScan({
      readerId: settings.reader_id,
      tagId,
      source: "esphome",
    });
  } catch (error) {
    espHomeBridge.status = "error";
    espHomeBridge.lastError = error.message;
  }
}

function getEspHomeBridgeStatus() {
  const { connection, recentTags, ...status } = espHomeBridge;
  return status;
}

function stopEspHomeBridge() {
  if (espHomeBridge.connection) {
    try {
      espHomeBridge.connection.disconnect();
    } catch {
      // Ignore disconnect errors from already-closed ESPHome sockets.
    }
  }

  espHomeBridge.connection = null;
  espHomeBridge.status = "disabled";
}

function restartEspHomeBridge(reason = "manual reconnect") {
  const settings = getEspHomeSettings();

  if (!settings.enabled) {
    stopEspHomeBridge();
    espHomeBridge.lastReconnectReason = `${reason}; bridge disabled`;
    return;
  }

  espHomeBridge.reconnectCount += 1;
  espHomeBridge.lastReconnectAt = new Date().toISOString();
  espHomeBridge.lastReconnectReason = reason;
  startEspHomeBridge(settings);
  rememberEspHomeLog(`Reader bridge reconnect requested: ${reason}`);
}

function shouldThrottleEspHomeReconnect() {
  const lastReconnectTime = Date.parse(espHomeBridge.lastReconnectAt || "");
  return !Number.isNaN(lastReconnectTime) && Date.now() - lastReconnectTime < ESPHOME_RECONNECT_BACKOFF_MS;
}

function checkEspHomeBridgeWatchdog() {
  const settings = getEspHomeSettings();

  if (!settings.enabled) {
    if (espHomeBridge.status !== "disabled") {
      stopEspHomeBridge();
    }
    return;
  }

  if (shouldThrottleEspHomeReconnect()) {
    return;
  }

  const startedAt = Date.parse(espHomeBridge.startedAt || "");
  const ageMs = Number.isNaN(startedAt) ? 0 : Date.now() - startedAt;

  if (espHomeBridge.status === "disabled") {
    restartEspHomeBridge("watchdog: bridge enabled but disabled");
    return;
  }

  if (espHomeBridge.status === "disconnected" || espHomeBridge.status === "error") {
    restartEspHomeBridge(`watchdog: bridge status ${espHomeBridge.status}`);
    return;
  }

  if (espHomeBridge.status === "connecting" && ageMs > ESPHOME_CONNECTING_TIMEOUT_MS) {
    restartEspHomeBridge("watchdog: connection attempt timed out");
    return;
  }

  if (espHomeBridge.status === "connected" && ageMs > ESPHOME_CONNECTED_REFRESH_MS) {
    restartEspHomeBridge("watchdog: scheduled connection refresh");
  }
}

function startEspHomeWatchdog() {
  if (espHomeWatchdogTimer) {
    return;
  }

  espHomeBridge.watchdogStartedAt = new Date().toISOString();
  espHomeWatchdogTimer = setInterval(checkEspHomeBridgeWatchdog, ESPHOME_WATCHDOG_INTERVAL_MS);
  if (typeof espHomeWatchdogTimer.unref === "function") {
    espHomeWatchdogTimer.unref();
  }
}

function stopEspHomeWatchdog() {
  if (!espHomeWatchdogTimer) {
    return;
  }

  clearInterval(espHomeWatchdogTimer);
  espHomeWatchdogTimer = null;
}

async function muteEspHomeBuzzer(connection) {
  try {
    connection.switchCommandService({
      key: TAGREADER_BUZZER_SWITCH_KEY,
      state: false,
    });
    rememberEspHomeLog("Sent TagReader Buzzer Enabled = OFF");
  } catch (error) {
    rememberEspHomeLog(`Could not mute TagReader buzzer: ${error.message}`);
  }
}

function startEspHomeBridge(settings = getEspHomeSettings()) {
  stopEspHomeBridge();

  if (!settings.enabled) {
    espHomeBridge.status = "disabled";
    return;
  }

  const connection = new EspHomeConnection({
    host: settings.host,
    port: 6053,
    reconnect: true,
    clientInfo: APP_SERVICE_ID,
  });

  espHomeBridge.connection = connection;
  espHomeBridge.status = "connecting";
  espHomeBridge.lastError = "";
  espHomeBridge.lastLog = "";
  espHomeBridge.lastTagId = "";
  espHomeBridge.lastScanAt = "";
  espHomeBridge.logHistory = [];
  espHomeBridge.startedAt = new Date().toISOString();

  connection.on("authorized", async () => {
    espHomeBridge.status = "connected";
    espHomeBridge.lastError = "";
    try {
      await muteEspHomeBuzzer(connection);
      await connection.subscribeLogsService(4, false);
      connection.sendMessage(new EspHomePb.SubscribeHomeassistantServicesRequest());
    } catch (error) {
      espHomeBridge.status = "error";
      espHomeBridge.lastError = error.message;
    }
  });

  connection.on("message.SubscribeLogsResponse", async (log) => {
    const logMessage = `${log.tag || ""} ${log.message || ""}`.trim();
    rememberEspHomeLog(logMessage);
    const tagId = parseTagIdFromEspHomeLog(logMessage);

    if (!tagId) {
      return;
    }

    await recordEspHomeTag(settings, tagId);
  });

  connection.on("message.HomeassistantServiceResponse", async (service) => {
    rememberEspHomeLog(summarizeHomeAssistantService(service));
    const tagId = parseTagIdFromHomeAssistantService(service);

    if (tagId) {
      await recordEspHomeTag(settings, tagId);
    }
  });

  connection.on("socketDisconnected", () => {
    if (espHomeBridge.connection === connection && espHomeBridge.status !== "disabled") {
      espHomeBridge.status = "disconnected";
    }
  });

  connection.on("error", (error) => {
    if (espHomeBridge.connection === connection) {
      espHomeBridge.status = "error";
      espHomeBridge.lastError = error.message;
    }
  });

  connection.connect();
}

function sonosCommandForAction(action) {
  if (action.type === "stop" || action.type === "sonos_stop" || action.type === "stop_all") {
    return "Stop";
  }

  if (action.type === "sonos_play") {
    return "Play";
  }

  return null;
}

async function sendSonosTransportCommand(host, command) {
  const bodyContent = `
      <InstanceID>0</InstanceID>
      ${command === "Play" ? "<Speed>1</Speed>" : ""}`;
  const result = await sendSonosSoapCommand(host, command, bodyContent);
  return { ...result, command };
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function getSonosControlUrl(host) {
  const controlHost = host.includes(":") ? host : `${host}:1400`;
  return `http://${controlHost}/MediaRenderer/AVTransport/Control`;
}

async function sendSonosSoapCommand(host, action, bodyContent) {
  const controlUrl = getSonosControlUrl(host);
  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      ${bodyContent}
    </u:${action}>
  </s:Body>
</s:Envelope>`;

  let response;

  try {
    response = await fetch(controlUrl, {
      method: "POST",
      headers: {
        "content-type": 'text/xml; charset="utf-8"',
        soapaction: `"urn:schemas-upnp-org:service:AVTransport:1#${action}"`,
      },
      body: soapBody,
      signal: AbortSignal.timeout(4500),
    });
  } catch (error) {
    const detail = error.cause?.code || error.cause?.message || error.message;
    throw new Error(`Sonos ${action} could not reach ${controlUrl}: ${detail}`);
  }

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Sonos ${action} failed with HTTP ${response.status}: ${responseText.slice(0, 160)}`);
  }

  return {
    command: action,
    status_code: response.status,
  };
}

function normalizeMediaUrl(value) {
  const mediaUrl = typeof value === "string" ? value.trim() : "";

  if (!mediaUrl) {
    return "";
  }

  try {
    const url = new URL(mediaUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

async function sendSonosPlayUrl(host, mediaUrl) {
  const normalizedUrl = normalizeMediaUrl(mediaUrl);

  if (!normalizedUrl) {
    throw new Error("Sonos URL playback needs an http or https media URL");
  }

  await sendSonosSoapCommand(
    host,
    "SetAVTransportURI",
    `
      <InstanceID>0</InstanceID>
      <CurrentURI>${escapeXml(normalizedUrl)}</CurrentURI>
      <CurrentURIMetaData></CurrentURIMetaData>`,
  );
  await sendSonosTransportCommand(host, "Play");

  return {
    command: "SetAVTransportURI+Play",
    status_code: 200,
    media_url: normalizedUrl,
  };
}

async function createScan(scan) {
  const scannedAt = new Date().toISOString();
  const result = insertScan.run(scan.readerId, scan.tagId, scan.source, scannedAt);
  const scanId = Number(result.lastInsertRowid);
  const card = getCard(scan.tagId);
  const receiver = getReceiver(scan.readerId);
  const pendingAssignment = maybeAssignPendingMediaToScan(scanId, scan, card);

  if (pendingAssignment) {
    return {
      id: scanId,
      reader_id: scan.readerId,
      tag_id: scan.tagId,
      source: scan.source,
      scanned_at: scannedAt,
      known: Boolean(pendingAssignment.card),
      card: pendingAssignment.card,
      receiver,
      action_event: pendingAssignment.actionEvent,
    };
  }

  const actionEvent = await maybeCreateActionEvent(scanId, scan, card, receiver);

  return {
    id: scanId,
    reader_id: scan.readerId,
    tag_id: scan.tagId,
    source: scan.source,
    scanned_at: scannedAt,
    known: Boolean(card),
    card,
    receiver,
    action_event: actionEvent,
  };
}

function upsertCard(card) {
  const now = new Date().toISOString();
  upsertCardStatement.run(card.tagId, card.name, card.notes, now, now);
  return getCard(card.tagId);
}

function getCard(tagId) {
  const card = selectCardByTag.get(normalizeTagId(tagId));
  return card ? shapeCard(card) : null;
}

function getCards(limit = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  return selectCards.all(safeLimit).map(shapeCard);
}

function getAction(tagId) {
  const action = selectActionByTag.get(normalizeTagId(tagId));
  return action ? shapeAction(action) : null;
}

function upsertAction(action) {
  if (!getCard(action.tagId)) {
    return { error: "Cannot assign an action before the card exists" };
  }

  const now = new Date().toISOString();
  upsertActionStatement.run(
    action.tagId,
    action.actionType,
    action.actionTarget,
    action.enabled ? 1 : 0,
    now,
    now,
  );
  return getAction(action.tagId);
}

async function maybeCreateActionEvent(scanId, scan, card, receiver) {
  const actionCard = card || getReaderTestActionCard(scan);

  if (!actionCard || !actionCard.action.enabled || actionCard.action.type === "none") {
    return null;
  }

  const createdAt = new Date().toISOString();
  const sonosCommand = sonosCommandForAction(actionCard.action);
  let eventActionType = actionCard.action.type;
  let eventActionTarget = actionCard.action.target;
  let status = "would_run";
  let message = actionCard.test_action ? `Reader test action would run ${actionCard.action.type}` : `Would run ${actionCard.action.type}`;

  if (actionCard.action.type === "spotify_pause") {
    try {
      const result = await sendSpotifyPause();
      clearSpotifyActivePlayback();
      status = "sent";
      message = result.device_id
        ? `Paused Spotify playback on default device`
        : "Paused Spotify playback";
    } catch (error) {
      status = "failed";
      message = error.message;
    }

    if (actionCard.test_action) {
      message = `Reader test action: ${message}`;
    }
  }

  if (actionCard.action.type === "spotify_play") {
    try {
      const uri = normalizeSpotifyUri(actionCard.action.target);
      const shouldPause =
        !actionCard.test_action &&
        uri &&
        (await shouldPauseActiveSpotifyCard(scan, uri));

      if (shouldPause) {
        const result = await sendSpotifyPause();
        clearSpotifyActivePlayback();
        eventActionType = "spotify_pause";
        status = "sent";
        message = result.device_id
          ? `Paused Spotify playback for ${uri} after second scan`
          : `Paused Spotify playback for ${uri} after second scan`;
      } else {
        const result = await sendSpotifyPlay(actionCard.action.target);
        setSpotifyActivePlayback(scan.tagId, result.uri, result.device_id);
        status = "sent";
        message =
          result.start_volume_percent === ""
            ? `Verified Spotify playback from beginning for ${result.uri}`
            : `Set Spotify volume to ${result.start_volume_percent}% and verified ${result.uri} from beginning`;

        if (result.retry_count > 0) {
          message += ` after ${result.retry_count} retry`;
        }
      }
    } catch (error) {
      status = "failed";
      message = error.message;
    }

    if (actionCard.test_action) {
      message = `Reader test action: ${message}`;
    }
  }

  if (actionCard.action.type === "sonos_play_url") {
    const settings = getSonosSettings();
    const mediaUrl = normalizeMediaUrl(actionCard.action.target);
    const resolvedTarget = resolveSonosTarget("__receiver_default__", receiver);
    const targetHost = resolvedTarget.host;
    const targetDevice = targetHost ? getSonosDeviceByHost(targetHost) : null;

    if (!mediaUrl) {
      status = "failed";
      message = "Sonos URL playback needs an http or https media URL";
    } else if (!settings.enabled) {
      message = `Sonos disabled; would play URL on receiver default: ${mediaUrl}`;
    } else if (!targetHost) {
      status = "failed";
      message = "Sonos URL playback not sent because this receiver has no default speaker";
    } else if (!targetDevice) {
      status = "failed";
      message = `Sonos URL playback not sent because ${targetHost} is not in the device list`;
    } else if (!targetDevice.enabled) {
      status = "failed";
      message = `Sonos URL playback not sent because ${targetDevice.name} is disabled`;
    } else {
      try {
        await sendSonosPlayUrl(targetDevice.host, mediaUrl);
        status = "sent";
        message = `Sent Sonos URL playback to ${targetDevice.name} via receiver default`;
      } catch (error) {
        status = "failed";
        message = error.message;
      }
    }

    if (actionCard.test_action) {
      message = `Reader test action: ${message}`;
    }
  }

  if (sonosCommand) {
    const settings = getSonosSettings();
    const resolvedTarget = resolveSonosTarget(actionCard.action.target, receiver);
    const targetHost = resolvedTarget.host;
    const targetDevice = targetHost ? getSonosDeviceByHost(targetHost) : null;

    if (!settings.enabled) {
      message =
        resolvedTarget.source === "receiver_default"
          ? `Sonos disabled; would send ${sonosCommand} to receiver default`
          : `Sonos disabled; would send ${sonosCommand}`;
      if (actionCard.test_action) {
        message = `Reader test action: ${message}`;
      }
      if (actionCard.action.type === "stop_all") {
        message += "; Spotify pause is not configured yet";
      }
    } else if (!targetHost) {
      status = "failed";
      message =
        resolvedTarget.source === "receiver_default"
          ? `Sonos ${sonosCommand} not sent because this receiver has no default speaker`
          : `Sonos ${sonosCommand} not sent because this action has no target speaker`;
      if (actionCard.test_action) {
        message = `Reader test action: ${message}`;
      }
      if (actionCard.action.type === "stop_all") {
        message += "; Spotify pause is not configured yet";
      }
    } else if (!targetDevice) {
      status = "failed";
      message = `Sonos ${sonosCommand} not sent because ${targetHost} is not in the device list`;
      if (actionCard.test_action) {
        message = `Reader test action: ${message}`;
      }
      if (actionCard.action.type === "stop_all") {
        message += "; Spotify pause is not configured yet";
      }
    } else if (!targetDevice.enabled) {
      status = "failed";
      message = `Sonos ${sonosCommand} not sent because ${targetDevice.name} is disabled`;
      if (actionCard.test_action) {
        message = `Reader test action: ${message}`;
      }
      if (actionCard.action.type === "stop_all") {
        message += "; Spotify pause is not configured yet";
      }
    } else {
      try {
        await sendSonosTransportCommand(targetDevice.host, sonosCommand);
        status = actionCard.action.type === "stop_all" ? "partial" : "sent";
        message =
          resolvedTarget.source === "receiver_default"
            ? `Sent Sonos ${sonosCommand} to ${targetDevice.name} via receiver default`
            : `Sent Sonos ${sonosCommand} to ${targetDevice.name}`;
        if (actionCard.test_action) {
          message = `Reader test action: ${message}`;
        }
        if (actionCard.action.type === "stop_all") {
          message += "; Spotify pause is not configured yet";
        }
      } catch (error) {
        status = "failed";
        message = error.message;
        if (actionCard.test_action) {
          message = `Reader test action: ${message}`;
        }
        if (actionCard.action.type === "stop_all") {
          message += "; Spotify pause is not configured yet";
        }
      }
    }
  }

  const result = insertActionEvent.run(
    scanId,
    scan.tagId,
    eventActionType,
    eventActionTarget,
    status,
    message,
    createdAt,
  );

  return {
    id: Number(result.lastInsertRowid),
    scan_id: scanId,
    tag_id: scan.tagId,
    action_type: eventActionType,
    action_target: eventActionTarget,
    status,
    message,
    created_at: createdAt,
  };
}

function getReaderTestActionCard(scan) {
  if (scan.source !== "esphome") {
    return null;
  }

  const settings = getReaderTestActionSettings();

  if (!settings.enabled || settings.reader_id !== scan.readerId) {
    return null;
  }

  return {
    test_action: true,
    name: "Reader test action",
    action: settings.action,
  };
}

function shapeAction(row) {
  return {
    id: row.id,
    tag_id: row.tag_id,
    type: row.action_type,
    target: row.action_target,
    enabled: Boolean(row.enabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function shapeMediaItem(row) {
  const assignedCardNames = row.assigned_card_names ? row.assigned_card_names.split(", ") : [];
  const assignedTagIds = row.assigned_tag_ids ? row.assigned_tag_ids.split(", ") : [];

  return {
    id: row.id,
    provider: row.provider,
    media_type: row.media_type,
    provider_uri: row.provider_uri,
    source_url: row.source_url,
    title: row.title,
    subtitle: row.subtitle,
    artist_names: row.artist_names,
    show_name: row.show_name,
    album_name: row.album_name,
    artwork_url: row.artwork_url,
    local_artwork_path: row.local_artwork_path,
    duration_ms: row.duration_ms,
    print_status: row.print_status,
    playlist_status: row.playlist_status || "active",
    imported_from_provider_uri: row.imported_from_provider_uri || "",
    imported_from_title: row.imported_from_title || "",
    imported_at: row.imported_at || "",
    assigned_card_count: Number(row.assigned_card_count) || 0,
    assigned_card_names: assignedCardNames,
    assigned_tag_ids: assignedTagIds,
    assignment_status: Number(row.assigned_card_count) > 0 ? "assigned" : "unassigned",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const PRINT_STATUSES = new Set(["not_printed", "queued", "pdf_generated", "printed"]);
const PRINT_STATUS_LABELS = {
  not_printed: "Not printed",
  queued: "Queued",
  pdf_generated: "PDF generated",
  printed: "Printed",
};

function normalizePrintStatus(value) {
  const status = String(value || "").trim();
  return PRINT_STATUSES.has(status) ? status : "";
}

function updateMediaItemPrintStatus(mediaItemId, printStatus) {
  const id = Number(mediaItemId);
  const status = normalizePrintStatus(printStatus);

  if (!Number.isInteger(id) || id < 1) {
    return { error: "media_item_id is required" };
  }

  if (!status) {
    return { error: "print_status is invalid" };
  }

  if (!getMediaItemById(id)) {
    return { error: "media item not found" };
  }

  updateMediaItemPrintStatusStatement.run(status, new Date().toISOString(), id);
  return { ok: true, media_item: shapeMediaItem(selectMediaItems.all(500).find((item) => item.id === id) || getMediaItemById(id)) };
}

function renderPrintStatusOptions(selectedStatus) {
  return Array.from(PRINT_STATUSES)
    .map((status) => {
      const selected = status === selectedStatus ? " selected" : "";
      return `<option value="${escapeHtml(status)}"${selected}>${escapeHtml(PRINT_STATUS_LABELS[status] || status)}</option>`;
    })
    .join("");
}

function getMediaItems(limit = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  return selectMediaItems.all(safeLimit).map(shapeMediaItem);
}

async function cacheMissingSpotifyArtwork(limit = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const items = selectMediaItemsMissingArtwork.all(safeLimit);
  let cachedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const failures = [];

  for (const item of items) {
    try {
      const result = await cacheSpotifyArtworkForMediaItem(item);

      if (result.ok && result.local_artwork_path) {
        updateMediaItemArtworkStatement.run(result.local_artwork_path, new Date().toISOString(), item.id);
        cachedCount += result.skipped ? 0 : 1;
        skippedCount += result.skipped ? 1 : 0;
      } else {
        skippedCount += 1;
      }
    } catch (error) {
      failedCount += 1;
      failures.push({
        id: item.id,
        title: item.title,
        error: error.message,
      });
    }
  }

  return {
    checked_count: items.length,
    cached_count: cachedCount,
    skipped_count: skippedCount,
    failed_count: failedCount,
    failures,
  };
}

function shapeCard(row) {
  return {
    id: row.id,
    tag_id: row.tag_id,
    name: row.name,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    action: {
      type: row.action_type || "none",
      target: row.action_target || "",
      enabled: Boolean(row.action_enabled),
    },
  };
}

function shapeActionEvent(row) {
  return {
    id: row.id,
    scan_id: row.scan_id,
    tag_id: row.tag_id,
    action_type: row.action_type,
    action_target: row.action_target,
    status: row.status,
    message: row.message,
    created_at: row.created_at,
  };
}

function getActionEvents(limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 200);
  return selectActionEvents.all(safeLimit).map(shapeActionEvent);
}

function shapeScan(row) {
  const card = row.card_id
    ? {
        id: row.card_id,
        tag_id: row.tag_id,
        name: row.card_name,
        notes: row.card_notes,
        action: {
          type: row.configured_action_type || "none",
          target: row.configured_action_target || "",
          enabled: Boolean(row.configured_action_enabled),
        },
      }
    : null;

  const actionEvent = row.action_event_id
    ? {
        id: row.action_event_id,
        scan_id: row.id,
        tag_id: row.tag_id,
        action_type: row.action_event_type,
        action_target: row.action_event_target,
        status: row.action_event_status,
        message: row.action_event_message,
        created_at: row.action_event_created_at,
      }
    : null;

  const receiver = row.receiver_id
    ? {
        id: row.receiver_id,
        reader_id: row.reader_id,
        name: row.receiver_name,
        child_name: row.receiver_child_name,
        default_sonos_host: row.receiver_default_sonos_host,
        spotify_account_label: row.receiver_spotify_account_label,
        enabled: Boolean(row.receiver_enabled),
      }
    : null;

  return {
    id: row.id,
    reader_id: row.reader_id,
    tag_id: row.tag_id,
    source: row.source,
    scanned_at: row.scanned_at,
    known: Boolean(row.card_id),
    card,
    receiver,
    action_event: actionEvent,
  };
}

function getRecentScans(limit = 50) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
  return selectScans.all(safeLimit).map(shapeScan);
}

function renderCardForm(scan) {
  const cardName = scan.card ? scan.card.name : "";
  const cardNotes = scan.card ? scan.card.notes : "";
  const buttonLabel = scan.known ? "Update" : "Assign";

  return `
    <form class="assign-form" method="post" action="/cards">
      <input type="hidden" name="tag_id" value="${escapeHtml(scan.tag_id)}">
      <label>
        <span>Name</span>
        <input name="name" value="${escapeHtml(cardName)}" placeholder="Card name" required maxlength="160">
      </label>
      <label>
        <span>Notes</span>
        <input name="notes" value="${escapeHtml(cardNotes)}" placeholder="Optional" maxlength="500">
      </label>
      <button type="submit">${buttonLabel}</button>
    </form>
  `;
}

function renderActionSummary(scan) {
  if (scan.action_event) {
    return `
      <span class="action-status">${escapeHtml(scan.action_event.status)}</span>
      <span class="small-text">${escapeHtml(scan.action_event.action_type)}</span>
    `;
  }

  if (!scan.known) {
    return `<span class="muted small-text">No action for unknown tags</span>`;
  }

  if (scan.card.action.enabled && scan.card.action.type !== "none") {
    return `<span class="muted small-text">Ready: ${escapeHtml(scan.card.action.type)}</span>`;
  }

  return `<span class="muted small-text">No action configured</span>`;
}

function renderActionTypeOptions(selectedType) {
  const options = [
    ["none", "None"],
    ["pretend_play", "Pretend play"],
    ["stop", "Stop"],
    ["sleep_timer", "Sleep timer"],
    ["sonos_play", "Sonos play"],
    ["sonos_play_url", "Sonos play URL"],
    ["sonos_stop", "Sonos stop"],
    ["spotify_play", "Spotify play"],
    ["spotify_pause", "Spotify pause"],
    ["stop_all", "Stop all"],
  ];

  return options
    .map(([value, label]) => {
      const selected = value === selectedType ? " selected" : "";
      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function renderSonosDeviceOptions(devices, selectedHost) {
  const options = [
    `<option value="">Choose speaker</option>`,
    `<option value="__receiver_default__"${selectedHost === "__receiver_default__" ? " selected" : ""}>Receiver default speaker</option>`,
  ]
    .concat(
      devices.map((device) => {
        const selected = device.host === selectedHost ? " selected" : "";
        const disabled = device.enabled ? "" : " disabled";
        return `<option value="${escapeHtml(device.host)}"${selected}${disabled}>${escapeHtml(device.name)} (${escapeHtml(device.host)})</option>`;
      }),
    );

  return options.join("");
}

function renderReceiverOptions(receivers, selectedReaderId = "") {
  const options = [`<option value="">UI test receiver</option>`].concat(
    receivers.map((receiver) => {
      const selected = receiver.reader_id === selectedReaderId ? " selected" : "";
      const disabled = receiver.enabled ? "" : " disabled";
      return `<option value="${escapeHtml(receiver.reader_id)}"${selected}${disabled}>${escapeHtml(receiver.name)} (${escapeHtml(receiver.reader_id)})</option>`;
    }),
  );

  return options.join("");
}

function renderActionForm(card, sonosDevices) {
  const checked = card.action.enabled ? " checked" : "";
  const usesSonosTarget = card.action.type === "sonos_play" || card.action.type === "sonos_stop" || card.action.type === "stop_all";
  const sonosSelectedHost = usesSonosTarget ? card.action.target : "";
  const actionTarget = usesSonosTarget ? "" : card.action.target;

  return `
    <form class="action-form" method="post" action="/actions">
      <input type="hidden" name="tag_id" value="${escapeHtml(card.tag_id)}">
      <label>
        <span>Action</span>
        <select name="action_type">${renderActionTypeOptions(card.action.type)}</select>
      </label>
      <label>
        <span>Details</span>
        <input name="action_target" value="${escapeHtml(actionTarget)}" placeholder="Frozen soundtrack, 20 minutes" maxlength="500">
      </label>
      <label>
        <span>Sonos device</span>
        <select name="sonos_target_host">${renderSonosDeviceOptions(sonosDevices, sonosSelectedHost)}</select>
      </label>
      <label class="toggle-label">
        <input type="hidden" name="enabled" value="0">
        <input type="checkbox" name="enabled" value="1"${checked}>
        <span>Enabled</span>
      </label>
      <button type="submit">Save</button>
    </form>
  `;
}

function renderKnownCards(cards, sonosDevices, receivers) {
  if (!cards.length) {
    return `<div class="empty">No known cards yet.</div>`;
  }

  const rows = cards
    .map(
      (card) => {
        const searchText = [
          card.name,
          card.tag_id,
          card.notes,
          card.action.type,
          card.action.target,
          card.action.enabled ? "enabled" : "disabled",
        ].join(" ");

        return `
        <tr data-filter-row data-search="${escapeHtml(searchText.toLowerCase())}">
          <td>
            <strong>${escapeHtml(card.name)}</strong>
            <span class="small-text"><code>${escapeHtml(card.tag_id)}</code></span>
          </td>
          <td>${escapeHtml(card.notes) || `<span class="muted">No notes</span>`}</td>
          <td>${renderActionForm(card, sonosDevices)}</td>
          <td>
            <form class="test-scan-form" method="post" action="/test-scan">
              <input type="hidden" name="tag_id" value="${escapeHtml(card.tag_id)}">
              <select name="reader_id">${renderReceiverOptions(receivers)}</select>
              <button type="submit">Test Scan</button>
            </form>
          </td>
        </tr>
      `;
      },
    )
    .join("");

  return `
    <div class="section-tools">
      <label>
        <span>Search cards</span>
        <input type="search" placeholder="Card, tag, action" data-filter-input="cards-table">
      </label>
    </div>
    <div class="table-wrap">
      <table class="cards-table" id="cards-table">
        <thead>
          <tr>
            <th>Card</th>
            <th>Notes</th>
            <th>Fake action</th>
            <th>Test</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderMediaLibrary(mediaItems, pendingAssignment = null) {
  if (!mediaItems.length) {
    return `<div class="empty">No media items yet. Spotify card actions will appear here after the app syncs them.</div>`;
  }

  const cards = mediaItems
    .map(
      (item) => {
        const artworkUrl = localArtworkUrl(item.local_artwork_path);
        const searchText = [
          item.title,
          item.subtitle,
          item.provider,
          item.media_type,
          item.provider_uri,
          item.assignment_status,
          item.print_status,
          item.playlist_status,
          item.assigned_card_names.join(" "),
          pendingAssignment && pendingAssignment.media_item_id === item.id ? "pending" : "",
        ].join(" ");
        const isPending = pendingAssignment && pendingAssignment.media_item_id === item.id;
        const canAssign = item.assignment_status === "unassigned" && item.provider === "spotify";
        const printLabel = PRINT_STATUS_LABELS[item.print_status] || item.print_status;
        const assignmentLabel = item.assignment_status === "assigned" ? "Assigned" : "Unassigned";
        const assignmentStatusClass = item.assignment_status === "assigned" ? "assigned" : "unassigned";
        const printStatusClass = item.print_status.replace(/[^a-z0-9_-]/gi, "-");
        const playlistStatus = item.playlist_status === "removed_from_playlist" ? "removed" : "in playlist";
        const artworkState = item.local_artwork_path ? "Artwork cached" : "No local artwork";
        const artistOrShow = item.artist_names || item.show_name || item.subtitle || item.album_name || "Unknown";
        const assignmentControl = isPending
          ? `
              <form class="inline-form" method="post" action="/media/assign-next/cancel">
                <span class="action-status status-pending">Waiting for card</span>
                <button type="submit">Cancel</button>
              </form>
            `
          : canAssign
            ? `
                <form class="inline-form" method="post" action="/media/assign-next">
                  <input type="hidden" name="media_item_id" value="${escapeHtml(item.id)}">
                  <button type="submit">Assign next</button>
                </form>
              `
            : "";

        return `
        <article class="media-card" data-filter-row data-search="${escapeHtml(searchText.toLowerCase())}">
          <div class="media-card-art">
              ${
                artworkUrl
                  ? `<img class="media-artwork" src="${escapeHtml(artworkUrl)}" alt="">`
                  : `<div class="media-artwork placeholder"></div>`
              }
          </div>
          <div class="media-card-main">
            <div class="media-card-title-row">
              <dl class="media-card-fields">
                <div>
                  <dt>Track</dt>
                  <dd>${escapeHtml(item.title)}</dd>
                </div>
                <div>
                  <dt>Artist / show</dt>
                  <dd>${escapeHtml(artistOrShow)}</dd>
                </div>
              </dl>
            </div>

            <div class="media-card-meta">
              ${
                item.imported_from_title
                  ? `<span>${escapeHtml(item.imported_from_title)}</span>`
                  : ""
              }
              <span>${escapeHtml(playlistStatus)}</span>
              <span>${escapeHtml(artworkState)}</span>
            </div>

            <div class="media-card-statuses">
              <span class="action-status status-${assignmentStatusClass}">${escapeHtml(assignmentLabel)}</span>
            </div>

            <div class="media-card-actions">
              <div>
                <span class="mini-label">Print</span>
                <div class="print-status-editor">
                  <span class="action-status status-${escapeHtml(printStatusClass)}">${escapeHtml(printLabel)}</span>
                  <button type="button" class="secondary-button" data-toggle-print>Edit</button>
                  <form class="inline-form print-status-form hidden-print-form" method="post" action="/media/print-status">
                    <input type="hidden" name="media_item_id" value="${escapeHtml(item.id)}">
                    <select name="print_status" aria-label="Print status for ${escapeHtml(item.title)}">
                      ${renderPrintStatusOptions(item.print_status)}
                    </select>
                    <button type="submit">Save</button>
                  </form>
                </div>
              </div>
              ${
                assignmentControl
                  ? `<div>
                      <span class="mini-label">Assignment</span>
                      ${assignmentControl}
                    </div>`
                  : ""
              }
            </div>
          </div>
        </article>
      `;
      },
    )
    .join("");

  return `
    <div class="section-tools">
      <label>
        <span>Search media</span>
        <input type="search" placeholder="Title, show, card, status" data-filter-input="media-table">
      </label>
    </div>
    <div class="media-card-grid" id="media-table">
      ${cards}
    </div>
  `;
}

function getLastSpotifyPlaylistImport() {
  const raw = getSetting("spotify_last_playlist_import", "");

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveLastSpotifyPlaylistImport(result) {
  setSetting("spotify_last_playlist_import", JSON.stringify({
    ...result,
    imported_at: new Date().toISOString(),
  }));
}

function getLastArtworkCacheResult() {
  const raw = getSetting("spotify_last_artwork_cache", "");

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveLastArtworkCacheResult(result) {
  setSetting("spotify_last_artwork_cache", JSON.stringify({
    ...result,
    cached_at: new Date().toISOString(),
  }));
}

function renderSpotifyPlaylistList(playlists) {
  if (!playlists.length) {
    return `<div class="empty">No saved Spotify playlists yet. Import one playlist URL to save it here.</div>`;
  }

  const rows = playlists
    .map(
      (playlist) => `
        <tr>
          <td>
            <strong>${escapeHtml(playlist.name)}</strong>
            <span class="small-text">${escapeHtml(playlist.provider_uri)}</span>
            ${playlist.source_url ? `<a class="small-text" href="${escapeHtml(playlist.source_url)}">Open in Spotify</a>` : ""}
          </td>
          <td>
            <span class="action-status">${escapeHtml(String(playlist.last_imported_count))} saved</span>
            <span class="small-text">${escapeHtml(String(playlist.last_skipped_count))} skipped</span>
            <span class="small-text">${escapeHtml(String(playlist.last_total_count))} total</span>
          </td>
          <td>
            <span class="small-text">${playlist.last_imported_at ? escapeHtml(formatScanTime(playlist.last_imported_at)) : "Never"}</span>
          </td>
          <td>
            <form class="inline-form" method="post" action="/playlists/import">
              <input type="hidden" name="playlist_url" value="${escapeHtml(playlist.provider_uri)}">
              <button type="submit">Refresh</button>
            </form>
          </td>
        </tr>
      `,
    )
    .join("");

  return `
    <div class="table-wrap compact-table-wrap">
      <table class="media-table">
        <thead>
          <tr>
            <th>Playlist</th>
            <th>Last sync</th>
            <th>Updated</th>
            <th>Refresh</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderSpotifyPlaylistImport(status) {
  const modeClass = status.authorized ? "armed" : "safe";
  const modeText = !status.configured ? "Needs app credentials" : status.authorized ? "Ready" : "Needs Spotify login";
  const loginLink = status.configured ? `<a class="button-link" href="/spotify/login">Connect Spotify</a>` : "";
  const lastImport = getLastSpotifyPlaylistImport();
  const lastPlaylistName = lastImport && lastImport.playlist && lastImport.playlist.name ? lastImport.playlist.name : "Spotify playlist";
  const lastArtworkCache = getLastArtworkCacheResult();
  const accountLabel = status.account.display_name || status.account.id || "";
  const refreshAccountForm = status.authorized
    ? `<form class="inline-form" method="post" action="/spotify/refresh-account"><button type="submit">Refresh Account</button></form>`
    : "";
  const playlists = getSpotifyPlaylists();

  return `
    <div class="import-panel">
      <div class="spotify-summary-grid">
        <div class="spotify-summary-item">
          <span>Import status</span>
          <strong><span class="sonos-mode ${modeClass}">${escapeHtml(modeText)}</span></strong>
        </div>
        <div class="spotify-summary-item">
          <span>Connected account</span>
          <strong>${accountLabel ? `<code>${escapeHtml(accountLabel)}</code>` : `<span class="muted">unknown</span>`}</strong>
        </div>
        <div class="spotify-summary-item">
          <span>Required scope</span>
          <strong><code>playlist-read-private</code></strong>
        </div>
        <div class="spotify-summary-item wide">
          <span>Last import</span>
          <strong>${
            lastImport
              ? `${escapeHtml(lastImport.imported_count)} saved, ${escapeHtml(lastImport.skipped_count)} skipped from ${escapeHtml(lastPlaylistName)}`
              : `<span class="muted">No playlist imported yet</span>`
          }</strong>
          ${
            lastImport
              ? `<small>${escapeHtml(formatScanTime(lastImport.imported_at))}</small>`
              : ""
          }
        </div>
        <div class="spotify-summary-item wide">
          <span>Artwork cache</span>
          <strong>${
            lastArtworkCache
              ? `${escapeHtml(lastArtworkCache.cached_count)} saved, ${escapeHtml(lastArtworkCache.failed_count)} failed`
              : `<span class="muted">No artwork cache run yet</span>`
          }</strong>
          ${
            lastArtworkCache
              ? `<small>${escapeHtml(formatScanTime(lastArtworkCache.cached_at))}</small>`
              : ""
          }
        </div>
      </div>
      <div class="spotify-actions-row">
        ${refreshAccountForm}
        ${loginLink}
      </div>
      <form class="playlist-import-form" method="post" action="/playlists/import">
        <label>
          <span>Spotify playlist URL</span>
          <input name="playlist_url" placeholder="https://open.spotify.com/playlist/..." maxlength="500" required>
        </label>
        <button type="submit">Save / Refresh Playlist</button>
      </form>
      <div class="saved-playlists">
        <h3>Saved playlists</h3>
        ${renderSpotifyPlaylistList(playlists)}
      </div>
      <form class="inline-form cache-artwork-form" method="post" action="/playlists/cache-artwork">
        <button type="submit">Cache Missing Artwork</button>
      </form>
    </div>
  `;
}

function renderPendingMediaAssignment(pendingAssignment) {
  if (!pendingAssignment) {
    return `
      <div class="pending-assignment empty">
        No pending card assignment. Choose "Assign Next Card" beside an unassigned media item.
      </div>
    `;
  }

  return `
    <div class="pending-assignment active">
      <div>
        <strong>Next unknown card will become ${escapeHtml(pendingAssignment.title)}</strong>
        <span class="small-text">Expires at ${escapeHtml(formatScanTime(pendingAssignment.expires_at))}</span>
        <span class="small-text"><code>${escapeHtml(pendingAssignment.provider_uri)}</code></span>
      </div>
      <form class="inline-form" method="post" action="/media/assign-next/cancel">
        <button type="submit">Cancel</button>
      </form>
    </div>
  `;
}

function renderActionEvents(events) {
  if (!events.length) {
    return `<div class="empty">No action events yet. Scan a known card with an enabled action.</div>`;
  }

  const rows = events
    .map(
      (event) => {
        const searchText = [
          formatScanTime(event.created_at),
          event.tag_id,
          event.action_type,
          event.action_target,
          event.status,
          event.message,
        ].join(" ");

        return `
        <tr data-filter-row data-search="${escapeHtml(searchText.toLowerCase())}">
          <td>${escapeHtml(formatScanTime(event.created_at))}</td>
          <td><code>${escapeHtml(event.tag_id)}</code></td>
          <td>${escapeHtml(event.action_type)}</td>
          <td>${escapeHtml(event.action_target) || `<span class="muted">No target</span>`}</td>
          <td><span class="action-status">${escapeHtml(event.status)}</span></td>
          <td>${escapeHtml(event.message) || `<span class="muted">No message</span>`}</td>
        </tr>
      `;
      },
    )
    .join("");

  return `
    <div class="section-tools">
      <label>
        <span>Search log</span>
        <input type="search" placeholder="Tag, action, status, message" data-filter-input="events-table">
      </label>
    </div>
    <div class="table-wrap">
      <table class="events-table" id="events-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Tag</th>
            <th>Action</th>
            <th>Target</th>
            <th>Status</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderSonosSettings(settings, devices) {
  const checked = settings.enabled ? " checked" : "";
  const statusClass = settings.enabled ? "armed" : "safe";
  const statusText = settings.enabled ? "Real Sonos commands enabled" : "Dry run only";
  const rows = devices.length
    ? devices
        .map(
          (device) => `
            <tr>
              <td colspan="3">
                <form class="sonos-device-row-form" method="post" action="/sonos/devices/update">
                  <input type="hidden" name="id" value="${escapeHtml(device.id)}">
                  <label>
                    <span>Name</span>
                    <input name="name" value="${escapeHtml(device.name)}" maxlength="120" required>
                  </label>
                  <label>
                    <span>Host/IP</span>
                    <input name="host" value="${escapeHtml(device.host)}" maxlength="255" required>
                  </label>
                  <label class="toggle-label">
                    <input type="hidden" name="enabled" value="0">
                    <input type="checkbox" name="enabled" value="1"${device.enabled ? " checked" : ""}>
                    <span>Enabled</span>
                  </label>
                  <button type="submit">Save</button>
                </form>
              </td>
            </tr>
          `,
        )
        .join("")
    : `
      <tr>
        <td colspan="3"><span class="muted">No Sonos devices added yet.</span></td>
      </tr>
    `;

  return `
    <div class="sonos-settings-grid">
      <form class="sonos-toggle-form" method="post" action="/settings/sonos">
        <label class="toggle-label">
          <input type="hidden" name="sonos_enabled" value="0">
          <input type="checkbox" name="sonos_enabled" value="1"${checked}>
          <span>Allow real Sonos commands</span>
        </label>
        <span class="sonos-mode ${statusClass}">${statusText}</span>
        <button type="submit">Save Safety Switch</button>
      </form>

      <form class="sonos-device-form" method="post" action="/sonos/devices">
        <label>
          <span>Name</span>
          <input name="name" placeholder="Living room" maxlength="120" required>
        </label>
        <label>
          <span>Host/IP</span>
          <input name="host" placeholder="192.168.5.40 or speaker.local" maxlength="255" required>
        </label>
        <label class="toggle-label">
          <input type="hidden" name="enabled" value="0">
          <input type="checkbox" name="enabled" value="1" checked>
          <span>Enabled</span>
        </label>
        <button type="submit">Add Device</button>
      </form>
    </div>

    <table class="sonos-devices-table">
      <thead>
        <tr>
          <th colspan="3">Saved devices</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderReceiverSonosOptions(devices, selectedHost) {
  const options = [`<option value="">No default speaker</option>`].concat(
    devices.map((device) => {
      const selected = device.host === selectedHost ? " selected" : "";
      const disabled = device.enabled ? "" : " disabled";
      return `<option value="${escapeHtml(device.host)}"${selected}${disabled}>${escapeHtml(device.name)} (${escapeHtml(device.host)})</option>`;
    }),
  );

  return options.join("");
}

function renderReceivers(receivers, sonosDevices) {
  const rows = receivers.length
    ? receivers
        .map(
          (receiver) => {
            return `
              <tr>
                <td colspan="5">
                  <form class="receiver-row-form" method="post" action="/receivers/update">
                    <input type="hidden" name="id" value="${escapeHtml(receiver.id)}">
                    <label>
                      <span>Receiver name</span>
                      <input name="name" value="${escapeHtml(receiver.name)}" maxlength="120" required>
                    </label>
                    <label>
                      <span>Reader ID</span>
                      <input name="reader_id" value="${escapeHtml(receiver.reader_id)}" maxlength="128" required>
                    </label>
                    <label>
                      <span>Child</span>
                      <input name="child_name" value="${escapeHtml(receiver.child_name)}" maxlength="120">
                    </label>
                    <label>
                      <span>Default speaker</span>
                      <select name="default_sonos_host">${renderReceiverSonosOptions(sonosDevices, receiver.default_sonos_host)}</select>
                    </label>
                    <label>
                      <span>Spotify account</span>
                      <input name="spotify_account_label" value="${escapeHtml(receiver.spotify_account_label)}" maxlength="160">
                    </label>
                    <label class="toggle-label">
                      <input type="hidden" name="enabled" value="0">
                      <input type="checkbox" name="enabled" value="1"${receiver.enabled ? " checked" : ""}>
                      <span>Enabled</span>
                    </label>
                    <button type="submit">Save</button>
                  </form>
                </td>
              </tr>
            `;
          },
        )
        .join("")
    : `
      <tr>
        <td colspan="5"><span class="muted">No receivers added yet.</span></td>
      </tr>
    `;

  return `
    <form class="receiver-form" method="post" action="/receivers">
      <label>
        <span>Receiver name</span>
        <input name="name" placeholder="Eabha receiver" maxlength="120" required>
      </label>
      <label>
        <span>Reader ID</span>
        <input name="reader_id" placeholder="tagreader-c6c6e4" maxlength="128" required>
      </label>
      <label>
        <span>Child</span>
        <input name="child_name" placeholder="Eabha" maxlength="120">
      </label>
      <label>
        <span>Default speaker</span>
        <select name="default_sonos_host">${renderReceiverSonosOptions(sonosDevices, "")}</select>
      </label>
      <label>
        <span>Spotify account</span>
        <input name="spotify_account_label" placeholder="Later" maxlength="160">
      </label>
      <label class="toggle-label">
        <input type="hidden" name="enabled" value="0">
        <input type="checkbox" name="enabled" value="1" checked>
        <span>Enabled</span>
      </label>
      <button type="submit">Add Receiver</button>
    </form>

    <table class="receivers-table">
      <thead>
        <tr>
          <th colspan="5">Saved receivers</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderEspHomeBridge(settings, status) {
  const checked = settings.enabled ? " checked" : "";
  const statusClass = status.status === "connected" ? "armed" : "safe";
  const logRows = Array.isArray(status.logHistory) && status.logHistory.length
    ? status.logHistory
        .slice(0, 8)
        .map(
          (entry) => `
            <li>
              <span>${escapeHtml(formatScanTime(entry.at))}</span>
              <code>${escapeHtml(entry.message)}</code>
            </li>
          `,
        )
        .join("")
    : `<li><span class="muted">No reader logs yet</span></li>`;

  return `
    <form class="esphome-form" method="post" action="/settings/esphome">
      <label>
        <span>Reader host/IP</span>
        <input name="esphome_host" value="${escapeHtml(settings.host)}" placeholder="192.168.5.28" maxlength="255" required>
      </label>
      <label>
        <span>Reader ID</span>
        <input name="reader_id" value="${escapeHtml(settings.reader_id)}" placeholder="tagreader-c6c6e4" maxlength="128" required>
      </label>
      <label class="toggle-label">
        <input type="hidden" name="esphome_enabled" value="0">
        <input type="checkbox" name="esphome_enabled" value="1"${checked}>
        <span>Enable reader bridge</span>
      </label>
      <span class="sonos-mode ${statusClass}">${escapeHtml(status.status)}</span>
      <button type="submit">Save Bridge</button>
    </form>
    <div class="bridge-status">
      <span>Last tag: ${status.lastTagId ? `<code>${escapeHtml(status.lastTagId)}</code>` : `<span class="muted">none</span>`}</span>
      <span>Last scan: ${status.lastScanAt ? escapeHtml(formatScanTime(status.lastScanAt)) : `<span class="muted">none</span>`}</span>
      <span>Last log: ${status.lastLog ? escapeHtml(status.lastLog) : `<span class="muted">none</span>`}</span>
      <span>Reconnects: <code>${escapeHtml(status.reconnectCount || 0)}</code></span>
      <span>Last reconnect: ${status.lastReconnectAt ? escapeHtml(formatScanTime(status.lastReconnectAt)) : `<span class="muted">none</span>`}</span>
      <span>Reconnect reason: ${status.lastReconnectReason ? escapeHtml(status.lastReconnectReason) : `<span class="muted">none</span>`}</span>
      <span>Watchdog: ${status.watchdogStartedAt ? `<code>on</code>` : `<span class="muted">off</span>`}</span>
      ${status.lastError ? `<span class="error-text">Error: ${escapeHtml(status.lastError)}</span>` : ""}
    </div>
    <form class="inline-form" method="post" action="/settings/esphome/reconnect">
      <button type="submit">Reconnect Reader</button>
    </form>
    <ol class="bridge-log-list">${logRows}</ol>
  `;
}

function renderReaderTestAction(settings, sonosDevices) {
  const checked = settings.enabled ? " checked" : "";
  const usesSonosTarget = settings.action.type === "sonos_play" || settings.action.type === "sonos_stop" || settings.action.type === "stop_all";
  const sonosSelectedHost = usesSonosTarget ? settings.action.target : "";
  const actionTarget = usesSonosTarget ? "" : settings.action.target;

  return `
    <form class="reader-test-form" method="post" action="/settings/reader-test-action">
      <label class="toggle-label">
        <input type="hidden" name="reader_test_enabled" value="0">
        <input type="checkbox" name="reader_test_enabled" value="1"${checked}>
        <span>Use unknown ESPHome scans as test trigger</span>
      </label>
      <label>
        <span>Reader ID</span>
        <input name="reader_id" value="${escapeHtml(settings.reader_id)}" placeholder="tagreader-c6c6e4" maxlength="128" required>
      </label>
      <label>
        <span>Action</span>
        <select name="action_type">${renderActionTypeOptions(settings.action.type)}</select>
      </label>
      <label>
        <span>Details</span>
        <input name="action_target" value="${escapeHtml(actionTarget)}" placeholder="Reader test trigger" maxlength="500">
      </label>
      <label>
        <span>Sonos device</span>
        <select name="sonos_target_host">${renderSonosDeviceOptions(sonosDevices, sonosSelectedHost)}</select>
      </label>
      <button type="submit">Save Test Action</button>
    </form>
  `;
}

function renderSpotifySettings(status) {
  const modeClass = status.authorized ? "armed" : "safe";
  const modeText = !status.configured ? "Needs app credentials" : status.authorized ? "Authorized" : "Needs login";
  const loginLink = status.configured ? `<a class="button-link" href="/spotify/login">Connect Spotify</a>` : "";
  const startVolumeValue = status.start_volume_percent === "" ? "" : String(status.start_volume_percent);
  const accountLabel = status.account.display_name || status.account.id || "";
  const defaultDeviceName = status.default_device_name || "";
  const refreshAccountForm = status.authorized
    ? `<form class="inline-form" method="post" action="/spotify/refresh-account"><button type="submit">Refresh Account</button></form>`
    : "";

  return `
    <div class="spotify-summary-grid">
      <div class="spotify-summary-item">
        <span>Auth</span>
        <strong><span class="sonos-mode ${modeClass}">${escapeHtml(modeText)}</span></strong>
      </div>
      <div class="spotify-summary-item">
        <span>Connected account</span>
        <strong>${accountLabel ? `<code>${escapeHtml(accountLabel)}</code>` : `<span class="muted">unknown</span>`}</strong>
      </div>
      <div class="spotify-summary-item">
        <span>Default device</span>
        <strong>${defaultDeviceName ? `<code>${escapeHtml(defaultDeviceName)}</code>` : `<span class="muted">name not saved yet</span>`}</strong>
      </div>
      <div class="spotify-summary-item">
        <span>Start volume</span>
        <strong><code>${startVolumeValue ? `${escapeHtml(startVolumeValue)}%` : "unchanged"}</code></strong>
      </div>
      <div class="spotify-summary-item wide">
        <span>Redirect URI</span>
        <strong><code>${escapeHtml(status.redirect_uri)}</code></strong>
      </div>
      <div class="spotify-summary-item wide">
        <span>Scopes</span>
        <strong><code>${escapeHtml(status.scopes.join(" "))}</code></strong>
      </div>
      ${status.expires_at ? `
        <div class="spotify-summary-item">
          <span>Token expires</span>
          <strong>${escapeHtml(formatScanTime(status.expires_at))}</strong>
        </div>
      ` : ""}
    </div>
    <div class="spotify-actions-row">
      ${refreshAccountForm}
      ${loginLink}
    </div>
    <form class="spotify-form" method="post" action="/settings/spotify-playback">
      <label>
        <span>Default device ID</span>
        <input name="default_device_id" value="${escapeHtml(status.default_device_id)}" placeholder="Spotify Connect device ID" maxlength="200">
      </label>
      <label>
        <span>Default device name</span>
        <input name="default_device_name" value="${escapeHtml(defaultDeviceName)}" placeholder="Eabha's Office Dot" maxlength="200">
      </label>
      <label>
        <span>Start volume</span>
        <input type="number" name="start_volume_percent" value="${escapeHtml(startVolumeValue)}" min="0" max="100" step="1" placeholder="30">
      </label>
      <button type="submit">Save Spotify</button>
    </form>
  `;
}

function renderSpotifyDevices(devices, status, error = "") {
  if (error) {
    return `<div class="empty error-text">${escapeHtml(error)}</div>`;
  }

  if (!devices.length) {
    return `<div class="empty">No Spotify Connect devices are currently visible.</div>`;
  }

  const defaultDeviceId = status.default_device_id || "";
  const defaultDeviceName = status.default_device_name || "";
  const rows = devices
    .map((device) => {
      const isDefault = device.id === defaultDeviceId || spotifyDeviceNameMatches(device.name, defaultDeviceName);
      return `
        <tr>
          <td>
            <strong>${escapeHtml(device.name || "Unnamed device")}</strong>
            ${isDefault ? `<span class="pill known">Default</span>` : ""}
          </td>
          <td>${escapeHtml(device.type || "")}</td>
          <td>${device.is_active ? `<span class="pill known">Active</span>` : `<span class="muted">Idle</span>`}</td>
          <td>${device.supports_volume ? "Yes" : "No"}</td>
          <td>${Number.isInteger(device.volume_percent) ? `${escapeHtml(device.volume_percent)}%` : `<span class="muted">unknown</span>`}</td>
          <td><code>${escapeHtml(device.id || "")}</code></td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Device</th>
            <th>Type</th>
            <th>Status</th>
            <th>Volume API</th>
            <th>Volume</th>
            <th>Spotify ID</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderRecentScans(scans) {
  const rows = scans
    .map(
      (scan) => {
        const searchText = [
          scan.id,
          scan.tag_id,
          scan.known ? "known" : "unknown",
          scan.card ? scan.card.name : "unassigned",
          scan.receiver ? scan.receiver.name : "unknown",
          scan.reader_id,
          scan.source,
          scan.action_event ? scan.action_event.status : "",
          scan.action_event ? scan.action_event.action_type : "",
        ].join(" ");

        return `
        <tr data-filter-row data-search="${escapeHtml(searchText.toLowerCase())}">
          <td>${escapeHtml(scan.id)}</td>
          <td>
            <code>${escapeHtml(scan.tag_id)}</code>
            <span class="pill ${scan.known ? "known" : "unknown"}">${scan.known ? "Known" : "Unknown"}</span>
          </td>
          <td>
            ${scan.known ? escapeHtml(scan.card.name) : `<span class="muted">Unassigned</span>`}
            <span class="small-text">${renderActionSummary(scan)}</span>
          </td>
          <td>
            ${scan.receiver ? escapeHtml(scan.receiver.name) : `<span class="muted">Unknown</span>`}
            <span class="small-text"><code>${escapeHtml(scan.reader_id)}</code></span>
          </td>
          <td>${escapeHtml(scan.source)}</td>
          <td class="time-cell" title="${escapeHtml(scan.scanned_at)}">${escapeHtml(formatScanTime(scan.scanned_at))}</td>
          <td class="assign-cell">${renderCardForm(scan)}</td>
        </tr>
      `;
      },
    )
    .join("");

  const table = scans.length
    ? `
      <div class="section-tools">
        <label>
          <span>Search scans</span>
          <input type="search" placeholder="Tag, card, reader, action" data-filter-input="scans-table">
        </label>
      </div>
      <div class="table-wrap">
        <table class="scans-table" id="scans-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Tag</th>
              <th>Card</th>
              <th>Reader</th>
              <th>Source</th>
              <th>Scanned at</th>
              <th>Assign</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `
    : `<div class="empty">No scans received yet.</div>`;

  return table;
}

function renderPageShell(activePage, pageTitle, pageDescription, content) {
  const scans = getRecentScans(50);
  const mediaItems = getMediaItems(100);
  const sonosSettings = getSonosSettings();
  const receivers = getReceivers();
  const cardCount = countCards.get().card_count;
  const actionEventCount = countActionEvents.get().action_event_count;
  const readerStatus = getEspHomeBridgeStatus();
  const navItems = [
    ["/media", "Tracks", mediaItems.length],
    ["/playlists", "Playlists", getSpotifyPlaylists().length],
    ["/spotify", "Spotify", getSpotifyStatus().authorized ? "Ready" : "Login"],
    ["/cards", "Cards", cardCount],
    ["/activity", "Activity", actionEventCount],
    ["/devices", "Devices", receivers.length],
    ["/reader", "Reader", readerStatus.status],
  ];
  const nav = navItems
    .map(([href, label, meta]) => {
      const active = activePage === href ? " active" : "";
      const aria = active ? ` aria-current="page"` : "";
      return `<a class="${active.trim()}" href="${href}"${aria}><span>${label}</span><span class="nav-count">${escapeHtml(String(meta))}</span></a>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(APP_NAME)} - ${escapeHtml(pageTitle)}</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --bg: #f6f7f8;
        --surface: #ffffff;
        --surface-subtle: #f1f4f5;
        --surface-muted: #e8eef0;
        --line: #d8dee3;
        --line-strong: #c7d0d6;
        --text: #17202a;
        --muted: #5f6b78;
        --muted-strong: #46515c;
        --accent: #2f7d6d;
        --accent-strong: #256859;
        --accent-soft: #e4f2ed;
        --warning-soft: #fff4dc;
        --warning-line: #ead39e;
        --danger: #97441f;
        --danger-soft: #f8e8df;
        --shadow: 0 12px 30px rgba(23, 32, 42, 0.06);
        background: var(--bg);
        color: var(--text);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.84), rgba(255, 255, 255, 0) 190px),
          var(--bg);
      }

      main {
        width: min(1500px, calc(100% - 36px));
        margin: 0 auto;
        padding: 22px 0 42px;
      }

      header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 14px;
      }

      header > div:first-child {
        max-width: 520px;
        min-width: 0;
      }

      h1 {
        margin: 0 0 5px;
        font-size: 1.82rem;
        line-height: 1.08;
        letter-spacing: 0;
      }

      .brand-kicker {
        margin-bottom: 6px;
        color: var(--accent);
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      p {
        margin: 0;
        color: var(--muted);
        font-size: 0.9rem;
      }

      .stats {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
        flex: 0 0 auto;
      }

      .status {
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 7px 9px;
        background: rgba(255, 255, 255, 0.78);
        min-width: 100px;
      }

      .status span {
        display: block;
        font-size: 0.72rem;
        color: var(--muted);
      }

      .status strong {
        display: block;
        margin-top: 1px;
        font-size: 1.05rem;
        line-height: 1.15;
      }

      .page-nav {
        position: sticky;
        top: 0;
        z-index: 5;
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        margin-bottom: 18px;
        padding: 5px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.84);
        backdrop-filter: blur(10px);
        box-shadow: 0 8px 24px rgba(23, 32, 42, 0.04);
      }

      .page-nav a {
        display: inline-flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 32px;
        border: 1px solid transparent;
        border-radius: 6px;
        padding: 0 10px;
        background: transparent;
        color: inherit;
        font-size: 0.82rem;
        font-weight: 650;
        text-decoration: none;
      }

      .nav-count {
        min-width: 22px;
        border-radius: 999px;
        padding: 2px 5px;
        background: var(--surface-subtle);
        color: var(--muted);
        font-size: 0.7rem;
        line-height: 1;
        text-align: center;
        text-transform: capitalize;
      }

      .page-nav a:hover {
        background: var(--surface-subtle);
        border-color: var(--line);
      }

      .page-nav a.active {
        background: var(--accent-soft);
        border-color: #b7d8cc;
        color: var(--accent-strong);
      }

      .page-nav a.active .nav-count {
        background: #cfe7de;
        color: var(--accent-strong);
      }

      .page-content {
        display: grid;
        gap: 18px;
      }

      .activity-grid,
      .devices-grid,
      .reader-grid,
      .spotify-management-grid {
        display: grid;
        gap: 16px;
        align-items: start;
      }

      .activity-grid {
        grid-template-columns: minmax(0, 1.45fr) minmax(420px, 0.75fr);
      }

      .devices-grid {
        grid-template-columns: minmax(0, 1fr) minmax(360px, 0.78fr);
      }

      .reader-grid {
        grid-template-columns: minmax(0, 1fr) minmax(360px, 0.8fr);
      }

      .spotify-management-grid {
        grid-template-columns: minmax(0, 1fr) minmax(420px, 0.85fr);
      }

      .grid-full {
        grid-column: 1 / -1;
      }

      section {
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 8px;
        overflow: hidden;
        box-shadow: var(--shadow);
      }

      section + section {
        margin-top: 16px;
      }

      h2 {
        margin: 0;
        font-size: 0.92rem;
        line-height: 1.25;
        letter-spacing: 0;
      }

      .section-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        background: var(--surface-subtle);
        border-bottom: 1px solid var(--line);
      }

      .table-wrap {
        overflow-x: auto;
      }

      .section-tools {
        display: flex;
        gap: 10px;
        padding: 10px 14px;
        border-bottom: 1px solid var(--line);
        background: var(--surface);
      }

      .section-tools label {
        width: min(420px, 100%);
      }

      tr.filtered-out {
        display: none;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      .scans-table {
        table-layout: fixed;
      }

      th,
      td {
        padding: 10px 14px;
        text-align: left;
        border-bottom: 1px solid #e6e9ee;
        vertical-align: top;
      }

      th {
        background: #f8fafb;
        color: var(--muted-strong);
        font-size: 0.7rem;
        font-weight: 750;
        text-transform: uppercase;
        white-space: nowrap;
      }

      td {
        font-size: 0.88rem;
      }

      tbody tr:hover {
        background: #fbfcfd;
      }

      .scans-table td:nth-child(3) {
        white-space: normal;
      }

      .scans-table th:nth-child(1),
      .scans-table td:nth-child(1) {
        width: 42px;
      }

      .scans-table th:nth-child(2),
      .scans-table td:nth-child(2) {
        width: 160px;
      }

      .scans-table th:nth-child(3),
      .scans-table td:nth-child(3) {
        width: 140px;
      }

      .scans-table th:nth-child(4),
      .scans-table td:nth-child(4) {
        width: 150px;
      }

      .scans-table th:nth-child(5),
      .scans-table td:nth-child(5) {
        width: 76px;
      }

      .scans-table th:nth-child(6),
      .scans-table td:nth-child(6) {
        width: 135px;
      }

      .media-cell {
        display: grid;
        grid-template-columns: 46px minmax(0, 1fr);
        gap: 10px;
        align-items: center;
      }

      .media-card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
        gap: 12px;
        padding: 14px;
      }

      .media-card {
        display: grid;
        grid-template-columns: 76px minmax(0, 1fr);
        gap: 12px;
        min-width: 0;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 12px;
        background: var(--surface);
      }

      .media-card:hover {
        border-color: var(--line-strong);
        box-shadow: 0 10px 24px rgba(23, 32, 42, 0.06);
      }

      .media-card-art {
        width: 76px;
        min-width: 76px;
      }

      .media-card .media-artwork {
        width: 76px;
        height: 76px;
      }

      .media-card-main {
        display: grid;
        gap: 10px;
        min-width: 0;
      }

      .media-card-title-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        min-width: 0;
      }

      .media-card-title-row strong {
        display: block;
        line-height: 1.25;
      }

      .media-card-fields {
        display: grid;
        gap: 8px;
        margin: 0;
      }

      .media-card-fields div {
        display: grid;
        gap: 2px;
      }

      .media-card-fields dt {
        color: var(--muted);
        font-size: 0.68rem;
        font-weight: 750;
        text-transform: uppercase;
      }

      .media-card-fields dd {
        margin: 0;
        font-size: 0.9rem;
        font-weight: 700;
        line-height: 1.25;
      }

      .media-card-meta,
      .media-card-statuses {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }

      .media-card-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: end;
      }

      .media-card-actions > div {
        display: grid;
        gap: 4px;
      }

      .media-card-actions button {
        white-space: nowrap;
      }

      .print-status-editor {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }

      .inline-form.hidden-print-form {
        display: none;
      }

      .inline-form.hidden-print-form.is-open {
        display: inline-flex;
      }

      .mini-label {
        color: var(--muted);
        font-size: 0.68rem;
        font-weight: 750;
        text-transform: uppercase;
      }

      .media-card-meta span {
        border-radius: 999px;
        padding: 2px 7px;
        background: var(--surface-subtle);
        color: var(--muted);
        font-size: 0.72rem;
        font-weight: 650;
      }

      .media-artwork {
        width: 46px;
        height: 46px;
        border-radius: 6px;
        object-fit: contain;
        background: var(--surface-subtle);
      }

      .media-artwork.placeholder {
        border: 1px dashed rgba(31, 41, 51, 0.2);
      }

      code {
        font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
        font-size: 0.86em;
        overflow-wrap: anywhere;
      }

      input,
      select {
        width: 100%;
        min-width: 0;
        min-height: 32px;
        border: 1px solid #cfd6dd;
        border-radius: 6px;
        padding: 6px 8px;
        background: var(--surface);
        color: inherit;
        font: inherit;
      }

      input:focus,
      select:focus {
        border-color: #82b7a8;
        box-shadow: 0 0 0 3px rgba(47, 125, 109, 0.14);
        outline: none;
      }

      select {
        cursor: pointer;
      }

      button {
        min-height: 32px;
        border: 1px solid var(--accent-strong);
        border-radius: 6px;
        padding: 0 10px;
        background: var(--accent);
        color: #fff;
        font: inherit;
        font-size: 0.86rem;
        font-weight: 650;
        cursor: pointer;
      }

      button:hover {
        background: var(--accent-strong);
      }

      .secondary-button {
        border-color: var(--line-strong);
        background: var(--surface);
        color: var(--muted-strong);
      }

      .secondary-button:hover {
        background: var(--surface-subtle);
        color: var(--text);
      }

      button:focus-visible,
      .button-link:focus-visible,
      .page-nav a:focus-visible {
        box-shadow: 0 0 0 3px rgba(47, 125, 109, 0.18);
        outline: none;
      }

      .button-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 32px;
        width: max-content;
        border: 1px solid var(--accent-strong);
        border-radius: 6px;
        padding: 0 10px;
        background: var(--accent);
        color: #fff;
        font-size: 0.86rem;
        font-weight: 650;
        text-decoration: none;
      }

      .button-link:hover {
        background: var(--accent-strong);
      }

      .assign-form {
        display: grid;
        grid-template-columns: minmax(130px, 1fr) minmax(160px, 1.25fr) auto;
        gap: 8px;
        align-items: end;
        min-width: 0;
      }

      .action-form {
        display: grid;
        grid-template-columns: minmax(130px, 0.7fr) minmax(170px, 1fr) minmax(190px, 1fr) auto auto;
        gap: 8px;
        align-items: end;
      }

      .test-scan-form {
        display: grid;
        grid-template-columns: minmax(160px, 1fr) auto;
        gap: 8px;
        align-items: end;
      }

      .sonos-settings-grid {
        display: grid;
        gap: 14px;
      }

      .sonos-toggle-form,
      .sonos-device-form,
      .receiver-form,
      .esphome-form,
      .reader-test-form,
      .spotify-form,
      .playlist-import-form,
      .sonos-device-row-form,
      .receiver-row-form {
        display: grid;
        grid-template-columns: auto auto auto;
        gap: 10px;
        align-items: end;
        justify-content: start;
      }

      .sonos-device-form {
        grid-template-columns: minmax(180px, 260px) minmax(240px, 360px) auto auto;
      }

      .receiver-form {
        grid-template-columns:
          minmax(150px, 1fr)
          minmax(160px, 1fr)
          minmax(120px, 0.8fr)
          minmax(210px, 1.2fr)
          minmax(140px, 0.9fr)
          auto
          auto;
        margin-bottom: 16px;
      }

      .esphome-form {
        grid-template-columns: minmax(220px, 340px) minmax(180px, 260px) auto auto auto;
      }

      .reader-test-form {
        grid-template-columns:
          minmax(210px, auto)
          minmax(180px, 260px)
          minmax(140px, 190px)
          minmax(180px, 1fr)
          minmax(210px, 280px)
          auto;
      }

      .spotify-form {
        grid-template-columns: minmax(260px, 1fr) minmax(220px, 0.8fr) minmax(120px, 160px) auto;
        margin-top: 12px;
      }

      .spotify-summary-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .spotify-summary-item {
        min-width: 0;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 9px 10px;
        background: var(--surface);
      }

      .spotify-summary-item.wide {
        grid-column: 1 / -1;
      }

      .spotify-summary-item span,
      .spotify-summary-item small {
        display: block;
        color: var(--muted);
        font-size: 0.72rem;
      }

      .spotify-summary-item strong {
        display: block;
        margin-top: 3px;
        font-size: 0.9rem;
        font-weight: 650;
        overflow-wrap: anywhere;
      }

      .spotify-actions-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }

      .inline-form {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .playlist-import-form {
        grid-template-columns: minmax(0, 1fr);
        max-width: 760px;
        margin-top: 12px;
      }

      .playlist-import-form button {
        justify-self: start;
        width: max-content;
      }

      .cache-artwork-form {
        margin-top: 10px;
      }

      .sonos-device-row-form {
        grid-template-columns: minmax(180px, 260px) minmax(240px, 360px) auto auto;
      }

      .receiver-row-form {
        grid-template-columns:
          minmax(150px, 1fr)
          minmax(160px, 1fr)
          minmax(120px, 0.8fr)
          minmax(210px, 1.2fr)
          minmax(140px, 0.9fr)
          auto
          auto;
      }

      .settings-panel {
        padding: 14px;
      }

      .pending-assignment {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
      }

      .pending-assignment.active {
        background: var(--warning-soft);
        border-bottom: 1px solid var(--warning-line);
      }

      .assign-form span,
      .action-form span,
      .sonos-toggle-form span,
      .sonos-device-form span,
      .receiver-form span,
      .esphome-form span,
      .reader-test-form span,
      .spotify-form span,
      .playlist-import-form span,
      .sonos-device-row-form span,
      .receiver-row-form span {
        display: block;
        margin-bottom: 3px;
        color: var(--muted);
        font-size: 0.68rem;
        font-weight: 750;
        text-transform: uppercase;
      }

      .toggle-label {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 32px;
        padding-bottom: 2px;
      }

      .toggle-label input {
        width: 16px;
        min-height: 16px;
      }

      .toggle-label span {
        margin: 0;
      }

      .pill {
        display: block;
        width: fit-content;
        margin-top: 5px;
        border-radius: 999px;
        padding: 2px 6px;
        font-size: 0.68rem;
        font-weight: 750;
        vertical-align: 1px;
      }

      .time-cell {
        white-space: normal;
      }

      .assign-cell {
        width: auto;
      }

      .assign-cell label {
        min-width: 0;
      }

      .cards-table td:first-child {
        width: 190px;
      }

      .cards-table td:nth-child(2) {
        width: 190px;
      }

      .cards-table td:nth-child(4) {
        width: 120px;
      }

      .events-table td:first-child {
        width: 190px;
      }

      .action-status {
        display: inline-block;
        width: fit-content;
        border-radius: 999px;
        padding: 2px 6px;
        background: var(--accent-soft);
        color: var(--accent-strong);
        font-size: 0.68rem;
        font-weight: 750;
      }

      .status-assigned,
      .status-printed {
        background: var(--accent-soft);
        color: var(--accent-strong);
      }

      .status-unassigned,
      .status-not_printed {
        background: var(--danger-soft);
        color: var(--danger);
      }

      .status-queued {
        background: var(--warning-soft);
        color: #795710;
      }

      .status-pdf_generated {
        background: #e8eef8;
        color: #315d9b;
      }

      .status-pending {
        background: var(--warning-soft);
        color: #795710;
      }

      .sonos-mode {
        display: inline-flex;
        align-items: center;
        min-height: 32px;
        border-radius: 999px;
        padding: 0 9px;
        font-size: 0.72rem;
        font-weight: 750;
      }

      .sonos-mode.safe {
        background: var(--danger-soft);
        color: var(--danger);
      }

      .sonos-mode.armed {
        background: var(--accent-soft);
        color: var(--accent-strong);
      }

      .bridge-status {
        display: grid;
        gap: 6px;
        margin-top: 12px;
        color: #5f6b78;
        font-size: 0.84rem;
      }

      .bridge-log-list {
        display: grid;
        gap: 6px;
        margin: 12px 0 0;
        padding: 0;
        list-style: none;
      }

      .bridge-log-list li {
        display: grid;
        grid-template-columns: minmax(130px, auto) minmax(0, 1fr);
        gap: 10px;
        align-items: baseline;
        color: #5f6b78;
        font-size: 0.78rem;
      }

      .bridge-log-list code {
        white-space: normal;
        overflow-wrap: anywhere;
      }

      .error-text {
        color: #9d4324;
        font-weight: 700;
      }

      .small-text {
        display: block;
        margin-top: 4px;
        color: var(--muted);
        font-size: 0.76rem;
      }

      .known {
        background: var(--accent-soft);
        color: var(--accent-strong);
      }

      .unknown {
        background: var(--danger-soft);
        color: var(--danger);
      }

      .muted,
      .empty {
        color: var(--muted);
      }

      .empty {
        padding: 28px 16px;
        text-align: center;
      }

      .filter-empty-row td {
        padding: 24px 16px;
        color: var(--muted);
        text-align: center;
      }

      .media-card-grid > .filter-empty-row {
        grid-column: 1 / -1;
        padding: 28px 16px;
        color: var(--muted);
        text-align: center;
      }

      @media (max-width: 760px) {
        main {
          width: min(100% - 24px, 1500px);
          padding-top: 16px;
        }

        header {
          display: block;
        }

        h1 {
          font-size: 1.55rem;
        }

        .stats {
          justify-content: stretch;
          margin-top: 16px;
        }

        .status {
          min-width: 0;
          flex: 1 1 130px;
        }

        .activity-grid,
        .devices-grid,
        .reader-grid,
        .spotify-management-grid {
          grid-template-columns: 1fr;
        }

        .spotify-summary-grid {
          grid-template-columns: 1fr;
        }

        .sonos-toggle-form,
        .sonos-device-form,
        .receiver-form,
        .esphome-form,
        .reader-test-form,
        .sonos-device-row-form,
        .receiver-row-form,
        .spotify-form,
        .playlist-import-form,
        .action-form,
        .assign-form {
          grid-template-columns: 1fr;
        }

        .pending-assignment {
          display: grid;
        }

        .media-card-grid {
          grid-template-columns: 1fr;
          padding: 12px;
        }

        .media-card {
          grid-template-columns: 62px minmax(0, 1fr);
        }

        .media-card-art,
        .media-card .media-artwork {
          width: 62px;
          height: 62px;
        }

        .media-card-art {
          min-width: 62px;
        }
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #10151b;
          --surface: #18212a;
          --surface-subtle: #202b36;
          --surface-muted: #263441;
          --line: #2b3642;
          --line-strong: #3a4652;
          --text: #eef2f5;
          --muted: #aeb8bd;
          --muted-strong: #cfd7df;
          --accent: #4fb69f;
          --accent-strong: #91e3cc;
          --accent-soft: #17352e;
          --warning-soft: #3a3020;
          --warning-line: #5e4c28;
          --danger: #ffad8a;
          --danger-soft: #47271c;
          --shadow: none;
          background: var(--bg);
          color: var(--text);
        }

        body {
          background: var(--bg);
        }

        p,
        .status span,
        .assign-form span,
        .action-form span,
        .sonos-toggle-form span,
        .sonos-device-form span,
        .receiver-form span,
        .esphome-form span,
        .reader-test-form span,
        .spotify-form span,
        .playlist-import-form span,
        .sonos-device-row-form span,
        .receiver-row-form span,
        .small-text,
        .bridge-status,
        .muted,
        .empty {
          color: var(--muted);
        }

        section,
        .status,
        .page-nav,
        .section-tools,
        .spotify-summary-item {
          background: var(--surface);
          border-color: var(--line);
        }

        .section-heading {
          background: var(--surface-subtle);
          border-bottom-color: var(--line);
        }

        .page-nav a {
          border-color: transparent;
          background: transparent;
        }

        .page-nav a.active {
          background: var(--accent-soft);
          border-color: #3a7b6d;
          color: var(--accent-strong);
        }

        .nav-count {
          background: var(--surface-muted);
          color: var(--muted);
        }

        .page-nav a.active .nav-count {
          background: #244b42;
          color: var(--accent-strong);
        }

        th,
        td {
          border-bottom-color: var(--line);
        }

        th {
          background: var(--surface-subtle);
          color: var(--muted-strong);
        }

        input,
        select {
          border-color: var(--line-strong);
          background: #111820;
        }

        .known {
          background: var(--accent-soft);
          color: var(--accent-strong);
        }

        .unknown {
          background: var(--danger-soft);
          color: var(--danger);
        }

        .action-status {
          background: var(--accent-soft);
          color: var(--accent-strong);
        }

        .status-queued,
        .status-pending {
          background: var(--warning-soft);
          color: #f3ce7a;
        }

        .status-pdf_generated {
          background: #172f4f;
          color: #9fc7ff;
        }

        .sonos-mode.safe {
          background: var(--danger-soft);
          color: var(--danger);
        }

        .pending-assignment.active {
          background: var(--warning-soft);
          border-bottom-color: var(--warning-line);
        }

        .sonos-mode.armed {
          background: var(--accent-soft);
          color: var(--accent-strong);
        }

        .error-text {
          color: var(--danger);
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <div class="brand-kicker">${escapeHtml(APP_NAME)}</div>
          <h1>${escapeHtml(pageTitle)}</h1>
          <p>${escapeHtml(pageDescription)}</p>
        </div>
        <div class="stats">
          <div class="status">
            <span>Shown scans</span>
            <strong>${scans.length}</strong>
          </div>
          <div class="status">
            <span>Known cards</span>
            <strong>${cardCount}</strong>
          </div>
          <div class="status">
            <span>Media items</span>
            <strong>${mediaItems.length}</strong>
          </div>
          <div class="status">
            <span>Action events</span>
            <strong>${actionEventCount}</strong>
          </div>
          <div class="status">
            <span>Sonos</span>
            <strong>${sonosSettings.enabled ? "On" : "Off"}</strong>
          </div>
          <div class="status">
            <span>Receivers</span>
            <strong>${receivers.length}</strong>
          </div>
        </div>
      </header>

      <nav class="page-nav" aria-label="Main pages">${nav}</nav>

      <div class="page-content">
        ${content}
      </div>
    </main>
    <script>
      (() => {
        const inputs = document.querySelectorAll("[data-filter-input]");

        inputs.forEach((input) => {
          const table = document.getElementById(input.dataset.filterInput || "");

          if (!table) {
            return;
          }

          const rows = Array.from(table.querySelectorAll("[data-filter-row]"));
          const tbody = table.querySelector("tbody");
          const emptyRow = document.createElement(tbody ? "tr" : "div");
          emptyRow.className = "filter-empty-row filtered-out";

          if (tbody) {
            const columnCount = table.querySelectorAll("thead th").length || 1;
            emptyRow.innerHTML = '<td colspan="' + columnCount + '">No matching rows</td>';
            tbody.append(emptyRow);
          } else {
            emptyRow.textContent = "No matching items";
            table.append(emptyRow);
          }

          input.addEventListener("input", () => {
            const query = input.value.trim().toLowerCase();
            let visibleCount = 0;

            rows.forEach((row) => {
              const isVisible = !query || row.dataset.search.includes(query);
              row.classList.toggle("filtered-out", !isVisible);

              if (isVisible) {
                visibleCount += 1;
              }
            });

            emptyRow.classList.toggle("filtered-out", visibleCount > 0);
          });
        });

        document.querySelectorAll("[data-toggle-print]").forEach((button) => {
          button.addEventListener("click", () => {
            const editor = button.closest(".print-status-editor");
            const form = editor ? editor.querySelector(".hidden-print-form") : null;

            if (!form) {
              return;
            }

            const isOpen = form.classList.toggle("is-open");
            button.textContent = isOpen ? "Close" : "Edit";
          });
        });
      })();
    </script>
  </body>
</html>`;
}

function renderMediaPage() {
  const pendingAssignment = getPendingMediaAssignment();

  return renderPageShell(
    "/media",
    "Tracks",
    "Imported tracks and episodes, card assignment status, and print status.",
    `
      <section aria-label="Track library">
        <div class="section-heading">
          <h2>Track library</h2>
        </div>
        ${renderPendingMediaAssignment(pendingAssignment)}
        ${renderMediaLibrary(getMediaItems(100), pendingAssignment)}
      </section>
    `,
  );
}

function renderPlaylistsPage() {
  return renderPageShell(
    "/playlists",
    "Playlists",
    "Import and refresh Spotify playlists, cache artwork, and monitor assignment readiness.",
    `
      <section aria-label="Spotify playlist import and refresh">
        <div class="section-heading">
          <h2>Playlist library</h2>
        </div>
        <div class="settings-panel">
          ${renderSpotifyPlaylistImport(getSpotifyStatus())}
        </div>
      </section>
    `,
  );
}

async function renderSpotifyPage() {
  let devices = [];
  let devicesError = "";

  try {
    devices = await getSpotifyDevices();
  } catch (error) {
    devicesError = error.message;
  }

  return renderPageShell(
    "/spotify",
    "Spotify",
    "Account status, playback target, and visible Spotify devices.",
    `
      <div class="spotify-management-grid">
        <section aria-label="Spotify account and playback target">
          <div class="section-heading">
            <h2>Account and playback</h2>
          </div>
          <div class="settings-panel">
            ${renderSpotifySettings(getSpotifyStatus())}
          </div>
        </section>

        <section aria-label="Spotify devices" class="grid-full">
          <div class="section-heading">
            <h2>Visible devices</h2>
            <a class="button-link" href="/api/spotify/devices">Refresh Devices</a>
          </div>
          ${renderSpotifyDevices(devices, getSpotifyStatus(), devicesError)}
        </section>
      </div>
    `,
  );
}

function renderCardsPage() {
  const sonosDevices = getSonosDevices();
  const receivers = getReceivers();

  return renderPageShell(
    "/cards",
    "Cards",
    "Manage known tags, actions, and test scans.",
    `
      <section aria-label="Known cards">
        <div class="section-heading">
          <h2>Known cards</h2>
        </div>
        ${renderKnownCards(getCards(100), sonosDevices, receivers)}
      </section>
    `,
  );
}

function renderActivityPage() {
  return renderPageShell(
    "/activity",
    "Activity",
    "Recent scans and action events.",
    `
      <div class="activity-grid">
        <section aria-label="Recent scans">
          <div class="section-heading">
            <h2>Recent scans</h2>
          </div>
          ${renderRecentScans(getRecentScans(50))}
        </section>

        <section aria-label="Action events">
          <div class="section-heading">
            <h2>Action events</h2>
          </div>
          ${renderActionEvents(getActionEvents(20))}
        </section>
      </div>
    `,
  );
}

function renderDevicesPage() {
  const sonosSettings = getSonosSettings();
  const sonosDevices = getSonosDevices();
  const receivers = getReceivers();

  return renderPageShell(
    "/devices",
    "Devices",
    "Receivers and speaker settings.",
    `
      <div class="devices-grid">
        <section aria-label="Receivers" class="grid-full">
          <div class="section-heading">
            <h2>Receivers</h2>
          </div>
          <div class="settings-panel">
            ${renderReceivers(receivers, sonosDevices)}
          </div>
        </section>

        <section aria-label="Sonos settings" class="grid-full">
          <div class="section-heading">
            <h2>Sonos devices</h2>
          </div>
          <div class="settings-panel">
            ${renderSonosSettings(sonosSettings, sonosDevices)}
          </div>
        </section>
      </div>
    `,
  );
}

function renderReaderPage() {
  const espHomeSettings = getEspHomeSettings();
  const espHomeStatus = getEspHomeBridgeStatus();
  const readerTestActionSettings = getReaderTestActionSettings();
  const sonosDevices = getSonosDevices();

  return renderPageShell(
    "/reader",
    "Reader",
    "ESPHome bridge status and reader test action.",
    `
      <div class="reader-grid">
        <section aria-label="ESPHome reader bridge">
          <div class="section-heading">
            <h2>ESPHome reader bridge</h2>
          </div>
          <div class="settings-panel">
            ${renderEspHomeBridge(espHomeSettings, espHomeStatus)}
          </div>
        </section>

        <section aria-label="Reader test action">
          <div class="section-heading">
            <h2>Reader test action</h2>
          </div>
          <div class="settings-panel">
            ${renderReaderTestAction(readerTestActionSettings, sonosDevices)}
          </div>
        </section>
      </div>
    `,
  );
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (request.method === "GET" && url.pathname.startsWith("/assets/spotify-artwork/")) {
    const fileName = path.basename(decodeURIComponent(url.pathname.slice("/assets/spotify-artwork/".length)));
    const filePath = path.join(__dirname, "data", "spotify-artwork", fileName);
    const resolvedDir = path.resolve(__dirname, "data", "spotify-artwork");
    const resolvedFile = path.resolve(filePath);

    if (!resolvedFile.startsWith(resolvedDir + path.sep)) {
      notFound(response);
      return;
    }

    sendFile(response, resolvedFile, contentTypeForPath(resolvedFile));
    return;
  }

  if (request.method === "GET" && url.pathname === "/") {
    redirect(response, "/media");
    return;
  }

  if (request.method === "GET" && url.pathname === "/media") {
    sendHtml(response, renderMediaPage());
    return;
  }

  if (request.method === "GET" && url.pathname === "/playlists") {
    sendHtml(response, renderPlaylistsPage());
    return;
  }

  if (request.method === "GET" && url.pathname === "/spotify") {
    sendHtml(response, await renderSpotifyPage());
    return;
  }

  if (request.method === "GET" && url.pathname === "/cards") {
    sendHtml(response, renderCardsPage());
    return;
  }

  if (request.method === "GET" && url.pathname === "/activity") {
    sendHtml(response, renderActivityPage());
    return;
  }

  if (request.method === "GET" && url.pathname === "/devices") {
    sendHtml(response, renderDevicesPage());
    return;
  }

  if (request.method === "GET" && url.pathname === "/reader") {
    sendHtml(response, renderReaderPage());
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: APP_SERVICE_ID,
      name: APP_NAME,
      database: {
        path: DB_PATH,
        exists: fs.existsSync(DB_PATH),
        scan_count: countScans.get().scan_count,
        card_count: countCards.get().card_count,
        media_item_count: countMediaItems.get().media_item_count,
        action_event_count: countActionEvents.get().action_event_count,
        receiver_count: countReceivers.get().receiver_count,
      },
      esphome: getEspHomeBridgeStatus(),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/scans") {
    sendJson(response, 200, {
      ok: true,
      scans: getRecentScans(url.searchParams.get("limit") || 50),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/scan") {
    try {
      const payload = await readPayload(request);
      const scan = normalizeScan(payload);

      if (scan.error) {
        sendJson(response, 400, { ok: false, error: scan.error });
        return;
      }

      sendJson(response, 201, {
        ok: true,
        scan: await createScan(scan),
      });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/cards") {
    sendJson(response, 200, {
      ok: true,
      cards: getCards(url.searchParams.get("limit") || 100),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/media") {
    sendJson(response, 200, {
      ok: true,
      media_items: getMediaItems(url.searchParams.get("limit") || 100),
      pending_assignment: getPendingMediaAssignment(),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/media/pending-assignment") {
    sendJson(response, 200, {
      ok: true,
      pending_assignment: getPendingMediaAssignment(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/media/assign-next") {
    try {
      const payload = await readPayload(request);
      const pendingAssignment = setPendingMediaAssignment(payload.media_item_id);

      if (pendingAssignment.error) {
        sendJson(response, 400, { ok: false, error: pendingAssignment.error });
        return;
      }

      sendJson(response, 200, { ok: true, pending_assignment: pendingAssignment });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/media/assign-next/cancel") {
    clearPendingMediaAssignment();
    sendJson(response, 200, { ok: true, pending_assignment: null });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/media/cache-artwork") {
    try {
      const payload = await readPayload(request);
      const result = await cacheMissingSpotifyArtwork(payload.limit || 100);
      saveLastArtworkCacheResult(result);
      sendJson(response, 200, {
        ok: true,
        result,
        media_items: getMediaItems(100),
      });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/media/print-status") {
    try {
      const payload = await readPayload(request);
      const result = updateMediaItemPrintStatus(payload.media_item_id || payload.id, payload.print_status);

      if (result.error) {
        sendJson(response, 400, { ok: false, error: result.error });
        return;
      }

      sendJson(response, 200, {
        ok: true,
        media_items: getMediaItems(100),
      });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/spotify/import-playlist") {
    try {
      const payload = await readPayload(request);
      const result = await importSpotifyPlaylist(payload.playlist_url || payload.playlist_uri || payload.url || payload.uri);
      saveSpotifyPlaylistImport(result);
      saveLastSpotifyPlaylistImport(result);
      sendJson(response, 200, {
        ok: true,
        result,
        playlists: getSpotifyPlaylists(),
        media_items: getMediaItems(100),
      });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message, spotify: getSpotifyStatus() });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/receivers") {
    sendJson(response, 200, {
      ok: true,
      receivers: getReceivers(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/receivers") {
    try {
      const payload = await readPayload(request);
      const receiver = normalizeReceiver(payload);

      if (receiver.error) {
        sendJson(response, 400, { ok: false, error: receiver.error });
        return;
      }

      sendJson(response, 200, { ok: true, receiver: upsertReceiver(receiver) });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "PUT" && url.pathname === "/api/receivers") {
    try {
      const payload = await readPayload(request);
      const receiver = normalizeReceiverUpdate(payload);

      if (receiver.error) {
        sendJson(response, 400, { ok: false, error: receiver.error });
        return;
      }

      sendJson(response, 200, { ok: true, receiver: updateReceiver(receiver) });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/settings/sonos") {
    sendJson(response, 200, {
      ok: true,
      sonos: getSonosSettings(),
      devices: getSonosDevices(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/settings/sonos") {
    try {
      const payload = await readPayload(request);
      const settings = normalizeSonosSettings(payload);

      if (settings.error) {
        sendJson(response, 400, { ok: false, error: settings.error });
        return;
      }

      sendJson(response, 200, {
        ok: true,
        sonos: saveSonosSettings(settings),
        devices: getSonosDevices(),
      });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/spotify/status") {
    sendJson(response, 200, {
      ok: true,
      spotify: getSpotifyStatus(),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/spotify/playlists") {
    sendJson(response, 200, {
      ok: true,
      playlists: getSpotifyPlaylists(),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/spotify/devices") {
    try {
      const devices = await getSpotifyDevices();
      sendJson(response, 200, {
        ok: true,
        spotify: getSpotifyStatus(),
        devices,
      });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message, spotify: getSpotifyStatus() });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/spotify/refresh-account") {
    try {
      sendJson(response, 200, {
        ok: true,
        account: await refreshSpotifyAccountProfile(),
        spotify: getSpotifyStatus(),
      });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message, spotify: getSpotifyStatus() });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/settings/spotify-playback") {
    try {
      const payload = await readPayload(request);
      const settings = normalizeSpotifyPlaybackSettings(payload);

      if (settings.error) {
        sendJson(response, 400, { ok: false, error: settings.error });
        return;
      }

      sendJson(response, 200, {
        ok: true,
        spotify: saveSpotifyPlaybackSettings(settings),
      });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/spotify/play") {
    try {
      const payload = await readPayload(request);
      const result = await sendSpotifyPlay(
        payload.spotify_uri || payload.uri || payload.url || payload.action_target,
        payload.device_id || payload.default_device_id || undefined,
      );

      sendJson(response, 200, {
        ok: true,
        result,
      });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/spotify/login") {
    const config = getSpotifyConfig();

    if (!config.clientId || !config.clientSecret) {
      sendJson(response, 400, {
        ok: false,
        error: "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET, then restart the app",
        redirect_uri: config.redirectUri,
      });
      return;
    }

    const state = crypto.randomBytes(16).toString("hex");
    setSetting("spotify_oauth_state", state);
    const authorizeUrl = new URL("https://accounts.spotify.com/authorize");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", config.clientId);
    authorizeUrl.searchParams.set("scope", SPOTIFY_SCOPES.join(" "));
    authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
    authorizeUrl.searchParams.set("state", state);
    redirect(response, authorizeUrl.toString());
    return;
  }

  if (request.method === "GET" && url.pathname === "/spotify/callback") {
    try {
      const expectedState = getSetting("spotify_oauth_state", "");
      const state = url.searchParams.get("state") || "";
      const code = url.searchParams.get("code") || "";

      if (!code) {
        sendJson(response, 400, { ok: false, error: url.searchParams.get("error") || "Missing Spotify code" });
        return;
      }

      if (!expectedState || state !== expectedState) {
        sendJson(response, 400, { ok: false, error: "Spotify OAuth state did not match" });
        return;
      }

      await exchangeSpotifyCode(code);
      redirect(response, "/");
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/settings/esphome") {
    sendJson(response, 200, {
      ok: true,
      esphome: getEspHomeSettings(),
      bridge: getEspHomeBridgeStatus(),
      reader_test_action: getReaderTestActionSettings(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/settings/esphome") {
    try {
      const payload = await readPayload(request);
      const settings = normalizeEspHomeSettings(payload);

      if (settings.error) {
        sendJson(response, 400, { ok: false, error: settings.error });
        return;
      }

      const savedSettings = saveEspHomeSettings(settings);

      if (savedSettings.enabled) {
        startEspHomeBridge(savedSettings);
      } else {
        stopEspHomeBridge();
      }

      sendJson(response, 200, {
        ok: true,
        esphome: savedSettings,
        bridge: getEspHomeBridgeStatus(),
      });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/settings/esphome/reconnect") {
    restartEspHomeBridge("manual API reconnect");
    sendJson(response, 200, {
      ok: true,
      esphome: getEspHomeSettings(),
      bridge: getEspHomeBridgeStatus(),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/settings/reader-test-action") {
    sendJson(response, 200, {
      ok: true,
      reader_test_action: getReaderTestActionSettings(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/settings/reader-test-action") {
    try {
      const payload = await readPayload(request);
      const settings = normalizeReaderTestActionSettings(payload);

      if (settings.error) {
        sendJson(response, 400, { ok: false, error: settings.error });
        return;
      }

      sendJson(response, 200, {
        ok: true,
        reader_test_action: saveReaderTestActionSettings(settings),
      });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sonos/devices") {
    try {
      const payload = await readPayload(request);
      const device = normalizeSonosDevice(payload);

      if (device.error) {
        sendJson(response, 400, { ok: false, error: device.error });
        return;
      }

      sendJson(response, 200, { ok: true, device: upsertSonosDevice(device) });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "PUT" && url.pathname === "/api/sonos/devices") {
    try {
      const payload = await readPayload(request);
      const device = normalizeSonosDeviceUpdate(payload);

      if (device.error) {
        sendJson(response, 400, { ok: false, error: device.error });
        return;
      }

      sendJson(response, 200, { ok: true, device: updateSonosDevice(device) });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sonos/test") {
    try {
      const payload = await readPayload(request);
      const command = payload.command === "play" ? "Play" : "Stop";
      const settings = getSonosSettings();
      const device = resolveSonosDeviceForTest(payload);

      if (!settings.enabled) {
        sendJson(response, 400, { ok: false, error: "Sonos must be enabled first" });
        return;
      }

      if (!device) {
        sendJson(response, 400, { ok: false, error: "Choose a Sonos device, or configure exactly one enabled device" });
        return;
      }

      if (!device.enabled) {
        sendJson(response, 400, { ok: false, error: "Selected Sonos device is disabled" });
        return;
      }

      const result = await sendSonosTransportCommand(device.host, command);
      sendJson(response, 200, { ok: true, sonos: settings, device, result });
    } catch (error) {
      sendJson(response, 502, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/action-events") {
    sendJson(response, 200, {
      ok: true,
      action_events: getActionEvents(url.searchParams.get("limit") || 20),
    });
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/actions/")) {
    const tagId = decodeURIComponent(url.pathname.slice("/api/actions/".length));
    const action = getAction(tagId);

    if (!action) {
      sendJson(response, 404, { ok: false, error: "Action not found" });
      return;
    }

    sendJson(response, 200, { ok: true, action });
    return;
  }

  if ((request.method === "POST" || request.method === "PUT") && url.pathname === "/api/actions") {
    try {
      const payload = await readPayload(request);
      const action = normalizeAction(payload);

      if (action.error) {
        sendJson(response, 400, { ok: false, error: action.error });
        return;
      }

      const savedAction = upsertAction(action);

      if (savedAction.error) {
        sendJson(response, 400, { ok: false, error: savedAction.error });
        return;
      }

      sendJson(response, 200, { ok: true, action: savedAction });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/cards/")) {
    const tagId = decodeURIComponent(url.pathname.slice("/api/cards/".length));
    const card = getCard(tagId);

    if (!card) {
      sendJson(response, 404, { ok: false, error: "Card not found" });
      return;
    }

    sendJson(response, 200, { ok: true, card });
    return;
  }

  if ((request.method === "POST" || request.method === "PUT") && url.pathname === "/api/cards") {
    try {
      const payload = await readPayload(request);
      const card = normalizeCard(payload);

      if (card.error) {
        sendJson(response, 400, { ok: false, error: card.error });
        return;
      }

      sendJson(response, 200, { ok: true, card: upsertCard(card) });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/cards") {
    try {
      const payload = await readPayload(request);
      const card = normalizeCard(payload);

      if (card.error) {
        sendJson(response, 400, { ok: false, error: card.error });
        return;
      }

      upsertCard(card);
      redirect(response, "/");
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/test-scan") {
    try {
      const payload = await readPayload(request);
      const tagId = normalizeTagId(payload.tag_id);

      if (!tagId) {
        sendJson(response, 400, { ok: false, error: "tag_id is required" });
        return;
      }

      const readerId = typeof payload.reader_id === "string" && payload.reader_id.trim()
        ? payload.reader_id.trim()
        : "ui-test";

      await createScan({
        readerId,
        tagId,
        source: "ui-test",
      });
      redirect(response, "/");
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && (url.pathname === "/playlists/import" || url.pathname === "/spotify/import-playlist")) {
    try {
      const payload = await readPayload(request);
      const result = await importSpotifyPlaylist(payload.playlist_url || payload.playlist_uri || payload.url || payload.uri);
      saveSpotifyPlaylistImport(result);
      saveLastSpotifyPlaylistImport(result);
      redirect(response, "/playlists");
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message, spotify: getSpotifyStatus() });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/media/assign-next") {
    try {
      const payload = await readPayload(request);
      const pendingAssignment = setPendingMediaAssignment(payload.media_item_id);

      if (pendingAssignment.error) {
        sendJson(response, 400, { ok: false, error: pendingAssignment.error });
        return;
      }

      redirect(response, "/media");
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/media/assign-next/cancel") {
    clearPendingMediaAssignment();
    redirect(response, "/media");
    return;
  }

  if (request.method === "POST" && url.pathname === "/media/cache-artwork") {
    try {
      const result = await cacheMissingSpotifyArtwork(100);
      saveLastArtworkCacheResult(result);
      redirect(response, "/media");
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/media/print-status") {
    try {
      const payload = await readPayload(request);
      const result = updateMediaItemPrintStatus(payload.media_item_id || payload.id, payload.print_status);

      if (result.error) {
        sendJson(response, 400, { ok: false, error: result.error });
        return;
      }

      redirect(response, "/media");
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && (url.pathname === "/playlists/cache-artwork" || url.pathname === "/spotify/cache-artwork")) {
    try {
      const result = await cacheMissingSpotifyArtwork(100);
      saveLastArtworkCacheResult(result);
      redirect(response, "/playlists");
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/receivers") {
    try {
      const payload = await readPayload(request);
      const receiver = normalizeReceiver(payload);

      if (receiver.error) {
        sendJson(response, 400, { ok: false, error: receiver.error });
        return;
      }

      upsertReceiver(receiver);
      redirect(response, "/");
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/receivers/update") {
    try {
      const payload = await readPayload(request);
      const receiver = normalizeReceiverUpdate(payload);

      if (receiver.error) {
        sendJson(response, 400, { ok: false, error: receiver.error });
        return;
      }

      updateReceiver(receiver);
      redirect(response, "/");
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/settings/sonos") {
    try {
      const payload = await readPayload(request);
      const settings = normalizeSonosSettings(payload);

      if (settings.error) {
        sendJson(response, 400, { ok: false, error: settings.error });
        return;
      }

      saveSonosSettings(settings);
      redirect(response, "/");
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/settings/spotify-playback") {
    try {
      const payload = await readPayload(request);
      const settings = normalizeSpotifyPlaybackSettings(payload);

      if (settings.error) {
        sendJson(response, 400, { ok: false, error: settings.error });
        return;
      }

      saveSpotifyPlaybackSettings(settings);
      redirect(response, "/spotify");
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/spotify/refresh-account") {
    try {
      await refreshSpotifyAccountProfile();
      redirect(response, "/spotify");
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message, spotify: getSpotifyStatus() });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/settings/esphome") {
    try {
      const payload = await readPayload(request);
      const settings = normalizeEspHomeSettings(payload);

      if (settings.error) {
        sendJson(response, 400, { ok: false, error: settings.error });
        return;
      }

      const savedSettings = saveEspHomeSettings(settings);

      if (savedSettings.enabled) {
        startEspHomeBridge(savedSettings);
      } else {
        stopEspHomeBridge();
      }

      redirect(response, "/");
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/settings/esphome/reconnect") {
    restartEspHomeBridge("manual UI reconnect");
    redirect(response, "/reader");
    return;
  }

  if (request.method === "POST" && url.pathname === "/settings/reader-test-action") {
    try {
      const payload = await readPayload(request);
      const settings = normalizeReaderTestActionSettings(payload);

      if (settings.error) {
        sendJson(response, 400, { ok: false, error: settings.error });
        return;
      }

      saveReaderTestActionSettings(settings);
      redirect(response, "/");
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/sonos/devices") {
    try {
      const payload = await readPayload(request);
      const device = normalizeSonosDevice(payload);

      if (device.error) {
        sendJson(response, 400, { ok: false, error: device.error });
        return;
      }

      upsertSonosDevice(device);
      redirect(response, "/");
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/sonos/devices/update") {
    try {
      const payload = await readPayload(request);
      const device = normalizeSonosDeviceUpdate(payload);

      if (device.error) {
        sendJson(response, 400, { ok: false, error: device.error });
        return;
      }

      updateSonosDevice(device);
      redirect(response, "/");
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/actions") {
    try {
      const payload = await readPayload(request);
      const action = normalizeAction(payload);

      if (action.error) {
        sendJson(response, 400, { ok: false, error: action.error });
        return;
      }

      const savedAction = upsertAction(action);

      if (savedAction.error) {
        sendJson(response, 400, { ok: false, error: savedAction.error });
        return;
      }

      redirect(response, "/");
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
    return;
  }

  notFound(response);
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error(error);
    sendJson(response, 500, { ok: false, error: "Internal server error" });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`${APP_NAME} listening at http://${HOST}:${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
  startEspHomeBridge();
  startEspHomeWatchdog();
});

function shutdown() {
  stopEspHomeWatchdog();
  stopEspHomeBridge();
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
