# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Belfast Accessibility Mapper — a crowd-sourced, real-time map of accessibility blockers (broken lifts, blocked ramps/pavements, construction) in Belfast city centre. Built for a 3-hour hackathon. Full requirements: [PRD.md](PRD.md). Full technical design: [ARCHITECTURE.md](ARCHITECTURE.md).

## Commands

```bash
npm install      # install dependencies
npm run dev       # start Vite dev server
npm run build     # production build to dist/
npm run preview   # preview the production build locally
```

There is no lint or test tooling configured in this project — don't assume `npm test` or `npm run lint` exist.

Before `npm run dev` will work, Supabase must be set up (see README.md): run [supabase-setup.sql](supabase-setup.sql) in the Supabase SQL editor, enable Realtime on the `reports` table, create the public `report-photos` Storage bucket, and populate `.env` (copy from `.env.example`) with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_ORS_API_KEY` (free key from openrouteservice.org, used for turn-by-turn navigation).

Routing uses OpenRouteService, not GraphHopper — GraphHopper's free tier was tried first but its `block_area` blocker-avoidance parameter is a silent no-op unless Contraction Hierarchies is disabled (`ch.disable=true`), which its free tier rejects ("Free packages cannot use flexible mode"). ORS's `avoid_polygons` has no such gate on its free tier.

Supabase has repeatedly moved the dashboard location for enabling Realtime on a table (it is no longer under Database → Replication, which is now Pipelines/CDC-only). Don't chase the UI — run this in the SQL Editor instead, it's stable regardless of dashboard changes:
```sql
alter publication supabase_realtime add table reports;
```

**Never commit `.env` or paste real Supabase/ORS keys or URLs into commits, PRs, or this file.** It's already gitignored — keep it that way. The Supabase anon key is safe to expose *client-side in the deployed app* (that's how Supabase's public-anon-key model works, access control is enforced by RLS policies, not by hiding the key); the ORS key is a free-tier key with no sensitive access either, but the same rule applies — never land any of it in git history or docs. When setting the same vars in Vercel, use the Vercel project's environment variable settings, not a checked-in file.

## Architecture

There is no application backend. This is a static frontend (Vite + vanilla JS + Leaflet) that talks directly from the browser to Supabase using the public anon key — Postgres is the data store, Supabase Realtime pushes live updates, and Supabase Storage holds uploaded photos. Access control is enforced entirely through Postgres RLS policies (anonymous read + insert on `reports`), not application code, because there is no auth/accounts in this app (see PRD Out of Scope).

Everything hangs off a single `reports` table (`id`, `lat`, `lng`, `category`, `photo_url`, `created_at`) — schema in [supabase-setup.sql](supabase-setup.sql).

The real-time sync (the core demo feature, FR-03) works by every client subscribing once to Postgres `INSERT` and `DELETE` events on `reports` via `supabase.channel(...).on('postgres_changes', ...)`, and rendering the new pin or removing the deleted one immediately — see `subscribeToReportChanges()` in [src/main.js](src/main.js). There is no custom WebSocket server or pub/sub layer; Supabase Realtime is the entire mechanism.

A user can delete a report they submitted (a "Delete my report" button appears in that pin's popup). There's no auth, so "own report" is tracked client-side only, via a list of submitted report IDs in `localStorage` — the DB's RLS delete policy allows anyone to delete any row (same accepted-risk trust model as insert/read), the Delete button is just not shown for reports that aren't in the current browser's local list.

The report submission flow (FR-02, in [src/main.js](src/main.js)) is: get GPS position (fallback to tap-to-place if denied) → draggable Leaflet marker → category selection → optional photo upload to Supabase Storage → insert row into `reports`. Category → icon/color mapping lives in [src/categories.js](src/categories.js) and is the single place to add/change a category.

The app is a PWA ([public/manifest.webmanifest](public/manifest.webmanifest), [public/sw.js](public/sw.js)) so it can be added to a phone's home screen without an app store — this only activates over HTTPS (the deployed Vercel URL), not on `localhost`.

Turn-by-turn navigation (FR-04, in [src/navigation.js](src/navigation.js)) is two-phase: a route **preview**, then optional live **guidance**. Preview: tap "Navigate" → GPS or tap for start → tap for destination → OpenRouteService Directions API (`foot-walking` profile) returns a route avoiding an in-memory `reportsStore` array of current blockers via its `avoid_polygons` option (each blocker becomes a small circular polygon). `reportsStore` (in [src/main.js](src/main.js)) is populated from both `loadExistingReports()` and the realtime INSERT handler, and is read fresh via a getter each time a route is (re)calculated.

Tapping "Start" on a previewed route enters live guidance: `navigator.geolocation.watchPosition` tracks the walker, a Google Maps-style banner (`#nav-live-banner`) shows the current maneuver and live distance-to-turn, and the map follows the user's position (until they pan, at which point a recenter FAB reappears). Position fixes are projected onto the route polyline (`nearestPointOnPath` in [src/geo.js](src/geo.js)) to detect step completion, cross-track (off-route) distance, and arrival. The route *does* auto-recalculate mid-walk in two cases: the walker straying more than ~30m from the route for a few consecutive fixes, or a new blocker report landing within the block-avoidance radius of the remaining path — both reuse the same ORS request path as the initial preview, so a reroute picks up whatever is in `reportsStore` at that moment.

## Team & Ownership (hackathon build)

Three devs working in parallel on the same repo. Respect these ownership boundaries to avoid merge conflicts — check with the owning dev before editing outside your area.

| Dev | Owns | Feature | Why prioritized |
|---|---|---|---|
| Dev 1 | Supabase schema + Realtime subscription wiring | FR-03 | Highest-risk, load-bearing feature — start immediately, verify two-client live pin sync works before anything else gets polished |
| Dev 2 | Map view: Leaflet + custom category icons + seed data rendering | FR-01 | Can build against a mocked/static report list first, swap to live Supabase data once Dev 1's schema exists |
| Dev 3 | Report submission flow: GPS placement, drag-to-refine, category picker, optional photo upload | FR-02 | Depends on Dev 1's schema as the insert target, but the UI can be built in parallel against a stub |

**Sequencing:**
- **T+0 to T+15min:** Dev 1 shares the finalized Supabase table schema so Dev 2 and Dev 3 are not blocked.
- **T+45min (first integration checkpoint):** confirm a manual insert into Supabase shows up live on Dev 2's map — this validates FR-03 end-to-end before further polish work continues.
