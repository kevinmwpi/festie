# Festie v1 — Architecture Contract (rev 2.2)

Status: **authoritative contract for the v1 App Store overhaul** (Oct 2026). Rev 2 folds in an
adversarial security review and an App Store / mobile review of rev 1. Rev 2.1 records decisions made
during implementation (§5.1 sign-out semantics, terms gate, captive-portal handling). Rev 2.2 records the
fixes from the final adversarial review; **§9 lists them and supersedes any earlier text it conflicts with.**
Every implementer works from this document. If code and this document disagree, fix the code or
amend this document explicitly — never silently diverge.

Goals, in priority order:

1. **Secure** — no user can read or change data they should not; proven by automated tests that would fail if a rule were missing.
2. **Passes App Review** — in-app account deletion, UGC filter/report/block/eject, a reviewer login that survives the reviewer deleting the account, accurate privacy disclosures, no dead UI.
3. **Works at a festival** — launches into cached schedule/groups with no signal and an expired token; times are right in the festival's timezone; location sharing is truthful.
4. **Design** — build on the merged `match_aistudio` design language (pastel palette, 40px card radii, Georgia-italic headings, the "Festie" wordmark in the bundled rounded font Fredoka Bold, uppercase micro-labels, per-festival accent via `deriveAccentColors`). New screens must look native to it. Change existing visuals only for function, accessibility or consistency.

Non-goals for v1: chat (removed), background location, social login, universal links (custom scheme + typed code + App Store link), server push notifications.

Global conventions:

- **One error convention.** Every app-level database error is `raise exception using errcode = 'P0001', message = '<code>'`, including triggers and rate limits. Codes: `not_authenticated, profile_required, not_group_member, not_group_admin, group_full, rate_limited, content_not_allowed, invalid_input, festival_not_found, meetup_not_found, meetup_limit_reached, cannot_remove_self`. (`invite_not_found` is not raised — see `join_group`.) PostgREST returns HTTP 400 for P0001; clients classify by `error.code === 'P0001'` + `error.message`.
- **An RPC that must persist something on a failure path returns the failure as a value and never raises** (a raise rolls back the whole RPC transaction).
- Never `select('*')` or embed `users(*)` against `public.users`.

---

## 1. Identity model

- `auth.users` is the identity; `public.users` is the profile.
- `public.users.auth_user_id uuid not null unique references auth.users(id) on delete cascade` (backfilled in 007, §2.1 step 3).
- `public.users.email` kept for support only: never readable by `anon`/`authenticated` (column grants, §2.4), never client-writable. Unique index on `lower(email)`.
- `private.current_app_user_id()` → `select id from public.users where auth_user_id = auth.uid()`.
- No RLS policy may query a table whose own policy calls back into the querying table; all cross-table checks go through `private` security-definer helpers.

## 2. Database

### 2.1 Migration files and order

- `001`–`005_rate_limiting.sql`: unchanged byte-for-byte (already applied on hosted).
- `005_user_festivals_and_festival_theme.sql` → renamed `006_user_festivals_and_festival_theme.sql`, made idempotent (`create table if not exists`, `add column if not exists`, `drop policy if exists` before each `create policy`). Uses `extensions.uuid_generate_v4()`.
- `007_v1_security_overhaul.sql` — core schema/RLS/RPCs. **Idempotent** and safe on (a) a fresh DB after 001–006 and (b) a hosted DB with arbitrary dashboard edits and only one of the two old `005` files applied. Statement order:
  0. `set local lock_timeout = '5s';` `create schema if not exists private; revoke all on schema private from public; grant usage on schema private to anon, authenticated, service_role;` (`private` is never added to the API schemas.)
  1. Create-if-missing or `to_regclass`-guard every legacy table referenced (`auth_attempts`, `group_invite_generations`, `user_festivals`).
  2. Drop **every** existing policy on every `public` table this migration manages (loop over `pg_policies where schemaname = 'public'`).
  3. Foreign keys: for `groups.created_by_user_id`, `meetups.created_by_user_id`, `chat_messages.sender_user_id`, find the existing FK via `pg_constraint`, drop it, re-add with an explicit name (`on delete set null` for groups — after `alter column ... drop not null` — and `on delete cascade` for the other two).
  4. Users: add `auth_user_id` if missing. Dedupe by `lower(email)`: keep the row whose email equals `auth.users.email` exactly, else the oldest; others become orphans. Backfill `auth_user_id`; delete orphans; repair groups (promote earliest-joined member where no admin remains; delete groups with no members). Then `set not null`, unique index on `lower(email)`.
  5. Normalize legacy data: `display_name = coalesce(nullif(left(btrim(display_name), 40), ''), 'Festie user')`; same pattern for `groups.name` (60, 'My crew'), `meetups.title` (80, 'Meetup'), `meetups.notes` (500, null if blank); unknown `avatar_type` → `'initials'`; unknown `role` → `'member'`.
  6. Regenerate invite codes not matching `^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$` (covers legacy `pending-xxxxxx`), then add that check.
  7. `delete from public.location_shares;` (ephemeral) then add `unique (user_id, group_id)`.
  8. New tables/columns (§2.3); constraints as `drop constraint if exists X; add constraint X ...`.
  9. Festivals: add columns; `update public.festivals set status = 'draft' where is_demo = false;` (nothing real is published until entered through admin-tools with a `source_url`).
  10. Privileges (§2.4), functions (`create or replace` only; `drop function` only for removed legacy functions, after step 2), policies (§2.5).
  11. pg_cron block (§2.7).
  12. Triggers last (§2.3).
- `008_storage_totems.sql` — all `storage.*` statements, isolated so a hosted permission quirk cannot roll back 007 (§2.8).
- `009_seed_moderation_terms.sql` — data only (`insert ... on conflict do nothing`).
- `010_foreign_key_indexes.sql` — indexes on foreign keys (`create index if not exists`).
- `011_set_status.sql` — schedule changes on `sets` (§9.7). Idempotent.
- `012_image_credits_and_suggestions.sql` — image credit columns and checks on `artists`/`festivals`, the locked `festival_suggestions` table and `public.suggest_festival` (§9.8). Idempotent; must be re-applied after any re-run of 007 (which revokes execute on every `public` function).
- `013_storage_artwork.sql` — all `storage.*` statements for the public `artwork` bucket, isolated like 008 (§9.8).
- `014_festival_lineup.sql` — `public.festival_artists`, the announced lineup of a festival with or without sets, and `sets_lineup_fkey` (§9.9). Idempotent; must be re-applied after any re-run of 007 (which revokes the table grants of anon/authenticated and drops every `public` policy, so the lineup's grant and policy both go).
- CI grep fails on `alter table storage.`, `create (or replace )?function storage.`, `delete from storage.` in migrations.

### 2.2 Helper functions — schema `private`

All: `security definer`, `stable` (except `try_uuid`: `immutable`, not definer), `set search_path = ''`, fully qualified names. Execute granted to `anon, authenticated` (needed for policy evaluation; harmless because `private` is not exposed over the API).

| Function | Returns | Semantics |
|---|---|---|
| `current_app_user_id()` | uuid | profile id of `auth.uid()` or null |
| `is_group_member(p_group_id uuid)` | boolean | caller is a member |
| `is_group_admin(p_group_id uuid)` | boolean | caller is a member with role `admin` |
| `shares_group_with(p_user_id uuid)` | boolean | caller and user share ≥ 1 group |
| `shares_festival_group_with(p_user_id uuid, p_festival_id uuid)` | boolean | caller and user share a group whose `festival_id = p_festival_id` |
| `is_blocked_with(p_other uuid)` | boolean | caller blocked p_other or p_other blocked caller |
| `can_upload_totem(p_group_id uuid, p_meetup_id uuid)` | boolean | meetup exists with that id and group, created by caller, caller is member |
| `try_uuid(p text)` | uuid | null instead of raising on malformed input |
| `contains_disallowed_text(p text)` | boolean | case-insensitive whole-word match against `public.moderation_terms` |
| `check_rate_limit(p_key text, p_action text, p_max int, p_window interval)` | boolean | `pg_advisory_xact_lock(hashtextextended(key||'|'||action,0))`; count events in window; if ≥ max return false; else insert event, return true. **Execute: service_role only** (definer RPCs owned by `postgres` still call it). |

Trigger functions and internal helpers (admin hand-off, invite generator) also live in `private`, no grants beyond what triggers need.

End of 007: `revoke execute on all functions in schema public, private from public, anon, authenticated;` then grant the whitelist; plus `alter default privileges in schema public, private revoke execute on functions from public, anon, authenticated;`. A test compares the exact set of functions executable by `anon` and by `authenticated` against the whitelist.

### 2.3 Tables & constraints

- `users`: `auth_user_id` (§1); check `char_length(btrim(display_name)) between 1 and 40`; `avatar_type in ('initials','emoji','color')`; `avatar_value` ≤ 100.
- `festivals`: add `status text not null default 'draft' check (status in ('draft','published'))`, `is_demo boolean not null default false`, `latitude`, `longitude`, `default_zoom double precision default 15`, `bounds_sw_lat`, `bounds_sw_lng`, `bounds_ne_lat`, `bounds_ne_lng` (double precision, nullable), `source_url text`, `updated_at timestamptz default now()`. Keep `accent_color`, `image_url`, `map_asset_url`, `version`.
- `stages`: add `latitude`, `longitude` (double precision). `map_x/map_y` legacy, unused.
- `groups`: `created_by_user_id` nullable, FK `on delete set null`; `name` 1–60; invite code check (§2.1 step 6); add `invite_code_rotated_at timestamptz`.
- `group_members`: `role in ('admin','member')`. `after delete` trigger (private, definer): delete that user's `location_shares` row for that group.
- `meetups`: FK creator `on delete cascade`; add `latitude`, `longitude`, `totem_path text`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`; check `totem_path is null or totem_path like group_id::text || '/' || id::text || '/%'`; title 1–80; notes ≤ 500. `totem_image_url`, `custom_map_x/y` legacy, unused.
- `user_set_selections`: trigger (or composite FK on `sets(id, festival_id)`) enforcing `festival_id = sets.festival_id`.
- `location_shares`: `unique (user_id, group_id)`; lat ∈ [-90,90], lng ∈ [-180,180], accuracy ≥ 0 or null, heading ∈ [0,360) or null.
- `chat_messages`, `group_invite_generations`, `auth_attempts`: locked (RLS on, no policies, no grants to anon/authenticated).
- New `user_blocks(blocker_id uuid references users on delete cascade, blocked_id uuid references users on delete cascade, created_at timestamptz default now(), primary key (blocker_id, blocked_id), check (blocker_id <> blocked_id))`.
- New `reports(id uuid pk default gen_random_uuid(), reporter_id uuid references users on delete set null, target_type text check in ('user','group','meetup','photo','block'), target_id uuid not null, group_id uuid references groups on delete set null, reason text check in ('spam','harassment','hate','sexual','violence','impersonation','other'), details text check (char_length(details) <= 500), target_snapshot text, status text not null default 'open' check in ('open','reviewed','actioned','dismissed'), created_at timestamptz default now(), unique (reporter_id, target_type, target_id))`. For `photo`, `target_id` = the meetup id. `target_snapshot` = text of the target at report time (name/title/notes/totem_path).
- New `moderation_terms(term text primary key)` — locked.
- New `rate_limit_events(key text not null, action text not null, created_at timestamptz not null default now())`, index `(key, action, created_at)` — locked.
- Triggers (private, created last, **column-scoped** so FK actions and unrelated updates never fire them):
  - `before insert or update of display_name on users`, `... of name on groups`, `... of title, notes on meetups`: when `tg_op = 'INSERT' or new.col is distinct from old.col`, raise `content_not_allowed` if `contains_disallowed_text`.
  - `before update of created_by_user_id, group_id on meetups`: immutable (raise `invalid_input`).
  - `before update on meetups`: maintain `updated_at`.

### 2.4 Privileges

- `revoke all on all tables in schema public from anon, authenticated;` + `alter default privileges in schema public revoke all on tables from anon, authenticated;`. Then:
  - `anon, authenticated`: `select` on `festivals`, `stages`, `artists`, `sets`.
  - `authenticated`:
    - `users`: `select (id, display_name, avatar_type, avatar_value, created_at)` only.
    - `user_festivals`: select, insert, delete.
    - `user_set_selections`: select, insert, update, delete.
    - `groups`: select, `update (name)`, delete.
    - `group_members`: select **only** (leave/remove via RPCs).
    - `meetups`: select, insert, update, delete.
    - `location_shares`: select (writes via RPC).
    - `user_blocks`: select (writes via `block_user`/`unblock_user`).
    - `reports`: **none** (`report_content` is the only path).
- `service_role` keeps Supabase defaults.

### 2.5 RLS policies (enabled on every public table). `me` = `private.current_app_user_id()`

| Table | Policy |
|---|---|
| festivals | select: `status = 'published'` |
| stages, sets | select: `exists (select 1 from public.festivals f where f.id = festival_id and f.status = 'published')` |
| artists | select: true |
| users | select: `id = me or private.shares_group_with(id)` |
| user_festivals | select/insert/delete: `user_id = me` |
| user_set_selections | select: `user_id = me or (private.shares_festival_group_with(user_id, festival_id) and not private.is_blocked_with(user_id))`; insert check / update using+check / delete using: `user_id = me` |
| groups | select: `private.is_group_member(id)`; update/delete: `private.is_group_admin(id)` |
| group_members | select: `private.is_group_member(group_id)` |
| meetups | select: `private.is_group_member(group_id) and not private.is_blocked_with(created_by_user_id)`; insert: `private.is_group_member(group_id) and created_by_user_id = me`; update: using `created_by_user_id = me`, check `created_by_user_id = me and private.is_group_member(group_id)`; delete: `created_by_user_id = me or private.is_group_admin(group_id)` |
| location_shares | select: `private.is_group_member(group_id) and recorded_at > now() - interval '15 minutes' and not private.is_blocked_with(user_id)` |
| user_blocks | select: `blocker_id = me` |
| everything else | no policies (locked) |

### 2.6 Client RPCs — schema `public`

`security definer`, `set search_path = ''`, owner `postgres`, execute granted to `authenticated` only. Any RPC that reads roles or counts for a group first takes `select 1 from public.groups where id = p_group_id for update`.

| RPC | Args | Returns | Rules |
|---|---|---|---|
| `upsert_my_profile` | `p_display_name text, p_avatar_type text, p_avatar_value text` | `table(id uuid, display_name text, avatar_type text, avatar_value text)` | requires `auth.uid()`; insert with `auth_user_id = auth.uid()`, `email = auth.jwt()->>'email'`, or update own row |
| `get_my_profile` | — | same shape, 0–1 rows | |
| `create_group` | `p_name text, p_festival_id uuid` | `table(group_id uuid, name text, festival_id uuid, invite_code text)` | festival must be published (`festival_not_found`); `check_rate_limit('user:'||me,'create_group',10,'1 day')` false → raise `rate_limited`; atomic group + admin membership; code = 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` via `extensions.gen_random_bytes`, retry on collision |
| `join_group` | `p_invite_code text` | `table(group_id uuid, group_name text, festival_id uuid, member_count int)` | if ≥ 10 `join_fail` events for `user:<me>` in the last hour → raise `rate_limited`. Normalize `upper(regexp_replace(code,'[^A-Za-z0-9]','','g'))`; **exact** equality. Unknown → insert a `join_fail` event and **return zero rows** (client maps to "invite not found"). Group locked `for update`; ≥ 50 members → `group_full`; already a member → return the group |
| `rotate_invite_code` | `p_group_id uuid` | text | admin only |
| `leave_group` | `p_group_id uuid` | void | remove own membership (trigger clears location); last admin with members left → promote earliest-joined; no members left → delete group |
| `remove_group_member` | `p_group_id uuid, p_user_id uuid` | void | admin only; self → `cannot_remove_self` |
| `share_location` | `p_group_id uuid, p_lat, p_lng, p_accuracy, p_heading double precision` | void | member only; validate ranges; `insert ... on conflict (user_id, group_id) do update set ..., recorded_at = now() where public.location_shares.recorded_at < now() - interval '5 seconds'`; also delete rows in this group older than 15 min |
| `stop_sharing_location` | `p_group_id uuid` | void | delete own row |
| `get_group_locations` | `p_group_id uuid` | `table(user_id uuid, display_name text, avatar_type text, avatar_value text, lat, lng, accuracy, heading double precision, recorded_at timestamptz)` | member only; purge > 15 min first; exclude caller and blocked-either-way |
| `block_user` / `unblock_user` | `p_user_id uuid` | void | insert/delete `user_blocks` (block requires `shares_group_with` or an existing block; idempotent) |
| `report_content` | `p_target_type text, p_target_id uuid, p_reason text, p_details text default null` | uuid | visibility: user → `shares_group_with`; group → member; meetup/photo → member of the meetup's group; else `invalid_input`; `check_rate_limit('user:'||me,'report',20,'1 day')`; duplicate → return existing id; stores `target_snapshot` |
| `prepare_account_deletion` | `p_auth_user_id uuid` | `table(storage_path text)` | **service_role only**. Locks and hands off admin roles in each group (same rules as `leave_group`), deletes empty groups, returns `select name from storage.objects where bucket_id = 'totems' and owner_id = p_auth_user_id::text union select totem_path from public.meetups where created_by_user_id = <profile> and totem_path is not null` |
| `prepare_demo_account` | `p_auth_user_id uuid` | void | **service_role only**. Ensures the demo profile exists, re-joins the seeded "Festie Demo Crew" group, refreshes `recorded_at = now()` on the seeded fake members' location rows |
| `purge_stale_locations` | — | int | **service_role only**; deletes `location_shares` older than 15 minutes |
| `purge_rate_limit_events` | — | int | **service_role only**; deletes `rate_limit_events`/`auth_attempts` older than 24 h |

### 2.7 Scheduled jobs (in 007)

```sql
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname in ('purge-stale-locations','purge-rate-limit-events','refresh-demo-crew');
  perform cron.schedule('purge-stale-locations', '*/5 * * * *', 'select public.purge_stale_locations()');
  perform cron.schedule('purge-rate-limit-events', '17 * * * *', 'select public.purge_rate_limit_events()');
  perform cron.schedule('refresh-demo-crew', '*/5 * * * *', 'select private.refresh_demo_crew()');
exception when others then raise notice 'pg_cron unavailable: %', sqlerrm;
end $$;
```
Retention never depends on cron alone (the location RPCs purge too). Platform configuration outside the migrations (runbook §2.8): database auth audit logging is turned off and an operator-scheduled `purge-auth-audit-log` job deletes `auth.audit_log_entries` older than 90 days.

### 2.8 Storage — `008_storage_totems.sql`

- Bucket `totems`: `public = false`, `file_size_limit = 5242880`, `allowed_mime_types = '{image/jpeg}'` (client always re-encodes to JPEG, so EXIF stripping always applies). Insert-or-update the row.
- Path `<group_id>/<meetup_id>/<uuid>.jpg`; uploads use `upsert: false`.
- Drop the known 004 policy names and any `storage.objects` policy whose qual/with_check mentions `totems`.
- Restrictive guard: `create policy totems_guard on storage.objects as restrictive for all to public using (bucket_id <> 'totems' or private.is_group_member(private.try_uuid((storage.foldername(name))[1]))) with check (bucket_id <> 'totems' or private.can_upload_totem(private.try_uuid((storage.foldername(name))[1]), private.try_uuid((storage.foldername(name))[2])));`
- Permissive, `to authenticated`: select (member of folder[1]); insert (`can_upload_totem`); delete (`owner_id = (select auth.uid())::text or private.is_group_admin(folder[1])`). No update policy.
- Clients read via `createSignedUrl(path, 3600)` only.

### 2.9 Generated types

`packages/data-access/src/database.types.ts` hand-updated to match the final schema exactly (tables, columns, `public` RPCs under `Functions`). `users.Row` contains only the selectable columns.

---

## 3. Edge functions (`supabase/functions`)

Remove `request-otp`, `verify-otp`, `create_group_invite`, `join_group_from_invite`, `upload_totem_photo` and unused `_shared` helpers.

1. **`delete-account`** (`verify_jwt = true`, but the function's own check is authoritative): POST, no body.
   1. `auth.getUser(jwt)`: `error.code === 'user_not_found'` → 200 `{ deleted: true }` (idempotent); any other error → 401.
   2. Service role `rpc('prepare_account_deletion', { p_auth_user_id })`.
   3. `storage.from('totems').remove(chunk)` in chunks of ≤ 1000; any error → retryable 500.
   4. `auth.admin.deleteUser(id)` (cascades through `users.auth_user_id`).
   5. 200 `{ deleted: true }`. No PII in logs.
2. **`demo-login`** (`verify_jwt = false`) — the only App Review path:
   - Enabled only when `DEMO_LOGIN_EMAIL` is set and `DEMO_LOGIN_CODE` matches `^\d{8,10}$`; otherwise always 404.
   - Rate limits via `check_rate_limit` (service role): per IP using the **last** `x-forwarded-for` entry (`demo-login:ip:<addr>`, 20/h) and global `demo-login:global` (30 failed/h).
   - Compare SHA-256 digests of `lower(email)` and of the code with a timing-safe equal, always evaluating both. Mismatch → 401 `{ error: 'invalid_code' }`, identical for wrong email vs wrong code.
   - On match: ensure the auth user exists (`auth.admin.createUser({ email, email_confirm: true })` if missing), `rpc('prepare_demo_account')`, then `auth.admin.generateLink({ type: 'magiclink', email })` → 200 `{ token_hash: properties.hashed_token, verification_type: properties.verification_type }`.
   - Client verifies with `verifyOtp({ token_hash, type: 'email' })`.
3. Shared: method check, JSON body size cap, no CORS headers needed (native clients only; OPTIONS → 204).

`supabase/config.toml` (local dev; hosted is applied with `supabase config push` after review, see runbook):
- `[api] schemas = ["public", "graphql_public"]` (stop exposing `storage`).
- `[auth] site_url` = non-localhost placeholder documented in the runbook; `additional_redirect_urls = ["festivalapp://"]`.
- `[auth.email] enable_signup = true, enable_confirmations = true, double_confirm_changes = true, otp_length = 8, otp_expiry = 600, max_frequency = "60s"` (8 matches the hosted project, see commit `da99227`; `max_frequency` must stay explicit or `config push` resets the hosted 60 s). Confirmations **must stay on**: GoTrue accepts `{email, password}` on `/signup` even though the app never uses passwords, and with autoconfirm an attacker could pre-register a victim's address.
- `[auth.hook.custom_access_token] enabled = true, uri = "pg-functions://postgres/public/custom_access_token_hook"` — refuses tokens whose `authentication_method` is `password` (hosted: Authentication → Hooks).
- `[auth] refresh_token_reuse_interval = 30` (default 10): pairs with the client's 10 s refresh timeout (§4.1) so a retry after a lost refresh response is accepted instead of signing the user out.
- `[auth.email.template.magic_link]` and `[auth.email.template.confirmation]`: `subject` + `content_path = "./supabase/templates/<name>.html"`; templates show `{{ .Token }}` prominently and contain **no link**.
- `[auth.rate_limit] email_sent = 200, token_verifications = 30`.
- `[functions.delete-account] verify_jwt = true`, `[functions.demo-login] verify_jwt = false`.

Verification: `deno check` every function (`deno` is installed); `deno test` pure helpers (digest compare, XFF parsing, chunking).

---

## 4. Client data layer (`packages/*`)

### 4.1 `@festival/data-access`

**Config & client**
- Reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (alias `EXPO_PUBLIC_SUPABASE_KEY`). No fallbacks: export `supabaseConfigError: string | null`; if set, no client is created and calls throw `ConfigError`.
- `createClient(..., { global: { fetch: fetchWithTimeout(15_000) } })` (AbortController); token refreshes time out after 10 s so a retry lands inside the 30 s `refresh_token_reuse_interval`. For refresh-token requests (`/auth/v1/token?grant_type=refresh_token`), a response that is 5xx, 429, not JSON (including a 200 HTML captive-portal page), or JSON without a session is converted into a network error so auth-js keeps the session and retries, instead of signing the user out. A genuine JSON 4xx auth error (e.g. `refresh_token_not_found`) still signs out. See `packages/data-access/README.md`.

**Session (offline-safe)**
- `getStoredSession(): { authUserId: string; expiresAt: number } | null` — **synchronous**; parses MMKV `festival-auth` / key `supabase_session`; requires `refresh_token` and `user.id`; never calls `supabase.auth.*`. Routing and launch paths use only this and `getCachedProfile()`. `supabase.auth.getSession()/getUser()` are never awaited on launch or render paths.
- Every authenticated write path (sync flush, RPCs) first checks the stored session; if missing → throw `TransientAuthError` without sending (prevents anon-key requests being misread as permission errors).

**Auth**
- `requestEmailCode(email)` → `auth.signInWithOtp({ email, options: { shouldCreateUser: true } })`.
- `verifyEmailCode(email, code)`:
  1. `auth.verifyOtp({ email, token: code, type: 'email' })`.
  2. Only if that fails with an `AuthApiError` (4xx — never on `AuthRetryableFetchError`) **and** the code is 8–10 digits **and** demo-login has not returned 404 in this app session: `functions.invoke('demo-login', { body: { email, code } })`; on `token_hash` → `auth.verifyOtp({ token_hash, type: 'email' })`.
  3. Otherwise rethrow the original error.
- `signOut()` and `deleteAccount()` (data-access part only):
  1. Server call (`auth.signOut({ scope: 'local' })` / `functions.invoke('delete-account')` — delete must succeed before continuing; sign-out ignores failure).
  2. Remove MMKV `festival-auth`/`supabase_session` directly, regardless of step 1.
  3. `clearLocalUserData()` (sync-engine), clear MMKV `profile-cache`, clear the signed-URL cache.
  4. Clear `app_meta.local_owner_auth_user_id`.
- `ensureLocalOwner(authUserId)`: on `SIGNED_IN`, if it differs from `app_meta.local_owner_auth_user_id`, wipe local user data first, then set it.

**Profile**: `getMyProfile()` (RPC, online, writes MMKV `profile-cache` including `auth_user_id`), `getCachedProfile()` (sync), `saveMyProfile(input)` (RPC). Offline-capable paths (enqueue, cache reads, routing) resolve identity **only** via `getCachedProfile()`.

**Reads are cache-first**: screens render from SQLite/MMKV immediately; background refresh only when NetInfo reports online.
- `refreshFestivalCatalog()`: published festivals (light columns) → upsert → delete local festivals/stages/sets not returned. Called on launch and pull-to-refresh when online.
- `fetchAndCacheFestival(id)`: light `select id, version` first; full bundle only when changed.
- `listMyGroups()`: replaces the current user's memberships locally (delete local rows not returned, and groups no longer referenced). A `not_group_member` error on any group call purges that group locally.
- Cache `user_festivals` in SQLite.

**Groups/meetups/photos**
- `createGroup` → `create_group`; `joinGroup(code)` → `join_group` (zero rows → `InviteNotFoundError`); `leaveGroup`, `removeGroupMember`, `rotateInviteCode`. Member selects use explicit columns.
- Meetups: create/update/delete via the sync queue (direct table writes under RLS); payload uses `latitude/longitude`.
- `uploadTotemPhoto(file, meetup)`: `flush()` first; if the meetup still has a pending op → throw `meetup_not_synced` ("Add the photo once this meetup syncs"); EXIF strip (piexif) on a JPEG re-encode → upload `<group_id>/<meetup_id>/<uuid>.jpg` (`upsert: false`) → `update meetups set totem_path` (online, not queued) → update local row. `getTotemSignedUrl(path)` with in-memory cache (50 min).

**Location**: `shareLocation(groupId, coords)`, `stopSharingLocation(groupId)`, `getGroupLocations(groupId)` → RPCs.

**Moderation**: `reportContent(type, targetId, reason, details?)`; `blockUser(id)` (RPC, then delete that user's rows from local meetups / combined selections caches and invalidate); `unblockUser(id)`; `listBlockedUsers()`.

**Selections**: upsert with `{ onConflict: 'user_id,set_id', ignoreDuplicates: true }`; delete by `user_id` + `set_id`. `refreshUserSelections` never drops rows with `pending_sync = 1` and never resurrects rows with a queued delete.

**Errors**: `toUserMessage(error)` maps P0001 codes, 23505/23514, network, timeout and auth errors to friendly copy.

### 4.2 `@festival/sync-engine`

- Local schema v2: on schema-version bump, drop and recreate every cache table except `sync_queue` and `app_meta`, then refetch. Local `users` has **no email**; `groups.created_by_user_id` nullable; new columns per §2.3 (festival status/is_demo/lat/lng/bounds/default_zoom/source_url, stage lat/lng, meetup latitude/longitude/totem_path/created_at/updated_at); `user_festivals` table.
- `MUTABLE_TABLES = { user_set_selections, meetups }`.
- Transport strips payloads to a per-table server whitelist — meetups: `id, group_id, title, stage_id, starts_at, notes, latitude, longitude, created_by_user_id`; user_set_selections: `id, user_id, festival_id, set_id, selected_at, note`. Never sends `pending_sync, synced_at, totem_path, custom_map_*, created_at, updated_at`.
- `flush()` checks the stored session first (expired-within-60 s or missing → treat as transient, do not send).
- Error classification:
  - **Transient** (keep, exponential backoff ≤ 30 s, cap attempts at 20 then park): network/timeout, HTTP 5xx/408/429, `rate_limited`, PGRST301/PGRST303/HTTP 401, any request sent without a user JWT.
  - **Permanent** (record in `getFailedOperations()`, drop, roll back the optimistic local row): 42501 with a valid JWT, 23502, 23503, 23514, 22P02, PGRST204, other P0001 codes.
  - **Success**: 23505 on user_set_selections; delete matching 0 rows.
- Add `clearLocalUserData()`, `getPendingOperationIds(table)`, `getPendingCount()`, `getFailedOperations()`, `clearFailedOperations()`.

### 4.3 `@festival/domain` — time & schedule (vitest)

- `formatFestivalTime(iso, tz)` → `9:30 PM` in the festival tz.
- `formatFestivalDate(value, tz, opts)`: **date-only strings** (`/^\d{4}-\d{2}-\d{2}$/`) are calendar dates → `Date.UTC(y, m-1, d)` formatted with `timeZone: 'UTC'`; timestamps are formatted in `tz`.
- `festivalDayKey(iso, tz, dayStartHour = 6)` → `YYYY-MM-DD` of the festival day (1:00 AM belongs to the previous day).
- `minutesIntoFestivalDay(iso, tz, dayStartHour = 6)`.
- `listFestivalDays(festival, sets)` = calendar days `start_date..end_date` plus any set day outside that range.
- `festivalTimeZoneLabel(tz)` (may be `GMT+2`; tests must not assert an abbreviation).
- All `formatToParts` calls use `hourCycle: 'h23'`; parser maps `24` → `00`.
- If `Intl.DateTimeFormat(…, { timeZone })` throws: format in device time and expose `timesAreDeviceLocal = true` so the UI hint says "Times shown in your device's time zone". Unit-test both branches.
- Conflict detection: add tests across midnight and adjacent (end == start → no conflict).

### 4.4 `@festival/map-utils`

- `getFestivalCamera(festival)` → `{ center: [lng, lat], zoom, bounds? } | null` (null without coordinates).
- `getFestivalBounds(festival)` → bounds or center ± ~1.5 km.
- `getStageCoordinate(stage)`, `getMeetupCoordinate(meetup, stagesById)` → `[lng, lat] | null`.
- No hard-coded city coordinates anywhere.

### 4.5 `@festival/notification-utils`

- Reminders at the absolute instant from the DB; copy uses festival-time formatting.
- `cancelAllReminders()`; permission asked contextually (first set/meetup), denial handled.

---

## 5. Mobile app (`apps/mobile`)

### 5.1 Shell, routing, sign-out

- `app/_layout.tsx`: fonts + splash, `AppProviders`, config-error screen if `supabaseConfigError`. Wrap `(tabs)` and `settings` in `<Stack.Protected guard={hasSession && acceptedTerms}>` (expo-router 55).
- `app/index.tsx` routing: stored session + cached profile with matching `auth_user_id` → `/(tabs)/festivals` (even if the token is expired; auto-refresh fixes it online). Stored session, no cached profile → online: `getMyProfile()` → profile-setup if none; offline: retry screen (never the login screen). No stored session → `/auth/enter-email`.
- `app/+native-intent.tsx`: `redirectSystemPath({ path })` stores `code` in MMKV `pending-invite-code` when the path starts with `group/join`, returns the path. After sign-in/profile setup, `index` routes to `/(tabs)/group/join?code=<pending>` and clears the key.
- `src/providers/session-actions.ts` → `performSignOut(mode: 'sign_out' | 'delete_account' | 'session_lost')`:
  - `sign_out`: `await stopLocationSharingNow()` → `await cancelAllReminders()` → data-access `signOut()` → `queryClient.clear()` → `resetAppStore()` → `router.replace('/auth/enter-email')`. Warns first if `getPendingCount() > 0`.
  - `delete_account`: data-access `deleteAccount()` **first**; only after the server confirms: stop sharing, cancel reminders, wipe, reset, route. A failed deletion leaves the user signed in with everything intact.
  - `session_lost` (involuntary `SIGNED_OUT`): stop the location watcher locally, clear the signed-URL cache, reset app state and route to sign-in, but **keep** the SQLite cache and offline queue so unsynced writes survive a captive-portal or transient auth failure. A different account signing in is isolated by `ensureLocalOwner`, which wipes before anything is shown or sent.
  - Re-entrancy: a call with the same mode, or `session_lost`, joins the run in progress; `sign_out` during `session_lost` waits, then wipes; any other combination rejects with `sign_out_in_progress`.
- Auth listener: `SIGNED_OUT` → `performSignOut('session_lost')`; `SIGNED_IN` → `ensureLocalOwner`.
- React-query keys for user data include the auth user id.
- Remove `app/(tabs)/chat`, `app/modal.tsx`, unused Expo template components.

### 5.2 Auth screens

- Enter email: remove the "Your Name" field (it overwrites the email, `enter-email.tsx:55-63`) and both social buttons; rebalance with spacing only. On `requestEmailCode` error (429/5xx) show the message plus an "I already have a code" link to verify.
- Verify code: `OTP_LENGTH` (from `src/config/app-info.ts`, = 8) boxes over one hidden `TextInput` (`textContentType="oneTimeCode"`, `autoComplete="one-time-code"`); auto-submit only at `OTP_LENGTH` digits; a Verify button accepts pasted 6–10 digits; resend with 60 s cooldown.
- Profile setup: display name (1–40), avatar; an explicit "I agree to the Terms of Use and Privacy Policy" checkbox (linked) is required to continue.
- Terms gate: `auth/accept-terms` shows the same explicit agreement to signed-in users who have not accepted the current `TERMS_VERSION` on this device (e.g. the App Review demo account, which already has a profile). Acceptance is stored per device and per `TERMS_VERSION`; bumping the version re-prompts everyone.

### 5.3 Settings (`app/settings/`, opened from an avatar button in the Fests header)

Built with `@festival/ui` primitives: Profile (edit name/avatar) · Privacy (Blocked users with Unblock; location sharing status + Stop) · Notifications (open system settings if denied) · About (Privacy Policy, Terms, Contact support via `mailto:SUPPORT_EMAIL`, Support URL, version/build) · Sign out · **Delete account** (explains what is deleted, type `DELETE` to confirm, ≤ 3 taps from Settings).

### 5.4 Groups & meetups

- `(tabs)/group/_layout.tsx` exports `unstable_settings = { initialRouteName: 'index' }`.
- Create group → share sheet: `Join my crew "<name>" on Festie. Code: ABC123 — open festivalapp://group/join?code=ABC123 — get the app: https://apps.apple.com/app/id6761392490`.
- Join screen pre-fills `code` from params (no auto-join).
- Group detail: members (tap another member → Report / Block (confirm) / admin: Remove); Leave group (confirm); admin: rotate code; blocked users shown as "Blocked user" with Unblock.
- Meetups: creator can delete; others can Report; totem via signed URL with Report on the photo.
- Report sheet: reason picker + optional details → toast "Thanks — we'll review this within 24 hours."
- Create meetup: stage picker; custom pin only when the festival has coordinates **and** Mapbox is configured (tap → lat/lng). Remove the normalized-grid picker.

### 5.5 Schedule & lineup

- All time labels via §4.3 helpers with `festival.timezone`; day tabs from `listFestivalDays`; timeline from `minutesIntoFestivalDay`.
- Hint "Times shown in festival local time (<label>)" or the device-time variant.
- Disclaimer on festival detail/lineup: "Festie is an independent app and is not affiliated with or endorsed by any festival, organizer, or artist. Schedules can change — check official sources."
- Demo festivals show a "Sample" badge and sort last.

### 5.6 Map & live location

- Mapbox: `src/config/app-info.ts` exports `MAPBOX_ACCESS_TOKEN` + `isMapboxConfigured()`; `AppProviders` calls `Mapbox.setAccessToken()` and `Mapbox.setTelemetryEnabled(false)` once.
- Camera from `getFestivalCamera`; stage, meetup, friend pins. `Mapbox.UserLocation` only when permission is already granted.
- Fallback (no token or no coordinates): styled card listing stages, next sets, meetups. No fake map.
- Offline pack: `getPack('festival-<id>')` first; `createPack(options, onProgress, onError)`; state from `pack.status()`; delete + recreate when `festival.version` changes.
- **Location sharing** — `src/location/LocationSharingProvider.tsx` (MOBILE-B), mounted by `AppProviders`:
  - Persisted (MMKV) `{ groupId, startedAt, expiresAt }`. Durations: 1 h, 4 h, 8 h (default), "Until I stop" (max 24 h).
  - Foreground only: `watchPositionAsync({ accuracy: Balanced, distanceInterval: 25 })` while sharing and permission granted. Pause only on AppState `background` (`inactive` changes nothing); resume on `active`.
  - Heartbeat every 120 s while sharing: re-send last fix (cached or `getLastKnownPositionAsync()`); client throttle ≥ 15 s.
  - On every `active`: if `now >= expiresAt` → `stopSharingLocation` + clear before resuming.
  - Stop on: user off, expiry, `not_group_member`, leave/removal, sign-out.
  - API: `useLocationSharing()` → `{ status: 'off'|'sharing'|'paused'|'permission_denied', groupId, expiresAt, start(groupId, durationMs), stop() }` and `stopLocationSharingNow()` (idempotent, 3 s timeout).
  - First-start explainer: "Only members of <group> can see your location, only while Festie is open, for the time you choose. Your position is visible to your crew for at most 15 minutes after the last update, then deleted."
- Friend locations polled every 30 s only while the map is focused (`useFocusEffect`); "last seen N min ago".

### 5.7 App config (MOBILE-A owns all of it)

- Delete stray root `app.json` and root `eas.json`. Bundle id/package `com.kevin.festivalapp`.
- Add `apps/mobile/app.config.ts` extending `app.json` that **throws** when `EAS_BUILD_PROFILE` is `preview`/`production` and `EXPO_PUBLIC_SUPABASE_URL` or the anon key is missing.
- Plugins:
  - `expo-location`: `{ locationWhenInUsePermission: "Festie uses your location while the app is open to show you on the festival map and, only when you turn on sharing, to show your position to members of the crew you choose.", locationAlwaysAndWhenInUsePermission: false, locationAlwaysPermission: false, isIosBackgroundLocationEnabled: false, isAndroidBackgroundLocationEnabled: false }`.
  - `expo-image-picker`: totem-photo `photosPermission`/`cameraPermission`, `microphonePermission: false`.
  - `@rnmapbox/maps` per `node_modules/@rnmapbox/maps/plugin/install.md` (10.3 needs no download token — verify in the podspec).
  - Remove duplicate keys from `ios.infoPlist`.
- Android: permissions `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `CAMERA`; `blockedPermissions`: `RECORD_AUDIO`, `ACCESS_BACKGROUND_LOCATION`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES`, `READ_MEDIA_VIDEO`.
- Remove `expo-insights`.
- `eas.json`: document required env vars; nothing secret committed.

### 5.8 Design rules

- Tokens/primitives from `@festival/ui`. MOBILE-A adds first: `ListRow`, `DestructiveButton`, `IconButton` (required `accessibilityLabel`, 44×44), `Badge`, `showToast`, tokens `colors.link` (≥ 4.5:1 on white and on accent `bgTint`, e.g. `#2F5DA8`), `colors.destructive` (`#B42318`), `colors.destructiveBg` (`#FDECEC`), `layout.tabBarClearance = 120`.
- Pastel `primary` and festival accents are fill-only, never text. Text links and secondary-button labels use `colors.link`; breadcrumbs use `textPrimary`.
- `textSecondary` alpha ≥ 0.68.
- Every scrollable screen under `(tabs)` adds `layout.tabBarClearance` bottom padding.
- Empty, loading, error and offline states on every data screen; destructive actions confirm.

---

## 6. Content, moderation & admin tooling

- Delete `seed-data/coachella-2026.json`, `seed-data/lollapalooza-2026.json`, `seed-data/sample-festival.json`; remove root scripts `supabase:seed:festival|coachella|lolla|all`.
- `seed-data/demo-festival.json`: fictional "Festie Demo Fest", `is_demo: true`, `status: 'published'`, upcoming 2027 dates, fictional artists, real coordinates of a large public open space, stage coordinates inside it, accent color.
- `apps/admin-tools` commands (service role):
  - `festival:seed <file> [--dry-run]` — strict validation (UUIDs, offsets on times, sets within festival dates ±1 day, references exist, end > start, lat/lng ranges, `source_url` required unless `is_demo`), auto-bumps `version`.
  - `festival:import-csv <dir>` — `festival.csv`, `stages.csv`, `artists.csv`, `sets.csv` → validated JSON.
  - `festival:shift-dates <file> --start <YYYY-MM-DD>` — moves a demo festival so "now/next" states are live during review.
  - `demo:seed` — demo festival + ≥ 2 fake member auth users/profiles + "Festie Demo Crew" group + their selections + a meetup with a totem photo by a fake member + location rows near stages.
  - `reports:list`, `reports:remove-content <id>` (delete meetup + storage object, or clear the photo), `users:ban <user_id>` (`auth.admin.updateUserById(id, { ban_duration: '876000h' })`, remove memberships and location rows, mark reports actioned).
- `docs/festival-data.md`: how to enter a real festival from public official schedules (factual data, nominative names, no logos/artwork, `source_url`).

## 7. Verification gates

1. `npm run build` and `npm run lint` — zero errors.
2. `npm run test` — domain, sync-engine, data-access unit tests.
3. `npm run db:test` — throwaway local Postgres 16 (`/usr/lib/postgresql/16/bin`, non-root OS user) or `DATABASE_URL` (CI service). `supabase/tests/local/supabase-stubs.sql` bootstraps:
   - superuser `supabase_admin`; roles `anon`, `authenticated` (NOLOGIN), `service_role` (NOLOGIN BYPASSRLS), `authenticator` (LOGIN NOINHERIT, granted the three), `supabase_auth_admin`, `supabase_storage_admin`, and `postgres` as NOSUPERUSER CREATEROLE owning schema `public`;
   - `alter database ... set search_path = "$user", public, extensions`; schema `extensions` with `uuid-ossp` and `pgcrypto`;
   - usage on `public`, `extensions`, `auth`, `storage` for the API roles, plus Supabase's `alter default privileges for role postgres in schema public grant all on tables, sequences, functions to anon, authenticated, service_role`;
   - `auth.users` (owned by `supabase_auth_admin`, `grant select, references to postgres`), `auth.uid()/role()/jwt()` reading `request.jwt.claims` (and legacy `request.jwt.claim.sub`);
   - `storage.buckets`, `storage.objects` (with `owner`, `owner_id text`, `path_tokens`), RLS on, owned by `supabase_storage_admin`, `grant supabase_storage_admin to postgres`; `storage.foldername` exactly as Supabase defines it; a statement-level BEFORE DELETE trigger emulating `protect_delete`;
   - a minimal pgTAP-compatible shim (`plan/ok/is/throws_ok/lives_ok/finish`) unless `postgresql-16-pgtap` is installed.
   Then: apply 001→014 as `postgres`; apply a **dirty fixture** after 006 (case-duplicate emails, 81-char name, `pending-` code, duplicate location rows, permissive dashboard-style policies on `users` and `storage.objects`) before 007; run `supabase/tests/rls.sql`; re-apply 007–014 to prove idempotency. Impersonate with `set local role authenticated` + `set_config('request.jwt.claims', json_build_object('sub', …, 'role', 'authenticated', 'email', …)::text, true)`. Every negative assertion is paired with a positive control under the same identity. Covers every row of §2.4–§2.8, the function-exposure whitelist, rate limits (11th wrong invite → `rate_limited`), wildcard codes, admin hand-off races, account-deletion cascade (`set role supabase_auth_admin; delete from auth.users ...`), and moderation-trigger-vs-cascade.
4. `deno check` + `deno test` for edge functions.
5. `npx expo export --platform ios` in `apps/mobile`.
6. `.github/workflows/ci.yml` runs gates 1–5 and the storage-SQL grep.
7. Release gates (manual, in the runbook): ≥ 1 real upcoming festival published with `source_url`; hosted email templates send codes; demo login works on hosted; first TestFlight upload has no ITMS-91053; App Privacy answers match `docs/app-store-privacy.md`; age rating declares UGC and location sharing; festival times spot-checked on physical iOS and Android devices.

## 8. Ownership and interfaces

| Slice | Owns |
|---|---|
| BE-DB | `supabase/migrations/**`, `supabase/tests/**`, `scripts/db-test.sh`, **all of root `package.json`**, `seed-data/**`, `apps/admin-tools/**`, `docs/festival-data.md` |
| DA | `packages/data-access/**`, `packages/sync-engine/**`, `packages/domain/**`, `packages/map-utils/**` |
| BE-FN | `supabase/functions/**`, `supabase/config.toml`, `supabase/templates/**` |
| MOBILE-A (shell) | `apps/mobile/app/_layout.tsx`, `app/index.tsx`, `app/+not-found.tsx`, `app/+native-intent.tsx`, `app/auth/**`, `app/settings/**`, `apps/mobile/src/providers/**`, `apps/mobile/src/config/**`, `packages/ui/**`, `apps/mobile/app.json`, `apps/mobile/app.config.ts`, `apps/mobile/eas.json`, `apps/mobile/package.json`, root `app.json`/`eas.json` deletion, template leftovers |
| MOBILE-B (features) | `apps/mobile/app/(tabs)/**`, `apps/mobile/src/state/**`, `apps/mobile/src/location/**`, `apps/mobile/src/hooks/**`, `apps/mobile/src/components/**`, `packages/notification-utils/**` |
| DOCS | `docs/**` (except `festival-data.md`, `v1-architecture.md`), `apps/mobile/app/legal/**`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `.github/workflows/ci.yml` |

Interfaces between slices:

- MOBILE-B `src/location/LocationSharingProvider.tsx` exports `LocationSharingProvider({ children })`, `useLocationSharing()` (§5.6), `stopLocationSharingNow(): Promise<void>`.
- MOBILE-B `src/state/app-store.tsx` exports `AppStoreProvider`, `useAppStore` (persisted `activeFestivalId`, `selectedGroupId`, accent; default festival = first followed, else first published non-demo, else demo), `resetAppStore()`.
- MOBILE-A `src/providers/app-providers.tsx` mounts `QueryClientProvider > AppStoreProvider > LocationSharingProvider > children`, exports `queryClient`; owns `session-actions.ts` and `app/+native-intent.tsx`.
- MOBILE-B adds the header avatar button in `(tabs)/festivals/index.tsx` → `router.push('/settings')`.
- `cancelAllReminders()` is called by the app orchestrator, never by data-access.
- BE-FN's deploy script changes go into root `package.json` via BE-DB (or the integrator).
- DOCS owns the legal copy; canonical location retention copy: "visible to your crew for at most 15 minutes after the last update, then deleted".

## 9. Rev 2.2 amendments (final adversarial review)

These record behaviour shipped after rev 2.1. Where they conflict with earlier sections, **this section wins**.

### 9.1 Database (§2)

- **Helpers (§2.2)**, all `private`, definer, `search_path = ''`, executable by `anon` and `authenticated` for policy evaluation:
  - `is_banned()`: `auth.users.banned_until > now()` for `auth.uid()`. `current_app_user_id()` returns null and `require_profile()` raises `not_authenticated` for a banned caller, so a ban takes effect even for already-issued access tokens.
  - `can_view_totem(p_group_id uuid, p_meetup_id uuid, p_owner_id text)`: member of the group and no block either way with the meetup's creator or the uploader (`owner_id`).
  - `is_reported_totem(p_name text)`: a photo report with status `open` or `reviewed` whose `target_snapshot` equals the object name.
  - `can_upload_totem` additionally requires fewer than 5 objects already in `<group>/<meetup>/`.
  - `refresh_demo_crew(p_group_id uuid default null)` / `refresh_demo_crew_content`: keep the seeded fake members' locations fresh and roll their meetups that have started (or start within 30 minutes) to the start of the current hour + 2 h. No-op for any non-demo group.
- **Triggers (§2.3)**: `meetups_insert_limits` (profile-JWT inserts only; a sync replay of an existing id is not counted): more than 30 new meetups an hour per user → `rate_limited` (transient, clears by itself); 100 meetups per user per crew → `meetup_limit_reached` (permanent).
- **Reports (§2.3)**: `target_type` also allows `block` (see `block_user`).
- **RPCs (§2.6)**:
  - `join_group`: besides the 10 failures/hour per user, a project-wide `join_group:global` budget: once 200 wrong codes land in an hour, profiles younger than 7 days are refused and older ones get 3 failures an hour. Each failure records both the user and the global event.
  - `remove_group_member`: also deletes the removed member's meetups in that crew and rotates the invite code under the group row lock, so the removed person cannot rejoin with the code they had.
  - `block_user`: a new block also files a moderation notice — a `reports` row with `target_type 'block'`, `reason 'other'`, `target_snapshot` = display name, `group_id` = first shared crew (`on conflict do nothing`).
  - `get_group_locations`: returns `age_seconds double precision` (age on the server clock) so clients never judge freshness by the phone's clock; calls `refresh_demo_crew` first. Its earlier definition is dropped before re-creation because the return type changed.
  - `prepare_demo_account`: also refreshes the demo crew's meetups and locations (above).
  - New `prepare_account_ban(p_auth_user_id uuid)` → `table(storage_path text)`, **service_role only**: runs `prepare_account_deletion`, rotates the invite code of every crew the user was in, deletes the user's meetups, returns every photo path to remove; idempotent.
  - New `public.check_rate_limit(...)`: service_role-only wrapper around `private.check_rate_limit` (PostgREST exposes only `public`); used by `demo-login`.
  - New `public.custom_access_token_hook(event jsonb)`: executable only by `supabase_auth_admin`; returns a 403 error when `event->>'authentication_method' = 'password'`, otherwise passes the claims through.
- **Cron (§2.7)**: adds `refresh-demo-crew` every 5 minutes (see the block in §2.7).
- **Storage (§2.8)**: the restrictive `totems_guard` USING clause and the permissive select policy use `private.can_view_totem(folder[1], folder[2], owner_id)`; the delete policy adds `and not private.is_reported_totem(name)`, so reported photos are kept for review until a moderator resolves the report.

### 9.2 Edge functions and auth config (§3)

- Auth config as in §3 (confirmations on, password-token hook, `max_frequency = "60s"`, `refresh_token_reuse_interval = 30`).
- Edge functions read the new secret key from `SUPABASE_SECRET_KEYS` (`default` entry) and fall back to the legacy `SUPABASE_SERVICE_ROLE_KEY`, so both key-rotation routes work.
- `demo-login` order: per-IP limit first (20/h, the only 429); then the email digest; then exactly one more limiter call — `demo-login:global` (30 attempts/h, taken before the code is compared) if the email matched, otherwise `demo-login:other` (result ignored). A full global cap answers the same 401 `invalid_code` as a wrong code. On a match: ensure the auth user → `generateLink` → `prepare_demo_account(user id)` → 200, so the token is returned only once the account is ready.

### 9.3 Client data layer (§4)

- `fetchWithTimeout`: token refreshes use a 10 s timeout (`REFRESH_TIMEOUT_MS`), other requests 15 s, storage uploads 90 s.
- Sync engine (§4.2):
  - `flush()` sends nothing unless the stored session's user equals `app_meta.local_owner_auth_user_id` and stops mid-pass if the account changes.
  - Operations parked after 20 attempts get a fresh round on every external `flush()` (launch, foreground, `TOKEN_REFRESHED`, sign-in, pull to refresh) and on a NetInfo offline→online change; the engine's own retries never release them.
  - A 4xx without a PostgREST or Postgres error code, a non-JSON body, or a body that is not PostgREST-shaped (including an empty 2xx/204 or empty 404 from a middlebox) is a connectivity failure (transient), never permanent or success. "Permanent" covers only 4xx responses that carry a code. Every queued write selects `id`, so a non-PostgREST empty reply is never read as success.
- `listMyGroups` (§4.1) does not purge crews written by `createGroup`, `refreshGroupDetail` or `joinGroup` while it is in flight, and rejects on an empty reply instead of treating it as "no crews"; direct cache writes made during a refresh are not undone by the refresh's stale snapshot.

### 9.4 Mobile (§5)

- Routes: `auth/delete-account`, guarded by `hasSession` only and linked from `auth/accept-terms` and `auth/profile-setup`, so an account can be deleted without first accepting the terms.
- Reminders: sign-out cancels every reminder; afterwards the app recreates missing reminders (silently, only when notification permission is already granted) for future picked sets and the user's own future meetups whenever picks or crews refresh from the server. Reminders for a crew are cancelled when the user is removed from it or it is purged.
- Create Meetup: while online it waits up to 8 s for the server's verdict before confirming success and shows server rejections (e.g. `content_not_allowed`, `meetup_limit_reached`) inline.
- Location sharing (§5.6):
  - The heartbeat sends only a fresh fix: the last fix of the current foreground session or `getLastKnownPositionAsync({ maxAge: 2 min })`; nothing is sent without one.
  - `useLocationSharing()` adds `stop(): Promise<boolean>` (true when the server row is gone), `requestAccess(): Promise<boolean>` and `canAskAgain` (re-prompt after an expired "Allow Once").
  - `stop()` waits up to 1.5 s for an in-flight share before deleting, and deletes again if a late share lands; `stopLocationSharingNow()` times out after 4.5 s.
  - The map hides friends whose server-measured age exceeds 15 minutes (falls back to `recorded_at` vs the device clock only when the server sends no age).
- Release guards (`app.config.ts`): preview/production builds also fail on template artwork, on bundled legal `__PLACEHOLDER__` tokens (run `node docs/legal/generate.mjs --release` with real values), and on a missing Mapbox `pk.` token.
- `apps/mobile` has a vitest suite (`apps/mobile/test/*.test.ts`), run by `npm run test`.

### 9.5 Admin tools (§6)

- `users:ban <user_id>`: `auth.admin.updateUserById(id, { ban_duration: '876000h' })` → `rpc('prepare_account_ban')` → remove the returned `totems` paths in chunks of ≤ 1000 → mark open/reviewed reports about the user `actioned`. The profile is kept and reports keep `target_snapshot`. Safe to re-run.
- `reports:remove-content` on a photo report deletes the reported object (the path in `target_snapshot`), not the meetup's current photo. `storage:sweep-orphans` keeps photos under an open or reviewed report.

### 9.7 Schedule changes (migration 011)

- `sets` gains `status text not null default 'scheduled'` (`scheduled | moved | cancelled`), `original_start_time timestamptz` (only when `status = 'moved'`, optional) and `change_note text` (1–140 characters, already trimmed, any status). Covered by the existing table-level `select` grant and `sets_select_published`; written only by `festival:seed`. A cancelled set is never deleted, so picks of it survive; picks of moved and cancelled sets are never refused (a pick queued offline before the change still syncs). rls.sql section Q.
- Clients: `SET_COLUMNS` carries the three columns; the local cache adds them in place on the next launch (cache columns are now appended with `ALTER TABLE`, and a new catalog column marks every cached bundle stale with `bundle_version = 0`, so offline data survives an app update). Unknown statuses read as `scheduled`.
- Domain: `describeSetChange` (chip, "Was Sat 11:00 PM", note, accessibility sentence); `detectConflict`, `getConflictSetIds`, `getNextUpcomingSet` and map-utils `getNextStageSet` ignore cancelled sets.
- Reminders: every bundle refresh runs `restoreSetReminders`, which cancels reminders of cancelled picks and moves reminders of moved picks (same lead time); My Schedule's `syncSetReminders` leaves cancelled picks out. Both go through one queue (`runReminderTask`), so a run with fresh picks always corrects a run that read picks from before the update.
- Festivals list and default: the Fests list shows festivals that have not ended first (soonest first), then ended ones with an "Ended" badge (most recent first), then demo festivals. The default festival is the first not-ended festival across the tiers followed → published real → demo; an ended festival is the default only when nothing upcoming is published (`apps/mobile/src/state/default-festival.ts`).
- UI: Lineup, Add sets, My Schedule and Crew Schedule show a Moved (blue) or Cancelled (red, struck through) chip and the detail line; a cancelled set can be removed but not added; My Schedule lists changed picks at the top.
- Admin tools: the validator mirrors the database checks and always emits all three fields; `sets.csv` takes `status, original_start, note`; a moved set's derived id uses the festival day of `original_start`, so it keeps its id across days. Deploy order: apply 011 before shipping a client that selects the new columns.

### 9.6 Known residual risks (accepted for v1, revisit after launch)

- No CAPTCHA on email-code requests: one client can exhaust the project-wide email budget (200/h) and block sign-ins until it resets. Enabling Turnstile needs a Cloudflare account, a captcha token in `signInWithOtp`, and the commented `[auth.captcha]` block in `supabase/config.toml`.
- Invite codes are 6 characters (32⁶) and never expire unless rotated; per-account and project-wide guess budgets apply.
- `auth.sessions` rows (IP, user agent) persist for devices that never sign out online; disclosed in the privacy policy.

### 9.8 Artwork, photo credits and festival suggestions (migrations 012–013)

- **Image credits (012).** `artists` and `festivals` gain `image_credit text`, `image_license text` and `image_source_url text` next to the existing `image_url`. Checks, named `<table>_image_url_check`, `_image_license_check`, `_image_credit_check`, `_image_source_url_check`: `image_url` is null or starts with `https://`; an `image_url` requires an `image_license`; `image_credit` is null or 1–300 characters; `image_source_url` is null or starts with `https://`. When 012 runs, a legacy row whose `image_url` is not https or has no licence loses its `image_url` (an image without a licence cannot be shown; re-seed it with a credit). Written only by admin-tools (service role). Clients read the four columns through the existing table-level `select` grants on `artists`/`festivals` and the `artists_select_all` / `festivals_select_published` policies: 012 changes no grant and no policy. rls.sql section R.
- **Artwork bucket (013).** Bucket `artwork`: `public = true`, `file_size_limit = 2097152`, `allowed_mime_types = '{image/jpeg,image/png,image/webp}'` (insert-or-update the row). Paths `artists/<uuid>.<ext>` and `festivals/<uuid>.<ext>`; `image_url` holds the object's public URL. 013 drops every `storage.objects` policy whose name, qual or with_check mentions `artwork`, then creates `artwork_select_public` (select, `to anon, authenticated`, `bucket_id = 'artwork'`) and three **restrictive** guards `artwork_no_client_insert` (`with check (bucket_id <> 'artwork')`), `artwork_no_client_update` and `artwork_no_client_delete` (`using (bucket_id <> 'artwork')`), all `to public`, so a permissive dashboard-made policy can never let a client write artwork (rls.sql R10–R13 prove it with a probe policy). Only admin-tools (service role, bypasses RLS) writes objects. Same CI grep rules as 008.
- **Festival suggestions (012).** `public.festival_suggestions(id uuid pk, user_id uuid → users on delete set null, name text not null, url text, note text, status text not null default 'new', created_at timestamptz not null default now())`. Checks: `char_length(btrim(name)) between 1 and 120`; `url` null or (`https://` and ≤ 500 characters); `note` null or ≤ 300; `status in ('new','accepted','rejected','duplicate')`. Index `(status, created_at)`; unique index `festival_suggestions_user_name_key` on `(user_id, lower(btrim(name))) where user_id is not null`. Locked table: RLS on, no policies, no grants to anon/authenticated (A2–A4); admin-tools reads and triages it with the service role.
- **RPC `public.suggest_festival(p_name text, p_url text default null, p_note text default null) returns uuid`** — plpgsql, security definer, `search_path = ''`, execute granted to `authenticated` only (A8). Contract: `private.require_profile()` (`not_authenticated` / `profile_required`); trims the name and blanks url/note to null; `invalid_input` when the trimmed name is not 1–120 characters, the url is given but not https or over 500 characters, or the note is over 300; `content_not_allowed` when `private.contains_disallowed_text` hits the name or the note; a name the same user already suggested (case- and whitespace-insensitive) returns the existing row's id without inserting or charging the limit; otherwise `private.check_rate_limit('user:<profile id>', 'suggest_festival', 5, interval '1 day')` → `rate_limited`, then the insert (`on conflict do nothing` + re-read against the unique index for races). All errors are `P0001` with the code as message. rls.sql section S.
- **Client.** `ARTIST_COLUMNS` and `FESTIVAL_COLUMNS` carry the credit columns and the local cache adds them in place (catalog tables, so bundles refetch once). Lineup cards render `artist_image_url` through `ArtistAvatar` (expo-image, memory-disk cache, `contentFit cover`) and fall back to the monogram when there is no image or it fails to load; festival cards do the same inside their icon box. Settings → Photo credits lists every cached artist/festival with an image (`getLocalImageCredits`) with its attribution and licence, tapping opens `image_source_url` (`accessory="external"`); below the credits, a "Licences" section lists each Creative Commons licence in use once (`licensesInUse`: the deed derived from the `image_license` id by `licenseDeedUrl`, CC0 1.0 and CC BY / BY-SA 2.0–4.0 international or unported, with a photo count) and opens its deed; the intro says photos are resized and may be cropped to fit (CC licences require the licence link and an indication of changes). Fests → "Suggest a festival" calls `suggestFestival` (validated client-side with the RPC's limits, online only, never queued; `toSuggestionErrorMessage` maps `rate_limited` to daily-limit copy).
- **Pipeline (admin-tools).** Images enter only through `seed-data/media/registry.json` (`media:validate`, `media:upload`; Commons fetcher `media:fetch-commons` records licence and attribution, using the author's requested credit line (Commons `Attribution`) word for word when there is one and refusing it rather than shortening it; NC/ND, country versions of CC licences and unknown licences are refused; `media:validate` requires a CC BY credit to name its licence and a CC licence link to point at that licence, not a country version). Festivals enter as candidates in `seed-data/candidates/<slug>/` written by the scout agent (`/festival-scout`, workflow `festival-scout`), reviewed in `review:serve` (127.0.0.1, section and image decisions), promoted with `candidate:promote` into `seed-data/` and `seed-data/golden/index.json`, scored with `scout:eval`. Suggestions are triaged with `suggestions:list` / `suggestions:to-candidate`. Rules, roles and the flywheel: `docs/agents/festival-pipeline.md`. Publishing order: migrations 012–014 → `media:upload` → `festival:seed`.

### 9.9 Lineup announced, set times to be announced (migration 014)

- **Table.** `public.festival_artists(festival_id uuid → festivals on delete cascade, artist_id uuid → artists (restrict, like `sets.artist_id`), billing_order integer, primary key (festival_id, artist_id))`; check `festival_artists_billing_order_check` (`billing_order is null or between 1 and 10000`; the number is a position or tier, acts may share it); index `festival_artists_artist_id_idx`. RLS on; `grant select to anon, authenticated` (A3/A4 list it) and `select, insert, update, delete to service_role` (parity with 012); policy `festival_artists_select_published` mirrors `sets_select_published` (T18 pins it as the only policy); no client write policies, `festival:seed` (service role) is the only writer. 014 backfills one row per distinct `(festival_id, artist_id)` of `sets` (`on conflict do nothing`), then adds `sets_lineup_fkey`: `sets (festival_id, artist_id) → festival_artists` with plain `no action`, so a set's artist is always in the festival's lineup (T19–T21) and deleting a festival still cascades to both in one statement; `sets_festival_id_artist_id_idx` covers the key (T22). Clients read the union of lineup and set artists regardless (a cache written by an older build). Statement order is fail-closed under a non-transactional `db push` (RLS before grant before policy). rls.sql section T; the dirty-fixture checks prove the backfill equals the distinct set pairs.
- **Validator and seed.** A published festival needs at least one artist; zero sets is a warning, not an error ("set times to be announced"), except for the demo festival, which must keep its sets (`demo:seed` builds the sample crew from them). `artists[].billing_order` (CSV `billing`) is written to `festival_artists`, never to `artists`. The seed upserts artists → lineup rows → stages → sets, deletes stale sets, then lineup rows no longer in the file, then stale stages, and bumps the version last (the order `sets_lineup_fkey` requires); planning reads `festival_artists` first, so a project without 014 fails before any write. `scout:eval` reports a candidate without sets as lineup-only instead of 0 % recall; the watchlist status `awaiting_times` keeps a published lineup-only festival in scheduled scouting until its set times are seeded (the set-times run writes a change candidate `<slug>-times-<date>`, workflow arg `update: true`), and `candidate:promote` writes the festival id onto the watchlist entry so follows count towards its score.
- **Client.** `LINEUP_COLUMNS` (`festival_id, artist_id, billing_order`); `fetchAndCacheFestival` pages `festival_artists` with the bundle, fetches artists for lineup ∪ set artists and replaces the local `festival_artists` rows (cache table, in `CATALOG_TABLES`; a catalog *table* added by a release marks cached bundles stale the same way a new column does). A server without the relation (PostgREST `PGRST205`, no 014 yet) fails the bundle fetch like any other read error and leaves the cached bundle alone: a silently empty lineup would be cached under the current version and never corrected. `getLocalUnscheduledArtists` lists lineup artists with no set of any status in the festival, billing order first then name; `describeLineupAvailability` (domain) names the state `empty | tba | partial | scheduled`. Orphan-artist cleanup keeps artists referenced by sets or lineups.
- **UI.** Every screen waits for both the sets read and the unscheduled read before choosing an empty state. Lineup: `tba` hides the day/stage chips and the time-zone hint and shows a notice (with a "Follow <festival>" button from the shared `useFollowFestivals` hook when the user does not follow it yet) plus one card per announced act ("Set time TBA", no Add button, one accessible element per card); `partial` appends a "Set times to be announced" section under the timed cards when no filter is active, else a one-line footnote. Add sets: `tba` hides search, day chips and hint and shows "Set times coming soon" with a link to the Lineup; `partial` adds the footnote. My Schedule's empty state says set times are coming when the festival has no set yet and its "+" then leads to the Lineup. The map's stage list says "Set times to be announced" instead of "No more sets" while the bundle has no sets; the crew schedule's empty state says the same. Reminders and conflicts are set-driven and unchanged.
- **Deploy order.** Apply 014 before any build that selects `festival_artists`; older builds ignore the table. `docs/festival-data.md` §4.2 is the operator's view.
