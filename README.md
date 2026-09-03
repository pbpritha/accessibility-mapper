# Belfast Accessibility Mapper

Crowd-sourced, real-time map of accessibility blockers (lifts, ramps, pavements) in Belfast city centre. See [PRD.md](PRD.md) for requirements and [ARCHITECTURE.md](ARCHITECTURE.md) for the technical design.

## Setup

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase SQL editor, run [`supabase-setup.sql`](supabase-setup.sql). It creates the `reports` table, RLS policies, and seed data.
3. Enable Realtime on `reports`. Supabase's dashboard location for this has moved before and may move again — the reliable way is to run this in the SQL Editor:
   ```sql
   alter publication supabase_realtime add table reports;
   ```
   (As of writing, the UI equivalent is **Database → Publications** → `supabase_realtime` → toggle on `reports`. **Database → Replication** is now for Pipelines/CDC, not this.)
4. In Supabase: **Storage** → create a public bucket named `report-photos`, with anonymous upload + read allowed.
5. Copy `.env.example` to `.env` and fill in your project's URL and anon key (Supabase dashboard → Project Settings → API).
6. Create a free account at [openrouteservice.org](https://openrouteservice.org/dev/#/signup), generate an API key, and add it to `.env` as `VITE_ORS_API_KEY` (used for turn-by-turn navigation, FR-04). GraphHopper's free tier was tried first but its `block_area` blocker-avoidance parameter is silently ignored unless "flexible mode" is enabled, which requires a paid plan — ORS's free tier supports `avoid_polygons` with no such restriction.
7. Install and run:

```bash
npm install
npm run dev
```

8. Open the printed local URL. Open it again in a second browser/tab to test real-time sync (FR-03): submit a report in one, watch it appear in the other without refreshing.

## Installing on a phone

The app is a PWA — no app store needed:

- **Android (Chrome):** open the deployed URL, tap the browser menu → "Add to Home Screen" (Chrome may also prompt automatically).
- **iOS (Safari):** open the deployed URL, tap Share → "Add to Home Screen".

This requires HTTPS, so it only works on the deployed Vercel URL, not `localhost`.

## Deploy

```bash
npm run build
npx vercel --prod
```

Set the same three env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ORS_API_KEY`) in the Vercel project settings.
