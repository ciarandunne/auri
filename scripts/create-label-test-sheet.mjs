import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = process.cwd();
const artworkDir = path.join(projectRoot, "data", "spotify-artwork");
const outputDir = path.join(projectRoot, "data", "print-sheets");
const outputHtml = path.join(outputDir, "spotify-artwork-test-sheet.html");
const manifestPath = path.join(artworkDir, "manifest.json");

const selectedTitles = new Set([
  "Claude the Crab",
  "Delphine Dolphin",
  "Cici the Seahorse",
]);

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function labelFor(item) {
  const imagePath = path.join(projectRoot, item.artwork_file);
  const imageUrl = pathToFileURL(imagePath).href;

  return `
    <figure class="label">
      <img src="${imageUrl}" alt="${escapeHtml(item.title)}">
    </figure>
  `;
}

function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const items = manifest.items.filter((item) => selectedTitles.has(item.title)).slice(0, 3);

  if (items.length !== 3) {
    throw new Error(`Expected 3 artwork items, found ${items.length}. Refresh Spotify artwork first.`);
  }

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Kids Tunes Spotify Artwork Test Sheet</title>
    <style>
      @page {
        size: A4;
        margin: 14mm;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: #ffffff;
        color: #111111;
        font-family: Arial, sans-serif;
      }

      .sheet {
        display: flex;
        flex-wrap: wrap;
        gap: 12mm;
        align-content: flex-start;
      }

      .label {
        width: 50mm;
        height: 50mm;
        margin: 0;
        padding: 1mm;
        border: 0.2mm dashed #b8b8b8;
        display: grid;
        place-items: center;
        break-inside: avoid;
      }

      .label img {
        width: 48mm;
        height: 48mm;
        object-fit: contain;
        display: block;
      }
    </style>
  </head>
  <body>
    <main class="sheet">
      ${items.map(labelFor).join("\n")}
    </main>
  </body>
</html>
`;

  fs.writeFileSync(outputHtml, html);
  console.log(outputHtml);
}

main();
