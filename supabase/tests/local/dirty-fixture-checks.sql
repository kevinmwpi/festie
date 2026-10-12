-- Verifies that 007–013 repaired supabase/tests/local/dirty-fixture.sql.
-- Run after the first apply and again after re-applying 007–013.
begin;
select plan(44);

-- Users: dedupe, backfill, orphans ------------------------------------------
select is(
  (select auth_user_id from public.users where id = 'd2000000-0000-4000-8000-000000000002'),
  'd1000000-0000-4000-8000-000000000001'::uuid,
  'case-duplicate emails: exact email match keeps the auth identity'
);
select is(
  (select count(*)::int from public.users where id = 'd2000000-0000-4000-8000-000000000001'),
  0,
  'case-duplicate emails: the non-exact duplicate is deleted'
);
select is(
  (select auth_user_id from public.users where id = 'd2000000-0000-4000-8000-000000000003'),
  'd1000000-0000-4000-8000-000000000002'::uuid,
  'no exact match: the oldest profile keeps the auth identity'
);
select is(
  (select count(*)::int from public.users where id = 'd2000000-0000-4000-8000-000000000004'),
  0,
  'no exact match: newer duplicate is deleted'
);
select is(
  (select count(*)::int from public.users where id = 'd2000000-0000-4000-8000-000000000008'),
  0,
  'profile without an auth identity is deleted'
);
select is(
  (select count(*)::int from public.users where auth_user_id is null),
  0,
  'every profile is linked to auth.users'
);
select is(
  (select attnotnull from pg_attribute where attrelid = 'public.users'::regclass and attname = 'auth_user_id'),
  true,
  'users.auth_user_id is NOT NULL'
);
select isnt_empty(
  $$ select 1 from pg_indexes where schemaname = 'public' and tablename = 'users'
       and indexdef ilike '%unique%lower(email)%' $$,
  'unique index on lower(email) exists'
);
select is(
  (select confdeltype from pg_constraint where conname = 'users_auth_user_id_fkey'),
  'c'::"char",
  'users.auth_user_id cascades from auth.users'
);

-- Normalization ---------------------------------------------------------------
select is(
  (select display_name::text from public.users where id = 'd2000000-0000-4000-8000-000000000005'),
  'Clean',
  'display names are trimmed'
);
select is(
  (select avatar_type::text from public.users where id = 'd2000000-0000-4000-8000-000000000005'),
  'initials',
  'unknown avatar_type becomes initials'
);
select is(
  (select char_length(display_name)::int from public.users where id = 'd2000000-0000-4000-8000-000000000006'),
  40,
  'long display names are truncated to 40'
);
select is(
  (select display_name::text from public.users where id = 'd2000000-0000-4000-8000-000000000007'),
  'Festie user',
  'blank display names get the default'
);
select is(
  (select char_length(name)::int from public.groups where id = 'd4000000-0000-4000-8000-000000000001'),
  60,
  '81-char group name truncated to 60'
);
select is(
  (select name::text from public.groups where id = 'd4000000-0000-4000-8000-000000000002'),
  'My crew',
  'blank group name gets the default'
);
select is(
  (select char_length(title)::int from public.meetups where id = 'd6000000-0000-4000-8000-000000000001'),
  80,
  'meetup title truncated to 80'
);
select is(
  (select notes::text from public.meetups where id = 'd6000000-0000-4000-8000-000000000001'),
  null::text,
  'blank meetup notes become null'
);
select is(
  (select count(*)::int from public.meetups where id = 'd6000000-0000-4000-8000-000000000002'),
  0,
  'meetups of deleted orphan profiles are removed'
);
select is(
  (select festival_id from public.user_set_selections where id = 'd7000000-0000-4000-8000-000000000001'),
  'd3000000-0000-4000-8000-000000000001'::uuid,
  'selection festival_id is corrected to the set''s festival'
);

-- Groups: roles, admin repair, empty groups, invite codes ---------------------
select is(
  (select role from public.group_members where id = 'd5000000-0000-4000-8000-000000000002'),
  'admin',
  'unknown role normalized, then earliest member promoted when the admin was deleted'
);
select is(
  (select role from public.group_members where id = 'd5000000-0000-4000-8000-000000000003'),
  'member',
  'later members are not promoted'
);
select is(
  (select role from public.group_members where id = 'd5000000-0000-4000-8000-000000000005'),
  'admin',
  'earliest remaining member promoted in a group whose only admin was an orphan'
);
select is(
  (select count(*)::int from public.groups where id = 'd4000000-0000-4000-8000-000000000003'),
  0,
  'groups left without members are deleted'
);
select is(
  (select created_by_user_id from public.groups where id = 'd4000000-0000-4000-8000-000000000001'),
  null::uuid,
  'groups created by a deleted profile keep existing with created_by_user_id null'
);
select ok(
  (select invite_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$' from public.groups
    where id = 'd4000000-0000-4000-8000-000000000001'),
  'legacy pending- invite code regenerated'
);
select ok(
  (select invite_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$' from public.groups
    where id = 'd4000000-0000-4000-8000-000000000002'),
  'lowercase legacy invite code regenerated'
);
select is(
  (select invite_code from public.groups where id = 'd4000000-0000-4000-8000-000000000004'),
  'VALUE2',
  'valid invite codes are kept'
);
select is(
  (select count(*)::int from public.groups where invite_code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
  0,
  'every invite code matches the format'
);

-- Location shares -------------------------------------------------------------
select is(
  (select count(*)::int from public.location_shares where group_id = 'd4000000-0000-4000-8000-000000000004'),
  0,
  'legacy location rows (including duplicates) are cleared'
);
select isnt_empty(
  $$ select 1 from pg_constraint where conname = 'location_shares_user_group_key' and contype = 'u' $$,
  'location_shares has unique (user_id, group_id)'
);

-- Festivals ---------------------------------------------------------------------
select is(
  (select status from public.festivals where id = 'd3000000-0000-4000-8000-000000000001'),
  'draft',
  'legacy non-demo festivals are drafts until re-entered with a source_url'
);
select is(
  (select status || ':' || coalesce(original_start_time::text, '-') || ':' || coalesce(change_note, '-')
   from public.sets where id = 'd3300000-0000-4000-8000-000000000001'),
  'scheduled:-:-',
  'legacy sets read as scheduled with no original start or note (011)'
);
select is(
  (select coalesce(image_credit, '-') || ':' || coalesce(image_license, '-') || ':' || coalesce(image_source_url, '-')
   from public.artists where id = 'd3200000-0000-4000-8000-000000000001'),
  '-:-:-',
  'legacy artists read with no image credit, licence or source (012)'
);

-- Policies and privileges --------------------------------------------------------
select is_empty(
  $$ select policyname from pg_policies
     where schemaname = 'public'
       and policyname in ('Enable read access for all users', 'Enable update for users based on email', 'Anyone can see groups') $$,
  'dashboard policies on public tables are dropped'
);
select is_empty(
  $$ select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname in ('Public Access', 'Allow uploads 1abc_0', 'totems_public_read', 'totems_insert_group_member') $$,
  'legacy and dashboard totems storage policies are dropped'
);
select isnt_empty(
  $$ select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'Avatar images are publicly accessible' $$,
  'storage policies for other buckets are left alone'
);
select is(
  (select array_agg(policyname::text order by policyname) from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'totems%'),
  array['totems_delete_owner_or_admin', 'totems_guard', 'totems_insert_meetup_creator', 'totems_select_member'],
  'exactly the 008 totems policies exist'
);
select is(
  (select public from storage.buckets where id = 'totems'),
  false,
  'totems bucket is private'
);
select ok(
  not has_table_privilege('anon', 'public.users', 'select'),
  'dashboard grant of users to anon is revoked'
);
select ok(
  not has_table_privilege('authenticated', 'public.chat_messages', 'select'),
  'dashboard grant of chat_messages to authenticated is revoked'
);
select is(
  (select count(*)::int from public.moderation_terms where term in ('fuck', 'nigger', 'faggot', 'retard')),
  4,
  'moderation terms are seeded'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'current_app_user_id'),
  0,
  'legacy public.current_app_user_id() is dropped'
);

select is(
  (select count(*)::int from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgname = 'on_auth_user_created' and position('insert' in lower(p.prosrc)) > 0),
  0,
  'legacy on_auth_user_created no longer inserts profiles (dropped or a no-op)'
);
insert into auth.users (id, email, created_at)
values ('d1000000-0000-4000-8000-0000000000ff', 'newcomer@example.com', now());
select is(
  (select count(*)::int from public.users where lower(email) = 'newcomer@example.com'),
  0,
  'a new auth user gets no auto-created profile (profiles come only from upsert_my_profile)'
);

select * from finish();
rollback;
