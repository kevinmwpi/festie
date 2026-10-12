# Security controls: Festie v1

Last reviewed: October 5, 2026, against the v1 code on this branch.

What protects Festie's data, where each control lives and which automated test would fail if it were
removed. The contract is [`../v1-architecture.md`](../v1-architecture.md) (goal 1: "no user can read or
change data they should not; proven by automated tests"). All tests below run in CI
(`.github/workflows/ci.yml`) on every push and pull request.

## 1. Secrets and configuration

| Value | Where it lives | Exposure |
|---|---|---|
| Supabase URL, anon/publishable key | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (EAS environment variables; the URL is also pinned in `apps/mobile/eas.json`) | Public by design (in the app binary); everything they can reach is governed by RLS and grants |
| Mapbox token | `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` | Public `pk.` token only; `MAPBOX_ACCESS_TOKEN` in `apps/mobile/src/config/app-info.ts` rejects anything else |
| Service-role / secret key | Supabase Edge Functions runtime (injected automatically) and the operator's local, git-ignored `.env` for `apps/admin-tools` | Never in the app, never `EXPO_PUBLIC_*`, never committed. It was previously stored in a Railway service; rotate it when decommissioning Railway ([`../release-runbook.md`](../release-runbook.md) §2.3) |
| Demo login email and code | Supabase function secrets `DEMO_LOGIN_EMAIL`, `DEMO_LOGIN_CODE` | Never committed; compared as SHA-256 digests in constant time |
| Apple team id, App Store app id, EAS project id | `apps/mobile/eas.json`, `app.json` | Identifiers, not secrets |

`app.config.ts` refuses release builds without the public configuration. Without Supabase configuration
the data layer creates no client and the app shows a configuration-error screen (no silent fallback
project). Re-scan before each release:
`git grep -nE "service_role|sb_secret_|sk\.[A-Za-z0-9]|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY" -- . ':!docs'`
(expect only references by name).

## 2. Database access control (Postgres + PostgREST)

| Control | Implementation | Tests |
|---|---|---|
| RLS enabled on every public table; locked tables have no policies or grants | `supabase/migrations/007_v1_security_overhaul.sql` §2.4–2.5 | `supabase/tests/rls.sql` section A |
| Table and column privileges whitelist (e.g. `users` exposes only id, display name, avatar, created_at; `group_members` and `reports` are not directly writable) | 007 privileges block | rls.sql A, C, D, E |
| Exact whitelist of RPCs executable by `anon` and `authenticated`; service-role-only functions (`prepare_account_deletion`, `prepare_account_ban`, `prepare_demo_account`, purges, `check_rate_limit`); the access token hook is executable only by `supabase_auth_admin` | 007, end of file | rls.sql A, M, P6 |
| Security-definer helpers in a non-exposed `private` schema with `search_path = ''` | 007 §2.2 | rls.sql A |
| Crew-scoped visibility of profiles, picks, meetups, locations and meetup photos, and block filtering in both directions (blocks also hide totem photos: `private.can_view_totem`) | RLS and storage policies and `private.*` helpers | rls.sql C, F, G, H, J (photos J6a, J8a, J8b, J9a) |
| Group integrity: atomic create, 6-character invite codes from a 32-character alphabet, exact-match join, 50-member cap, admin-only rotate/remove (removing a member also replaces the invite code, so the removed member cannot rejoin with it), admin hand-off under row locks | `create_group`, `join_group`, `rotate_invite_code`, `remove_group_member`, `leave_group` | rls.sql I; concurrency races in `supabase/tests/local/race-*.sql` |
| Immutable meetup ownership and crew; picks must match their set's festival | Column-scoped triggers | rls.sql F, G |
| Disallowed-word filter on names, crew names, meetup title/notes (insert and change only, never on cascades) | Triggers + `private.contains_disallowed_text`, list in `public.moderation_terms` (009) | rls.sql D, G; `apps/admin-tools/test/terms.test.ts` |
| Rate limits: crew creation 10/day, reports 20/day, meetups 30/h per user and 100 per user per crew (`meetups_insert_limits`, profile-JWT inserts only), invite guessing: 11th wrong code per account in an hour refused, and once 200 wrong codes land project-wide in the last hour (`join_group:global`, counted without a lock) profiles younger than 7 days cannot guess and older ones get 3 failures an hour; demo login 20/h per IP and 30/h global. Residual risk: 6-character codes (32^6) never expire; 8 characters or a TTL on `invite_code_rotated_at` is a v1.1 option (needs mobile input and contract changes) | `private.check_rate_limit` (advisory lock per key) | rls.sql I (I37–I41), G21–G24, K, M; `supabase/functions/demo-login/handler_test.ts` |
| Only published festivals visible; catalog read-only | RLS on festivals/stages/sets; draft-by-default; `festivals_published_requires_source` | rls.sql B |
| Migrations safe on a dirty hosted database and idempotent | 006–011 | `npm run db:test` (dirty fixture, re-apply of 007–011, partial-history scenarios) |
| No `storage.*` DDL/DML in migrations except the isolated 008 | `scripts/db-test.sh` guard | `npm run db:test` |

## 3. Storage

| Control | Implementation | Tests |
|---|---|---|
| Private `totems` bucket, 5 MiB, `image/jpeg` only | 008 | rls.sql L |
| Restrictive guard: read only as a member of the folder's crew who has no block in either direction with the meetup's creator or the uploader (`private.can_view_totem`); upload only for your own meetup in that crew, at most 5 objects per meetup folder (`private.can_upload_totem`); delete by owner or crew admin unless an open or reviewed photo report points at the object (`private.is_reported_totem`, so evidence survives until moderation); no updates; `upsert: false` | 008 policies | rls.sql L (L10a, L10b, L15a–L15c), J6a, J8a, J8b |
| Reads only via 1-hour signed URLs | `getTotemSignedUrl` in `packages/data-access/src/media.ts` | `packages/data-access/test/meetups-totems.test.ts` |
| Metadata stripped before upload (EXIF via piexif plus XMP/IPTC/comment segments) | `stripJpegMetadata` | `packages/data-access/test/groups-schedule.test.ts` |
| Storage schema not exposed through the API | `[api] schemas = ["public", "graphql_public"]` in `supabase/config.toml` (applied with `supabase config push`) | Manual check, runbook §2.8 |

## 4. Edge functions

| Control | Implementation | Tests |
|---|---|---|
| `delete-account`: JWT verified by the gateway and by the function; idempotent; storage removed in batches ≤ 1000 before the auth user; retryable 500 on partial failure; no PII in logs | `supabase/functions/delete-account/handler.ts` | `delete-account/handler_test.ts`, `_shared/chunk_test.ts` |
| `demo-login`: off (404) unless both secrets are valid; constant-time digest comparison of email and code; identical 401 for wrong email, wrong code or a full global cap (no enumeration); per-IP and global limits; spoofed X-Forwarded-For prefixes ignored | `supabase/functions/demo-login/handler.ts`, `_shared/crypto.ts`, `_shared/http.ts` | `demo-login/handler_test.ts`, `_shared/crypto_test.ts`, `_shared/http_test.ts`; the platform's header shape is verified once on hosted ([`../release-runbook.md`](../release-runbook.md) §2.11) |
| Method checks, JSON body size cap, no CORS (native clients only) | `_shared/http.ts` | `_shared/http_test.ts` |
| Retired functions (`request-otp`, `verify-otp`, `create_group_invite`, `join_group_from_invite`, `upload_totem_photo`) removed from the repo and from hosted | runbook §2.10 | Manual |

## 5. Authentication and sessions

- Email one-time codes only (8 digits, 10-minute expiry, `token_verifications = 30` per 5 minutes per IP), no
  links in emails (`supabase/config.toml`, `supabase/templates/`). The email provider still accepts a
  password on `/signup` server-side, so email confirmations are on (such a signup gets no session until the
  mailbox is proven) and the custom access token hook (`public.custom_access_token_hook` in 007, enabled
  under `[auth.hook.custom_access_token]`) refuses every token requested with a password (rls.sql M13–M15;
  the hook and confirmations are enabled on hosted per runbook §2.8). At most one code email
  per address per 60 seconds (`[auth.email] max_frequency`, verified on the hosted project in runbook
  §2.8) and 200 emails per hour project-wide (`email_sent`). That budget is shared by the whole project:
  until sign-in sends a CAPTCHA token (a Turnstile `[auth.captcha]` block is ready, commented out, in
  `supabase/config.toml`), one client rotating addresses can use it up and stop code emails for everyone
  for the rest of the hour. Known gap; runbook §2.7 and §9 cover sizing and detection.
- Refresh-token rotation on; access tokens expire after 3600 s. A ban takes effect at once even for
  tokens already issued: `private.is_banned()` makes `current_app_user_id()` null and `require_profile`
  raise `not_authenticated` while `auth.users.banned_until` is in the future (rls.sql P2–P5).
- Session in MMKV inside the app sandbox (iOS data protection; no extra app-level encryption). Sign-out
  and deletion remove it directly, even if the server call fails (`packages/data-access/test/signout-race.test.ts`).
- Writes are never sent without a user JWT (prevents anon-key requests being misread as permission
  errors); offline-safe routing uses only the stored session (`session-auth.test.ts`).
- Captive portals or proxy error pages during token refresh are treated as network errors, so the user
  is not signed out (`captive-portal.test.ts`).
- Switching accounts on one device wipes the previous account's local data before anything is shown or
  sent (`local-owner.test.ts`), and the sync engine sends the offline queue only under a session of the
  account that owns it (`app_meta.local_owner_auth_user_id`), stopping mid-pass if the account changes
  (`packages/sync-engine/test/sync-service.test.ts`).
- Sync errors are classified (transient vs permanent) so permission failures are never retried forever
  (`packages/sync-engine/test/classify.test.ts`). Only a 4xx carrying a PostgREST/Postgres error code is
  permanent; a codeless 4xx or a response that is not PostgREST-shaped (a captive-portal or proxy page,
  even with status 200) is a connectivity failure, so the write is kept and retried rather than dropped or
  marked synced (`packages/data-access/test/transport.test.ts`).

## 6. Mobile platform

- Permissions: When-In-Use location only (no background, no Always), camera and photos only on use,
  microphone disabled; Android blocks background location, audio and broad storage permissions
  (`apps/mobile/app.json`).
- Mapbox telemetry off (`Mapbox.setTelemetryEnabled(false)`); on iOS `@rnmapbox/maps` 10.3.0 writes the
  `MGLMapboxMetricsEnabled` default, which Mapbox Maps SDK 11.18.2 observes and applies
  ([`EventsManager.swift` at v11.18.2](https://github.com/mapbox/mapbox-maps-ios/blob/v11.18.2/Sources/MapboxMaps/Foundation/Events/EventsManager.swift)); turnstile and map-load billing events continue
  ([mapbox-maps-ios#1964](https://github.com/mapbox/mapbox-maps-ios/issues/1964)). The traffic check in runbook §5.4 step 4 confirms it on each release
  build; re-read the SDK source when its version changes. A user can opt in from the map's (i) attribution
  menu ("Mapbox Telemetry"); that lasts until the next launch, which turns telemetry off again, and is
  disclosed in the privacy policy and App Privacy answers. No analytics or advertising SDKs; no tracking.
- Release builds: `ITSAppUsesNonExemptEncryption = false` (TLS only); privacy manifest in `app.json`.
- Custom URL scheme `festivalapp://` only for invite deep links; invite codes are stored and pre-filled,
  never auto-joined.

## 7. Operations

- Admin actions run locally with the service-role key (`apps/admin-tools`), with `--dry-run` for every
  write; no hosted admin service.
- Moderation: reports reviewed daily within 24 hours; bans via `users:ban`: Auth ban, then
  `prepare_account_ban` removes the user from every crew, gives those crews new invite codes, deletes the
  user's meetups and location rows and returns their photo paths, which the command removes from storage
  (rls.sql P6–P12; `apps/admin-tools/test/ban.test.ts`).
- Backups before every schema change; Security Advisor checked after migrations (runbook §2.2, §2.6).

## 8. Known limitations

- `supabase/tests/rls.sql` runs against a pgTAP-compatible shim in `npm run db:test`, not the real pgTAP
  extension, and the Supabase platform is emulated by `supabase/tests/local/supabase-stubs.sql`. Hosted
  behaviour of pg_cron and storage permissions is verified manually (runbook §2.6).
- The X-Forwarded-For shape on hosted Supabase must be confirmed once (runbook §2.11).
- `supabase config push` fills keys missing from `config.toml` with CLI template values; the runbook
  (§2.8) requires `max_frequency = "60s"` and lists the full expected diff so the per-user email interval
  is never pushed as 1 s.
- Supabase Auth writes sign-in audit entries (email, IP) to `auth.audit_log_entries`, which account
  deletion does not touch; retention is bounded by turning database audit logging off and a 90-day purge
  job (runbook §2.8).
- A totem photo can outlive its meetup if the app is killed between the database change and the storage
  removal; it stays readable only to that crew's members and is removed by `storage:sweep-orphans`.
- The anon key and Mapbox token are extractable from the app by design; their abuse is bounded by RLS,
  rate limits and Mapbox token scopes.
