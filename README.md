# Gym Training Log — PWA

An installable, offline-first training log. Log sets (exercise, weight, reps),
track PRs, and see per-exercise progress charts. Data lives in **IndexedDB** on
your device and can be **backed up to Google Drive** so it survives beyond any
single browser or device.

Built with Vite + React, `idb`, Recharts, and `vite-plugin-pwa`.

## Features

- **Offline-first** — every set is written to IndexedDB instantly; the app works
  with no network at all.
- **Installable** — "Add to Home Screen" on Android/iOS gives a standalone app.
- **Google Drive backup** — optional. Uses the narrow `drive.file` scope (the
  app can only touch the single backup file it creates, nothing else in your
  Drive). Syncs on a 30s debounce and when the app is backgrounded.
- **Export** — one-tap JSON export as a no-account-needed fallback.

## Getting started

```bash
npm install
cp .env.example .env.local   # optional: add your Google client ID for Drive
npm run dev
```

Open http://localhost:5173.

### Enabling Google Drive backup

Drive sync is optional — skip this and the app still works locally with JSON
export. To enable it:

1. Go to the [Google Cloud Console](https://console.cloud.google.com).
2. Create a project and enable the **Google Drive API**.
3. Configure the **OAuth consent screen** (User type: External). While in
   testing, add your own Google account under **Test users**.
4. Create an **OAuth 2.0 Client ID** → *Web application*.
5. Under **Authorized JavaScript origins** add your origins, e.g.
   `http://localhost:5173` (dev) and your deployed HTTPS URL (prod).
6. Copy the client ID into `.env.local` as `VITE_GOOGLE_CLIENT_ID`.
7. Restart `npm run dev`. A **Connect Drive** button appears in the sync bar.

> The `drive.file` scope is auto-approved without a Google verification review
> because it grants no access to the rest of your Drive.

## How it works

| Concern      | Approach                                                            |
| ------------ | ------------------------------------------------------------------ |
| Local store  | IndexedDB via `idb` — one `entries` store keyed by `id`, indexed by `date` and `exercise` (`src/db.js`). |
| Drive sync   | Google Identity Services token client + Drive API v3 multipart upload of a single `gym-tracker-backup.json` (`src/drive.js`). |
| Conflicts    | Single-user model: local IndexedDB is source of truth, Drive is a mirror. On connect, remote entries are unioned in by `id`. |
| Offline      | Service worker (Workbox via `vite-plugin-pwa`) caches the app shell; Drive pushes are skipped while `navigator.onLine` is false and retried on the next change. |

## Testing

Three layers, none of which touch real Google:

| Layer | Tool | File |
| ----- | ---- | ---- |
| Pure logic (PRs, grouping, merge, chart data) | Vitest | `src/logic.test.js` |
| IndexedDB access | Vitest + `fake-indexeddb` (in-memory IndexedDB) | `src/db.test.js` |
| Drive sync (OAuth + REST) | Vitest with mocked `fetch` + mocked GIS token client | `src/drive.test.js` |
| Full app (render + persist + reload) | Playwright headless smoke test | `scripts/smoke.mjs` |

The Drive tests mock the two seams `drive.js` depends on — `window.google`'s
token client and `global.fetch` — and assert we send the right requests
(create vs. update, multipart body, `Authorization` header) and parse responses
correctly. Real end-to-end Drive verification is a one-time manual check once you
have a client ID.

```bash
npm test            # run unit tests once
npm run test:watch  # watch mode

# Browser smoke test (needs a built app + preview server):
npm run build && npm run preview -- --port 4173 &
node scripts/smoke.mjs
```

## Scripts

```bash
npm run dev       # dev server
npm run build     # production build (generates service worker + manifest)
npm run preview   # serve the production build locally
npm test          # unit tests (Vitest)
node scripts/gen-icons.mjs   # regenerate PNG icons from public/icon.svg
```

## Project layout

```
src/
  GymTracker.jsx   UI + state (ported from the original artifact)
  db.js            IndexedDB access layer
  drive.js         Google Drive auth + backup/restore
scripts/
  gen-icons.mjs    SVG -> PNG icon generator
public/
  icon.svg         icon source
  icons/           generated PWA icons
```
