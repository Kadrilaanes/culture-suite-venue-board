// Inlines src/ into one self-contained HTML file at dist/venue-board.html.
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const css   = read('src/styles.css');
const js    = read('src/app.js');
const maps  = read('src/data/maps.json');
const seed  = read('src/data/seed-venues.json');
const html  = read('src/index.html');

const body = html
  .split('<body>')[1]
  .replace('<script src="app.js"></script>', '')
  .replace('</body>', '')
  .replace('</html>', '')
  .trim();

const preload =
  `<script>window.__VENUE_BOARD_DATA={"data/maps.json":${maps},"data/seed-venues.json":${seed}};</script>`;

const out = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Culture Suite Venue Board</title>
<meta name="description" content="Website licence pipeline for ticketed cultural venues.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js"></script>
<style>
${css}</style>
</head>
<body>
${body}
${preload}
<script>
${js}</script>
</body>
</html>
`;

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/venue-board.html'), out);
console.log('dist/venue-board.html', Math.round(out.length / 1024) + ' kB');
