# Architecture — Belfast Accessibility Mapper

**Scope:** 3-hour hackathon build. This document covers only what's needed to ship the PRD's Must Have features (FR-01, FR-02, FR-03). No enterprise sections, no future-proofing.

---

## 1. System Overview

A single-page web app where anyone can view and add pins on a map of Belfast city centre. Pins sync live across all open browser sessions with no login, no backend code, and no custom server.

```
┌─────────────────────┐        ┌──────────────────────┐
│   Browser (User A)   │        │   Browser (User B)    │
│  ┌────────────────┐  │        │  ┌────────────────┐   │
│  │ Leaflet map UI  │  │        │  │ Leaflet map UI  │   │
│  │ + report form   │  │        │  │ (view only atm) │   │
│  └───────┬────────┘  │        │  └───────┬────────┘   │
│          │ supabase-js         │          │ supabase-js
└──────────┼───────────┘        └──────────┼────────────┘
           │  insert report              subscribe (Realtime)
           │  read reports                  │
           ▼                                ▼
        ┌────────────────────────────────────────┐
        │              Supabase                   │
        │  Postgres table: reports                │
        │  Realtime (logical replication broadcast)│
        │  Storage bucket: report-photos (public)  │
        └────────────────────────────────────────┘
                         ▲
                         │ tiles (no auth, no key)
        ┌────────────────────────────────────────┐
        │   OpenStreetMap tile server (public)     │
        └────────────────────────────────────────┘
```

There is no application server. The browser talks directly to Supabase (Postgres + Realtime + Storage) using the public anon key, and to OpenStreetMap for map tiles. Hosting is static (Vercel).

---

## 2. Components

| Component | Technology | Responsibility |
|---|---|---|
| Frontend | Vite + vanilla JS (or React if the team is faster in it) + Leaflet.js | Render map, render pins, handle report flow (GPS, drag-to-place, category, photo, submit), subscribe to live updates |
| Map tiles | OpenStreetMap (via Leaflet's `L.tileLayer`) | Free base map, no API key |
| Geolocation | Browser Geolocation API | Get user's current lat/lng for auto pin placement |
| Backend/DB | Supabase Postgres | Single `reports` table, source of truth |
| Realtime sync | Supabase Realtime | Broadcasts INSERTs on `reports` to all subscribed clients |
| File storage | Supabase Storage (public bucket) | Stores optional report photos, returns a public URL |
| Hosting | Vercel | Serves the static built frontend |
| Routing | OpenRouteService Directions API (`foot-walking` profile) | Calculates a one-shot walking route between a start and tapped destination, avoiding reported blockers via `avoid_polygons` |

**Why this stack fits the 3-hour constraint:** no backend code to write or deploy — Supabase gives DB + live sync + file storage as managed services reachable directly from the browser. The PRD's own constraints section mandates this exact stack.

---

## 3. Data Model

One table is enough for the whole MVP.

```sql
create table reports (
  id uuid primary key default gen_random_uuid(),
  lat double precision not null,
  lng double precision not null,
  category text not null check (category in ('lift', 'construction', 'blocked_ramp', 'blocked_pavement')),
  photo_url text,              -- nullable, public Storage URL
  created_at timestamptz not null default now()
);

-- Anonymous, unmoderated MVP: allow anyone to read and insert.
alter table reports enable row level security;

create policy "Anyone can read reports"
  on reports for select
  using (true);

create policy "Anyone can insert reports"
  on reports for insert
  with check (true);

create policy "Anyone can delete reports"
  on reports for delete
  using (true);
```

Enable Realtime on the table (Supabase dashboard → Database → Replication → toggle `reports`), and create a **public** Storage bucket called `report-photos` with public read + anonymous upload policy.

No `users` table, no auth tables — matches PRD Out of Scope (no accounts/login).

---

## 4. Core Flow — Real-Time Report Propagation (FR-03, the demo feature)

```
User A                    Supabase                    User B
  │                          │                            │
  │  place pin, pick         │                            │
  │  category, submit ──────▶│  INSERT INTO reports        │
  │                          │──────────────┐             │
  │                          │              │ replication  │
  │  pin appears locally     │              ▼ broadcast    │
  │  immediately (optimistic │        Realtime channel     │
  │  or on insert response)  │              │             │
  │                          │              └────────────▶│ payload.new
  │                          │                            │ → add pin to map
  │                          │                            │ (no refresh)
```

Implementation shape (client):

```js
// subscribe once on page load
supabase
  .channel('reports-changes')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reports' },
    (payload) => addPinToMap(payload.new))
  .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reports' },
    (payload) => removePinFromMap(payload.old.id))
  .subscribe();

// on submit
await supabase.from('reports').insert({ lat, lng, category, photo_url });

// on delete (own report only, enforced client-side — see Section 8)
await supabase.from('reports').delete().eq('id', id);
```

That's the entire real-time mechanism — no WebSocket server, no custom pub/sub to build. Deletes propagate live the same way inserts do, so if User A deletes their report, it disappears from User B's map immediately too.

---

## 5. Report Submission Flow (FR-02)

1. User taps "Report" → app calls `navigator.geolocation.getCurrentPosition()`.
2. On success: drop a draggable Leaflet marker at that lat/lng. On failure/denied: prompt "tap the map to place your pin" and place marker on next map click.
3. User drags marker to refine position (optional).
4. User picks one of 4 categories (icon buttons).
5. User optionally attaches a photo → upload to Supabase Storage bucket first, get public URL.
6. Submit → insert row into `reports` with lat/lng/category/photo_url; `created_at` is set automatically by the DB default.
7. Pin renders immediately for the submitting user (either from the insert's returned row, or via the same Realtime subscription everyone else uses).

---

## 5a. Navigation Flow (FR-04)

The client keeps an in-memory `reportsStore` array (`src/main.js`), populated from both `loadExistingReports()` and the Realtime subscription's INSERT handler — this is the live list of current blockers, read fresh each time a route is requested (via a getter function, not a snapshot).

1. User taps "Navigate" → app calls `navigator.geolocation.getCurrentPosition()` for the start point; on denial, the user taps the map twice (start, then destination) instead.
2. User taps the map to set the destination (`src/navigation.js`).
3. The app POSTs to the OpenRouteService Directions API (`foot-walking` profile) with `options.avoid_polygons` built from the current `reportsStore` (each blocker approximated as a small circular polygon, ~15m radius).
4. On success, the returned route geometry is drawn on the map and the instruction list (`properties.segments[].steps`) is rendered as text + distance.
5. If `avoid_polygons` makes the destination unreachable, the app automatically retries once without it and shows a warning that the route may cross a blocker. If no route exists at all, the user sees a message and can tap a new destination.

**Why OpenRouteService, not GraphHopper:** GraphHopper was the original choice, but its free tier's `block_area` parameter is silently ignored unless Contraction Hierarchies is disabled (`ch.disable=true`) — and the free tier rejects that flag outright ("Free packages cannot use flexible mode"), so blocker avoidance never actually worked. ORS's `avoid_polygons` has no equivalent paid-tier gate.
6. The route is calculated once and does **not** re-calculate automatically if new reports arrive mid-navigation or as the user moves — this is a deliberate one-shot design, not live GPS tracking. To get an updated route, the user stops and restarts navigation.

Reusing `map.once('click', ...)` for both the report flow and the navigation flow required a small coexistence rule: starting either flow cancels the other (`cancelNavigation()` / `cancelReportFlow()`), so a single tap can't be captured by both handlers at once.

---

## 6. Seed Data (PRD 3.1: map must not be empty on first load)

Insert 5-10 rows directly into `reports` via the Supabase SQL editor before the demo, spread across real Belfast city centre coordinates (e.g. around Donegall Square, Royal Avenue, Victoria Square), covering all 4 categories so the icon variety is visible immediately.

---

## 7. Environments & Config

| Concern | Approach |
|---|---|
| Secrets | Supabase URL + anon key are safe to ship in frontend code (RLS policies are the real access control) |
| Config | `.env` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ORS_API_KEY`, loaded via Vite's `import.meta.env` |
| Deployment | `vercel --prod` (or connect GitHub repo to Vercel for auto-deploy on push) |
| Mobile testing | Open the deployed Vercel URL directly on a phone browser — no app store, no build step needed for testers |
| Install to home screen | App is a PWA (`manifest.webmanifest` + minimal `sw.js`): on Android Chrome, browser offers "Add to Home Screen"; on iOS Safari, user taps Share → "Add to Home Screen". No app store submission — that's out of scope, native app store distribution needs a native wrapper (Capacitor) and review time not available in 3 hours |

---

## 8. Explicitly Not Built (matches PRD Out of Scope)

- No auth/accounts, no login screens. "Delete your own report" is therefore enforced only client-side (localStorage tracks which report IDs this browser submitted); the DB itself allows any anonymous client to delete any row.
- No moderation queue or content filtering on photos.
- No push notifications.
- No map rotation/compass-up view or spoken (voice) turn-by-turn during live guidance (FR-04) — guidance is visual only, north-up.
- No geocoding/address search for destinations — destination is set by tapping the map only.
- No report expiry logic.
- No automated test suite — manual two-device verification only (per NFR-01).

---

## 9. Build Order (suggested, ~3 hours)

1. **(20 min)** Supabase project setup: create project, run the `reports` table SQL above, create Storage bucket, enable Realtime, grab URL + anon key.
2. **(20 min)** Scaffold frontend (see below), get Leaflet rendering a map centred on Belfast with OSM tiles.
3. **(30 min)** Load + render seed pins from Supabase on page load, with 4 distinct icons per category.
4. **(45 min)** Build the report flow: geolocation → draggable marker → category picker → optional photo upload → insert.
5. **(20 min)** Wire up the Realtime subscription so inserts from any client render live on all clients.
6. **(15 min)** Insert seed data, deploy to Vercel.
7. **(30 min)** Two-phone/two-tab live test of FR-03, fix any issues, polish tap targets/contrast for NFR-03.

---

## 10. Risks Carried Forward (from PRD Section 7, accepted)

- Anonymous, unmoderated photo uploads — no mitigation planned for MVP, documented and accepted.
- No verification of report accuracy — trust model is "anyone can post," acceptable for hackathon demo scale (<10 users).
