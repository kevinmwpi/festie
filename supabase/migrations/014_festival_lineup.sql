-- 014_festival_lineup.sql
--
-- Announcement mode: "lineup announced, set times TBA" (docs/v1-architecture.md
-- §9.9, docs/festival-data.md §4.2). Festivals announce their lineup months
-- before set times exist, but every row of public.sets needs a start and an
-- end. public.festival_artists lists the announced acts of a festival with or
-- without a set, so a festival can be published as soon as the lineup is
-- official and the app shows "set times to be announced" until they arrive.
--
--   festival_id    the festival (cascades with it, like sets)
--   artist_id      the act (restricted, like sets.artist_id: an artist in a
--                  lineup is never deleted by accident)
--   billing_order  position or tier as the organizer lists the lineup, 1 =
--                  top; acts sharing a number are shown alphabetically within
--                  it; null = alphabetical
--
-- Invariant, enforced by the composite foreign key sets_lineup_fkey: every
-- set's artist is in that festival's lineup. festival:seed writes the lineup
-- before the sets and removes dropped acts after their stale sets. Clients
-- still read the union of the lineup and the sets' artists, so a cache written
-- by an older build renders. The backfill below seeds the lineup of every
-- existing festival from its sets before the key is added.
--
-- Read by clients through a table-level select grant and a policy that mirrors
-- sets_select_published (only rows of published festivals). No client writes:
-- only festival:seed (service role) writes the table. Artists are global and
-- public (artists_select_all), so seeding a draft lineup makes its artist rows
-- visible to every client, though not which festival they belong to; seed a
-- draft only from a lineup the organizer has already published.
--
-- Re-running 007 alone revokes every table privilege of anon/authenticated and
-- drops every policy in public (its step 2), so 014 must be applied again after
-- it (scripts/db-test.sh re-applies 007-014 in order), like 012. Statement
-- order is fail-closed under a non-transactional `supabase db push`: RLS is
-- enabled before the grant and the policy, so a partial apply yields 42501 or
-- zero rows, never draft data; `lock_timeout` is effective only when the file
-- runs in a transaction (db-test.sh). Idempotent.

set local lock_timeout = '5s';

create table if not exists public.festival_artists (
  festival_id uuid not null references public.festivals(id) on delete cascade,
  artist_id uuid not null references public.artists(id),
  billing_order integer,
  primary key (festival_id, artist_id)
);

alter table public.festival_artists
  drop constraint if exists festival_artists_billing_order_check,
  add constraint festival_artists_billing_order_check
    check (billing_order is null or billing_order between 1 and 10000);

-- The policy filters on festival_id (the primary key's leading column covers
-- it); the artist FK needs its own index (Supabase advisor: unindexed_foreign_keys).
create index if not exists festival_artists_artist_id_idx on public.festival_artists (artist_id);

alter table public.festival_artists enable row level security;

-- 007 removed the default privileges of anon/authenticated on new tables, so
-- the read grant is explicit. Clients never write the lineup; festival:seed
-- (service role) does, whatever role created the table.
revoke all on public.festival_artists from public, anon, authenticated;
grant select on public.festival_artists to anon, authenticated;
grant select, insert, update, delete on public.festival_artists to service_role;

drop policy if exists festival_artists_select_published on public.festival_artists;
create policy festival_artists_select_published on public.festival_artists
  for select to anon, authenticated
  using (exists (
    select 1 from public.festivals f where f.id = festival_id and f.status = 'published'
  ));

-- Every artist that already plays a festival is in its lineup. A no-op on
-- re-runs and after festival:seed has written the rows.
insert into public.festival_artists (festival_id, artist_id)
select distinct s.festival_id, s.artist_id
from public.sets s
on conflict (festival_id, artist_id) do nothing;

-- A set's artist is always in the festival's lineup. Plain `no action` (not
-- `restrict`): deleting a festival cascades to its sets and its lineup rows in
-- one statement, and the check runs at the end of it.
alter table public.sets
  drop constraint if exists sets_lineup_fkey,
  add constraint sets_lineup_fkey
    foreign key (festival_id, artist_id) references public.festival_artists (festival_id, artist_id);
