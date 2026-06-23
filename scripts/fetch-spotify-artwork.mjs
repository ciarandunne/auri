import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const projectRoot = process.cwd();
const outputDir = path.join(projectRoot, "data", "spotify-artwork");
const manifestPath = path.join(outputDir, "manifest.json");
const databasePath = path.join(process.env.LOCALAPPDATA || "", "Auri", "auri.db");

function getSetting(db, key, fallback = "") {
  return db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)?.value || fallback;
}

function setSetting(db, key, value) {
  db.prepare(
    `
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `,
  ).run(key, value, new Date().toISOString());
}

function normalizeSpotifyUri(value) {
  const raw = String(value || "").trim();

  if (/^spotify:(track|album|playlist|episode):[A-Za-z0-9]+$/.test(raw)) {
    return raw;
  }

  try {
    const url = new URL(raw);
    const [, type, id] = url.pathname.split("/");

    if (url.hostname.endsWith("spotify.com") && ["track", "album", "playlist", "episode"].includes(type) && id) {
      return `spotify:${type}:${id}`;
    }
  } catch {
    return "";
  }

  return "";
}

function slugify(value) {
  return String(value || "spotify-item")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "spotify-item";
}

function imageExtension(contentType) {
  if (contentType.includes("png")) {
    return "png";
  }

  if (contentType.includes("webp")) {
    return "webp";
  }

  return "jpg";
}

async function refreshAccessToken(db) {
  const refreshToken = getSetting(db, "spotify_refresh_token");
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("Spotify token is expired and SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET are not available in this shell.");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.access_token) {
    throw new Error(`Spotify token refresh failed with HTTP ${response.status}`);
  }

  setSetting(db, "spotify_access_token", payload.access_token);
  setSetting(db, "spotify_expires_at", String(Date.now() + Number(payload.expires_in) * 1000 - 60000));

  if (payload.refresh_token) {
    setSetting(db, "spotify_refresh_token", payload.refresh_token);
  }

  return payload.access_token;
}

async function getAccessToken(db) {
  const accessToken = getSetting(db, "spotify_access_token");
  const expiresAt = Number(getSetting(db, "spotify_expires_at", "0")) || 0;

  if (accessToken && expiresAt > Date.now()) {
    return accessToken;
  }

  return refreshAccessToken(db);
}

async function spotifyGet(pathname, token) {
  const response = await fetch(`https://api.spotify.com/v1${pathname}`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Spotify API failed with HTTP ${response.status}: ${payload.error?.message || "unknown error"}`);
  }

  return payload;
}

function shapeMetadata(card, uri, spotifyItem) {
  const [, type, spotifyId] = uri.split(":");
  const images = type === "track" ? spotifyItem.album?.images || [] : spotifyItem.images || [];
  const image = images[0] || null;
  const artists = type === "track" ? spotifyItem.artists?.map((artist) => artist.name).join(", ") || "" : "";
  const show = type === "episode" ? spotifyItem.show?.name || "" : "";
  const showSpotifyUrl = type === "episode" ? spotifyItem.show?.external_urls?.spotify || "" : "";
  const albumName = type === "track" ? spotifyItem.album?.name || "" : "";
  const albumSpotifyUrl = type === "track" ? spotifyItem.album?.external_urls?.spotify || "" : "";
  const subtitle = artists || show || spotifyItem.album?.name || "";

  return {
    card_name: card.name,
    tag_id: card.tag_id,
    action_target: card.action_target,
    spotify_uri: uri,
    spotify_type: type,
    spotify_id: spotifyId,
    title: spotifyItem.name || card.name,
    subtitle,
    show_name: show,
    show_spotify_url: showSpotifyUrl,
    artist_names: artists,
    album_name: albumName,
    album_spotify_url: albumSpotifyUrl,
    release_date: spotifyItem.release_date || spotifyItem.album?.release_date || "",
    spotify_url: spotifyItem.external_urls?.spotify || card.action_target,
    image_url: image?.url || "",
    image_width: image?.width || null,
    image_height: image?.height || null,
  };
}

async function downloadImage(item) {
  if (!item.image_url) {
    return { ...item, artwork_file: "" };
  }

  const response = await fetch(item.image_url);

  if (!response.ok) {
    throw new Error(`Artwork download failed with HTTP ${response.status} for ${item.title}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const extension = imageExtension(contentType);
  const fileName = `${slugify(item.title)}--${item.spotify_type}-${item.spotify_id}.${extension}`;
  const filePath = path.join(outputDir, fileName);
  const buffer = Buffer.from(await response.arrayBuffer());

  fs.writeFileSync(filePath, buffer);

  return {
    ...item,
    artwork_file: path.relative(projectRoot, filePath).replace(/\\/g, "/"),
  };
}

function getSpotifyCards(db) {
  return db
    .prepare(
      `
      SELECT c.tag_id, c.name, a.action_target
      FROM cards c
      JOIN card_actions a ON a.tag_id = c.tag_id
      WHERE a.enabled = 1
        AND a.action_type = 'spotify_play'
      ORDER BY c.name
      `,
    )
    .all();
}

async function main() {
  if (!process.env.LOCALAPPDATA) {
    throw new Error("LOCALAPPDATA is not set; cannot find the Auri database.");
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const db = new DatabaseSync(databasePath);

  try {
    const token = await getAccessToken(db);
    const cards = getSpotifyCards(db);
    const manifest = [];

    for (const card of cards) {
      const uri = normalizeSpotifyUri(card.action_target);

      if (!uri) {
        continue;
      }

      const [, type, id] = uri.split(":");

      if (!["track", "episode"].includes(type)) {
        continue;
      }

      const spotifyItem = await spotifyGet(`/${type}s/${encodeURIComponent(id)}`, token);
      const metadata = shapeMetadata(card, uri, spotifyItem);
      manifest.push(await downloadImage(metadata));
    }

    fs.writeFileSync(manifestPath, `${JSON.stringify({ generated_at: new Date().toISOString(), items: manifest }, null, 2)}\n`);
    console.log(`Saved ${manifest.length} Spotify artwork entries to ${path.relative(projectRoot, outputDir)}`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
