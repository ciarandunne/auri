import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultDbPath = process.platform === "win32" && process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "Auri", "auri-local-dev.db")
  : path.join(projectRoot, "data", "auri-local-dev.db");
const dbPath = path.resolve(process.env.AURI_DB_PATH || defaultDbPath);
const force = process.argv.includes("--force");

if (!force && !/auri-local-dev|mock|seed/i.test(path.basename(dbPath))) {
  throw new Error(
    `Refusing to seed "${dbPath}". Set AURI_DB_PATH to a local mock DB such as auri-local-dev.db, or pass --force.`,
  );
}

await import("node:fs").then(({ default: fs }) => {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
});

const db = new DatabaseSync(dbPath);

function iso(minutesAgo = 0) {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function ensureColumn(tableName, columnName, columnDefinition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columns.some((column) => column.name === columnName);

  if (!hasColumn) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS scan_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reader_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'api',
    scanned_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

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
`);

ensureColumn("media_items", "imported_from_provider_uri", "TEXT NOT NULL DEFAULT ''");
ensureColumn("media_items", "imported_from_title", "TEXT NOT NULL DEFAULT ''");
ensureColumn("media_items", "imported_at", "TEXT NOT NULL DEFAULT ''");
ensureColumn("media_items", "playlist_status", "TEXT NOT NULL DEFAULT 'active'");

const statements = {
  card: db.prepare(`
    INSERT INTO cards (tag_id, name, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  action: db.prepare(`
    INSERT INTO card_actions (tag_id, action_type, action_target, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tag_id) DO UPDATE SET
      action_type = excluded.action_type,
      action_target = excluded.action_target,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `),
  media: db.prepare(`
    INSERT INTO media_items (
      provider, media_type, provider_uri, source_url, title, subtitle, artist_names, show_name, album_name,
      artwork_url, local_artwork_path, duration_ms, print_status, imported_from_provider_uri,
      imported_from_title, imported_at, playlist_status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  assignment: db.prepare(`
    INSERT INTO card_media_assignments (tag_id, media_item_id, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  playlist: db.prepare(`
    INSERT INTO spotify_playlists (
      provider_uri, source_url, name, last_imported_at, last_total_count, last_imported_count,
      last_skipped_count, last_cached_artwork_count, last_failed_artwork_count, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  receiver: db.prepare(`
    INSERT INTO receivers (reader_id, name, child_name, default_sonos_host, spotify_account_label, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  sonos: db.prepare(`
    INSERT INTO sonos_devices (name, host, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  setting: db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
  `),
  scan: db.prepare(`
    INSERT INTO scan_events (reader_id, tag_id, source, scanned_at)
    VALUES (?, ?, ?, ?)
  `),
  event: db.prepare(`
    INSERT INTO action_events (scan_id, tag_id, action_type, action_target, status, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
};

const playlistUri = "spotify:playlist:mock-kids-tunes";
const playlistTitle = "Kids Tunes Mock Playlist";
const media = [
  {
    title: "Pink Pony Club",
    subtitle: "Chappell Roan",
    artist: "Chappell Roan",
    album: "The Rise and Fall of a Midwest Princess",
    uri: "spotify:track:mock-pink-pony-club",
    source: "https://open.spotify.com/track/mock-pink-pony-club",
    artwork: "data/spotify-artwork/pink-pony-club.avif",
    status: "printed",
    duration: 258000,
  },
  {
    title: "Golden",
    subtitle: "HUNTR/X, EJAE, AUDREY NUNA, REI AMI",
    artist: "HUNTR/X, EJAE, AUDREY NUNA, REI AMI",
    album: "KPop Demon Hunters",
    uri: "spotify:track:mock-golden",
    source: "https://open.spotify.com/track/mock-golden",
    artwork: "",
    status: "queued",
    duration: 194000,
  },
  {
    title: "Soda Pop",
    subtitle: "Saja Boys",
    artist: "Saja Boys",
    album: "KPop Demon Hunters",
    uri: "spotify:track:mock-soda-pop",
    source: "https://open.spotify.com/track/mock-soda-pop",
    artwork: "",
    status: "not_printed",
    duration: 181000,
  },
  {
    title: "Tiana & Princess Paua's Magical Beignet Quest",
    subtitle: "Bedtime Stories - Princesses!",
    show: "Bedtime Stories - Princesses!",
    uri: "spotify:episode:mock-tiana",
    source: "https://open.spotify.com/episode/mock-tiana",
    artwork: "data/spotify-artwork/tiana-princess-paua-s-magical-beignet-quest--episode-63j88DV0id99TNpEu2JjlR.jpg",
    status: "pdf_generated",
    duration: 905000,
  },
  {
    title: "The Creature Cases: The Search for the Sea Otter",
    subtitle: "Bedtime Stories with Netflix Jr.",
    show: "Bedtime Stories with Netflix Jr.",
    uri: "spotify:episode:mock-sea-otter",
    source: "https://open.spotify.com/episode/mock-sea-otter",
    artwork: "data/spotify-artwork/the-creature-cases-the-search-for-the-sea-otter--episode-4tY2mAwPQmtTELztzL6gGP.jpg",
    status: "not_printed",
    duration: 1020000,
  },
  {
    title: "E1 - The Visitors",
    subtitle: "Disney Frozen: Forces of Nature",
    show: "Disney Frozen: Forces of Nature",
    uri: "spotify:episode:mock-frozen-e1",
    source: "https://open.spotify.com/episode/mock-frozen-e1",
    artwork: "data/spotify-artwork/e1-the-visitors--episode-4w2bUCTirGozufUO8ACqes.jpg",
    status: "queued",
    duration: 738000,
  },
  {
    title: "Dirty Bertie - Chocolate",
    subtitle: "Story Time",
    show: "Story Time",
    uri: "spotify:episode:mock-dirty-bertie-chocolate",
    source: "https://open.spotify.com/episode/mock-dirty-bertie-chocolate",
    artwork: "",
    status: "not_printed",
    duration: 653000,
  },
  {
    title: "Premium Story Placeholder",
    subtitle: "premium/restricted or unavailable",
    show: "Premium Kids Podcast",
    uri: "spotify:episode:mock-premium-skipped",
    source: "https://open.spotify.com/episode/mock-premium-skipped",
    artwork: "",
    status: "not_printed",
    playlistStatus: "removed_from_playlist",
    duration: null,
  },
];

const cards = [
  ["04-A1-11-22-33-44-80", "Pink Pony Club", "Assigned test card"],
  ["04-B2-11-22-33-44-80", "Golden", "KPop test card"],
  ["04-C3-11-22-33-44-80", "Tiana Story", "Bedtime card"],
  ["04-D4-11-22-33-44-80", "Frozen Episode 1", "Story card"],
  ["04-E5-11-22-33-44-80", "Sea Otter", "Unprinted artwork"],
  ["04-F6-11-22-33-44-80", "Unused New Card", "Known card without assigned media"],
  ["04-77-11-22-33-44-80", "Stop/Pause Test", "Second tap pause behavior"],
  ["04-88-11-22-33-44-80", "Long Name Test Card For Layout Checking", "Useful for UI overflow testing"],
];

const assignments = [
  [cards[0][0], media[0].uri],
  [cards[1][0], media[1].uri],
  [cards[2][0], media[3].uri],
  [cards[3][0], media[5].uri],
  [cards[4][0], media[4].uri],
];

db.exec("BEGIN");

try {
  for (const table of [
    "action_events",
    "scan_events",
    "card_media_assignments",
    "card_actions",
    "cards",
    "media_items",
    "spotify_playlists",
    "sonos_devices",
    "receivers",
    "app_settings",
  ]) {
    db.exec(`DELETE FROM ${table}`);
  }

  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('action_events','scan_events','card_media_assignments','card_actions','cards','media_items','spotify_playlists','sonos_devices','receivers')");

  statements.playlist.run(
    playlistUri,
    "https://open.spotify.com/playlist/mock-kids-tunes",
    playlistTitle,
    iso(45),
    12,
    media.length,
    1,
    6,
    0,
    iso(600),
    iso(45),
  );

  const mediaIdsByUri = new Map();
  for (const [index, item] of media.entries()) {
    const result = statements.media.run(
      "spotify",
      item.uri.includes(":track:") ? "track" : "episode",
      item.uri,
      item.source,
      item.title,
      item.subtitle,
      item.artist || "",
      item.show || "",
      item.album || "",
      item.artwork ? `https://example.test/${path.basename(item.artwork)}` : "",
      item.artwork,
      item.duration,
      item.status,
      playlistUri,
      playlistTitle,
      iso(90 + index),
      item.playlistStatus || "active",
      iso(700 + index),
      iso(40 + index),
    );
    mediaIdsByUri.set(item.uri, Number(result.lastInsertRowid));
  }

  for (const [tagId, name, notes] of cards) {
    statements.card.run(tagId, name, notes, iso(1200), iso(60));
    statements.action.run(tagId, "none", "", 0, iso(1200), iso(60));
  }

  for (const [tagId, uri] of assignments) {
    const mediaId = mediaIdsByUri.get(uri);
    statements.assignment.run(tagId, mediaId, 1, iso(500), iso(35));
    statements.action.run(tagId, "spotify_play", uri, 1, iso(500), iso(35));
  }

  statements.receiver.run("tagreader-c6c6e4", "Eabha bedroom receiver", "Eabha", "", "Eabha Spotify", 1, iso(900), iso(30));
  statements.receiver.run("tagreader-liam-demo", "Liam demo receiver", "Liam", "", "Liam Spotify", 0, iso(900), iso(30));
  statements.sonos.run("Eabha Echo Dot", "spotify-connect:eabha-dot", 1, iso(900), iso(30));
  statements.sonos.run("Living Room Sonos Move", "192.168.5.15", 0, iso(900), iso(30));

  statements.setting.run("spotify_account_display_name", "ciaran.dunne2", iso(20));
  statements.setting.run("spotify_start_volume_percent", "15", iso(20));
  statements.setting.run("spotify_default_device_name", "Eabha Echo Dot", iso(20));
  statements.setting.run("spotify_last_artwork_cache", JSON.stringify({
    checked_count: 6,
    cached_count: 4,
    skipped_count: 2,
    failed_count: 0,
    failures: [],
    cached_at: iso(42),
  }), iso(42));
  statements.setting.run("spotify_last_playlist_import", JSON.stringify({
    playlist: { name: playlistTitle, uri: playlistUri, url: "https://open.spotify.com/playlist/mock-kids-tunes" },
    imported_count: media.length,
    skipped_count: 1,
    cached_artwork_count: 6,
    failed_artwork_count: 0,
    total_count: 12,
    imported_at: iso(45),
  }), iso(45));

  const scanTags = [
    [cards[0][0], "played", "Started Pink Pony Club", 12],
    [cards[0][0], "paused", "Second tap paused Pink Pony Club", 10],
    [cards[3][0], "played", "Started E1 - The Visitors", 90],
    [cards[4][0], "failed", "Spotify device was not visible", 160],
    ["04-99-00-00-00-00-80", "unknown", "Unknown card scanned", 220],
    [cards[2][0], "played", "Started Tiana story", 280],
    [cards[1][0], "played", "Started Golden", 340],
  ];

  for (const [tagId, status, message, minutesAgo] of scanTags) {
    const scan = statements.scan.run("tagreader-c6c6e4", tagId, "mock", iso(minutesAgo));
    const uri = assignments.find(([assignmentTag]) => assignmentTag === tagId)?.[1] || "";
    statements.event.run(
      Number(scan.lastInsertRowid),
      tagId,
      uri ? "spotify_play" : "none",
      uri,
      status,
      message,
      iso(minutesAgo - 1),
    );
  }

  db.exec("COMMIT");
} catch (error) {
  try {
    db.exec("ROLLBACK");
  } catch {
    // The original error is more useful than a follow-up rollback failure.
  }
  throw error;
}

const counts = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM cards) AS cards,
    (SELECT COUNT(*) FROM media_items) AS media_items,
    (SELECT COUNT(*) FROM spotify_playlists) AS playlists,
    (SELECT COUNT(*) FROM scan_events) AS scans,
    (SELECT COUNT(*) FROM action_events) AS action_events,
    (SELECT COUNT(*) FROM receivers) AS receivers
`).get();

console.log(JSON.stringify({ ok: true, dbPath, counts }, null, 2));
