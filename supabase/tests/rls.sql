-- supabase/tests/rls.sql — security contract tests (docs/v1-architecture.md §2, §7 gate 3).
--
-- Runs inside one transaction that is rolled back. Fixtures are inserted as
-- the superuser; every assertion then runs as a concrete identity through
-- pg_temp.become(), which sets `role` and `request.jwt.claims` exactly like
-- PostgREST does. Every negative assertion is paired with a positive control
-- under the same identity, so a test cannot pass merely because the identity
-- or fixture is broken.
--
-- Run with: npm run db:test

begin;
select plan(385);

-- ===========================================================================
-- Identities
-- ===========================================================================
-- Profiles: b0000000-0000-4000-8000-0000000000NN; auth: a0000000-...-0000000000NN
--   01 alice  (GA admin)        02 bob    (GA, GB member; blocks erin)
--   03 carol  (stranger)        04 dave   (GB admin)
--   05 erin   (GA member)       06 frank  (GC admin)
--   07 zed    (GZ admin)        08 yan    (GZ member)
--   09 solo   (only member GS)  10 newbie (auth only, no profile)
--   11 joiner                   12 grace  (brute-forces invite codes)
--   13 nopro  (auth only)       14 hank   (GA member, gets removed)
--   15 ivy / 16 jack / 17 kim   (GH: ivy admin)
--   18 lou / 19 max / 20 ned    (GT: lou + max admins)
--   21 rev    (demo reviewer, auth only)
--   22 demo1 / 23 demo2         (Festie Demo Crew)
--   24 troll  (GP member, gets banned; fixture created in section P)
create function pg_temp.become(p_who text)
returns void
language plpgsql
as $$
declare
  v_n integer;
begin
  if p_who = 'superuser' then
    perform set_config('request.jwt.claims', '', true);
    perform set_config('role', 'none', true);
    return;
  elsif p_who = 'anon' then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('role', 'anon', true);
    return;
  elsif p_who = 'service_role' then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
    perform set_config('role', 'service_role', true);
    return;
  elsif p_who = 'supabase_auth_admin' then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
    perform set_config('role', 'supabase_auth_admin', true);
    return;
  end if;

  v_n := array_position(
    array['alice','bob','carol','dave','erin','frank','zed','yan','solo','newbie','joiner','grace',
          'nopro','hank','ivy','jack','kim','lou','max','ned','rev','demo1','demo2','troll'],
    p_who
  );
  if v_n is null then
    raise exception 'unknown test identity %', p_who;
  end if;

  perform set_config('role', 'none', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', format('a0000000-0000-4000-8000-%s', lpad(v_n::text, 12, '0')),
      'role', 'authenticated',
      'email', p_who || '@example.com'
    )::text,
    true
  );
  perform set_config('role', 'authenticated', true);
end
$$;
grant execute on function pg_temp.become(text) to public;

-- ===========================================================================
-- Fixtures (superuser)
-- ===========================================================================
insert into auth.users (id, email)
select format('a0000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid, name || '@example.com'
from unnest(array['alice','bob','carol','dave','erin','frank','zed','yan','solo','newbie','joiner','grace',
                  'nopro','hank','ivy','jack','kim','lou','max','ned','rev','demo1','demo2'])
     with ordinality as t(name, n);

insert into public.users (id, auth_user_id, email, display_name, avatar_type, avatar_value)
select
  format('b0000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  format('a0000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  name || '@example.com',
  case name when 'zed' then 'Zedword Zed' else initcap(name) end,
  'initials',
  ''
from unnest(array['alice','bob','carol','dave','erin','frank','zed','yan','solo','newbie','joiner','grace',
                  'nopro','hank','ivy','jack','kim','lou','max','ned','rev','demo1','demo2'])
     with ordinality as t(name, n)
where name not in ('newbie', 'nopro', 'rev');

-- 50 filler members for the full-group test.
insert into auth.users (id, email)
select format('a1000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid, format('filler%s@example.com', n)
from generate_series(1, 50) n;
insert into public.users (id, auth_user_id, email, display_name)
select
  format('b1000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  format('a1000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
  format('filler%s@example.com', n),
  format('Filler %s', n)
from generate_series(1, 50) n;

insert into public.festivals (id, name, start_date, end_date, timezone, status, is_demo, source_url, latitude, longitude) values
  ('f0000000-0000-4000-8000-000000000001', 'Published One', '2027-06-01', '2027-06-03', 'America/Chicago', 'published', false, 'https://example.com/one', null, null),
  ('f0000000-0000-4000-8000-000000000002', 'Published Two', '2027-07-01', '2027-07-02', 'UTC', 'published', false, 'https://example.com/two', null, null),
  ('f0000000-0000-4000-8000-000000000003', 'Draft Fest', '2027-08-01', '2027-08-02', 'UTC', 'draft', false, null, null, null),
  ('f0000000-0000-4000-8000-000000000004', 'Demo Fest', '2027-09-01', '2027-09-03', 'America/Denver', 'published', true, null, 39.75, -104.95);

insert into public.stages (id, festival_id, name, latitude, longitude) values
  ('c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'S1', null, null),
  ('c0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'S2', null, null),
  ('c0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000002', 'S3', null, null),
  ('c0000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000003', 'SD', null, null),
  ('c0000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000004', 'Demo A', 39.7501, -104.9501),
  ('c0000000-0000-4000-8000-000000000006', 'f0000000-0000-4000-8000-000000000004', 'Demo B', 39.7505, -104.9505);

insert into public.artists (id, name) values
  ('ad000000-0000-4000-8000-000000000001', 'Artist One'),
  ('ad000000-0000-4000-8000-000000000002', 'Artist Two'),
  ('ad000000-0000-4000-8000-000000000003', 'Artist Three');

-- The announced lineup (014): every set's artist must be in it (sets_lineup_fkey). Artist Three is
-- announced for Published One without a set yet ("set times to be announced").
insert into public.festival_artists (festival_id, artist_id, billing_order) values
  ('f0000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000001', 1),
  ('f0000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000002', 2),
  ('f0000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000003', null),
  ('f0000000-0000-4000-8000-000000000002', 'ad000000-0000-4000-8000-000000000001', null),
  ('f0000000-0000-4000-8000-000000000003', 'ad000000-0000-4000-8000-000000000002', 1);

insert into public.sets (id, festival_id, artist_id, stage_id, start_time, end_time) values
  ('e5000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', '2027-06-01T20:00:00Z', '2027-06-01T21:00:00Z'),
  ('e5000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', '2027-06-01T21:00:00Z', '2027-06-01T22:00:00Z'),
  ('e5000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000002', 'ad000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', '2027-07-01T20:00:00Z', '2027-07-01T21:00:00Z'),
  ('e5000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000003', 'ad000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000004', '2027-08-01T20:00:00Z', '2027-08-01T21:00:00Z');

insert into public.groups (id, festival_id, name, created_by_user_id, invite_code) values
  ('90000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'Group A', 'b0000000-0000-4000-8000-000000000001', 'AAAAA2'),
  ('90000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', 'Group B', 'b0000000-0000-4000-8000-000000000004', 'BBBBB2'),
  ('90000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000001', 'Group C', 'b0000000-0000-4000-8000-000000000006', 'CCCCC2'),
  ('90000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000001', 'Zedword Crew', 'b0000000-0000-4000-8000-000000000007', 'ZZZZZ2'),
  ('90000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000001', 'Solo Crew', 'b0000000-0000-4000-8000-000000000009', 'SSSSS2'),
  ('90000000-0000-4000-8000-000000000006', 'f0000000-0000-4000-8000-000000000001', 'Full Crew', 'b1000000-0000-4000-8000-000000000001', 'FFFFF2'),
  ('90000000-0000-4000-8000-000000000007', 'f0000000-0000-4000-8000-000000000001', 'Group H', 'b0000000-0000-4000-8000-000000000015', 'HHHHH2'),
  ('90000000-0000-4000-8000-000000000008', 'f0000000-0000-4000-8000-000000000001', 'Group T', 'b0000000-0000-4000-8000-000000000018', 'TTTTT2'),
  ('90000000-0000-4000-8000-000000000009', 'f0000000-0000-4000-8000-000000000004', 'Festie Demo Crew', 'b0000000-0000-4000-8000-000000000022', 'DDDDD2');

insert into public.group_members (group_id, user_id, role, joined_at) values
  ('90000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'admin',  now() - interval '4 days'),
  ('90000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'member', now() - interval '3 days'),
  ('90000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000005', 'member', now() - interval '2 days'),
  ('90000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000014', 'member', now() - interval '1 day'),
  ('90000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000004', 'admin',  now() - interval '3 days'),
  ('90000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'member', now() - interval '2 days'),
  ('90000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000006', 'admin',  now() - interval '3 days'),
  ('90000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000007', 'admin',  now() - interval '3 days'),
  ('90000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000008', 'member', now() - interval '2 days'),
  ('90000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000009', 'admin',  now() - interval '3 days'),
  ('90000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000015', 'admin',  now() - interval '3 days'),
  ('90000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000016', 'member', now() - interval '2 days'),
  ('90000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000017', 'member', now() - interval '1 day'),
  ('90000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000018', 'admin',  now() - interval '3 days'),
  ('90000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000019', 'admin',  now() - interval '2 days'),
  ('90000000-0000-4000-8000-000000000008', 'b0000000-0000-4000-8000-000000000020', 'member', now() - interval '1 day'),
  ('90000000-0000-4000-8000-000000000009', 'b0000000-0000-4000-8000-000000000022', 'admin',  now() - interval '3 days'),
  ('90000000-0000-4000-8000-000000000009', 'b0000000-0000-4000-8000-000000000023', 'member', now() - interval '2 days');

insert into public.group_members (group_id, user_id, role, joined_at)
select '90000000-0000-4000-8000-000000000006',
       format('b1000000-0000-4000-8000-%s', lpad(n::text, 12, '0'))::uuid,
       case when n = 1 then 'admin' else 'member' end,
       now() - make_interval(hours => 100 - n)
from generate_series(1, 50) n;

insert into public.user_set_selections (id, user_id, festival_id, set_id) values
  ('5e000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001'),
  ('5e000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001'),
  ('5e000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000003'),
  ('5e000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000005', 'f0000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001'),
  ('5e000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000003'),
  ('5e000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001'),
  ('5e000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000007', 'f0000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001');

insert into public.meetups (id, group_id, title, notes, starts_at, created_by_user_id, totem_path, updated_at) values
  ('e0000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'Alice meetup', null, now() + interval '1 day', 'b0000000-0000-4000-8000-000000000001', null, now() - interval '1 day'),
  ('e0000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', 'Erin meetup', 'By the bins', now() + interval '1 day', 'b0000000-0000-4000-8000-000000000005',
   '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000002/0b000000-0000-4000-8000-000000000002.jpg', now()),
  ('e0000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000002', 'Dave meetup', null, now() + interval '1 day', 'b0000000-0000-4000-8000-000000000004',
   '90000000-0000-4000-8000-000000000002/e0000000-0000-4000-8000-000000000003/0b000000-0000-4000-8000-000000000003.jpg', now()),
  ('e0000000-0000-4000-8000-000000000004', '90000000-0000-4000-8000-000000000004', 'Zed meetup', null, now() + interval '1 day', 'b0000000-0000-4000-8000-000000000007',
   '90000000-0000-4000-8000-000000000004/e0000000-0000-4000-8000-000000000004/0b000000-0000-4000-8000-000000000004.jpg', now()),
  ('e0000000-0000-4000-8000-000000000005', '90000000-0000-4000-8000-000000000005', 'Solo meetup', null, now() + interval '1 day', 'b0000000-0000-4000-8000-000000000009',
   '90000000-0000-4000-8000-000000000005/e0000000-0000-4000-8000-000000000005/0b000000-0000-4000-8000-000000000005.jpg', now()),
  ('e0000000-0000-4000-8000-000000000006', '90000000-0000-4000-8000-000000000004', 'Yan meetup', null, now() + interval '1 day', 'b0000000-0000-4000-8000-000000000008',
   '90000000-0000-4000-8000-000000000004/e0000000-0000-4000-8000-000000000006/0b000000-0000-4000-8000-000000000006.jpg', now()),
  ('e0000000-0000-4000-8000-000000000007', '90000000-0000-4000-8000-000000000001', 'Bob meetup', null, now() + interval '1 day', 'b0000000-0000-4000-8000-000000000002', null, now());

insert into public.location_shares (group_id, user_id, lat, lng, recorded_at) values
  ('90000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 41.0, -87.0, now() - interval '1 minute'),
  ('90000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000005', 41.1, -87.1, now() - interval '1 minute'),
  ('90000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000014', 41.2, -87.2, now() - interval '14 minutes'),
  ('90000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 41.3, -87.3, now() - interval '20 minutes'),
  ('90000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000004', 42.0, -88.0, now() - interval '2 minutes'),
  ('90000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 42.1, -88.1, now() - interval '2 minutes'),
  ('90000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000015', 43.0, -89.0, now() - interval '1 minute');

insert into public.user_blocks (blocker_id, blocked_id) values
  ('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000005');

insert into public.reports (reporter_id, target_type, target_id, group_id, reason, target_snapshot) values
  ('b0000000-0000-4000-8000-000000000007', 'user', 'b0000000-0000-4000-8000-000000000008', '90000000-0000-4000-8000-000000000004', 'spam', 'Yan');

insert into storage.objects (bucket_id, name, owner, owner_id) values
  ('totems', '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/0b000000-0000-4000-8000-000000000001.jpg', 'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'),
  ('totems', '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000002/0b000000-0000-4000-8000-000000000002.jpg', 'a0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000005'),
  ('totems', '90000000-0000-4000-8000-000000000002/e0000000-0000-4000-8000-000000000003/0b000000-0000-4000-8000-000000000003.jpg', 'a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000004'),
  ('totems', '90000000-0000-4000-8000-000000000004/e0000000-0000-4000-8000-000000000004/0b000000-0000-4000-8000-000000000004.jpg', 'a0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000007'),
  ('totems', '90000000-0000-4000-8000-000000000005/e0000000-0000-4000-8000-000000000005/0b000000-0000-4000-8000-000000000005.jpg', 'a0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000009'),
  ('totems', '90000000-0000-4000-8000-000000000004/e0000000-0000-4000-8000-000000000006/0b000000-0000-4000-8000-000000000006.jpg', 'a0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000008'),
  ('totems', '90000000-0000-4000-8000-000000000005/e0000000-0000-4000-8000-000000000008/0b000000-0000-4000-8000-000000000007.jpg', 'a0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000006');

-- ===========================================================================
-- A. Structure: RLS everywhere, locked tables, privileges, function whitelist
-- ===========================================================================
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity $$,
  'A1 RLS is enabled on every public table'
);

select is_empty(
  $$ select tablename, policyname from pg_policies
     where schemaname = 'public'
       and tablename in ('chat_messages', 'group_invite_generations', 'auth_attempts', 'reports',
                         'moderation_terms', 'rate_limit_events', 'festival_suggestions') $$,
  'A2 locked tables have no policies'
);

select is(
  array(
    select c.relname || ':' || p.priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(priv)
    where n.nspname = 'public' and c.relkind = 'r'
      and has_table_privilege('anon', c.oid, p.priv)
    order by 1
  ),
  array['artists:SELECT', 'festival_artists:SELECT', 'festivals:SELECT', 'sets:SELECT', 'stages:SELECT'],
  'A3 anon table privileges are exactly the public catalog'
);

select is(
  array(
    select c.relname || ':' || p.priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(priv)
    where n.nspname = 'public' and c.relkind = 'r'
      and has_table_privilege('authenticated', c.oid, p.priv)
    order by 1
  ),
  array[
    'artists:SELECT', 'festival_artists:SELECT', 'festivals:SELECT', 'group_members:SELECT', 'groups:DELETE', 'groups:SELECT',
    'location_shares:SELECT', 'meetups:DELETE', 'meetups:INSERT', 'meetups:SELECT', 'meetups:UPDATE',
    'sets:SELECT', 'stages:SELECT', 'user_blocks:SELECT', 'user_festivals:DELETE', 'user_festivals:INSERT',
    'user_festivals:SELECT', 'user_set_selections:DELETE', 'user_set_selections:INSERT',
    'user_set_selections:SELECT', 'user_set_selections:UPDATE'
  ],
  'A4 authenticated table privileges match §2.4 exactly'
);

select is(
  array(
    select a.attname::text || ':' || p.priv
    from pg_attribute a
    cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) as p(priv)
    where a.attrelid = 'public.users'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', 'public.users'::regclass, a.attnum, p.priv)
    order by 1
  ),
  array['avatar_type:SELECT', 'avatar_value:SELECT', 'created_at:SELECT', 'display_name:SELECT', 'id:SELECT'],
  'A5 authenticated can select only the public profile columns of users (no email, no auth_user_id, no writes)'
);

select is(
  array(
    select a.attname::text
    from pg_attribute a
    where a.attrelid = 'public.groups'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', 'public.groups'::regclass, a.attnum, 'UPDATE')
    order by 1
  ),
  array['name'],
  'A6 authenticated can update only groups.name'
);

select is(
  array(
    select n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
    order by 1
  ),
  array(
    select x from unnest(array[
      'private.can_upload_totem(uuid, uuid)',
      'private.can_view_totem(uuid, uuid, text)',
      'private.contains_disallowed_text(text)',
      'private.current_app_user_id()',
      'private.is_blocked_with(uuid)',
      'private.is_group_admin(uuid)',
      'private.is_group_member(uuid)',
      'private.is_reported_totem(text)',
      'private.shares_festival_group_with(uuid, uuid)',
      'private.shares_group_with(uuid)',
      'private.try_uuid(text)'
    ]) x order by 1
  ),
  'A7 functions executable by anon are exactly the private policy helpers'
);

select is(
  array(
    select n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
    order by 1
  ),
  array(
    select x from unnest(array[
      'private.can_upload_totem(uuid, uuid)',
      'private.can_view_totem(uuid, uuid, text)',
      'private.contains_disallowed_text(text)',
      'private.current_app_user_id()',
      'private.is_blocked_with(uuid)',
      'private.is_group_admin(uuid)',
      'private.is_group_member(uuid)',
      'private.is_reported_totem(text)',
      'private.shares_festival_group_with(uuid, uuid)',
      'private.shares_group_with(uuid)',
      'private.try_uuid(text)',
      'public.block_user(uuid)',
      'public.create_group(text, uuid)',
      'public.get_group_locations(uuid)',
      'public.get_my_profile()',
      'public.join_group(text)',
      'public.leave_group(uuid)',
      'public.remove_group_member(uuid, uuid)',
      'public.report_content(text, uuid, text, text)',
      'public.rotate_invite_code(uuid)',
      'public.share_location(uuid, double precision, double precision, double precision, double precision)',
      'public.stop_sharing_location(uuid)',
      'public.suggest_festival(text, text, text)',
      'public.unblock_user(uuid)',
      'public.upsert_my_profile(text, text, text)'
    ]) x order by 1
  ),
  'A8 functions executable by authenticated are exactly the helpers + client RPCs'
);

select ok(
  has_function_privilege('service_role', 'public.prepare_account_deletion(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.prepare_account_ban(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.prepare_demo_account(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.purge_stale_locations()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.purge_rate_limit_events()', 'EXECUTE')
  and has_function_privilege('service_role', 'public.check_rate_limit(text, text, integer, interval)', 'EXECUTE')
  and has_function_privilege('service_role', 'private.check_rate_limit(text, text, integer, interval)', 'EXECUTE'),
  'A9 service_role can execute the service-only RPCs'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosecdef
     and not coalesce(p.proconfig @> array['search_path=""'], false)),
  null::text[],
  'A10 security definer functions pin search_path to empty'
);

select is(
  (select array_agg(t.tgname::text || ':' || coalesce(array_length(t.tgattr::int2[], 1), 0) order by t.tgname)
   from pg_trigger t
   where not t.tgisinternal
     and t.tgrelid in ('public.users'::regclass, 'public.groups'::regclass, 'public.meetups'::regclass,
                       'public.group_members'::regclass, 'public.user_set_selections'::regclass)),
  array[
    'group_members_clear_location:0', 'groups_moderate_text:1', 'meetups_immutable_columns:4',
    'meetups_insert_limits:0', 'meetups_moderate_text:2', 'meetups_touch_updated_at:0',
    'user_set_selections_festival_consistency:2',
    'users_moderate_text:1'
  ],
  'A11 moderation/immutability triggers exist and are column-scoped'
);

select pg_temp.become('superuser');
set local role postgres;
create function public.rls_probe_future_function() returns integer language sql as 'select 1';
create table public.rls_probe_future_table (id integer);
create sequence public.rls_probe_future_seq;
reset role;
select ok(
  not has_function_privilege('anon', 'public.rls_probe_future_function()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.rls_probe_future_function()', 'EXECUTE')
  and not has_table_privilege('anon', 'public.rls_probe_future_table', 'SELECT')
  and not has_table_privilege('authenticated', 'public.rls_probe_future_table', 'SELECT')
  and not has_sequence_privilege('anon', 'public.rls_probe_future_seq', 'USAGE, SELECT, UPDATE')
  and not has_sequence_privilege('authenticated', 'public.rls_probe_future_seq', 'USAGE, SELECT, UPDATE')
  and has_sequence_privilege('service_role', 'public.rls_probe_future_seq', 'USAGE'),
  'A12 functions, tables and sequences created later by postgres are not exposed to anon/authenticated by default'
);
drop function public.rls_probe_future_function();
drop table public.rls_probe_future_table;
drop sequence public.rls_probe_future_seq;

-- ===========================================================================
-- B. Festival catalog: drafts hidden, read-only
-- ===========================================================================
select pg_temp.become('anon');
select is(
  array(select id::text from public.festivals where id::text like 'f0000000-%' order by id),
  array['f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000004'],
  'B1 anon sees published festivals only (draft hidden)'
);
select is(
  array(select id::text from public.stages where id::text like 'c0000000-%' order by id),
  array['c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003',
        'c0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000006'],
  'B2 anon sees stages of published festivals only'
);
select is(
  array(select id::text from public.sets where id::text like 'e5000000-%' order by id),
  array['e5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000003'],
  'B3 anon sees sets of published festivals only'
);
select is(
  (select count(*)::int from public.artists where id::text like 'ad000000-%'),
  3,
  'B4 anon sees artists (every artist, including one announced without a set)'
);
select throws_ok(
  $$ insert into public.festivals (name, start_date, end_date, timezone) values ('x', '2027-01-01', '2027-01-02', 'UTC') $$,
  '42501', null, 'B5 anon cannot insert festivals'
);
select throws_ok(
  $$ select id from public.users limit 1 $$,
  '42501', null, 'B6 anon cannot read users'
);
select throws_ok(
  $$ select 1 from public.groups limit 1 $$,
  '42501', null, 'B7 anon cannot read groups'
);
select throws_ok(
  $$ select * from public.get_my_profile() $$,
  '42501', null, 'B8 anon cannot execute client RPCs'
);

select pg_temp.become('carol');
select is(
  array(select id::text from public.festivals where id::text like 'f0000000-%' order by id),
  array['f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000004'],
  'B9 authenticated sees published festivals only (draft hidden)'
);
select is(
  (select count(*)::int from public.sets where id = 'e5000000-0000-4000-8000-000000000004'),
  0,
  'B10 authenticated cannot see sets of a draft festival'
);
select throws_ok(
  $$ update public.festivals set name = 'pwned' where id = 'f0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'B11 authenticated cannot update festivals'
);
select throws_ok(
  $$ delete from public.stages where id = 'c0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'B12 authenticated cannot delete stages'
);

-- ===========================================================================
-- C. Read visibility (before any mutation)
-- ===========================================================================
select pg_temp.become('alice');
select is(
  array(select id::text from public.users where id::text like 'b0000000-%' order by id),
  array['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002',
        'b0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000014'],
  'C1 alice sees herself and her groupmates only'
);
select throws_ok(
  $$ select email from public.users where id = 'b0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'C2 select email on users is denied (even own row)'
);
select throws_ok(
  $$ select * from public.users $$,
  '42501', null, 'C3 select * on users is denied'
);
select throws_ok(
  $$ select auth_user_id from public.users $$,
  '42501', null, 'C4 select auth_user_id on users is denied'
);
select is(
  (select display_name from public.users where id = 'b0000000-0000-4000-8000-000000000002'),
  'Bob',
  'C5 explicit public columns of a groupmate are readable (positive control)'
);
select is(
  array(select id::text from public.groups where id::text like '90000000-%' order by id),
  array['90000000-0000-4000-8000-000000000001'],
  'C6 alice sees only groups she belongs to'
);
select is(
  (select count(*)::int from public.group_members where group_id = '90000000-0000-4000-8000-000000000001'),
  4,
  'C7 alice sees all members of her group'
);
select is(
  (select count(*)::int from public.group_members where group_id = '90000000-0000-4000-8000-000000000002'),
  0,
  'C8 alice sees no members of a group she is not in'
);
select is(
  array(select id::text from public.user_set_selections where id::text like '5e000000-%' order by id),
  array['5e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000002', '5e000000-0000-4000-8000-000000000004'],
  'C9 alice sees own selections + same-festival groupmates'' (not bob''s other-festival pick)'
);
select is(
  array(select id::text from public.meetups where id::text like 'e0000000-%' order by id),
  array['e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000007'],
  'C10 alice sees meetups of her group only'
);
select is(
  array(select user_id::text from public.location_shares order by user_id),
  array['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000014'],
  'C11 alice sees fresh (<15 min, incl. 14 min) locations in her group; stale (20 min) hidden'
);
select is(
  (select count(*)::int from public.user_blocks),
  0,
  'C12 alice cannot see other users'' blocks'
);
select is(
  array(select name from storage.objects where bucket_id = 'totems' order by name),
  array['90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/0b000000-0000-4000-8000-000000000001.jpg',
        '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000002/0b000000-0000-4000-8000-000000000002.jpg'],
  'C13 alice sees totem objects of her group only'
);

select pg_temp.become('bob');
select is(
  array(select id::text from public.users where id::text like 'b0000000-%' order by id),
  array['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000004',
        'b0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000014'],
  'C14 bob sees members of both his groups'
);
select is(
  array(select id::text from public.user_set_selections where id::text like '5e000000-%' order by id),
  array['5e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000002',
        '5e000000-0000-4000-8000-000000000003', '5e000000-0000-4000-8000-000000000005'],
  'C15 bob sees per-festival groupmate selections; blocked erin''s are hidden'
);
select is(
  array(select id::text from public.meetups where id::text like 'e0000000-%' order by id),
  array['e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000007'],
  'C16 bob does not see meetups created by a user he blocked'
);
select is(
  array(select group_id::text || ':' || user_id::text from public.location_shares order by 1),
  array['90000000-0000-4000-8000-000000000001:b0000000-0000-4000-8000-000000000001',
        '90000000-0000-4000-8000-000000000001:b0000000-0000-4000-8000-000000000014',
        '90000000-0000-4000-8000-000000000002:b0000000-0000-4000-8000-000000000002',
        '90000000-0000-4000-8000-000000000002:b0000000-0000-4000-8000-000000000004'],
  'C17 bob: blocked user''s location hidden, own stale row hidden'
);
select is(
  (select count(*)::int from public.user_blocks where blocker_id = 'b0000000-0000-4000-8000-000000000002'),
  1,
  'C18 bob sees his own block'
);

select pg_temp.become('erin');
select is(
  array(select id::text from public.user_set_selections where id::text like '5e000000-%' order by id),
  array['5e000000-0000-4000-8000-000000000001', '5e000000-0000-4000-8000-000000000004'],
  'C19 blocking works both ways for selections (erin cannot see bob''s)'
);
select is(
  array(select id::text from public.meetups where id::text like 'e0000000-%' order by id),
  array['e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002'],
  'C20 blocking works both ways for meetups (erin cannot see bob''s)'
);

select pg_temp.become('dave');
select is(
  array(select id::text from public.user_set_selections where id::text like '5e000000-%' order by id),
  array['5e000000-0000-4000-8000-000000000003', '5e000000-0000-4000-8000-000000000005'],
  'C21 dave sees bob''s pick for their shared festival only'
);

select pg_temp.become('carol');
select is(
  (select count(*)::int from public.users),
  1,
  'C22 a stranger sees only her own profile'
);
select is(
  (select count(*)::int from public.groups) + (select count(*)::int from public.group_members)
  + (select count(*)::int from public.meetups) + (select count(*)::int from public.location_shares),
  0,
  'C23 a stranger sees no groups, members, meetups or locations'
);
select is(
  array(select id::text from public.user_set_selections where id::text like '5e000000-%'),
  array['5e000000-0000-4000-8000-000000000006'],
  'C24 a stranger sees only her own selections'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'totems'),
  0,
  'C25 a stranger sees no totem objects'
);

select pg_temp.become('anon');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'totems'),
  0,
  'C26 anon sees no totem objects'
);

-- Restrictive guard holds even if a permissive dashboard policy appears.
select pg_temp.become('superuser');
create policy rls_test_wide_open on storage.objects for select to public using (true);
select pg_temp.become('carol');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'totems'),
  0,
  'C27 restrictive guard hides totems even with a wide-open permissive policy'
);
select pg_temp.become('alice');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'totems'),
  2,
  'C28 members still see their group''s totems with that policy present (positive control)'
);
select pg_temp.become('superuser');
drop policy rls_test_wide_open on storage.objects;

-- Locked tables
select pg_temp.become('alice');
select throws_ok($$ select 1 from public.chat_messages limit 1 $$, '42501', null, 'C29 chat_messages is locked');
select throws_ok($$ select 1 from public.group_invite_generations limit 1 $$, '42501', null, 'C30 group_invite_generations is locked');
select throws_ok($$ select 1 from public.auth_attempts limit 1 $$, '42501', null, 'C31 auth_attempts is locked');
select throws_ok($$ select 1 from public.moderation_terms limit 1 $$, '42501', null, 'C32 moderation_terms is locked');
select throws_ok($$ select 1 from public.rate_limit_events limit 1 $$, '42501', null, 'C33 rate_limit_events is locked');
select throws_ok($$ select 1 from public.reports limit 1 $$, '42501', null, 'C34 reports cannot be read');
select throws_ok(
  $$ insert into public.reports (reporter_id, target_type, target_id, reason)
     values ('b0000000-0000-4000-8000-000000000001', 'user', 'b0000000-0000-4000-8000-000000000002', 'spam') $$,
  '42501', null, 'C35 reports cannot be inserted directly'
);
select lives_ok(
  $$ select public.report_content('user', 'b0000000-0000-4000-8000-000000000002', 'spam') $$,
  'C36 reports can be filed through report_content (positive control)'
);

-- ===========================================================================
-- D. Profiles
-- ===========================================================================
select pg_temp.become('alice');
select is(
  (select display_name from public.get_my_profile()),
  'Alice',
  'D1 get_my_profile returns the caller''s profile'
);
select throws_ok(
  $$ update public.users set display_name = 'Hacked' where id = 'b0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'D2 users cannot be updated directly'
);
select throws_ok(
  $$ insert into public.users (auth_user_id, email, display_name) values ('a0000000-0000-4000-8000-000000000001', 'x@example.com', 'X') $$,
  '42501', null, 'D3 users cannot be inserted directly'
);
select is(
  (select display_name from public.upsert_my_profile('  Alice A.  ', 'emoji', '🎧')),
  'Alice A.',
  'D4 upsert_my_profile updates own profile (trimmed)'
);
select throws_ok(
  $$ select * from public.upsert_my_profile('Alice', 'photo', '') $$,
  'P0001', 'invalid_input', 'D5 unknown avatar_type is rejected'
);
select throws_ok(
  $$ select * from public.upsert_my_profile('   ', 'initials', '') $$,
  'P0001', 'invalid_input', 'D6 blank display name is rejected'
);
select throws_ok(
  $$ select * from public.upsert_my_profile(repeat('x', 41), 'initials', '') $$,
  'P0001', 'invalid_input', 'D7 41-char display name is rejected'
);
select throws_ok(
  $$ select * from public.upsert_my_profile('FUCK yeah', 'initials', '') $$,
  'P0001', 'content_not_allowed', 'D8 disallowed display name is rejected (case-insensitive)'
);
select is(
  (select display_name from public.upsert_my_profile('Grape Escape', 'initials', '')),
  'Grape Escape',
  'D9 moderation matches whole words only ("Grape" does not match "rape")'
);

select pg_temp.become('newbie');
select is(
  (select count(*)::int from public.get_my_profile()),
  0,
  'D10 get_my_profile returns zero rows before profile setup'
);
select is(
  (select display_name from public.upsert_my_profile('Newbie', 'initials', '')),
  'Newbie',
  'D11 upsert_my_profile creates the profile'
);
select pg_temp.become('superuser');
select is(
  (select email from public.users where auth_user_id = 'a0000000-0000-4000-8000-000000000010'),
  'newbie@example.com',
  'D12 profile email comes from the JWT'
);

-- ===========================================================================
-- E. Groups and memberships: direct writes
-- ===========================================================================
select pg_temp.become('alice');
with u as (
  update public.groups set name = 'Group A renamed' where id = '90000000-0000-4000-8000-000000000001' returning 1
)
select is(count(*)::int, 1, 'E1 admin can rename the group') from u;
select throws_ok(
  $$ update public.groups set invite_code = 'XXXXX2' where id = '90000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'E2 admin cannot set invite_code directly'
);
select throws_ok(
  $$ update public.groups set created_by_user_id = 'b0000000-0000-4000-8000-000000000003' where id = '90000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'E3 created_by_user_id of groups is not client-writable'
);
select throws_ok(
  $$ insert into public.groups (festival_id, name, invite_code) values ('f0000000-0000-4000-8000-000000000001', 'Direct', 'QQQQQ2') $$,
  '42501', null, 'E4 groups cannot be inserted directly'
);
select throws_ok(
  $$ update public.group_members set role = 'member' where group_id = '90000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'E5 group_members cannot be updated directly (even by an admin)'
);
select throws_ok(
  $$ delete from public.group_members where user_id = 'b0000000-0000-4000-8000-000000000014' $$,
  '42501', null, 'E6 group_members cannot be deleted directly (even by an admin)'
);

select pg_temp.become('bob');
with u as (
  update public.groups set name = 'Bob was here' where id = '90000000-0000-4000-8000-000000000001' returning 1
)
select is(count(*)::int, 0, 'E7 a member cannot rename the group') from u;
with d as (
  delete from public.groups where id = '90000000-0000-4000-8000-000000000001' returning 1
)
select is(count(*)::int, 0, 'E8 a member cannot delete the group') from d;
select throws_ok(
  $$ update public.group_members set role = 'admin' where user_id = 'b0000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'E9 a member cannot promote himself'
);
select throws_ok(
  $$ delete from public.group_members where user_id = 'b0000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'E10 a member cannot delete his membership directly (leave_group only)'
);
select lives_ok(
  $$ select public.leave_group('90000000-0000-4000-8000-000000000002') $$,
  'E11 a member can leave through leave_group (positive control)'
);

select pg_temp.become('carol');
select throws_ok(
  $$ insert into public.group_members (group_id, user_id, role) values ('90000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', 'admin') $$,
  '42501', null, 'E12 a stranger cannot insert herself into a group'
);

select pg_temp.become('superuser');
select is(
  (select name from public.groups where id = '90000000-0000-4000-8000-000000000001'),
  'Group A renamed',
  'E13 member rename attempt left the name untouched'
);

-- ===========================================================================
-- F. user_set_selections and user_festivals
-- ===========================================================================
select pg_temp.become('alice');
select lives_ok(
  $$ insert into public.user_set_selections (user_id, festival_id, set_id)
     values ('b0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002') $$,
  'F1 user can add own selection'
);
select throws_ok(
  $$ insert into public.user_set_selections (user_id, festival_id, set_id)
     values ('b0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'F2 user cannot add a selection for someone else'
);
select throws_ok(
  $$ insert into public.user_set_selections (user_id, festival_id, set_id)
     values ('b0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000002') $$,
  'P0001', 'invalid_input', 'F3 selection festival_id must match the set''s festival'
);
select throws_ok(
  $$ update public.user_set_selections set set_id = 'e5000000-0000-4000-8000-000000000003'
     where id = '5e000000-0000-4000-8000-000000000001' $$,
  'P0001', 'invalid_input', 'F4 changing set_id to another festival''s set is rejected'
);
with u as (
  update public.user_set_selections set note = 'mine' where id = '5e000000-0000-4000-8000-000000000001' returning 1
)
select is(count(*)::int, 1, 'F5 user can update own selection') from u;
with u as (
  update public.user_set_selections set note = 'tampered' where id = '5e000000-0000-4000-8000-000000000002' returning 1
)
select is(count(*)::int, 0, 'F6 user cannot update a groupmate''s visible selection') from u;
with d as (
  delete from public.user_set_selections where id = '5e000000-0000-4000-8000-000000000002' returning 1
)
select is(count(*)::int, 0, 'F7 user cannot delete a groupmate''s selection') from d;
with d as (
  delete from public.user_set_selections where id = '5e000000-0000-4000-8000-000000000001' returning 1
)
select is(count(*)::int, 1, 'F8 user can delete own selection') from d;

select lives_ok(
  $$ insert into public.user_festivals (user_id, festival_id)
     values ('b0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001') $$,
  'F9 user can follow a festival'
);
select throws_ok(
  $$ insert into public.user_festivals (user_id, festival_id)
     values ('b0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'F10 user cannot follow a festival on someone else''s behalf'
);
select pg_temp.become('superuser');
insert into public.user_festivals (user_id, festival_id)
values ('b0000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000002');
select pg_temp.become('alice');
select is(
  array(select user_id::text from public.user_festivals),
  array['b0000000-0000-4000-8000-000000000001'],
  'F11 user sees only own followed festivals'
);
with d as (
  delete from public.user_festivals where user_id = 'b0000000-0000-4000-8000-000000000002' returning 1
)
select is(count(*)::int, 0, 'F12 user cannot unfollow for someone else') from d;
with d as (
  delete from public.user_festivals where user_id = 'b0000000-0000-4000-8000-000000000001' returning 1
)
select is(count(*)::int, 1, 'F13 user can unfollow own festival') from d;

-- ===========================================================================
-- G. Meetups
-- ===========================================================================
select pg_temp.become('alice');
select lives_ok(
  $$ insert into public.meetups (id, group_id, title, starts_at, created_by_user_id, latitude, longitude)
     values ('e0000000-0000-4000-8000-000000000010', '90000000-0000-4000-8000-000000000001', 'New meetup', now(), 'b0000000-0000-4000-8000-000000000001', 41.88, -87.62) $$,
  'G1 member can create a meetup in her group'
);
select throws_ok(
  $$ insert into public.meetups (group_id, title, starts_at, created_by_user_id)
     values ('90000000-0000-4000-8000-000000000002', 'Intruder', now(), 'b0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'G2 cannot create a meetup in a group you are not in'
);
select throws_ok(
  $$ insert into public.meetups (group_id, title, starts_at, created_by_user_id)
     values ('90000000-0000-4000-8000-000000000001', 'Spoofed', now(), 'b0000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'G3 cannot create a meetup as someone else'
);
select throws_ok(
  $$ insert into public.meetups (group_id, title, starts_at, created_by_user_id)
     values ('90000000-0000-4000-8000-000000000001', 'shit show', now(), 'b0000000-0000-4000-8000-000000000001') $$,
  'P0001', 'content_not_allowed', 'G4 disallowed meetup title is rejected'
);
select throws_ok(
  $$ insert into public.meetups (group_id, title, notes, starts_at, created_by_user_id)
     values ('90000000-0000-4000-8000-000000000001', 'Fine', 'you bitch', now(), 'b0000000-0000-4000-8000-000000000001') $$,
  'P0001', 'content_not_allowed', 'G5 disallowed meetup notes are rejected'
);
with u as (
  update public.meetups set title = 'Alice meetup v2' where id = 'e0000000-0000-4000-8000-000000000001' returning updated_at
)
select is(max(updated_at), now(), 'G6 creator can edit her meetup; updated_at is maintained') from u;
select throws_ok(
  $$ update public.meetups set group_id = '90000000-0000-4000-8000-000000000002' where id = 'e0000000-0000-4000-8000-000000000001' $$,
  'P0001', 'invalid_input', 'G7 meetup group_id is immutable'
);
select throws_ok(
  $$ update public.meetups set created_by_user_id = 'b0000000-0000-4000-8000-000000000002' where id = 'e0000000-0000-4000-8000-000000000001' $$,
  'P0001', 'invalid_input', 'G8 meetup created_by_user_id is immutable'
);
select lives_ok(
  $$ update public.meetups set id = 'e0000000-0000-4000-8000-000000000001', group_id = '90000000-0000-4000-8000-000000000001',
       created_by_user_id = 'b0000000-0000-4000-8000-000000000001', title = 'Same parents'
     where id = 'e0000000-0000-4000-8000-000000000001' $$,
  'G9 re-sending unchanged id/group_id/created_by_user_id is allowed (sync payloads)'
);
select throws_ok(
  $$ update public.meetups set totem_path = '90000000-0000-4000-8000-000000000002/e0000000-0000-4000-8000-000000000001/x.jpg'
     where id = 'e0000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'G10 totem_path must live under the meetup''s own group folder'
);
select throws_ok(
  $$ update public.meetups set totem_path = '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000002/x.jpg'
     where id = 'e0000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'G11 totem_path must live under the meetup''s own id folder'
);
select lives_ok(
  $$ update public.meetups set totem_path = '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/0b000000-0000-4000-8000-000000000001.jpg'
     where id = 'e0000000-0000-4000-8000-000000000001' $$,
  'G12 creator can set a well-formed totem_path'
);
with d as (
  delete from public.meetups where id = 'e0000000-0000-4000-8000-000000000002' returning 1
)
select is(count(*)::int, 1, 'G13 admin can delete another member''s meetup') from d;

select pg_temp.become('bob');
with u as (
  update public.meetups set title = 'Bob edited this' where id = 'e0000000-0000-4000-8000-000000000001' returning 1
)
select is(count(*)::int, 0, 'G14 non-creator cannot edit a meetup') from u;
with u as (
  update public.meetups set totem_path = null where id = 'e0000000-0000-4000-8000-000000000001' returning 1
)
select is(count(*)::int, 0, 'G15 non-creator cannot clear the totem') from u;
with d as (
  delete from public.meetups where id = 'e0000000-0000-4000-8000-000000000001' returning 1
)
select is(count(*)::int, 0, 'G16 non-creator non-admin cannot delete a meetup') from d;
with u as (
  update public.meetups set title = 'Bob meetup v2' where id = 'e0000000-0000-4000-8000-000000000007' returning 1
)
select is(count(*)::int, 1, 'G17 member can edit his own meetup (positive control)') from u;

select pg_temp.become('superuser');
select is(
  (select title from public.meetups where id = 'e0000000-0000-4000-8000-000000000001'),
  'Same parents',
  'G18 tamper attempts left the meetup untouched'
);
select pg_temp.become('bob');
select throws_ok(
  $$ update public.meetups set id = 'e0000000-0000-4000-8000-0000000000ff' where id = 'e0000000-0000-4000-8000-000000000007' $$,
  'P0001', 'invalid_input', 'G19 the creator cannot rewrite a meetup''s id'
);
select throws_ok(
  $$ update public.meetups set created_at = '1999-01-01T00:00:00Z' where id = 'e0000000-0000-4000-8000-000000000007' $$,
  'P0001', 'invalid_input', 'G20 the creator cannot rewrite a meetup''s created_at'
);

-- Meetup flood limits (solo, only member of GS): 30 new meetups an hour, 100 per crew.
select pg_temp.become('superuser');
insert into public.rate_limit_events (key, action)
select 'user:b0000000-0000-4000-8000-000000000009', 'meetup_create' from generate_series(1, 29);
select pg_temp.become('solo');
select lives_ok(
  $$ insert into public.meetups (id, group_id, title, starts_at, created_by_user_id)
     values ('e0000000-0000-4000-8000-000000000041', '90000000-0000-4000-8000-000000000005', 'Thirtieth', now(), 'b0000000-0000-4000-8000-000000000009') $$,
  'G21 the 30th meetup in an hour is accepted (positive control)'
);
select throws_ok(
  $$ insert into public.meetups (id, group_id, title, starts_at, created_by_user_id)
     values ('e0000000-0000-4000-8000-000000000042', '90000000-0000-4000-8000-000000000005', 'Thirty-first', now(), 'b0000000-0000-4000-8000-000000000009') $$,
  'P0001', 'rate_limited', 'G22 the 31st meetup in an hour is rate limited'
);
select lives_ok(
  $$ insert into public.meetups (id, group_id, title, starts_at, created_by_user_id)
     values ('e0000000-0000-4000-8000-000000000041', '90000000-0000-4000-8000-000000000005', 'Thirtieth again', now(), 'b0000000-0000-4000-8000-000000000009')
     on conflict (id) do update set title = excluded.title $$,
  'G23 a sync replay (upsert) of an existing meetup is not counted as a new one'
);
select pg_temp.become('superuser');
delete from public.rate_limit_events where key = 'user:b0000000-0000-4000-8000-000000000009';
insert into public.meetups (group_id, title, starts_at, created_by_user_id)
select '90000000-0000-4000-8000-000000000005', 'Filler ' || n, now(), 'b0000000-0000-4000-8000-000000000009'
from generate_series(1, 100 - (
  select count(*)::int from public.meetups
  where group_id = '90000000-0000-4000-8000-000000000005' and created_by_user_id = 'b0000000-0000-4000-8000-000000000009'
)) n;
select pg_temp.become('solo');
select throws_ok(
  $$ insert into public.meetups (id, group_id, title, starts_at, created_by_user_id)
     values ('e0000000-0000-4000-8000-000000000042', '90000000-0000-4000-8000-000000000005', 'One too many', now(), 'b0000000-0000-4000-8000-000000000009') $$,
  'P0001', 'meetup_limit_reached', 'G24 a member can have at most 100 meetups in one crew (permanent code, not rate_limited)'
);
select pg_temp.become('superuser');
delete from public.meetups
where group_id = '90000000-0000-4000-8000-000000000005' and title like 'Filler %';
delete from public.meetups where id = 'e0000000-0000-4000-8000-000000000041';
delete from public.rate_limit_events where key = 'user:b0000000-0000-4000-8000-000000000009';

-- ===========================================================================
-- H. Location sharing RPCs
-- ===========================================================================
select pg_temp.become('alice');
select throws_ok(
  $$ insert into public.location_shares (group_id, user_id, lat, lng)
     values ('90000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 1, 1) $$,
  '42501', null, 'H1 location_shares cannot be inserted directly'
);
select throws_ok(
  $$ update public.location_shares set lat = 0 $$,
  '42501', null, 'H2 location_shares cannot be updated directly'
);
select is(
  array(select user_id::text from public.get_group_locations('90000000-0000-4000-8000-000000000001') order by user_id),
  array['b0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000014'],
  'H3 get_group_locations returns fresh groupmates, excluding the caller'
);
select ok(
  (select count(*) > 0 and bool_and(age_seconds is not null and age_seconds >= 0 and age_seconds < 15 * 60)
     from public.get_group_locations('90000000-0000-4000-8000-000000000001')),
  'H3b get_group_locations reports each row''s age on the server clock (0 <= age_seconds < 15 min)'
);
select pg_temp.become('superuser');
select is(
  (select count(*)::int from public.location_shares
    where group_id = '90000000-0000-4000-8000-000000000001' and user_id = 'b0000000-0000-4000-8000-000000000002'),
  0,
  'H4 get_group_locations purged the stale row'
);
select pg_temp.become('bob');
select is(
  array(select user_id::text from public.get_group_locations('90000000-0000-4000-8000-000000000001') order by user_id),
  array['b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000014'],
  'H5 get_group_locations excludes blocked users'
);
select pg_temp.become('carol');
select throws_ok(
  $$ select * from public.get_group_locations('90000000-0000-4000-8000-000000000001') $$,
  'P0001', 'not_group_member', 'H6 non-members cannot read group locations'
);
select throws_ok(
  $$ select public.share_location('90000000-0000-4000-8000-000000000001', 41, -87, 5, 0) $$,
  'P0001', 'not_group_member', 'H7 non-members cannot share into a group'
);

select pg_temp.become('alice');
select throws_ok(
  $$ select public.share_location('90000000-0000-4000-8000-000000000001', 91, -87, 5, 0) $$,
  'P0001', 'invalid_input', 'H8 latitude out of range is rejected'
);
select throws_ok(
  $$ select public.share_location('90000000-0000-4000-8000-000000000001', 41, -181, 5, 0) $$,
  'P0001', 'invalid_input', 'H9 longitude out of range is rejected'
);
select throws_ok(
  $$ select public.share_location('90000000-0000-4000-8000-000000000001', 'NaN', -87, 5, 0) $$,
  'P0001', 'invalid_input', 'H10 NaN latitude is rejected'
);
select pg_temp.become('superuser');
update public.location_shares set recorded_at = now() - interval '16 minutes'
where group_id = '90000000-0000-4000-8000-000000000001' and user_id = 'b0000000-0000-4000-8000-000000000014';
select pg_temp.become('alice');
select lives_ok(
  $$ select public.share_location('90000000-0000-4000-8000-000000000001', 41.5, -87.5, -1, 400) $$,
  'H11 member can share location (unknown accuracy/heading values accepted)'
);
select pg_temp.become('superuser');
select is(
  (select lat::text || ',' || coalesce(accuracy::text, 'null') || ',' || coalesce(heading::text, 'null')
   from public.location_shares
   where group_id = '90000000-0000-4000-8000-000000000001' and user_id = 'b0000000-0000-4000-8000-000000000001'),
  '41.5,null,null',
  'H12 share_location upserted the caller''s row; invalid accuracy/heading stored as null'
);
select is(
  (select count(*)::int from public.location_shares
    where group_id = '90000000-0000-4000-8000-000000000001' and user_id = 'b0000000-0000-4000-8000-000000000014'),
  0,
  'H13 share_location purged rows older than 15 minutes in the group'
);
select pg_temp.become('alice');
select public.share_location('90000000-0000-4000-8000-000000000001', 10, 10, 5, 0);
select pg_temp.become('superuser');
select is(
  (select lat from public.location_shares
    where group_id = '90000000-0000-4000-8000-000000000001' and user_id = 'b0000000-0000-4000-8000-000000000001'),
  41.5::double precision,
  'H14 updates within 5 seconds are throttled'
);
select is(
  (select count(*)::int from public.location_shares
    where group_id = '90000000-0000-4000-8000-000000000001' and user_id = 'b0000000-0000-4000-8000-000000000001'),
  1,
  'H15 exactly one row per user and group'
);
select pg_temp.become('alice');
select public.stop_sharing_location('90000000-0000-4000-8000-000000000001');
select pg_temp.become('superuser');
select is(
  (select count(*)::int from public.location_shares where user_id = 'b0000000-0000-4000-8000-000000000001'),
  0,
  'H16 stop_sharing_location deletes the caller''s row'
);

select pg_temp.become('alice');
select throws_ok(
  $$ select public.purge_stale_locations() $$,
  '42501', null, 'H17 purge_stale_locations is not callable by authenticated'
);
select pg_temp.become('superuser');
insert into public.location_shares (group_id, user_id, lat, lng, recorded_at)
values ('90000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003', 1, 1, now() - interval '1 hour');
select pg_temp.become('service_role');
select ok(
  public.purge_stale_locations() >= 1,
  'H18 service_role purge_stale_locations deletes stale rows'
);

-- ===========================================================================
-- I. Group RPCs: create, rotate, remove, leave (admin hand-off), join
-- ===========================================================================
select pg_temp.become('carol');
create temporary table rls_new_group on commit drop as
select * from public.create_group('  Carol Crew  ', 'f0000000-0000-4000-8000-000000000001');
select ok(
  (select name = 'Carol Crew' and festival_id = 'f0000000-0000-4000-8000-000000000001'
          and invite_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$' from rls_new_group),
  'I1 create_group returns the group with a well-formed invite code'
);
select is(
  (select role from public.group_members m join rls_new_group g on g.group_id = m.group_id),
  'admin',
  'I2 the creator becomes the group admin atomically'
);
select throws_ok(
  $$ select * from public.create_group('Drafty', 'f0000000-0000-4000-8000-000000000003') $$,
  'P0001', 'festival_not_found', 'I3 cannot create a group for a draft festival'
);
select throws_ok(
  $$ select * from public.create_group('Nowhere', '00000000-0000-4000-8000-000000000000') $$,
  'P0001', 'festival_not_found', 'I4 cannot create a group for an unknown festival'
);
select throws_ok(
  $$ select * from public.create_group(repeat('x', 61), 'f0000000-0000-4000-8000-000000000001') $$,
  'P0001', 'invalid_input', 'I5 group names over 60 characters are rejected'
);
select throws_ok(
  $$ select * from public.create_group('Nazi crew', 'f0000000-0000-4000-8000-000000000001') $$,
  'P0001', 'content_not_allowed', 'I6 disallowed group names are rejected'
);
with d as (
  delete from public.groups where id = (select group_id from rls_new_group) returning 1
)
select is(count(*)::int, 1, 'I7 an admin can delete her group') from d;

select pg_temp.become('nopro');
select throws_ok(
  $$ select * from public.create_group('No profile', 'f0000000-0000-4000-8000-000000000001') $$,
  'P0001', 'profile_required', 'I8 RPCs require a profile'
);

select pg_temp.become('superuser');
insert into public.rate_limit_events (key, action)
select 'user:b0000000-0000-4000-8000-000000000006', 'create_group' from generate_series(1, 10);
select pg_temp.become('frank');
select throws_ok(
  $$ select * from public.create_group('Eleventh', 'f0000000-0000-4000-8000-000000000001') $$,
  'P0001', 'rate_limited', 'I9 the 11th group in a day is rate limited'
);

-- rotate_invite_code
select pg_temp.become('bob');
select throws_ok(
  $$ select public.rotate_invite_code('90000000-0000-4000-8000-000000000001') $$,
  'P0001', 'not_group_admin', 'I10 members cannot rotate the invite code'
);
select pg_temp.become('carol');
select throws_ok(
  $$ select public.rotate_invite_code('90000000-0000-4000-8000-000000000001') $$,
  'P0001', 'not_group_member', 'I11 strangers cannot rotate the invite code'
);
select pg_temp.become('alice');
select ok(
  public.rotate_invite_code('90000000-0000-4000-8000-000000000001') ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$',
  'I12 admin rotates the invite code'
);
select pg_temp.become('superuser');
select ok(
  (select invite_code <> 'AAAAA2' and invite_code_rotated_at = now()
   from public.groups where id = '90000000-0000-4000-8000-000000000001'),
  'I13 rotation replaced the code and stamped invite_code_rotated_at'
);
update public.groups set invite_code = 'AAAAA2' where id = '90000000-0000-4000-8000-000000000001';

-- remove_group_member (+ after-delete trigger clears the location row)
insert into public.location_shares (group_id, user_id, lat, lng)
values ('90000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000014', 41, -87);
insert into public.meetups (id, group_id, title, starts_at, created_by_user_id) values
  ('e0000000-0000-4000-8000-000000000040', '90000000-0000-4000-8000-000000000001', 'Hank flood', now(), 'b0000000-0000-4000-8000-000000000014');
select pg_temp.become('bob');
select throws_ok(
  $$ select public.remove_group_member('90000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000014') $$,
  'P0001', 'not_group_admin', 'I14 members cannot remove members'
);
select pg_temp.become('alice');
select throws_ok(
  $$ select public.remove_group_member('90000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001') $$,
  'P0001', 'cannot_remove_self', 'I15 admins cannot remove themselves'
);
select lives_ok(
  $$ select public.remove_group_member('90000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000014') $$,
  'I16 admin removes a member'
);
select pg_temp.become('superuser');
select is(
  (select count(*)::int from public.group_members
    where group_id = '90000000-0000-4000-8000-000000000001' and user_id = 'b0000000-0000-4000-8000-000000000014')
  + (select count(*)::int from public.location_shares
    where group_id = '90000000-0000-4000-8000-000000000001' and user_id = 'b0000000-0000-4000-8000-000000000014'),
  0,
  'I17 removal deletes the membership and (via trigger) the location row'
);
select ok(
  (select invite_code <> 'AAAAA2' and invite_code_rotated_at = now()
   from public.groups where id = '90000000-0000-4000-8000-000000000001'),
  'I17a removing a member replaces the invite code every member could read'
);
select is(
  array(select id::text from public.meetups
        where id in ('e0000000-0000-4000-8000-000000000040', 'e0000000-0000-4000-8000-000000000007') order by id),
  array['e0000000-0000-4000-8000-000000000007'],
  'I17d removal deletes the removed member''s meetups in that crew; other members'' meetups remain'
);
select pg_temp.become('hank');
select is(
  (select count(*)::int from public.join_group('AAAAA2')),
  0,
  'I17b a removed member cannot rejoin with the old invite code'
);
select throws_ok(
  $$ select * from public.get_group_locations('90000000-0000-4000-8000-000000000001') $$,
  'P0001', 'not_group_member', 'I17c a removed member cannot read the crew''s locations'
);
select pg_temp.become('superuser');
update public.groups set invite_code = 'AAAAA2' where id = '90000000-0000-4000-8000-000000000001';

-- leave_group: last admin hands off to the earliest-joined member
select pg_temp.become('carol');
select throws_ok(
  $$ select public.leave_group('90000000-0000-4000-8000-000000000007') $$,
  'P0001', 'not_group_member', 'I18 cannot leave a group you are not in'
);
select pg_temp.become('ivy');
select lives_ok(
  $$ select public.leave_group('90000000-0000-4000-8000-000000000007') $$,
  'I19 last admin can leave'
);
select pg_temp.become('superuser');
select is(
  array(select u.display_name || ':' || m.role from public.group_members m join public.users u on u.id = m.user_id
        where m.group_id = '90000000-0000-4000-8000-000000000007' order by m.joined_at),
  array['Jack:admin', 'Kim:member'],
  'I20 earliest-joined member is promoted when the last admin leaves'
);
select is(
  (select count(*)::int from public.location_shares where user_id = 'b0000000-0000-4000-8000-000000000015'),
  0,
  'I21 leaving clears the leaver''s location row'
);
select pg_temp.become('lou');
select public.leave_group('90000000-0000-4000-8000-000000000008');
select pg_temp.become('superuser');
select is(
  array(select u.display_name || ':' || m.role from public.group_members m join public.users u on u.id = m.user_id
        where m.group_id = '90000000-0000-4000-8000-000000000008' order by m.joined_at),
  array['Max:admin', 'Ned:member'],
  'I22 no promotion while another admin remains'
);
select pg_temp.become('jack');
select public.leave_group('90000000-0000-4000-8000-000000000007');
select pg_temp.become('kim');
select public.leave_group('90000000-0000-4000-8000-000000000007');
select pg_temp.become('superuser');
select is(
  (select count(*)::int from public.groups where id = '90000000-0000-4000-8000-000000000007'),
  0,
  'I23 the group is deleted when its last member leaves'
);

-- join_group
select pg_temp.become('joiner');
select is(
  (select group_id::text || ':' || member_count from public.join_group('aaaaa2')),
  '90000000-0000-4000-8000-000000000001:4',
  'I24 lowercase invite codes join (normalized, exact match)'
);
select is(
  (select group_id::text || ':' || member_count from public.join_group(' bb-bbb-2 ')),
  '90000000-0000-4000-8000-000000000002:2',
  'I25 dashes and spaces in invite codes are ignored'
);
select is(
  (select group_id::text || ':' || member_count from public.join_group('AAAAA2')),
  '90000000-0000-4000-8000-000000000001:4',
  'I26 joining a group you are already in returns it without duplicating'
);
select throws_ok(
  $$ select * from public.join_group('FFFFF2') $$,
  'P0001', 'group_full', 'I27 a group with 50 members is full'
);

select pg_temp.become('grace');
select is((select count(*)::int from public.join_group('%')), 0, 'I28 "%" matches no group');
select is((select count(*)::int from public.join_group('_')), 0, 'I29 "_" matches no group');
select is((select count(*)::int from public.join_group('AAAAA_')), 0, 'I30 "AAAAA_" matches no group (no LIKE)');
select is((select count(*)::int from public.join_group('%%%%%%')), 0, 'I31 "%%%%%%" matches no group');
select is(
  (select count(*)::int from public.join_group('QQQQQ2'))
  + (select count(*)::int from public.join_group('QQQQQ3'))
  + (select count(*)::int from public.join_group('QQQQQ4'))
  + (select count(*)::int from public.join_group('QQQQQ5'))
  + (select count(*)::int from public.join_group('QQQQQ6'))
  + (select count(*)::int from public.join_group('QQQQQ7')),
  0,
  'I32 wrong codes 5-10 return zero rows'
);
select throws_ok(
  $$ select * from public.join_group('QQQQQ8') $$,
  'P0001', 'rate_limited', 'I33 the 11th wrong invite code in an hour is rate limited'
);
select throws_ok(
  $$ select * from public.join_group('AAAAA2') $$,
  'P0001', 'rate_limited', 'I34 even a valid code is refused while rate limited'
);
select pg_temp.become('superuser');
select is(
  (select count(*)::int from public.rate_limit_events
    where key = 'user:b0000000-0000-4000-8000-000000000012' and action = 'join_fail'),
  10,
  'I35 the 10 failure events persisted (failures return rows, not exceptions)'
);
select is(
  (select count(*)::int from public.group_members
    where user_id = 'b0000000-0000-4000-8000-000000000012'),
  0,
  'I36 brute-forcing joined nothing'
);

-- Guessing spread over many accounts: a project-wide join_fail budget.
create temp table rls_join_global on commit drop as
select count(*)::int as before from public.rate_limit_events where key = 'join_group:global' and action = 'join_fail';
select pg_temp.become('carol');
select is((select count(*)::int from public.join_group('QQQQQ9')), 0,
  'I37 below the global threshold a new account may guess (positive control)');
select pg_temp.become('superuser');
select is(
  (select count(*)::int from public.rate_limit_events where key = 'join_group:global' and action = 'join_fail'),
  (select before + 1 from rls_join_global),
  'I38 every wrong code is also counted project-wide'
);
insert into public.rate_limit_events (key, action)
select 'join_group:global', 'join_fail'
from generate_series(1, 200 - (
  select count(*)::int from public.rate_limit_events where key = 'join_group:global' and action = 'join_fail'
));
select pg_temp.become('carol');
select throws_ok(
  $$ select * from public.join_group('QQQQR2') $$,
  'P0001', 'rate_limited', 'I39 with 200 wrong codes project-wide in the last hour, profiles younger than 7 days cannot guess'
);
select pg_temp.become('superuser');
update public.users set created_at = now() - interval '30 days' where id = 'b0000000-0000-4000-8000-000000000003';
select pg_temp.become('carol');
select is(
  (select count(*)::int from public.join_group('QQQQR3')) + (select count(*)::int from public.join_group('QQQQR4')),
  0,
  'I40 under global pressure an established profile still gets 3 failures an hour'
);
select throws_ok(
  $$ select * from public.join_group('QQQQR5') $$,
  'P0001', 'rate_limited', 'I41 under global pressure the 4th failure in an hour is rate limited'
);
select pg_temp.become('superuser');
delete from public.rate_limit_events
where action = 'join_fail' and key in ('join_group:global', 'user:b0000000-0000-4000-8000-000000000003');
update public.users set created_at = now() where id = 'b0000000-0000-4000-8000-000000000003';

-- ===========================================================================
-- J. Blocks
-- ===========================================================================
-- A photo on bob's meetup in GA, for the photo-visibility checks below.
select pg_temp.become('superuser');
insert into storage.objects (bucket_id, name, owner, owner_id) values
  ('totems', '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000007/0b000000-0000-4000-8000-000000000021.jpg',
   'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002');
select pg_temp.become('alice');
select is(
  (select count(*)::int from storage.objects
    where name = '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000007/0b000000-0000-4000-8000-000000000021.jpg'),
  1,
  'J0 before any block, alice sees bob''s meetup photo (positive control)'
);
select throws_ok(
  $$ insert into public.user_blocks (blocker_id, blocked_id) values ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'J1 user_blocks cannot be written directly'
);
select throws_ok(
  $$ select public.block_user('b0000000-0000-4000-8000-000000000003') $$,
  'P0001', 'not_group_member', 'J2 cannot block someone you share no group with'
);
select throws_ok(
  $$ select public.block_user('b0000000-0000-4000-8000-000000000001') $$,
  'P0001', 'invalid_input', 'J3 cannot block yourself'
);
select lives_ok(
  $$ select public.block_user('b0000000-0000-4000-8000-000000000002') $$,
  'J4 can block a groupmate'
);
select lives_ok(
  $$ select public.block_user('b0000000-0000-4000-8000-000000000002') $$,
  'J5 block_user is idempotent'
);
select is(
  (select count(*)::int from public.meetups where id = 'e0000000-0000-4000-8000-000000000007'),
  0,
  'J6 after blocking, the blocked user''s meetups disappear'
);
select is(
  (select count(*)::int from storage.objects
    where name like '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000007/%'),
  0,
  'J6a after blocking, the blocked user''s meetup photos disappear too'
);
select is(
  (select count(*)::int from public.user_blocks where blocked_id = 'b0000000-0000-4000-8000-000000000002'),
  1,
  'J7 the blocker sees her block'
);
select pg_temp.become('superuser');
select is(
  array(select target_type || '|' || reason || '|' || status || '|' || coalesce(target_snapshot, '') || '|' || coalesce(group_id::text, '')
        from public.reports
        where reporter_id = 'b0000000-0000-4000-8000-000000000001' and target_id = 'b0000000-0000-4000-8000-000000000002'
          and target_type = 'block'),
  array['block|other|open|Bob|90000000-0000-4000-8000-000000000001'],
  'J7a blocking files one open block report for the developer (idempotent block, no duplicate)'
);
select pg_temp.become('bob');
select is(
  (select count(*)::int from public.meetups where id = 'e0000000-0000-4000-8000-000000000001'),
  0,
  'J8 the blocked user no longer sees the blocker''s meetups'
);
select is(
  array(select name from storage.objects
        where bucket_id = 'totems' and name like '90000000-0000-4000-8000-000000000001/%' order by name),
  array['90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000007/0b000000-0000-4000-8000-000000000021.jpg'],
  'J8a in GA the blocked user sees neither the blocker''s photos nor those of the user he blocked (erin), only his own'
);
select pg_temp.become('superuser');
create policy rls_test_wide_open on storage.objects for select to public using (true);
select pg_temp.become('bob');
select is(
  (select count(*)::int from storage.objects
    where name like '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/%'),
  0,
  'J8b the restrictive guard enforces blocks even with a wide-open permissive policy'
);
select pg_temp.become('superuser');
drop policy rls_test_wide_open on storage.objects;
select pg_temp.become('alice');
select public.unblock_user('b0000000-0000-4000-8000-000000000002');
select is(
  (select count(*)::int from public.meetups where id = 'e0000000-0000-4000-8000-000000000007'),
  1,
  'J9 unblocking restores visibility'
);
select is(
  (select count(*)::int from storage.objects
    where name like '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000007/%'),
  1,
  'J9a unblocking restores photo visibility'
);
select pg_temp.become('superuser');
insert into public.user_blocks (blocker_id, blocked_id)
values ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003');
select pg_temp.become('alice');
select lives_ok(
  $$ select public.block_user('b0000000-0000-4000-8000-000000000003') $$,
  'J10 re-blocking is allowed when a block already exists (no shared group needed)'
);
select pg_temp.become('superuser');
select is(
  (select count(*)::int from public.reports
    where reporter_id = 'b0000000-0000-4000-8000-000000000001' and target_id = 'b0000000-0000-4000-8000-000000000003'),
  0,
  'J11 re-blocking an existing block files no new report'
);

-- ===========================================================================
-- K. Reports
-- ===========================================================================
select pg_temp.become('alice');
select throws_ok(
  $$ select public.report_content('user', 'b0000000-0000-4000-8000-000000000003', 'spam') $$,
  'P0001', 'invalid_input', 'K1 cannot report a user you share no group with'
);
select throws_ok(
  $$ select public.report_content('user', 'b0000000-0000-4000-8000-000000000001', 'spam') $$,
  'P0001', 'invalid_input', 'K2 cannot report yourself'
);
select throws_ok(
  $$ select public.report_content('group', '90000000-0000-4000-8000-000000000002', 'spam') $$,
  'P0001', 'invalid_input', 'K3 cannot report a group you are not in'
);
select throws_ok(
  $$ select public.report_content('meetup', 'e0000000-0000-4000-8000-000000000003', 'spam') $$,
  'P0001', 'invalid_input', 'K4 cannot report a meetup outside your groups'
);
select throws_ok(
  $$ select public.report_content('photo', 'e0000000-0000-4000-8000-000000000007', 'sexual') $$,
  'P0001', 'invalid_input', 'K5 cannot report a photo on a meetup without one'
);
select throws_ok(
  $$ select public.report_content('user', 'b0000000-0000-4000-8000-000000000002', 'rude') $$,
  'P0001', 'invalid_input', 'K6 unknown reasons are rejected'
);
select throws_ok(
  $$ select public.report_content('user', 'b0000000-0000-4000-8000-000000000002', 'other', repeat('x', 501)) $$,
  'P0001', 'invalid_input', 'K7 details over 500 characters are rejected'
);
select throws_ok(
  $$ select public.report_content('festival', 'f0000000-0000-4000-8000-000000000001', 'other') $$,
  'P0001', 'invalid_input', 'K8 unknown target types are rejected'
);
select lives_ok(
  $$ select public.report_content('group', '90000000-0000-4000-8000-000000000001', 'hate', 'name') $$,
  'K9 can report your own group'
);
select lives_ok(
  $$ select public.report_content('meetup', 'e0000000-0000-4000-8000-000000000007', 'spam') $$,
  'K10 can report a meetup in your group'
);
select lives_ok(
  $$ select public.report_content('photo', 'e0000000-0000-4000-8000-000000000001', 'violence') $$,
  'K11 can report a photo in your group'
);
select is(
  public.report_content('user', 'b0000000-0000-4000-8000-000000000002', 'harassment'),
  public.report_content('user', 'b0000000-0000-4000-8000-000000000002', 'spam'),
  'K12 duplicate reports return the existing id'
);
select pg_temp.become('superuser');
select is(
  array(
    select target_type || '|' || coalesce(target_snapshot, '') || '|' || coalesce(group_id::text, '')
    from public.reports where reporter_id = 'b0000000-0000-4000-8000-000000000001' order by target_type
  ),
  array[
    'block|Bob|90000000-0000-4000-8000-000000000001',
    'group|Group A renamed|90000000-0000-4000-8000-000000000001',
    'meetup|Bob meetup v2|90000000-0000-4000-8000-000000000001',
    'photo|90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/0b000000-0000-4000-8000-000000000001.jpg|90000000-0000-4000-8000-000000000001',
    'user|Bob|90000000-0000-4000-8000-000000000001'
  ],
  'K13 reports store a target snapshot and group context'
);
insert into public.rate_limit_events (key, action)
select 'user:b0000000-0000-4000-8000-000000000005', 'report' from generate_series(1, 20);
select pg_temp.become('erin');
select throws_ok(
  $$ select public.report_content('user', 'b0000000-0000-4000-8000-000000000001', 'spam') $$,
  'P0001', 'rate_limited', 'K14 the 21st report in a day is rate limited'
);

-- ===========================================================================
-- L. Storage (totems bucket)
-- ===========================================================================
select pg_temp.become('alice');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner, owner_id)
     values ('totems', '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/0b000000-0000-4000-8000-000000000011.jpg',
             'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001') $$,
  'L1 meetup creator can upload into her meetup folder'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('totems', '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000007/0b000000-0000-4000-8000-000000000012.jpg', 'a0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'L2 cannot upload into another member''s meetup folder'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('totems', '90000000-0000-4000-8000-000000000002/e0000000-0000-4000-8000-000000000003/0b000000-0000-4000-8000-000000000013.jpg', 'a0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'L3 cannot upload into another group''s folder'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('totems', '90000000-0000-4000-8000-000000000002/e0000000-0000-4000-8000-000000000001/0b000000-0000-4000-8000-000000000014.jpg', 'a0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'L4 cannot upload under a group/meetup pair that does not match'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('totems', 'not-a-uuid/e0000000-0000-4000-8000-000000000001/0b000000-0000-4000-8000-000000000015.jpg', 'a0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'L5 malformed group folder is rejected'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('totems', '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/../../x.jpg', 'a0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'L6 extra path segments are rejected'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('totems', '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/photo.png', 'a0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'L7 file names other than <uuid>.jpg are rejected'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('totems', '0b000000-0000-4000-8000-000000000016.jpg', 'a0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'L8 uploads outside any folder are rejected'
);
with u as (
  update storage.objects set metadata = '{"x":1}'
  where bucket_id = 'totems' and owner_id = 'a0000000-0000-4000-8000-000000000001' returning 1
)
select is(count(*)::int, 0, 'L9 totem objects cannot be updated') from u;

select pg_temp.become('anon');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('totems', '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/0b000000-0000-4000-8000-000000000017.jpg') $$,
  '42501', null, 'L10 anon cannot upload totems'
);

-- At most 5 objects per meetup folder (0b..01 and 0b..11 are already there).
select pg_temp.become('alice');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner, owner_id)
     select 'totems', format('90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/0b000000-0000-4000-8000-0000000000%s.jpg', n),
            'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001'
     from generate_series(31, 33) n $$,
  'L10a uploads up to 5 objects per meetup folder are accepted (positive control)'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner, owner_id)
     values ('totems', '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/0b000000-0000-4000-8000-000000000034.jpg',
             'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'L10b a 6th object in one meetup folder is rejected'
);

-- A photo owned by bob (GA member) for the admin-deletes case (L15).
select pg_temp.become('superuser');
insert into storage.objects (bucket_id, name, owner, owner_id) values
  ('totems', '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000007/0b000000-0000-4000-8000-000000000018.jpg',
   'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002');

select pg_temp.become('bob');
select set_config('storage.allow_delete_query', 'true', true);
with d as (
  delete from storage.objects
  where bucket_id = 'totems'
    and name = '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/0b000000-0000-4000-8000-000000000011.jpg'
  returning 1
)
select is(count(*)::int, 0, 'L11 a member cannot delete another member''s photo') from d;
select pg_temp.become('dave');
select set_config('storage.allow_delete_query', 'true', true);
with d as (
  delete from storage.objects where bucket_id = 'totems' and name like '90000000-0000-4000-8000-000000000001/%' returning 1
)
select is(count(*)::int, 0, 'L12 a non-member cannot delete a group''s photos') from d;
-- erin is a plain member of GA (not an admin): only the owner branch applies.
select pg_temp.become('erin');
select set_config('storage.allow_delete_query', 'true', true);
with d as (
  delete from storage.objects
  where bucket_id = 'totems'
    and name = '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000002/0b000000-0000-4000-8000-000000000002.jpg'
  returning 1
)
select is(count(*)::int, 1, 'L13 a non-admin owner can delete her own photo') from d;
select pg_temp.become('alice');
select set_config('storage.allow_delete_query', 'false', true);
select throws_ok(
  $$ delete from storage.objects where bucket_id = 'totems' $$,
  '42501', null, 'L14 direct SQL deletes on storage.objects are refused (protect_delete)'
);
select set_config('storage.allow_delete_query', 'true', true);
with d as (
  delete from storage.objects
  where bucket_id = 'totems'
    and name = '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000007/0b000000-0000-4000-8000-000000000018.jpg'
  returning 1
)
select is(count(*)::int, 1, 'L15 a group admin can delete another member''s photo in her group') from d;
-- K11 reported alice's photo 0b..01: neither its owner nor the crew admin (both alice) can delete it.
with d as (
  delete from storage.objects
  where bucket_id = 'totems'
    and name = '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/0b000000-0000-4000-8000-000000000001.jpg'
  returning 1
)
select is(count(*)::int, 0, 'L15a a photo under an open report cannot be deleted by its owner or the crew admin') from d;
with d as (
  delete from storage.objects
  where bucket_id = 'totems'
    and name = '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/0b000000-0000-4000-8000-000000000031.jpg'
  returning 1
)
select is(count(*)::int, 1, 'L15b an unreported photo in the same folder can be deleted (positive control)') from d;
select pg_temp.become('superuser');
update public.reports set status = 'dismissed'
where target_type = 'photo' and target_id = 'e0000000-0000-4000-8000-000000000001';
select pg_temp.become('alice');
select set_config('storage.allow_delete_query', 'true', true);
with d as (
  delete from storage.objects
  where bucket_id = 'totems'
    and name = '90000000-0000-4000-8000-000000000001/e0000000-0000-4000-8000-000000000001/0b000000-0000-4000-8000-000000000001.jpg'
  returning 1
)
select is(count(*)::int, 1, 'L15c once the report is resolved the photo can be deleted again') from d;
select set_config('storage.allow_delete_query', 'false', true);
select pg_temp.become('superuser');
select ok(
  (select not public and file_size_limit = 5242880 and allowed_mime_types = array['image/jpeg']
   from storage.buckets where id = 'totems'),
  'L16 totems bucket is private, 5 MiB, JPEG only'
);

-- ===========================================================================
-- M. Service-role functions and rate limiting
-- ===========================================================================
select pg_temp.become('alice');
select throws_ok($$ select * from public.prepare_account_deletion('a0000000-0000-4000-8000-000000000001') $$, '42501', null, 'M1 prepare_account_deletion is service-role only');
select throws_ok($$ select public.prepare_demo_account('a0000000-0000-4000-8000-000000000001') $$, '42501', null, 'M2 prepare_demo_account is service-role only');
select throws_ok($$ select public.purge_rate_limit_events() $$, '42501', null, 'M3 purge_rate_limit_events is service-role only');
select throws_ok($$ select public.check_rate_limit('k', 'a', 1, '1 hour') $$, '42501', null, 'M4 public.check_rate_limit is service-role only');
select throws_ok($$ select private.check_rate_limit('k', 'a', 1, '1 hour') $$, '42501', null, 'M5 private.check_rate_limit is service-role only');
select pg_temp.become('anon');
select throws_ok($$ select * from public.prepare_account_deletion('a0000000-0000-4000-8000-000000000001') $$, '42501', null, 'M6 anon cannot call prepare_account_deletion');
select throws_ok($$ select public.check_rate_limit('k', 'a', 1, '1 hour') $$, '42501', null, 'M7 anon cannot call check_rate_limit');

select pg_temp.become('service_role');
select is(
  array[
    public.check_rate_limit('demo-login:ip:203.0.113.9', 'attempt', 2, '1 hour'),
    public.check_rate_limit('demo-login:ip:203.0.113.9', 'attempt', 2, '1 hour'),
    public.check_rate_limit('demo-login:ip:203.0.113.9', 'attempt', 2, '1 hour'),
    private.check_rate_limit('demo-login:ip:203.0.113.10', 'attempt', 2, '1 hour')
  ],
  array[true, true, false, true],
  'M8 check_rate_limit allows p_max events per window, then refuses (per key)'
);
select throws_ok(
  $$ select public.check_rate_limit('k', 'a', 0, '1 hour') $$,
  'P0001', 'invalid_input', 'M9 check_rate_limit validates its arguments'
);
select pg_temp.become('superuser');
insert into public.rate_limit_events (key, action, created_at) values ('old', 'x', now() - interval '25 hours');
insert into public.auth_attempts (email, action, attempted_at) values ('old@example.com', 'x', now() - interval '25 hours');
select pg_temp.become('service_role');
select ok(public.purge_rate_limit_events() >= 2, 'M10 purge_rate_limit_events deletes events older than 24 h');
select pg_temp.become('superuser');
select is(
  (select count(*)::int from public.rate_limit_events where key = 'old')
  + (select count(*)::int from public.auth_attempts where email = 'old@example.com'),
  0,
  'M11 old rate limit events and auth attempts are gone'
);
select ok(
  (select count(*) from public.rate_limit_events where key = 'demo-login:ip:203.0.113.9') = 2,
  'M12 recent rate limit events are kept'
);

-- Custom access token hook: GoTrue's email provider accepts passwords on
-- /signup and /token whatever the app does, so password tokens are refused.
select pg_temp.become('supabase_auth_admin');
select ok(
  (select h -> 'error' ->> 'http_code' = '403' and not h ? 'claims'
   from public.custom_access_token_hook(
     '{"user_id":"a0000000-0000-4000-8000-000000000001","authentication_method":"password","claims":{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}}'
   ) h),
  'M13 the access token hook refuses a token requested with a password'
);
select is(
  public.custom_access_token_hook(
    '{"user_id":"a0000000-0000-4000-8000-000000000001","authentication_method":"otp","claims":{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}}'
  ),
  '{"claims":{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}}'::jsonb,
  'M14 the access token hook passes emailed-code sign-ins through unchanged (control)'
);
select is(
  public.custom_access_token_hook(
    '{"user_id":"a0000000-0000-4000-8000-000000000001","authentication_method":"token_refresh","claims":{"sub":"a0000000-0000-4000-8000-000000000001"}}'
  ) -> 'claims' ->> 'sub',
  'a0000000-0000-4000-8000-000000000001',
  'M15 the access token hook passes token refreshes through'
);

-- ===========================================================================
-- N. Demo account (App Review)
-- ===========================================================================
-- demo:seed marks the fake members with app_metadata.festie_demo (service-role
-- only). carol forges the flag in her user_metadata, which users can edit.
select pg_temp.become('superuser');
update auth.users set raw_app_meta_data = '{"provider":"email","festie_demo":true}'
where id in ('a0000000-0000-4000-8000-000000000022', 'a0000000-0000-4000-8000-000000000023');
update auth.users set raw_user_meta_data = '{"festie_demo":true}'
where id = 'a0000000-0000-4000-8000-000000000003';
insert into public.meetups (id, group_id, title, starts_at, created_by_user_id) values
  ('e0000000-0000-4000-8000-000000000020', '90000000-0000-4000-8000-000000000009', 'Seeded meetup', now() + interval '1 day', 'b0000000-0000-4000-8000-000000000022');

-- Attack 1: carol creates a same-named crew on the published demo festival
-- (backdated so it is the oldest one).
select pg_temp.become('carol');
create temp table demo_attack on commit drop as
select group_id from public.create_group('Festie Demo Crew', 'f0000000-0000-4000-8000-000000000004');
select pg_temp.become('superuser');
update public.groups set created_at = now() - interval '30 days' where id = (select group_id from demo_attack);
-- Attack 2: kim got into the real demo crew and posted a meetup there.
insert into public.group_members (group_id, user_id, role, joined_at) values
  ('90000000-0000-4000-8000-000000000009', 'b0000000-0000-4000-8000-000000000017', 'member', now() - interval '1 day');
insert into public.meetups (id, group_id, title, starts_at, created_by_user_id) values
  ('e0000000-0000-4000-8000-000000000021', '90000000-0000-4000-8000-000000000009', 'Outsider meetup', now() + interval '1 day', 'b0000000-0000-4000-8000-000000000017');

select pg_temp.become('service_role');
select throws_ok(
  $$ select public.prepare_demo_account('00000000-0000-4000-8000-000000000000') $$,
  'P0001', 'invalid_input', 'N1 prepare_demo_account requires an existing auth user'
);
select lives_ok(
  $$ select public.prepare_demo_account('a0000000-0000-4000-8000-000000000021') $$,
  'N2 prepare_demo_account succeeds for the reviewer'
);
select pg_temp.become('superuser');
update public.location_shares set recorded_at = now() - interval '1 hour'
where group_id = '90000000-0000-4000-8000-000000000009';
select pg_temp.become('service_role');
select lives_ok(
  $$ select public.prepare_demo_account('a0000000-0000-4000-8000-000000000021') $$,
  'N3 prepare_demo_account is idempotent'
);
select pg_temp.become('superuser');
select is(
  (select display_name::text || ':' || email from public.users where auth_user_id = 'a0000000-0000-4000-8000-000000000021'),
  'App Reviewer:rev@example.com',
  'N4 the demo profile exists'
);
select is(
  (select string_agg(role, ',') from public.group_members m join public.users u on u.id = m.user_id
   where u.auth_user_id = 'a0000000-0000-4000-8000-000000000021'),
  'member',
  'N5 the reviewer is a member of the Festie Demo Crew (once)'
);
select is(
  (select count(*)::int from public.location_shares
    where group_id = '90000000-0000-4000-8000-000000000009' and recorded_at = now()),
  2,
  'N6 both fake members have live location rows near stages'
);
select is(
  (select count(*)::int from public.user_festivals f join public.users u on u.id = f.user_id
   where u.auth_user_id = 'a0000000-0000-4000-8000-000000000021'
     and f.festival_id = 'f0000000-0000-4000-8000-000000000004'),
  1,
  'N7 the reviewer follows the demo festival'
);
select pg_temp.become('rev');
select is(
  (select count(*)::int from public.get_group_locations('90000000-0000-4000-8000-000000000009')),
  2,
  'N8 the reviewer sees the fake members on the map'
);
-- Long after the demo login: location rows went stale and the seeded meetup
-- started hours ago (it would sit under "Earlier").
select pg_temp.become('superuser');
update public.location_shares set recorded_at = now() - interval '20 minutes'
where group_id = '90000000-0000-4000-8000-000000000009';
update public.meetups set starts_at = now() - interval '3 hours'
where id = 'e0000000-0000-4000-8000-000000000020';
select pg_temp.become('rev');
select is(
  (select count(*)::int from public.get_group_locations('90000000-0000-4000-8000-000000000009')),
  2,
  'N8a the demo crew is still live on the map long after the demo login'
);
select pg_temp.become('superuser');
select is(
  (select starts_at from public.meetups where id = 'e0000000-0000-4000-8000-000000000020'),
  date_trunc('hour', now()) + interval '2 hours',
  'N8b the seeded meetup moves to an upcoming time'
);
update public.location_shares set recorded_at = now() - interval '20 minutes'
where group_id = '90000000-0000-4000-8000-000000000009';
select private.refresh_demo_crew();
select is(
  (select count(*)::int from public.location_shares
    where group_id = '90000000-0000-4000-8000-000000000009' and recorded_at = now()),
  2,
  'N8c the scheduled refresh (no group argument) keeps the demo locations fresh too'
);
select pg_temp.become('superuser');
select is(
  array(select m.group_id::text from public.group_members m join public.users u on u.id = m.user_id
        where u.auth_user_id = 'a0000000-0000-4000-8000-000000000021'),
  array['90000000-0000-4000-8000-000000000009'],
  'N9 a same-named crew created by a real user (forged user_metadata) is never chosen'
);
select is(
  array(select u.display_name || ':' || m.role from public.group_members m join public.users u on u.id = m.user_id
        where m.group_id = (select group_id from demo_attack)),
  array['Carol:admin'],
  'N10 the impostor crew is left alone'
);
select is(
  array(select u.display_name || ':' || m.role from public.group_members m join public.users u on u.id = m.user_id
        where m.group_id = '90000000-0000-4000-8000-000000000009' order by u.display_name),
  array['App Reviewer:member', 'Demo1:admin', 'Demo2:member'],
  'N11 the demo crew is exactly the fake members plus the reviewer'
);
select is(
  array(select title::text from public.meetups where group_id = '90000000-0000-4000-8000-000000000009' order by title),
  array['Seeded meetup'],
  'N12 meetups posted by outsiders in the demo crew are removed; seeded ones stay'
);
select is(
  array(select u.display_name::text from public.location_shares l join public.users u on u.id = l.user_id
        where l.group_id in ('90000000-0000-4000-8000-000000000009', (select group_id from demo_attack))
        order by u.display_name),
  array['Demo1', 'Demo2'],
  'N13 location rows are written only for the seeded fake members'
);

-- App Review blocks a fake member on the shared reviewer login, and a block
-- from a fake member exists too. The next demo login clears blocks between the
-- reviewer and the fake members, and only those.
select pg_temp.become('rev');
select public.block_user('b0000000-0000-4000-8000-000000000022');
select is(
  (select count(*)::int from public.get_group_locations('90000000-0000-4000-8000-000000000009'))::text
    || ':' || (select count(*)::int from public.meetups where id = 'e0000000-0000-4000-8000-000000000020')::text,
  '1:0',
  'N14 a reviewer block hides that fake member''s location and seeded meetup (control)'
);
select pg_temp.become('superuser');
insert into public.user_blocks (blocker_id, blocked_id)
select v.blocker_id, v.blocked_id
from (select id from public.users where auth_user_id = 'a0000000-0000-4000-8000-000000000021') r,
     lateral (values ('b0000000-0000-4000-8000-000000000023'::uuid, r.id),
                     (r.id, 'b0000000-0000-4000-8000-000000000003'::uuid)) v(blocker_id, blocked_id);
select pg_temp.become('service_role');
select public.prepare_demo_account('a0000000-0000-4000-8000-000000000021');
select pg_temp.become('rev');
select is(
  (select count(*)::int from public.get_group_locations('90000000-0000-4000-8000-000000000009'))::text
    || ':' || (select count(*)::int from public.meetups where id = 'e0000000-0000-4000-8000-000000000020')::text,
  '2:1',
  'N15 the next demo login restores the blocked fake members'' locations and the seeded meetup'
);
select pg_temp.become('superuser');
select is(
  array(select bu.display_name::text || '>' || bd.display_name::text
        from public.user_blocks b
        join public.users bu on bu.id = b.blocker_id
        join public.users bd on bd.id = b.blocked_id
        where 'App Reviewer' in (bu.display_name, bd.display_name)
        order by 1),
  array['App Reviewer>Carol'],
  'N16 prepare_demo_account clears only blocks between the reviewer and the fake members'
);

-- ===========================================================================
-- O. Account deletion cascade
-- ===========================================================================
-- zed's earlier upload that no meetup references any more (replaced photo).
select pg_temp.become('superuser');
insert into storage.objects (bucket_id, name, owner, owner_id) values
  ('totems', '90000000-0000-4000-8000-000000000004/e0000000-0000-4000-8000-000000000004/0b000000-0000-4000-8000-000000000019.jpg',
   'a0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000007');
select pg_temp.become('service_role');
select is(
  (select count(*)::int from public.prepare_account_deletion('00000000-0000-4000-8000-000000000000')),
  0,
  'O0 prepare_account_deletion of an unknown auth user is a no-op'
);
select is(
  array(select storage_path from public.prepare_account_deletion('a0000000-0000-4000-8000-000000000007') order by 1),
  array['90000000-0000-4000-8000-000000000004/e0000000-0000-4000-8000-000000000004/0b000000-0000-4000-8000-000000000004.jpg',
        '90000000-0000-4000-8000-000000000004/e0000000-0000-4000-8000-000000000004/0b000000-0000-4000-8000-000000000019.jpg'],
  'O1 prepare_account_deletion returns the user''s photos, including unreferenced uploads (not groupmates'')'
);
select is(
  array(select storage_path from public.prepare_account_deletion('a0000000-0000-4000-8000-000000000009') order by 1),
  array['90000000-0000-4000-8000-000000000005/e0000000-0000-4000-8000-000000000005/0b000000-0000-4000-8000-000000000005.jpg',
        '90000000-0000-4000-8000-000000000005/e0000000-0000-4000-8000-000000000008/0b000000-0000-4000-8000-000000000007.jpg'],
  'O2 photos left in a group that becomes empty are returned too'
);
select pg_temp.become('superuser');
select is(
  array(select u.display_name || ':' || m.role from public.group_members m join public.users u on u.id = m.user_id
        where m.group_id = '90000000-0000-4000-8000-000000000004'),
  array['Yan:admin'],
  'O3 admin role handed off to the remaining member'
);
select is(
  (select count(*)::int from public.groups where id = '90000000-0000-4000-8000-000000000005'),
  0,
  'O4 groups left empty are deleted'
);

-- Moderation trigger vs cascade: the group name and display name now contain a
-- disallowed term, but FK cascades/set-null must still succeed.
insert into public.moderation_terms (term) values ('zedword');
select throws_ok(
  $$ update public.groups set name = 'Zedword Crew 2' where id = '90000000-0000-4000-8000-000000000004' $$,
  'P0001', 'content_not_allowed', 'O5 the new term is enforced on renames (positive control)'
);
select pg_temp.become('supabase_auth_admin');
select lives_ok(
  $$ delete from auth.users where id in ('a0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000009') $$,
  'O6 deleting auth users cascades without tripping moderation triggers'
);
select pg_temp.become('superuser');
select is(
  (select count(*)::int from public.users
    where id in ('b0000000-0000-4000-8000-000000000007', 'b0000000-0000-4000-8000-000000000009')),
  0,
  'O7 profiles are deleted with the auth user'
);
select is(
  (select coalesce(created_by_user_id::text, 'null') || ':' || name from public.groups
    where id = '90000000-0000-4000-8000-000000000004'),
  'null:Zedword Crew',
  'O8 groups created by the deleted user survive with created_by_user_id null'
);
select is(
  array(select id::text from public.meetups
        where id in ('e0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000006') order by id),
  array['e0000000-0000-4000-8000-000000000006'],
  'O9 the deleted user''s meetups are gone; groupmates'' remain'
);
select is(
  (select count(*)::int from public.user_set_selections where id = '5e000000-0000-4000-8000-000000000007'),
  0,
  'O10 the deleted user''s selections are gone'
);
select is(
  (select coalesce(reporter_id::text, 'null') from public.reports
    where target_id = 'b0000000-0000-4000-8000-000000000008' and target_type = 'user'),
  'null',
  'O11 reports filed by the deleted user are kept anonymized'
);
-- Direct deletion (no prepare step) of a blocked user with a location row.
select pg_temp.become('supabase_auth_admin');
select lives_ok(
  $$ delete from auth.users where id = 'a0000000-0000-4000-8000-000000000005' $$,
  'O12 auth user deletion cascades even without prepare_account_deletion'
);
select pg_temp.become('superuser');
select is(
  (select count(*)::int from public.user_blocks where blocked_id = 'b0000000-0000-4000-8000-000000000005')
  + (select count(*)::int from public.location_shares where user_id = 'b0000000-0000-4000-8000-000000000005')
  + (select count(*)::int from public.group_members where user_id = 'b0000000-0000-4000-8000-000000000005'),
  0,
  'O13 blocks, location rows and memberships of the deleted user are gone'
);


-- ===========================================================================
-- P. Bans (admin-tools users:ban -> prepare_account_ban)
-- ===========================================================================
-- troll is in carol's crew GP with a meetup + photo; carol shares her location.
select pg_temp.become('superuser');
insert into auth.users (id, email) values ('a0000000-0000-4000-8000-000000000024', 'troll@example.com');
insert into public.users (id, auth_user_id, email, display_name)
values ('b0000000-0000-4000-8000-000000000024', 'a0000000-0000-4000-8000-000000000024', 'troll@example.com', 'Troll');
insert into public.groups (id, festival_id, name, created_by_user_id, invite_code) values
  ('90000000-0000-4000-8000-00000000000a', 'f0000000-0000-4000-8000-000000000001', 'Group P', 'b0000000-0000-4000-8000-000000000003', 'PPPPP2');
insert into public.group_members (group_id, user_id, role, joined_at) values
  ('90000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-000000000003', 'admin', now() - interval '2 days'),
  ('90000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-000000000024', 'member', now() - interval '1 day');
insert into public.meetups (id, group_id, title, starts_at, created_by_user_id, totem_path) values
  ('e0000000-0000-4000-8000-000000000030', '90000000-0000-4000-8000-00000000000a', 'Troll meetup', now() + interval '1 day', 'b0000000-0000-4000-8000-000000000024',
   '90000000-0000-4000-8000-00000000000a/e0000000-0000-4000-8000-000000000030/0b000000-0000-4000-8000-000000000030.jpg'),
  ('e0000000-0000-4000-8000-000000000031', '90000000-0000-4000-8000-00000000000a', 'Carol meetup', now() + interval '1 day', 'b0000000-0000-4000-8000-000000000003', null);
insert into storage.objects (bucket_id, name, owner, owner_id) values
  ('totems', '90000000-0000-4000-8000-00000000000a/e0000000-0000-4000-8000-000000000030/0b000000-0000-4000-8000-000000000030.jpg',
   'a0000000-0000-4000-8000-000000000024', 'a0000000-0000-4000-8000-000000000024');
insert into public.location_shares (group_id, user_id, lat, lng, recorded_at) values
  ('90000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-000000000003', 44.0, -90.0, now() - interval '1 minute'),
  ('90000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-000000000024', 44.1, -90.1, now() - interval '1 minute');

select pg_temp.become('troll');
select is(
  (select count(*)::int from public.get_group_locations('90000000-0000-4000-8000-00000000000a'))::text
    || ':' || (select count(*)::int from public.meetups where group_id = '90000000-0000-4000-8000-00000000000a')::text
    || ':' || (select count(*)::int from storage.objects where name like '90000000-0000-4000-8000-00000000000a/%')::text,
  '1:2:1',
  'P1 before the ban, troll sees the crew''s locations, meetups and photos (control)'
);

-- users:ban sets banned_until; troll's access token stays valid until it expires.
select pg_temp.become('superuser');
update auth.users set banned_until = now() + interval '876000 hours'
where id = 'a0000000-0000-4000-8000-000000000024';
select pg_temp.become('troll');
select throws_ok(
  $$ select * from public.get_group_locations('90000000-0000-4000-8000-00000000000a') $$,
  'P0001', 'not_authenticated', 'P2 a banned user''s still-valid token cannot read crew locations'
);
select is(
  (select count(*)::int from public.location_shares)::text
    || ':' || (select count(*)::int from public.meetups)::text
    || ':' || (select count(*)::int from public.group_members)::text
    || ':' || (select count(*)::int from public.groups)::text
    || ':' || (select count(*)::int from storage.objects where bucket_id = 'totems')::text,
  '0:0:0:0:0',
  'P3 a banned user''s token reads no locations, meetups, members, crews or photos'
);
select throws_ok(
  $$ select * from public.join_group('PPPPP2') $$,
  'P0001', 'not_authenticated', 'P4 a banned user cannot (re)join a crew'
);
select throws_ok(
  $$ select * from public.get_my_profile() $$,
  'P0001', 'not_authenticated', 'P5 a banned user has no profile access'
);

select pg_temp.become('alice');
select throws_ok(
  $$ select * from public.prepare_account_ban('a0000000-0000-4000-8000-000000000024') $$,
  '42501', null, 'P6 prepare_account_ban is service-role only'
);
select pg_temp.become('service_role');
select is(
  array(select storage_path from public.prepare_account_ban('a0000000-0000-4000-8000-000000000024') order by 1),
  array['90000000-0000-4000-8000-00000000000a/e0000000-0000-4000-8000-000000000030/0b000000-0000-4000-8000-000000000030.jpg'],
  'P7 prepare_account_ban returns the banned user''s photo paths'
);
select pg_temp.become('superuser');
select ok(
  (select invite_code <> 'PPPPP2' and invite_code_rotated_at = now()
   from public.groups where id = '90000000-0000-4000-8000-00000000000a'),
  'P8 crews the banned user was in get a new invite code'
);
select is(
  array(select u.display_name || ':' || m.role from public.group_members m join public.users u on u.id = m.user_id
        where m.group_id = '90000000-0000-4000-8000-00000000000a'),
  array['Carol:admin'],
  'P9 the banned user''s membership is gone, the admin stays'
);
select is(
  (select array_agg(id::text order by id) from public.meetups where group_id = '90000000-0000-4000-8000-00000000000a')::text
    || ':' || (select count(*)::int from public.location_shares where user_id = 'b0000000-0000-4000-8000-000000000024')::text,
  '{e0000000-0000-4000-8000-000000000031}:0',
  'P10 the banned user''s meetups and location rows are deleted; others'' meetups remain'
);
-- A friend's (or second) account that knows the old code cannot get back in.
select pg_temp.become('jack');
select is(
  (select count(*)::int from public.join_group('PPPPP2')),
  0,
  'P11 the old invite code no longer works after a ban'
);
select pg_temp.become('carol');
select is(
  (select count(*)::int from public.join_group((select invite_code from public.groups where id = '90000000-0000-4000-8000-00000000000a'))),
  1,
  'P12 the new invite code works (control)'
);

-- ===========================================================================
-- Q. Set status: moved and cancelled sets (011)
-- ===========================================================================
select pg_temp.become('superuser');
select is(
  array(select status || ':' || coalesce(original_start_time::text, '-') || ':' || coalesce(change_note, '-')
        from public.sets where id::text like 'e5000000-%' order by id),
  array['scheduled:-:-', 'scheduled:-:-', 'scheduled:-:-', 'scheduled:-:-'],
  'Q1 existing sets default to scheduled with no original start or note'
);
-- carol picks the set that Q2 cancels (she already picks e5..01, which Q2 moves; fixture 5e..06).
insert into public.user_set_selections (id, user_id, festival_id, set_id)
values ('5e000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000003',
        'f0000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002');

select pg_temp.become('service_role');
select lives_ok(
  $$ update public.sets
     set status = 'moved', original_start_time = '2027-05-31T23:00:00Z',
         start_time = '2027-06-01T20:00:00Z', change_note = 'Moved to Sunday (weather)'
     where id = 'e5000000-0000-4000-8000-000000000001';
     update public.sets set status = 'cancelled', change_note = 'Artist withdrew'
     where id = 'e5000000-0000-4000-8000-000000000002' $$,
  'Q2 the service role can mark sets moved and cancelled'
);
select throws_ok(
  $$ update public.sets set status = 'postponed' where id = 'e5000000-0000-4000-8000-000000000003' $$,
  '23514', null, 'Q3 an unknown status is rejected'
);
select throws_ok(
  $$ update public.sets set status = null where id = 'e5000000-0000-4000-8000-000000000003' $$,
  '23502', null, 'Q4 status cannot be null'
);
select throws_ok(
  $$ update public.sets set original_start_time = now() where id = 'e5000000-0000-4000-8000-000000000002' $$,
  '23514', null, 'Q5 a cancelled set cannot carry an original start time'
);
select throws_ok(
  $$ update public.sets set original_start_time = now() where id = 'e5000000-0000-4000-8000-000000000003' $$,
  '23514', null, 'Q6 a scheduled set cannot carry an original start time'
);
select throws_ok(
  $$ update public.sets set change_note = '' where id = 'e5000000-0000-4000-8000-000000000003' $$,
  '23514', null, 'Q7 an empty change note is rejected'
);
select throws_ok(
  $$ update public.sets set change_note = repeat('x', 141) where id = 'e5000000-0000-4000-8000-000000000003' $$,
  '23514', null, 'Q8 a change note over 140 characters is rejected'
);
select throws_ok(
  $$ update public.sets set change_note = ' Weather ' where id = 'e5000000-0000-4000-8000-000000000003' $$,
  '23514', null, 'Q9 a change note with surrounding whitespace is rejected'
);
select lives_ok(
  $$ update public.sets set change_note = repeat('x', 140) where id = 'e5000000-0000-4000-8000-000000000003';
     update public.sets set change_note = null where id = 'e5000000-0000-4000-8000-000000000003' $$,
  'Q10 a 140-character note on a scheduled set is accepted (control)'
);

select pg_temp.become('anon');
select is(
  array(select status || ':' || coalesce((original_start_time = timestamptz '2027-05-31T23:00:00Z')::text, '-')
               || ':' || coalesce(change_note, '-')
        from public.sets where id::text like 'e5000000-%' order by id),
  array['moved:true:Moved to Sunday (weather)', 'cancelled:-:Artist withdrew', 'scheduled:-:-'],
  'Q11 anon reads status, original start and note of published sets'
);

select pg_temp.become('carol');
select throws_ok(
  $$ update public.sets set status = 'cancelled' where id = 'e5000000-0000-4000-8000-000000000003' $$,
  '42501', null, 'Q12 authenticated users cannot change a set''s status'
);

-- Picks are never refused or removed because of a status, so a pick queued offline before a
-- cancellation still syncs and users keep their picks of moved and cancelled sets.
select pg_temp.become('carol');
select is(
  array(select id::text || ':' || set_id::text from public.user_set_selections
        where user_id = 'b0000000-0000-4000-8000-000000000003' and festival_id = 'f0000000-0000-4000-8000-000000000001'
        order by set_id),
  array['5e000000-0000-4000-8000-000000000006:e5000000-0000-4000-8000-000000000001',
        '5e000000-0000-4000-8000-000000000021:e5000000-0000-4000-8000-000000000002'],
  'Q13 picks made before a set moved or was cancelled survive the change'
);
select pg_temp.become('frank');
select lives_ok(
  $$ insert into public.user_set_selections (id, user_id, festival_id, set_id)
     values ('5e000000-0000-4000-8000-000000000020', 'b0000000-0000-4000-8000-000000000006',
             'f0000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002') $$,
  'Q14 a user can still pick a cancelled set (an offline pick queued before the change syncs)'
);

-- ===========================================================================
-- R. Artwork: image credits (012) and the public artwork bucket (013)
-- ===========================================================================
-- admin-tools (service role) uploads artwork and writes the credit columns;
-- the fixture uses the superuser for the first row.
select pg_temp.become('superuser');
insert into storage.objects (bucket_id, name, owner, owner_id) values
  ('artwork', 'artists/ad000000-0000-4000-8000-000000000001.jpg', null, null);
update public.artists
set image_url = 'https://cdn.example.com/storage/v1/object/public/artwork/artists/ad000000-0000-4000-8000-000000000001.jpg',
    image_credit = 'Jane Doe / Wikimedia Commons',
    image_license = 'CC BY-SA 4.0',
    image_source_url = 'https://commons.wikimedia.org/wiki/File:Artist_One.jpg'
where id = 'ad000000-0000-4000-8000-000000000001';

select pg_temp.become('anon');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'artwork'),
  1,
  'R1 anon can read artwork object rows (public bucket)'
);
select is(
  (select image_credit || '|' || image_license || '|' || image_source_url from public.artists
    where id = 'ad000000-0000-4000-8000-000000000001'),
  'Jane Doe / Wikimedia Commons|CC BY-SA 4.0|https://commons.wikimedia.org/wiki/File:Artist_One.jpg',
  'R2 anon reads an artist''s image credit, licence and source through the catalog grant'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('artwork', 'artists/ad000000-0000-4000-8000-000000000002.jpg') $$,
  '42501', null, 'R3 anon cannot upload artwork'
);

select pg_temp.become('carol');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'artwork'),
  1,
  'R4 authenticated can read artwork object rows'
);
select is(
  (select image_credit || '|' || image_license from public.artists where id = 'ad000000-0000-4000-8000-000000000001'),
  'Jane Doe / Wikimedia Commons|CC BY-SA 4.0',
  'R5 authenticated reads an artist''s image credit and licence'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('artwork', 'artists/ad000000-0000-4000-8000-000000000002.jpg', 'a0000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'R6 authenticated cannot upload artwork'
);
with u as (
  update storage.objects set metadata = '{"x":1}' where bucket_id = 'artwork' returning 1
)
select is(count(*)::int, 0, 'R7 authenticated cannot update artwork objects') from u;
select set_config('storage.allow_delete_query', 'true', true);
with d as (
  delete from storage.objects where bucket_id = 'artwork' returning 1
)
select is(count(*)::int, 0, 'R8 authenticated cannot delete artwork objects') from d;
select set_config('storage.allow_delete_query', 'false', true);
select throws_ok(
  $$ update public.artists set image_credit = 'me' where id = 'ad000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'R9 authenticated users cannot change image credits'
);

-- Whatever permissive (e.g. dashboard-made) policies exist, a client never writes artwork objects:
-- a probe policy that allows everything to authenticated still leaves the artwork bucket read-only.
select pg_temp.become('superuser');
insert into storage.buckets (id, name) values ('rls_probe', 'rls_probe');
create policy rls_probe_allow_all on storage.objects for all to authenticated using (true) with check (true);
select pg_temp.become('carol');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id) values ('rls_probe', 'probe.jpg', 'a0000000-0000-4000-8000-000000000003') $$,
  'R10 the probe policy does let carol write another bucket (control)'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('artwork', 'artists/ad000000-0000-4000-8000-000000000002.jpg', 'a0000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'R11 the restrictive guard still refuses an artwork upload'
);
with u as (
  update storage.objects set metadata = '{"x":1}' where bucket_id = 'artwork' returning 1
)
select is(count(*)::int, 0, 'R12 the restrictive guard still refuses artwork updates') from u;
select set_config('storage.allow_delete_query', 'true', true);
with d as (
  delete from storage.objects where bucket_id = 'artwork' returning 1
)
select is(count(*)::int, 0, 'R13 the restrictive guard still refuses artwork deletes') from d;
select set_config('storage.allow_delete_query', 'false', true);
select pg_temp.become('superuser');
drop policy rls_probe_allow_all on storage.objects;

select pg_temp.become('service_role');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('artwork', 'festivals/f0000000-0000-4000-8000-000000000001.webp') $$,
  'R14 the service role (admin-tools) can upload artwork'
);
select lives_ok(
  $$ update public.festivals
     set image_url = 'https://cdn.example.com/storage/v1/object/public/artwork/festivals/f0000000-0000-4000-8000-000000000001.webp',
         image_credit = 'Festival press kit', image_license = 'Used with permission'
     where id = 'f0000000-0000-4000-8000-000000000001' $$,
  'R15 the service role can set a festival image with its licence (control)'
);
select throws_ok(
  $$ update public.artists set image_url = 'https://cdn.example.com/x.jpg', image_license = null
     where id = 'ad000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'R16 an artist image without a licence is rejected'
);
select throws_ok(
  $$ update public.artists set image_url = 'https://cdn.example.com/x.jpg', image_license = ''
     where id = 'ad000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'R16b an empty licence id is rejected'
);
select throws_ok(
  $$ update public.artists set image_credit = repeat('x', 301) where id = 'ad000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'R17 an image credit over 300 characters is rejected'
);
select throws_ok(
  $$ update public.artists set image_credit = '' where id = 'ad000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'R18 an empty image credit is rejected'
);
select throws_ok(
  $$ update public.artists set image_url = 'http://cdn.example.com/x.jpg' where id = 'ad000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'R19 a non-https artist image URL is rejected'
);
select throws_ok(
  $$ update public.artists set image_source_url = 'ftp://example.com/x' where id = 'ad000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'R20 a non-https image source URL is rejected'
);
select throws_ok(
  $$ update public.festivals set image_url = 'https://cdn.example.com/x.jpg', image_license = null
     where id = 'f0000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'R21 a festival image without a licence is rejected'
);
select throws_ok(
  $$ update public.festivals set image_url = 'http://cdn.example.com/x.jpg' where id = 'f0000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'R22 a non-https festival image URL is rejected'
);
select lives_ok(
  $$ update public.artists set image_credit = repeat('x', 300), image_source_url = null
     where id = 'ad000000-0000-4000-8000-000000000001';
     update public.artists set image_url = null, image_credit = null, image_license = null
     where id = 'ad000000-0000-4000-8000-000000000002' $$,
  'R23 a 300-character credit without a source and an image-less artist are accepted (control)'
);
select pg_temp.become('superuser');
select ok(
  (select public and file_size_limit = 2097152 and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
   from storage.buckets where id = 'artwork'),
  'R24 artwork bucket is public, 2 MiB, JPEG/PNG/WebP'
);
select is(
  (select array_agg(policyname::text order by policyname) from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'artwork%'),
  array['artwork_no_client_delete', 'artwork_no_client_insert', 'artwork_no_client_update', 'artwork_select_public'],
  'R25 exactly the 013 artwork policies exist'
);

-- ===========================================================================
-- S. Festival suggestions (012): locked table, suggest_festival RPC
-- ===========================================================================
select pg_temp.become('carol');
select lives_ok(
  $$ select public.suggest_festival('Countdown NYE', 'https://countdownnye.com', 'please') $$,
  'S1 a user can suggest a festival'
);
select is(
  public.suggest_festival('Countdown NYE', 'https://countdownnye.com', 'please'),
  public.suggest_festival('  countdown nye  '),
  'S2 suggesting the same name again (any case or spacing) returns the existing id'
);
select pg_temp.become('service_role');
select is(
  (select count(*)::int from public.festival_suggestions where user_id = 'b0000000-0000-4000-8000-000000000003'),
  1,
  'S3 a repeated suggestion inserts no second row'
);
select is(
  (select name || '|' || url || '|' || note || '|' || status from public.festival_suggestions
    where user_id = 'b0000000-0000-4000-8000-000000000003'),
  'Countdown NYE|https://countdownnye.com|please|new',
  'S4 the service role (admin-tools) reads suggestions; they are stored trimmed with status new'
);

select pg_temp.become('anon');
select throws_ok(
  $$ select public.suggest_festival('Anon Fest') $$,
  '42501', null, 'S5 anon cannot call suggest_festival'
);
select throws_ok(
  $$ select 1 from public.festival_suggestions limit 1 $$,
  '42501', null, 'S6 anon cannot read festival_suggestions'
);
select pg_temp.become('nopro');
select throws_ok(
  $$ select public.suggest_festival('No Profile Fest') $$,
  'P0001', 'profile_required', 'S7 an auth user without a profile cannot suggest'
);

select pg_temp.become('carol');
select throws_ok(
  $$ select 1 from public.festival_suggestions limit 1 $$,
  '42501', null, 'S8 authenticated cannot read festival_suggestions directly'
);
select throws_ok(
  $$ insert into public.festival_suggestions (user_id, name) values ('b0000000-0000-4000-8000-000000000003', 'Direct') $$,
  '42501', null, 'S9 authenticated cannot insert festival_suggestions directly'
);
select throws_ok(
  $$ update public.festival_suggestions set status = 'accepted' $$,
  '42501', null, 'S10 authenticated cannot update festival_suggestions directly'
);
select throws_ok(
  $$ select public.suggest_festival('Bad URL Fest', 'http://example.com') $$,
  'P0001', 'invalid_input', 'S11 a non-https url is rejected'
);
select throws_ok(
  $$ select public.suggest_festival('Long URL Fest', 'https://example.com/' || repeat('x', 500)) $$,
  'P0001', 'invalid_input', 'S12 a url over 500 characters is rejected'
);
select throws_ok(
  $$ select public.suggest_festival('   ') $$,
  'P0001', 'invalid_input', 'S13 a blank name is rejected'
);
select throws_ok(
  $$ select public.suggest_festival(repeat('x', 121)) $$,
  'P0001', 'invalid_input', 'S14 a name over 120 characters is rejected'
);
select throws_ok(
  $$ select public.suggest_festival('Long Note Fest', null, repeat('x', 301)) $$,
  'P0001', 'invalid_input', 'S15 a note over 300 characters is rejected'
);
select throws_ok(
  $$ select public.suggest_festival('Nazi Fest') $$,
  'P0001', 'content_not_allowed', 'S16 a disallowed word in the name is refused'
);
select throws_ok(
  $$ select public.suggest_festival('Nice Fest', null, 'fuck this') $$,
  'P0001', 'content_not_allowed', 'S17 a disallowed word in the note is refused'
);
-- Rate limit: 5 new suggestions per user per day. Countdown NYE was the first;
-- the repeated call and the refused calls above did not count.
select lives_ok(
  $$ select public.suggest_festival('Fest ' || n) from generate_series(2, 5) n $$,
  'S18 four more distinct suggestions are accepted (five in a day)'
);
select throws_ok(
  $$ select public.suggest_festival('Fest 6') $$,
  'P0001', 'rate_limited', 'S19 the 6th new suggestion in a day is rate limited'
);
select lives_ok(
  $$ select public.suggest_festival('Countdown NYE') $$,
  'S20 a repeated name still returns its id while rate limited'
);
select pg_temp.become('alice');
select lives_ok(
  $$ select public.suggest_festival('Countdown NYE') $$,
  'S21 another user can suggest the same festival (the limit is per user)'
);

select pg_temp.become('service_role');
select is(
  array(select name from public.festival_suggestions
        where user_id = 'b0000000-0000-4000-8000-000000000003' order by name),
  array['Countdown NYE', 'Fest 2', 'Fest 3', 'Fest 4', 'Fest 5'],
  'S22 exactly five suggestions were stored for the rate-limited user'
);
select is(
  (select count(*)::int from public.festival_suggestions where lower(name) = 'countdown nye'),
  2,
  'S23 the same festival is stored once per user'
);
select throws_ok(
  $$ update public.festival_suggestions set status = 'maybe' where name = 'Fest 2' $$,
  '23514', null, 'S24 an unknown suggestion status is rejected'
);
select lives_ok(
  $$ update public.festival_suggestions set status = 'duplicate' where name = 'Fest 2' $$,
  'S25 admin-tools can set a suggestion status (control)'
);

-- ===========================================================================
-- T. Festival lineup: announced acts with or without a set (014)
-- ===========================================================================
-- festival:seed (service role) writes the lineup; the fixture (top of this file) uses the superuser.
-- Artist Three is announced for Published One but has no set yet ("set times to be announced").
select pg_temp.become('superuser');
-- Scenario main also carries the dirty fixture's backfilled Legacy Fest row: count only this fixture.
select is(
  (select count(*)::int from public.festival_artists where festival_id::text like 'f0000000-%'),
  5,
  'T1 the lineup fixture is in place (control)'
);

select pg_temp.become('anon');
select is(
  array(select right(festival_id::text, 1) || ':' || right(artist_id::text, 1) || ':' || coalesce(billing_order::text, '-')
        from public.festival_artists order by festival_id, artist_id),
  array['1:1:1', '1:2:2', '1:3:-', '2:1:-'],
  'T2 anon reads the lineup of published festivals, including an act without a set, but not of a draft'
);
select throws_ok(
  $$ insert into public.festival_artists (festival_id, artist_id)
     values ('f0000000-0000-4000-8000-000000000002', 'ad000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'T3 anon cannot add an act to a lineup'
);

select pg_temp.become('carol');
select is(
  (select count(*)::int from public.festival_artists where festival_id::text like 'f0000000-%'),
  4,
  'T4 a signed-in user reads the same four published lineup rows'
);
select is(
  (select count(*)::int from public.festival_artists where festival_id = 'f0000000-0000-4000-8000-000000000003'),
  0,
  'T5 a signed-in user sees no lineup row of a draft festival'
);
select throws_ok(
  $$ insert into public.festival_artists (festival_id, artist_id)
     values ('f0000000-0000-4000-8000-000000000002', 'ad000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'T6 a signed-in user cannot add an act to a lineup'
);
select throws_ok(
  $$ update public.festival_artists set billing_order = 9
     where festival_id = 'f0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'T7 a signed-in user cannot change billing'
);
select throws_ok(
  $$ delete from public.festival_artists where festival_id = 'f0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'T8 a signed-in user cannot remove an act from a lineup'
);

select pg_temp.become('service_role');
select lives_ok(
  $$ insert into public.festival_artists (festival_id, artist_id, billing_order)
     values ('f0000000-0000-4000-8000-000000000002', 'ad000000-0000-4000-8000-000000000003', 10000);
     update public.festival_artists set billing_order = null
     where festival_id = 'f0000000-0000-4000-8000-000000000002' and artist_id = 'ad000000-0000-4000-8000-000000000003';
     delete from public.festival_artists
     where festival_id = 'f0000000-0000-4000-8000-000000000002' and artist_id = 'ad000000-0000-4000-8000-000000000003' $$,
  'T9 the service role (festival:seed) adds, re-bills and removes acts (control)'
);
select throws_ok(
  $$ insert into public.festival_artists (festival_id, artist_id)
     values ('f0000000-0000-4000-8000-000000000001', 'ad000000-0000-4000-8000-000000000001') $$,
  '23505', null, 'T10 an act is listed once per festival'
);
select throws_ok(
  $$ insert into public.festival_artists (festival_id, artist_id, billing_order)
     values ('f0000000-0000-4000-8000-000000000002', 'ad000000-0000-4000-8000-000000000003', 0) $$,
  '23514', null, 'T11 billing starts at 1'
);
select throws_ok(
  $$ insert into public.festival_artists (festival_id, artist_id, billing_order)
     values ('f0000000-0000-4000-8000-000000000002', 'ad000000-0000-4000-8000-000000000003', 10001) $$,
  '23514', null, 'T12 billing is capped at 10000'
);
select throws_ok(
  $$ insert into public.festival_artists (festival_id, artist_id)
     values ('f0000000-0000-4000-8000-000000000002', 'ad000000-0000-4000-8000-0000000000ee') $$,
  '23503', null, 'T13 a lineup row needs an existing artist'
);
select throws_ok(
  $$ delete from public.artists where id = 'ad000000-0000-4000-8000-000000000003' $$,
  '23503', null, 'T14 an artist that is in a lineup cannot be deleted (like one with a set)'
);

select pg_temp.become('superuser');
insert into public.festivals (id, name, start_date, end_date, timezone, status)
values ('f0000000-0000-4000-8000-0000000000ee', 'Throwaway', '2027-10-01', '2027-10-02', 'UTC', 'draft');
insert into public.festival_artists (festival_id, artist_id)
values ('f0000000-0000-4000-8000-0000000000ee', 'ad000000-0000-4000-8000-000000000003');
delete from public.festivals where id = 'f0000000-0000-4000-8000-0000000000ee';
select is(
  (select count(*)::int from public.festival_artists where festival_id = 'f0000000-0000-4000-8000-0000000000ee'),
  0,
  'T15 deleting a festival deletes its lineup rows'
);
select is(
  (select count(*)::int from public.artists where id = 'ad000000-0000-4000-8000-000000000003'),
  1,
  'T16 the artist survives the festival (artists are global)'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'festival_artists_artist_id_idx'),
  'T17 the artist foreign key is indexed'
);
select is(
  (select array_agg(policyname::text order by policyname) from pg_policies
    where schemaname = 'public' and tablename = 'festival_artists'),
  array['festival_artists_select_published'],
  'T18 exactly the 014 lineup policy exists on festival_artists'
);
-- The lineup never lags the schedule: a set needs its artist in the festival's lineup, and an act with
-- a set cannot be dropped from the lineup (festival:seed deletes stale sets first).
select pg_temp.become('service_role');
select throws_ok(
  $$ insert into public.sets (id, festival_id, artist_id, stage_id, start_time, end_time)
     values ('e5000000-0000-4000-8000-0000000000ee', 'f0000000-0000-4000-8000-000000000002',
             'ad000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000003',
             '2027-07-01T22:00:00Z', '2027-07-01T23:00:00Z') $$,
  '23503', null, 'T19 a set whose artist is not in the festival''s lineup is refused'
);
select throws_ok(
  $$ delete from public.festival_artists
     where festival_id = 'f0000000-0000-4000-8000-000000000001' and artist_id = 'ad000000-0000-4000-8000-000000000001' $$,
  '23503', null, 'T20 an act that still has a set cannot be dropped from the lineup'
);
select lives_ok(
  $$ insert into public.festival_artists (festival_id, artist_id)
     values ('f0000000-0000-4000-8000-000000000002', 'ad000000-0000-4000-8000-000000000003');
     insert into public.sets (id, festival_id, artist_id, stage_id, start_time, end_time)
     values ('e5000000-0000-4000-8000-0000000000ee', 'f0000000-0000-4000-8000-000000000002',
             'ad000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000003',
             '2027-07-01T22:00:00Z', '2027-07-01T23:00:00Z') $$,
  'T21 the same set is accepted once the act is in the lineup (control)'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'sets_festival_id_artist_id_idx'),
  'T22 the composite lineup foreign key on sets is indexed'
);

select * from finish();
rollback;
