-- Run this once in the Supabase SQL editor for a new project.

create table reports (
  id uuid primary key default gen_random_uuid(),
  lat double precision not null,
  lng double precision not null,
  category text not null check (category in ('lift', 'construction', 'blocked_ramp', 'blocked_pavement')),
  photo_url text,
  created_at timestamptz not null default now()
);

alter table reports enable row level security;

create policy "Anyone can read reports"
  on reports for select
  using (true);

create policy "Anyone can insert reports"
  on reports for insert
  with check (true);

-- No accounts/auth exist (see PRD Out of Scope), so "delete your own report" is enforced only
-- client-side (the app only shows a Delete button for report IDs it remembers submitting, in
-- localStorage). This policy allows any anonymous client to delete any row, consistent with the
-- app's existing accepted-risk trust model (anyone can already insert/read anonymously).
create policy "Anyone can delete reports"
  on reports for delete
  using (true);

-- After running this:
-- 1. Database -> Replication -> enable Realtime on the "reports" table.
-- 2. Storage -> create a new PUBLIC bucket named "report-photos".
--    Add a policy allowing anonymous INSERT (upload) and SELECT (read) on that bucket.

-- Seed data (adjust coordinates as needed, these are approximate Belfast city centre points)
insert into reports (lat, lng, category) values
  (54.5966, -5.9297, 'lift'),
  (54.5981, -5.9280, 'construction'),
  (54.5970, -5.9330, 'blocked_ramp'),
  (54.5990, -5.9310, 'blocked_pavement'),
  (54.5955, -5.9265, 'blocked_ramp');
