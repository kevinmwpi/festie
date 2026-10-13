-- 012_image_credits_and_suggestions.sql
--
-- Artwork credits and festival suggestions (docs/v1-architecture.md §9.8).
--
-- 1. Image credits. The app shows a Photo credits screen, so every artist or
--    festival image must carry its licence:
--      image_url         https:// only (null = no image)
--      image_credit      author / source line, 1-300 characters, optional
--      image_license     licence name or URL; required whenever image_url is set
--      image_source_url  https:// page the image was taken from, optional
--    Written only by admin-tools (service role). Clients read the four columns
--    through the existing table-level select grants from 007 (`grant select on
--    public.festivals, public.stages, public.artists, public.sets to anon,
--    authenticated`) and the artists_select_all / festivals_select_published
--    policies, so this file changes no grant and no policy. A legacy row whose
--    image_url cannot satisfy the new checks (not https, or no licence) loses
--    the image: an image without a licence cannot be shown; re-seed it with a
--    credit through admin-tools.
--
-- 2. Festival suggestions (the in-app "Suggest a festival" form).
--    public.festival_suggestions is a locked table (RLS on, no policies, no
--    grants to anon/authenticated; the service role bypasses RLS, so
--    admin-tools reads it). Clients write only through
--    public.suggest_festival(p_name, p_url, p_note) returns uuid:
--      not_authenticated / profile_required  (private.require_profile)
--      invalid_input        name not 1-120 characters after trimming; url not
--                           https or over 500 characters; note over 300
--      content_not_allowed  name or note hits private.contains_disallowed_text
--      rate_limited         6th new suggestion by one user within 24 h
--    The same user repeating a name (case- and whitespace-insensitive) gets the
--    existing row's id: no second row, no rate-limit charge.
--
-- Re-running 007 alone revokes execute on every public function, so 012 must
-- be applied again after it (scripts/db-test.sh re-applies 007-013 in order).
-- Idempotent.

set local lock_timeout = '5s';

-- ===========================================================================
-- 1. Image credits on artists and festivals
-- ===========================================================================
alter table public.artists
  add column if not exists image_credit text,
  add column if not exists image_license text,
  add column if not exists image_source_url text;

alter table public.festivals
  add column if not exists image_credit text,
  add column if not exists image_license text,
  add column if not exists image_source_url text;

-- Repair legacy rows the checks below would reject (see header). A no-op on
-- re-runs: rows written by admin-tools already satisfy the checks.
update public.artists
set image_license = null
where image_license is not null and char_length(image_license) not between 1 and 80;

update public.artists
set image_url = null
where image_url is not null and (image_url !~ '^https://' or image_license is null);

update public.festivals
set image_license = null
where image_license is not null and char_length(image_license) not between 1 and 80;

update public.festivals
set image_url = null
where image_url is not null and (image_url !~ '^https://' or image_license is null);

alter table public.artists
  drop constraint if exists artists_image_url_check,
  add constraint artists_image_url_check
    check (image_url is null or image_url ~ '^https://'),
  drop constraint if exists artists_image_license_check,
  add constraint artists_image_license_check
    check (
      (image_url is null or image_license is not null)
      and (image_license is null or char_length(image_license) between 1 and 80)
    ),
  drop constraint if exists artists_image_credit_check,
  add constraint artists_image_credit_check
    check (image_credit is null or char_length(image_credit) between 1 and 300),
  drop constraint if exists artists_image_source_url_check,
  add constraint artists_image_source_url_check
    check (image_source_url is null or image_source_url ~ '^https://');

alter table public.festivals
  drop constraint if exists festivals_image_url_check,
  add constraint festivals_image_url_check
    check (image_url is null or image_url ~ '^https://'),
  drop constraint if exists festivals_image_license_check,
  add constraint festivals_image_license_check
    check (
      (image_url is null or image_license is not null)
      and (image_license is null or char_length(image_license) between 1 and 80)
    ),
  drop constraint if exists festivals_image_credit_check,
  add constraint festivals_image_credit_check
    check (image_credit is null or char_length(image_credit) between 1 and 300),
  drop constraint if exists festivals_image_source_url_check,
  add constraint festivals_image_source_url_check
    check (image_source_url is null or image_source_url ~ '^https://');

-- ===========================================================================
-- 2. Festival suggestions
-- ===========================================================================
create table if not exists public.festival_suggestions (
  id uuid primary key default extensions.uuid_generate_v4(),
  user_id uuid references public.users(id) on delete set null,
  name text not null,
  url text,
  note text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

alter table public.festival_suggestions
  drop constraint if exists festival_suggestions_name_check,
  add constraint festival_suggestions_name_check
    check (char_length(btrim(name)) between 1 and 120),
  drop constraint if exists festival_suggestions_url_check,
  add constraint festival_suggestions_url_check
    check (url is null or (url ~ '^https://' and char_length(url) <= 500)),
  drop constraint if exists festival_suggestions_note_check,
  add constraint festival_suggestions_note_check
    check (note is null or char_length(note) <= 300),
  drop constraint if exists festival_suggestions_status_check,
  add constraint festival_suggestions_status_check
    check (status in ('new', 'accepted', 'rejected', 'duplicate'));

create index if not exists festival_suggestions_status_created_idx
  on public.festival_suggestions (status, created_at);

-- One row per user and festival name; suggest_festival returns the existing
-- row instead of inserting a second one.
create unique index if not exists festival_suggestions_user_name_key
  on public.festival_suggestions (user_id, lower(btrim(name)))
  where user_id is not null;

-- Locked table: RLS on, no policies. 007's default privileges already leave
-- anon/authenticated without grants on new tables; the explicit revoke also
-- undoes a dashboard-made grant. The service role (admin-tools) bypasses RLS.
alter table public.festival_suggestions enable row level security;
revoke all on public.festival_suggestions from public, anon, authenticated;
grant select, insert, update, delete on public.festival_suggestions to service_role;

create or replace function public.suggest_festival(
  p_name text,
  p_url text default null,
  p_note text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.require_profile();
  v_name text := btrim(coalesce(p_name, ''));
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if char_length(v_name) not between 1 and 120
     or (v_url is not null and (v_url !~ '^https://' or char_length(v_url) > 500))
     or char_length(coalesce(v_note, '')) > 300 then
    raise exception using errcode = 'P0001', message = 'invalid_input';
  end if;

  if private.contains_disallowed_text(v_name) or private.contains_disallowed_text(v_note) then
    raise exception using errcode = 'P0001', message = 'content_not_allowed';
  end if;

  -- The same user suggesting the same festival again gets the existing row:
  -- no second row and no rate-limit charge.
  select s.id into v_id
  from public.festival_suggestions s
  where s.user_id = v_me and lower(btrim(s.name)) = lower(v_name);
  if found then
    return v_id;
  end if;

  if not private.check_rate_limit('user:' || v_me::text, 'suggest_festival', 5, interval '1 day') then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;

  insert into public.festival_suggestions (user_id, name, url, note)
  values (v_me, v_name, v_url, v_note)
  on conflict (user_id, lower(btrim(name))) where user_id is not null do nothing
  returning id into v_id;

  if v_id is null then
    select s.id into v_id
    from public.festival_suggestions s
    where s.user_id = v_me and lower(btrim(s.name)) = lower(v_name);
  end if;

  return v_id;
end
$$;

-- 007 revokes execute from every client role by default; client RPCs are
-- whitelisted one by one (rls.sql A7/A8).
revoke execute on function public.suggest_festival(text, text, text) from public, anon;
grant execute on function public.suggest_festival(text, text, text) to authenticated;
