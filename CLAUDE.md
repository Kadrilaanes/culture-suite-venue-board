# CLAUDE.md — Culture Suite Venue Board

Project context for any Claude agent (Claude Code / Claude Desktop) working in this repo.

## What this is

A website-licence sales pipeline for ticketed cultural venues (theatres, opera houses,
concert halls, museums). Five views over one dataset: **Venues**, **Leads**,
**Priority Board**, **Intel Feed**, **Territory** (map, no tile server). Vanilla
HTML/CSS/JS — no framework, no bundler, no runtime dependencies.

## Ownership & access (as of 2026-08-29)

- **GitHub owner:** Kadri Laanes (`Kadrilaanes`) — this repo is hers
- **Deployment:** Cloudflare Worker `culture-suite-venue-board-gate` on account
  `b3a5b3d8f1c772bb8e1e23725f79b979` — Kadri has Administrator role there
  (accept the invite from `lordlagaa@gmail.com` if not yet done)
- **Live URL:** https://culture-suite-venue-board-gate.fluence-hitlist.workers.dev
  (password-gated)
- **Legacy duplicate:** `lordlagaa-lab/culture-suite-venue-board` (old home, stale —
  do not use as source of truth)
- **Do NOT touch the GitHub Pages URL** (`lordlagaa-lab.github.io/...`) — stale
  client-gate build, kept only because it may be linked somewhere.

## Stack & structure

```
src/index.html      # shell (head, fonts, CDN libs)
src/app.js          # the whole app (state, views, map)
src/styles.css      # theming (light/dark via CSS vars)
src/data/maps.json       # region geometry (europe/na) for SVG + choropleth
src/data/seed-venues.json# 86 seed venues with lat/lon
tools/build-single.mjs   # inlines src/ → single-file dist/venue-board.html
dist/venue-board.html    # THE artifact that gets deployed (committed)
worker/src/index.js      # auth-gate Worker (password → signed cookie → serves assets)
worker/wrangler.toml     # worker config; assets = ../dist, run_worker_first = true
```

## Build & deploy (no CI — all manual)

```bash
npm run build          # rebuilds dist/venue-board.html from src/
git add -A && git commit -m "..." && git push origin main   # dist is committed
```

Then deploy the worker (ships the `dist/` assets):

```bash
export CLOUDFLARE_API_TOKEN="<token with Workers:Edit + Pages:Edit>"
export CLOUDFLARE_ACCOUNT_ID="b3a5b3d8f1c772bb8e1e23725f79b979"
cd worker && npx wrangler deploy
```

Verify: `curl -s https://culture-suite-venue-board-gate.fluence-hitlist.workers.dev/api/auth/status`
→ `{"ok":false}` when logged out; full login flow → `/venue-board` HTTP 200.

## Auth model

- Worker enforces a shared password gate (not per-user accounts).
- `PASSWORD` + `JWT_SECRET` are **Cloudflare Worker secrets** (write-only), NOT in
  this repo. Ask the previous owner for the current password, or rotate:
  ```bash
  echo 'new-password' | npx wrangler secret put PASSWORD
  ```
  (`JWT_SECRET` should stay stable; rotate only if you want everyone logged out.)
- Session = HttpOnly `csb_session` cookie, 7-day TTL, HMAC-signed (SHA-256).

## Data persistence — IMPORTANT

- Seed data ships inside `dist/venue-board.html` (inlined at build time).
- Runtime fetch of `data/board.json` **404s on this static deploy** by design; the app
  falls back to `localStorage` (key `cs-venue-board-v2`, schema `>= 2` guard).
- **LocalStorage key was bumped v1 → v2 (2026-08-29)** to discard stale map-less
  state from an older build. Do NOT revert to v1, and do NOT preload
  `data/board.json` in the build — that would make the app always treat seed as
  authoritative and wipe per-browser local edits.

## Map (Territory view)

- Interactive MapLibre GL map when CDN libs load; static SVG map is the fallback.
- `initInteractiveMap` is intentionally idempotent (`mapBuilding` guard) — do not
  remove the guard; re-renders happen on every tab/theme change and would spawn
  duplicate MapLibre instances.
- If the world-atlas CDN fails, `svgForced` flips and the SVG map renders instead.

## Pitfalls learned the hard way (2026-08-29)

1. **The live worker can serve a STALE build.** The old deploy predated the map +
   theme + Territory-default commits. After any `npm run build`, you MUST
   `wrangler deploy` — the worker's assets come from `dist/` at deploy time.
2. **Login test via curl vs browser:** the login endpoint returns `{"ok":true}` and
   sets the cookie; a browser then redirects to `/venue-board`. Always verify the
   full flow (login → cookie → `/venue-board` 200 + expected markers).
3. **Cloudflare `secret put` output redacts the value** — don't trust the echo; keep
   the value somewhere safe before overwriting (secrets are write-only).
4. **`.env` token extraction:** values are double-quoted; strip quotes
   (`tr -d '"'`) or auth fails with `[code: 6111]`.
5. **Repos diverge fast if two agents push.** One implementer per change; the
   canonical repo is `Kadrilaanes/culture-suite-venue-board`.

## Secrets you may need from the previous owner

- Current `PASSWORD` (worker gate) — not stored in this repo.
- Cloudflare API token (or rotate your own with Workers:Edit).
- `JWT_SECRET` — leave unchanged unless you intentionally invalidate sessions.
