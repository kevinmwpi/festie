# Festie release runbook: from this repo to App Store submission

The single, ordered path from a green checkout to an App Store submission, written to be followed top to
bottom and copied from. It replaces the old `native-beta-release.md` and `supabase-operations.md`.

- Contract: [`v1-architecture.md`](./v1-architecture.md) (rev 2.1).
- Festival data, demo content, moderation commands: [`festival-data.md`](./festival-data.md) (linked, not
  repeated here).
- Device QA: [`qa-checklist.md`](./qa-checklist.md). App Privacy answers: [`app-store-privacy.md`](./app-store-privacy.md).
  App Review notes: [`app-review-notes.md`](./app-review-notes.md).

Commands run from the repository root unless a step says `cd apps/mobile`. `<ref>` is the Supabase project
ref (`lzxewkfxdibohzqbqmiu` for the existing project `kevins_project`). Anything written
`__LIKE_THIS__` is a decision only you can make; §7.1 lists them all.

The order matters: the build you submit (§5) must come after the key rotation (§2.3) and the legal pages
(§4), because it embeds the anon key, the in-app legal screens and the hosted URLs.

---

## 1. Before you start

### 1.1 Tools and accounts

- Node 20 (`.nvmrc` pins 20.19.4) and npm 10; `npm ci` once.
- Supabase CLI: use the pinned one with `npx supabase …` (root devDependency). `npx supabase login` once.
- EAS CLI: `npx eas-cli@latest …` (or `npm i -g eas-cli`), logged in as the Expo account that owns the
  project (`owner: kevinppi`, project id in `apps/mobile/app.json`).
- Apple Developer Program membership with access to App Store Connect app id `6761392490`
  (team `Z94VZGABD8`, see `apps/mobile/eas.json`).
- A Mapbox account (public token), a transactional email provider for SMTP (§2.7), and somewhere to host
  three static pages (§4).
- Optional for backups: Docker (for `supabase db dump`) or a local `pg_dump` matching the server's major
  version.

### 1.2 Local admin credentials (never committed)

Admin commands (`npm run admin -- …`) run on your machine with the service-role key. Keep it in the root
`.env`, which `.gitignore` already excludes:

```sh
# .env (repository root) — never commit, never copy into apps/mobile or any EXPO_PUBLIC_* variable
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SECRET_KEY=<Project Settings → API Keys → secret key (or the legacy service_role key)>
```

The CLI does not read `.env` by itself; load it into the current shell when you need it:

```sh
set -a; . ./.env; set +a
npm run admin -- help
```

`git status` must never show `.env`. `apps/admin-tools` also accepts `SUPABASE_SERVICE_ROLE_KEY`.

### 1.3 Green gates

All of these must pass on the commit you release (CI runs them too, see `.github/workflows/ci.yml`):

```sh
npm run build
npm run lint
npm run test
npm run db:test
(cd supabase/functions && deno check */index.ts && deno test && deno lint)
node docs/legal/generate.mjs --check
(cd apps/mobile && EXPO_PUBLIC_SUPABASE_URL=https://example.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=dummy \
  npx expo export --platform ios --output-dir /tmp/festie-export) && rm -rf /tmp/festie-export
```

Never run `deno` against `supabase/` from the repo root without `--config` (it writes a stray root
`deno.lock`).

---

## 2. Supabase

### 2.1 Restore the paused project (or create a new one)

1. Supabase dashboard → project **kevins_project** (`lzxewkfxdibohzqbqmiu`) → **Restore project**. Wait until
   it reports healthy.
2. If the dashboard no longer offers a restore (Supabase limits how long a paused free project can be
   restored), download its last backup from the same page and create a **new project** instead:
   - Pick the region you will name in the privacy policy (`__SUPABASE_REGION__`) and a strong database
     password (store it in your password manager).
   - Use its ref as `<ref>` everywhere below. A fresh project gets all migrations 001–014 in §2.5.
   - Update `EXPO_PUBLIC_SUPABASE_URL` in **both** the `preview` and `production` profiles of
     `apps/mobile/eas.json` (they pin `https://lzxewkfxdibohzqbqmiu.supabase.co`) and in your EAS
     environment variables (§5.1).
3. A released app needs a project that never pauses. Free-plan projects are paused after a period of
   inactivity; move the production project to a paid plan before launch.

### 2.2 Take a backup

Before changing anything on an existing project, save a copy **outside the repository**:

```sh
mkdir -p ~/festie-backups
npx supabase link --project-ref <ref>      # asks for the database password
npx supabase db dump --linked -f ~/festie-backups/$(date +%F)-schema.sql             # needs Docker
npx supabase db dump --linked --data-only -f ~/festie-backups/$(date +%F)-data.sql
```

Without Docker, use `pg_dump` with the session-pooler connection string from the dashboard's **Connect**
dialog: `pg_dump "<connection string>" -Fc -f ~/festie-backups/$(date +%F).dump`. Storage files (the
`totems` bucket) are not in a database dump; there are only demo photos so far. Paid plans also keep
daily backups (Database → Backups).

These dumps contain personal data (emails, profiles, sign-in logs). Keep them encrypted at rest (for
example on an encrypted disk), never share them, and delete each one once the release it protected is
verified, at the latest after 30 days: the privacy policy (§5) says deleted data survives only in backups
"until they expire".

### 2.3 Retire Railway and rotate the service-role key

Do this now, before the edge functions (§2.10) and long before the build (§5): rotating a legacy key also
replaces the anon key that the build embeds.

Railway is no longer part of Festie. The `@festival/mobile` service only ran the Expo development server
and served no purpose; the `admin-tools` service held the Supabase service-role key. Admin commands now
run locally (§1.2, §8.1).

1. Railway dashboard → the Festie project → each service (`@festival/mobile`, `admin-tools`) →
   Settings → **Delete service**. Then delete the project if nothing else is in it.
2. Treat the service-role key that was stored there as exposed and rotate it:
   - With Supabase's API keys: Project Settings → API Keys → create a new **secret key**, put it in your
     local `.env` (§1.2), then delete the old secret key. The anon / publishable key is unchanged.
   - If the project still uses the legacy JWT `service_role` key, it can only be rotated together with
     the anon key (by rotating the JWT secret, or by moving to the new API keys and disabling the legacy
     ones). That invalidates the anon key in every existing build, which is why it happens before §5.
     Put the new secret key in `.env` and use the new anon / publishable key in §5.1.
   Edge functions need no change for either route: Supabase injects the new secret keys as
   `SUPABASE_SECRET_KEYS` (a JSON map; the functions use its `default` entry) and the legacy key as
   `SUPABASE_SERVICE_ROLE_KEY`, and `supabase/functions/_shared/supabase.ts` prefers the secret key and
   falls back to the legacy one. Prefer the new-keys route: create a secret key for `.env` and use the
   **publishable** key as `EXPO_PUBLIC_SUPABASE_ANON_KEY` in §5.1. After disabling the legacy keys,
   redeploy the functions (§2.10), re-run the §2.10 demo-login smoke test and run one real Settings →
   Delete account on a throwaway account.
3. Check that no other place (CI secrets, old `.env` files, notes) still holds the old key.

### 2.4 Link and inspect the migration history

```sh
npx supabase link --project-ref <ref>
npx supabase migration list
```

- **Expected for the existing project:** `001`–`010` are listed as applied remotely; `011`–`014` only
  locally. Continue with §2.5.
- **Remote shows versions that do not exist locally** (made in the dashboard): `db push` refuses to run.
  Inspect them; if their effect is covered by 006–014 (they are idempotent and repair dashboard edits),
  mark them reverted: `npx supabase migration repair --status reverted <version>`.
- **Remote history is empty but the tables exist** (SQL was pasted in the dashboard): after checking that
  `public.festivals`, `public.groups` and the rate-limit table from 005 exist, record 001–005 as applied:
  `npx supabase migration repair --status applied 001 002 003 004 005`.
- **New project:** the remote column is empty and all fourteen migrations (001–014) will be applied.

**History — done, skip on `kevins_project`:** the block below was run in October 2026; the project now
has 001–010 applied and §2.5 only adds 011–014.

**`kevins_project` (`lzxewkfxdibohzqbqmiu`) as inspected on 2026-10-06:** the remote history holds only
three dashboard-made versions (`20260328045611` auth trigger + invite lookup policy, `20260329180317`
user_festivals + festival theme, `20260408060752` users RLS fix). The 001–004 tables exist, the 005
rate-limit table (`auth_attempts`) does **not**, and an `on_auth_user_created` trigger on `auth.users`
auto-creates profiles (007 neutralises it). Data is test-only: 1 auth user, 1 profile, the 3 fabricated
festivals (14 stages, 44 artists, 64 sets), no crews, meetups or photos. So, for this project:

```sh
npx supabase migration repair --status reverted 20260328045611 20260329180317 20260408060752
npx supabase migration repair --status applied 001 002 003 004   # NOT 005: its table is missing
npx supabase db push --dry-run      # listed exactly 005, 006, 007, 008, 009, 010 at the time (011 did not exist yet)
npx supabase db push
```

(The Supabase MCP connector cannot do this unattended: it holds every destructive statement for an
interactive approval, and these migrations are full of them.)

### 2.5 Apply migrations 006–014

```sh
npx supabase db push --dry-run      # lists the migrations not applied yet, in order (011–014 on the existing project, 001–014 on a new one)
npx supabase db push
```

- **011 (set status) goes in before any app build that selects the new `sets` columns** (every build from
  the schedule-changes release on): a newer app against a database without 011 cannot download festival
  data. Older builds keep working after 011. Then re-seed a festival to publish moved or cancelled sets
  (`docs/festival-data.md` §4.1).
- **012 (image credits, festival suggestions) and 013 (artwork bucket) go in before any app build that
  shows photo credits or the Suggest-a-festival form**: the app selects the new `artists`/`festivals`
  columns and calls `suggest_festival`. 012 clears the `image_url` of any legacy row without a licence or
  with a non-https URL (re-seed it with a credit). 013 holds only `storage.*` statements, like 008.
- **014 (festival lineup) goes in before any app build that shows "set times to be announced"**: the app
  selects `festival_artists` with every festival bundle, and a newer build against a database without 014
  cannot download festival data (it keeps what it cached), exactly like 011. 014 backfills the lineup of
  every existing festival from its sets; `festival:seed` and `demo:seed` refuse to run against a project
  without it. Older builds ignore the table.

- 006 is idempotent; 007 is idempotent and safe on a database with dashboard edits or only one of the two
  historical `005` files. **The CLI does not wrap a migration file in a transaction** (it prints
  `SET LOCAL can only be used in transaction blocks`), so a failure can leave earlier statements of that
  file applied. 006–014 are idempotent, so after fixing the cause simply re-run `db push`. A failed 005
  rolls back cleanly only if it fails at its first statement; otherwise inspect before re-running.
- 007 sets `lock_timeout = '5s'`. If it fails with a lock timeout, run it again at a quiet moment.
- **After any re-run of 007, re-run 012 and 014 before anything else:** 007 revokes execute on every
  `public` function (012 re-grants `suggest_festival`) and drops every `public` policy and the table
  grants of anon/authenticated (014 re-creates `festival_artists_select_published` and its grant); until
  then every festival bundle download fails with 42501 on `festival_artists`.
- 008 and 013 hold all `storage.*` statements so a hosted storage-permission problem cannot roll back 007
  or 012. If only 008 or 013 fails, fix the reported permission problem and re-run `db push`.
- 007 resets every non-demo festival without a `source_url` to `draft` and deletes all live location rows.

### 2.6 Verify the database

In the dashboard SQL editor:

```sql
select jobname, schedule, command from cron.job order by jobname;
-- expect: purge-rate-limit-events  17 * * * *    select public.purge_rate_limit_events()
--         purge-stale-locations    */5 * * * *   select public.purge_stale_locations()
--         refresh-demo-crew        */5 * * * *   select private.refresh_demo_crew()

select id, public, file_size_limit, allowed_mime_types from storage.buckets where id in ('totems', 'artwork') order by id;
-- expect: artwork | true  | 2097152 | {image/jpeg,image/png,image/webp}
--         totems  | false | 5242880 | {image/jpeg}

select count(*) as moderation_terms from public.moderation_terms;     -- > 0 (009)
select status, count(*) from public.sets group by status;               -- runs without error (011)
select status, count(*) from public.festival_suggestions group by status; -- runs without error (012)
select count(*) as lineup_rows, count(distinct festival_id) as festivals_with_lineup
  from public.festival_artists;                                         -- ≥ the festivals that have sets (014 backfill)
select count(*) as images_without_licence from public.artists
  where image_url is not null and image_license is null;                -- expect 0 (012)
select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'artwork%' order by 1;
-- expect: artwork_no_client_delete, artwork_no_client_insert, artwork_no_client_update, artwork_select_public (013)
select name, status, is_demo, source_url from public.festivals order by name;
```

If `cron.job` is missing or empty, enable **pg_cron** (Database → Extensions) and run the block from
[`v1-architecture.md`](./v1-architecture.md) §2.7 in the SQL editor, plus
`select cron.schedule('refresh-demo-crew', '*/5 * * * *', 'select private.refresh_demo_crew()');`
(the full block is section 11 of `supabase/migrations/007_v1_security_overhaul.sql`). Without that job the
demo crew still refreshes whenever the reviewer's map polls it. Retention does not depend on cron
alone (the location RPCs purge too), but rate-limit records are only purged by the job.

Then open **Advisors → Security Advisor**, click **Refresh** and resolve every **error** (for example a
table with RLS disabled or a policy that exposes data). Review each warning; anything about the
`public`/`private` functions, RLS or storage must be explained by the contract or fixed.

### 2.7 Custom SMTP (required)

Supabase's built-in email service only delivers to members of the project's team and is heavily rate
limited, so App Review and real users would never receive a code. Configure your own SMTP **before**
§2.8 (the raised email rate limit needs it):

1. Transactional email provider: **Resend** (named in the privacy policy; changing provider means updating the policy). Resend needs a domain you own to send from.
2. Verify a sending domain with the provider and publish the DNS records it gives you: SPF, DKIM and a
   DMARC policy. Wait until the provider shows the domain as verified.
3. Create SMTP credentials at the provider.
4. Supabase dashboard → **Authentication → Emails → SMTP Settings** → enable custom SMTP:
   sender email `no-reply@<your domain>`, sender name `Festie`, host, port (587 with STARTTLS, or 465),
   username, password. Save.
5. After §2.8, request a code for an address outside your Supabase team from a development or preview
   build and check that it arrives in the inbox, not spam.
6. Size the SMTP plan for the expected peak of sign-ins. `email_sent = 200` (§2.8) is one budget for
   the whole project per hour, not per user: until sign-in sends a CAPTCHA token (the `[auth.captcha]`
   block in `supabase/config.toml` stays commented out until the app does), one client rotating
   addresses can use it up and block every sign-in for the rest of the hour (a known gap,
   [`legal/security-audit.md`](./legal/security-audit.md)).

### 2.8 Push the auth/API configuration

`supabase/config.toml` holds the reviewed settings: exposed API schemas `public, graphql_public` (no
`storage`), email sign-up with 8-digit codes valid for 10 minutes, the two code-only email templates in
`supabase/templates/`, email confirmations on, the custom access token hook
(`public.custom_access_token_hook` from migration 007, which refuses every token requested with a
password), rate limits (`email_sent = 200`, `token_verifications = 30`), refresh-token rotation,
anonymous sign-ins off, `site_url` placeholder (codes are typed, so no email links to it), redirect URL
`festivalapp://`, storage file size limit 5 MiB.

**Check before pushing.** `config push` sends the whole auth configuration, and every key that
`config.toml` leaves out is filled in from the CLI's built-in template, not from the hosted value. Two
template values differ from the hosted defaults in a way that matters:

- `[auth.email] max_frequency` (the minimum interval between emails to one address). The template value
  is `"1s"`; the hosted default is 60 seconds. At 1 s anyone can send sign-in code emails to one address
  back to back, flooding that person and using up the project's hourly email limit (which also locks
  App Review out of sign-in). `config.toml` must contain `max_frequency = "60s"` under `[auth.email]`
  (60 s also matches the app's "Resend code" timer). If it does not, add that line before you push.
- `[auth.mfa.totp] enroll_enabled` / `verify_enabled`: the template turns TOTP multi-factor off. Festie
  has no MFA screens, so turning it off is harmless and expected.

```sh
grep -n 'max_frequency' supabase/config.toml   # must show max_frequency = "60s" in the [auth.email] block
npx supabase config push
```

The CLI prints the differences between the hosted project and `config.toml` and asks for confirmation.
The diff may contain only these changes (any of them may be absent if the hosted value already matches):

| Area | Expected changes |
|---|---|
| API | exposed schemas `public, graphql_public` (`storage` removed), `extra_search_path`, `max_rows = 1000` |
| Auth general | `site_url`, redirect URLs `festivalapp://`, JWT expiry 3600, refresh-token rotation on with reuse interval **30** (hosted default is 10; the app's 10 s refresh timeout relies on 30 so a retry after a lost response is accepted), sign-ups on, anonymous sign-ins off, manual linking off |
| Auth email | email sign-up on, confirmations **on** (no autoconfirm), secure email change on, OTP length 8, OTP expiry 600, `smtp_max_frequency` 60 s (never 1 s), both templates with the subject "Your Festie sign-in code" |
| Auth rate limits | `email_sent` 200, `token_verifications` 30; `sign_in_sign_ups`, `token_refresh`, `anonymous_users`, `sms_sent`, `web3` at the template values (30, 150, 30, 30, 30), which match the hosted defaults |
| Auth hooks | Customize Access Token (JWT) Claims on, Postgres function `public.custom_access_token_hook` |
| Auth MFA, phone, providers | TOTP enroll/verify off; phone sign-up, phone MFA and every external, Web3 and third-party provider off |
| Storage | file size limit 5 MiB |

Answer **no** if the diff shows `smtp_max_frequency` (or the per-user email interval) at 1 s, changes the
custom SMTP settings from §2.7 (`config.toml` has no `[auth.email.smtp]` block, so it should not touch
them), turns on anything other than the confirmations and the access token hook in the table, or
touches a setting not in the table. Apply migrations 006–014 (§2.5) first: the hook names a function
that 007 creates. Then either fix `config.toml` (add the
missing key with the hosted value you want to keep) and run the push again, or skip `config push` entirely
and set the values in the table by hand in the dashboard (Authentication → Sign In / Providers, Emails,
Rate Limits, Multi-Factor, Hooks; Project Settings → Data API; Storage → Settings) and copy the two
templates from `supabase/templates/` into Authentication → Emails → Templates.

Afterwards check in the dashboard:

- Authentication → Emails → Templates: "Magic Link" and "Confirm signup" both show the Festie code
  template with the subject "Your Festie sign-in code".
- Authentication → Sign In / Providers → Email: OTP length 8, expiry 600 seconds.
- Authentication → Emails → SMTP Settings: custom SMTP is still enabled with your provider (§2.7), and
  (here or under Rate Limits) the minimum interval between emails to the same user is **60 seconds**. From
  a development build, request a code for one address, tap "Use a different email" and request a code for
  the same address again within a few seconds: the app shows an error and no second email arrives. After
  60 seconds "Resend code" sends a new one.
- Project Settings → Data API: exposed schemas `public` and `graphql_public` only.
- Authentication → Sign In / Providers → Email: "Confirm email" is **on**.
- Authentication → Hooks: "Customize Access Token (JWT) Claims" is enabled with the Postgres function
  `public.custom_access_token_hook` (add it there if `config push` did not). Then prove passwords never
  yield a session, with the anon key from Project Settings → API (use a throwaway address you control):

  ```sh
  curl -s -X POST "https://<ref>.supabase.co/auth/v1/signup" -H "apikey: <anon key>" \
    -H "Content-Type: application/json" -d '{"email":"<throwaway address>","password":"Festie-test-123"}'
  # expected: a user object with no access_token (confirmation pending)
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "https://<ref>.supabase.co/auth/v1/token?grant_type=password" \
    -H "apikey: <anon key>" -H "Content-Type: application/json" \
    -d '{"email":"<throwaway address>","password":"Festie-test-123"}'
  # expected: 400 (email not confirmed) now; after you confirm that address with the emailed code in the
  # app, run it again: expected 403 from the hook, never 200
  ```

  Then sign in normally with an emailed code on a development build: it must still work (the hook passes
  code sign-ins and token refreshes through). Delete the throwaway user afterwards (Authentication → Users).

**Sign-in audit log retention (privacy policy §5: at most 90 days).** Supabase Auth logs every sign-in,
code request, token refresh, sign-out and account deletion with the email address and IP address. By
default it writes them both to Supabase's log storage and to the `auth.audit_log_entries` table in your
own database, where nothing deletes them (they have no link to `auth.users`, so deleting an account does
not remove them either).

1. Authentication → **Audit Logs** (under Configuration) → turn **on** "Disable writing auth audit logs
   to project database". The events stay visible in the dashboard's Auth logs, which Supabase keeps for
   your plan's log retention period. If your plan does not offer the setting, step 3 alone keeps the
   promise.
2. Check the plan's log retention (Organization → Billing, or Supabase's pricing page). The privacy
   policy promises at most 90 days for sign-in and server logs; if the plan keeps logs longer, change
   every "90 days" in privacy policy §5 and §6 and in
   [`legal/data-compliance.md`](./legal/data-compliance.md) before you generate the legal pages (§4).
3. In the SQL editor, delete old rows and schedule the same purge daily. This removes entries written
   before step 1 and keeps the promise if the setting is ever turned back on. Safe to re-run
   (`cron.schedule` with an existing name updates that job):

   ```sql
   delete from auth.audit_log_entries where created_at < now() - interval '90 days';
   select cron.schedule('purge-auth-audit-log', '43 3 * * *',
     $$delete from auth.audit_log_entries where created_at < now() - interval '90 days'$$);
   select jobname, schedule, command from cron.job where jobname = 'purge-auth-audit-log';
   ```

   If the `delete` fails with a permission error, do not schedule the job; keep step 1 on and ask
   Supabase support to remove `auth.audit_log_entries` rows older than 90 days.

The job lives outside the migrations (like the report trigger in §2.12): `db push` leaves it alone. To
remove it: `select cron.unschedule('purge-auth-audit-log');`.

### 2.9 Delete the legacy fabricated festivals

Old builds seeded fabricated "Coachella 2026", "Lollapalooza 2026" and "Sunstream Festival" schedules.
Migration 007 already hid them (draft); delete them for good. Run step 1, check that it returns only these
three rows, then run step 2. Both are safe to re-run.

```sql
-- Step 1 (read-only): what will be deleted, and what hangs off it
select f.id, f.name, f.status, f.is_demo, f.source_url,
       (select count(*) from public.groups g where g.festival_id = f.id) as crews,
       (select count(*) from public.group_members m join public.groups g on g.id = m.group_id where g.festival_id = f.id) as crew_memberships,
       (select count(*) from public.user_festivals uf where uf.festival_id = f.id) as followers,
       (select count(*) from public.user_set_selections s where s.festival_id = f.id) as picks
from public.festivals f
where f.is_demo = false
  and f.source_url is null
  and (f.id in ('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
                'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
                '11111111-1111-4111-8111-111111111111')
       or f.name ~* '(coachella|lollapalooza|sunstream)');
```

```sql
-- Step 2: delete them in one transaction
begin;

create temporary table legacy_festivals on commit drop as
select f.id
from public.festivals f
where f.is_demo = false
  and f.source_url is null
  and (f.id in ('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
                'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
                '11111111-1111-4111-8111-111111111111')
       or f.name ~* '(coachella|lollapalooza|sunstream)');

-- Picks and crews reference festivals without ON DELETE CASCADE, so remove them first.
delete from public.user_set_selections where festival_id in (select id from legacy_festivals);
-- Meetups in other crews pinned to a legacy stage keep the meetup and lose the pin.
update public.meetups set stage_id = null
where stage_id in (select s.id from public.stages s where s.festival_id in (select id from legacy_festivals));
-- Crews on legacy festivals (cascades to their memberships, meetups and locations).
delete from public.groups where festival_id in (select id from legacy_festivals);
-- The festivals themselves (cascades to stages, sets and follows).
delete from public.festivals where id in (select id from legacy_festivals);
-- Artists that no remaining set refers to.
-- Artists still billed somewhere (a set, or a lineup row of festival_artists, 014) stay.
delete from public.artists a
where not exists (select 1 from public.sets s where s.artist_id = a.id)
  and not exists (select 1 from public.festival_artists fa where fa.artist_id = a.id);

commit;
```

This SQL was run against a database built from migrations 001–009 with crews, picks, follows, cross-crew
stage pins and reports on the legacy festivals (all removed or detached as intended, re-run is a no-op).
Totem photos of deleted crews become orphans; remove them 24 hours later with
`npm run admin -- storage:sweep-orphans` (§3.2).

### 2.10 Edge functions: remove legacy ones, set secrets, deploy

1. Remove the functions the v1 contract retired (they may still be deployed and callable):

   ```sh
   npx supabase functions list
   for fn in request-otp verify-otp create_group_invite join_group_from_invite upload_totem_photo; do
     npx supabase functions delete "$fn"
   done
   ```

   (A "not found" for one of them is fine.)

2. Demo login secrets for App Review. The code must be **8 digits** to match `otp_length = 8` (the
   function accepts 8–10, the app's code boxes hold 8). Use a mailbox you control for the email: the app
   also asks Supabase to email a normal code to it every time the reviewer signs in. Write them to a file
   **outside the repo** so they stay out of shell history, then delete it:

   ```sh
   node -e "console.log(require('crypto').randomInt(0, 1e8).toString().padStart(8, '0'))"   # a random code
   cat > ~/festie-demo.env <<'EOF'
   DEMO_LOGIN_EMAIL=__DEMO_LOGIN_EMAIL__
   DEMO_LOGIN_CODE=__DEMO_LOGIN_CODE__
   EOF
   npx supabase secrets set --env-file ~/festie-demo.env && rm ~/festie-demo.env
   npx supabase secrets list      # shows the names (digests only)
   ```

   `SUPABASE_URL` and the server key (`SUPABASE_SECRET_KEYS`, or the legacy `SUPABASE_SERVICE_ROLE_KEY`;
   see §2.3) are provided to functions by Supabase automatically.
   Unsetting either demo secret (or an invalid code) turns demo login off: the function then answers 404.

3. Deploy both functions (`verify_jwt` comes from `supabase/config.toml`: on for `delete-account`, off for
   `demo-login`):

   ```sh
   npm run supabase:functions:deploy
   ```

   If the CLI reports that Docker is not running, deploy each function with server-side bundling instead:
   `npx supabase functions deploy delete-account --use-api` and the same for `demo-login`.

4. Smoke test (expect HTTP 401 and `{"error":"invalid_code"}`; 404 means the secrets are missing or
   invalid):

   ```sh
   curl -s -X POST "https://<ref>.supabase.co/functions/v1/demo-login" \
     -H "Content-Type: application/json" -H "apikey: <anon key>" \
     -d '{"email":"nobody@example.com","code":"00000000"}' -w '\nHTTP %{http_code}\n'
   ```

### 2.11 Verify the X-Forwarded-For shape once (staging or the production project before launch)

`demo-login` rate-limits per client IP using the **last** `X-Forwarded-For` entry
(`clientIpFromForwardedFor` in `supabase/functions/_shared/http.ts`, used at
`supabase/functions/demo-login/handler.ts:136`). That is only right if Supabase's own proxy appends the
caller's address last. Check it once, without changing code, by reading what the function stored:

```sh
curl -s https://api.ipify.org; echo        # your public IP address
curl -s -X POST "https://<ref>.supabase.co/functions/v1/demo-login" \
  -H "Content-Type: application/json" -H "apikey: <anon key>" \
  -H "X-Forwarded-For: 203.0.113.7" \
  -d '{"email":"nobody@example.com","code":"00000000"}' -o /dev/null -w 'HTTP %{http_code}\n'
```

```sql
select key, created_at from public.rate_limit_events
where key like 'demo-login:ip:%' order by created_at desc limit 5;
```

| Stored key | Meaning | Action |
|---|---|---|
| `demo-login:ip:<your public IP>` | The platform appends the real client last and the forged entry was ignored | Correct; nothing to do |
| `demo-login:ip:203.0.113.7` | The last entry is client-controlled (forgeable) | Change `clientIpFromForwardedFor` to the entry the platform appends (or a platform header such as `cf-connecting-ip` if present) and update [`v1-architecture.md`](./v1-architecture.md) §3 |
| An address that is neither (a Supabase/Cloudflare proxy) | The last entry is a proxy, so every caller shares one per-IP bucket | Use the entry just before the proxy hops (count from the right) in `clientIpFromForwardedFor`, add a test in `_shared/http_test.ts`, update [`v1-architecture.md`](./v1-architecture.md) §3 |
| `demo-login:ip:unknown` | No usable header | Same as the previous row, using whatever header carries the client address |

Code changes here belong to the edge-function owner (`supabase/functions/**`); redeploy after changing.
The test rows expire after 24 hours.

### 2.12 Get an email for every new report

The app promises "we'll review this within 24 hours", so get a notification for each new row in
`public.reports` (the daily `reports:list` in §8.1 remains the authoritative queue). The notification
carries **only the report id, reason and target type**: the reporter, the details and the reported text
stay in Supabase, so the service that receives it is not a processor of personal data and the privacy
policy needs no change. Do not use a dashboard **Database Webhook** for this: it always sends the whole
row (reporter id, details, text snapshot) to the third party.

1. Create an inbound webhook that forwards to your email, at any service that turns an HTTP POST into an
   email (your email provider or an automation service). Note its URL and, if the service can check a
   header, a random shared secret.
2. Supabase dashboard → **Database → Extensions** → enable **pg_net**.
3. In the SQL editor, replace the two `REPLACE_ME` values and run:

   ```sql
   create or replace function private.notify_new_report()
   returns trigger
   language plpgsql
   security definer
   set search_path = ''
   as $$
   begin
     -- Only the report id, reason and target type leave the database.
     perform net.http_post(
       url := 'https://hooks.example.com/REPLACE_ME',
       body := jsonb_build_object(
         'subject', 'New Festie report',
         'text', format('New Festie report %s (%s, %s). Review it: npm run admin -- reports:list',
                        new.id, new.reason, new.target_type),
         'report_id', new.id,
         'reason', new.reason,
         'target_type', new.target_type
       ),
       headers := jsonb_build_object('Content-Type', 'application/json', 'X-Festie-Secret', 'REPLACE_ME'),
       timeout_milliseconds := 5000
     );
     return new;
   exception when others then
     -- A notification problem must never stop a report from being saved.
     return new;
   end
   $$;
   revoke all on function private.notify_new_report() from public;

   drop trigger if exists notify_new_report on public.reports;
   create trigger notify_new_report
     after insert on public.reports
     for each row execute function private.notify_new_report();
   ```

4. Report something from a test account and confirm the email arrives. If it does not, check
   `select status_code, error_msg, created from net._http_response order by created desc limit 5;`
   (pg_net keeps responses for a few hours). A failed notification never blocks the report itself.

This SQL was run against a database built from migrations 001–009: reports save with and without pg_net,
only the three fields are sent, and the trigger survives a re-application of 007. It is managed outside
the migrations: it survives `db push` and appears in `supabase db diff` output, which is expected. To
remove it: `drop trigger notify_new_report on public.reports; drop function private.notify_new_report();`.

### 2.13 End-to-end smoke test on the hosted project

With a development build pointed at the project (not a build you will submit; those come in §5): sign in
with a real email (code arrives through your SMTP, §2.7), set up a profile, follow the demo festival,
create a crew, then delete the account in Settings. Following a festival and creating a crew need a
published festival: if none is published yet (a new project, or the demo festival was never seeded), run
§3.3 first, then come back. The demo sign-in check comes after `demo:seed` in §3.3: until then the demo
account signs in but has no crew (`prepare_demo_account` returns early while the demo content is missing).

---

## 3. Content

### 3.1 At least one real upcoming festival (release gate 7)

Enter and publish at least one real, upcoming festival from its official public schedule, with
`source_url`, following [`festival-data.md`](./festival-data.md) sections 1–4 (CSV import → validate →
seed as draft → check against the source → publish). Then spot-check its times on a physical device
([`qa-checklist.md`](./qa-checklist.md) §7).

### 3.2 Orphaned photo sweep

`npm run admin -- storage:sweep-orphans --dry-run`, review, then run it without `--dry-run`. It deletes
totem photos that no meetup references and that are older than 24 hours (photos left behind when an app
was killed mid-replace, by deleted crews, or by §2.9). It keeps photos that an open or reviewed photo
report points at, even if the uploader replaced them or deleted the meetup, until the report is resolved
(§8.1). Run it weekly and 24 hours after §2.9.

### 3.3 Demo content before every App Review submission

Run after migrations are applied (and again after any re-application of 007), on the project the review
build uses. Pick a start date in the review window (usually the submission day) so "now playing / up next"
is live:

```sh
npm run admin -- festival:shift-dates seed-data/demo-festival.json --start <YYYY-MM-DD> --out /tmp/demo.json
npm run admin -- demo:seed --file /tmp/demo.json --dry-run
npm run admin -- demo:seed --file /tmp/demo.json
```

`demo:seed` must run at least once **after migration 007** on a project that was seeded before it: it adds
the `app_metadata.festie_demo` marker to the demo members and replaces the old guessable invite code;
without it the reviewer logs in to no crew. Details: [`festival-data.md`](./festival-data.md) section 5.
Then sign in once with the demo email and code (§2.10) and check the crew, the meetup photo and the map.
Demo login must work on the project you submit against (release gate 7).

---

## 4. Legal pages: fill in, regenerate, host

Do this before the build (§5): the build embeds the in-app Terms and Privacy screens generated from the
Markdown (the app shows the in-app Terms whenever `EXPO_PUBLIC_TERMS_URL` is unset), and §5.1 needs the
hosted URLs. The pages are generated from `docs/legal/*.md` into `docs/site/` (standalone HTML, no
external assets) and `apps/mobile/app/legal/*.tsx`.

1. Replace every placeholder in `docs/legal/privacy-policy.md`, `terms-of-use.md` and `support.md` (§7.1)
   and set `supportEmail` in `docs/legal/values.json` to the address you will use for
   `EXPO_PUBLIC_SUPPORT_EMAIL`. Leave the `__SUPPORT_EMAIL__` tokens in the Markdown: they are a template
   variable that the generator turns into a tappable `mailto:` link (from `values.json` on the web pages,
   from `EXPO_PUBLIC_SUPPORT_EMAIL` in the app). Then check, regenerate and commit:

   ```sh
   EXPO_PUBLIC_SUPPORT_EMAIL='<support email>' node docs/legal/generate.mjs --release   # fails while anything is left; writes nothing
   node docs/legal/generate.mjs                                                         # rewrites docs/site/*.html and the in-app legal screens
   git add docs/legal docs/site apps/mobile/app/legal && git commit -m "Fill in legal placeholders"
   ```

2. Publish `docs/site/` on any static host:
   - **Cloudflare Workers (what Festie uses, on `joinfestie.com`)**: `wrangler.jsonc` at the repository
     root publishes `docs/site/` as a static-assets Worker named `festie`. Cloudflare dashboard →
     Workers & Pages → Create → import this GitHub repository; project name `festie` (must match `name`
     in `wrangler.jsonc`); build command empty; deploy command `npx wrangler deploy`; preview builds off;
     build variable `SKIP_DEPENDENCY_INSTALL=true` (without it Cloudflare runs `npm ci` and the
     `postinstall` workspace build for nothing); production branch = the branch you release from. Then
     the Worker's Settings → Domains & Routes → add the custom domains `joinfestie.com` and
     `www.joinfestie.com`. The pages are at `https://joinfestie.com/privacy`, `/terms` and `/support`
     (requests for the `.html` paths redirect there).
   - **Any static host that serves just that folder** (Netlify, Cloudflare Pages, S3 + CloudFront, your
     own server): upload the four files in `docs/site/` as they are. This is the cleanest option.
   - **GitHub Pages** (public repository, or a paid GitHub plan for private ones): repository Settings →
     Pages → Build and deployment → Deploy from a branch → your release branch, folder `/docs`. The pages
     are then at `https://<owner>.github.io/<repo>/site/privacy.html`, `…/terms.html`, `…/support.html`.
     This publishes the **whole** `docs/` folder (including this runbook) as a website. Commit an empty
     `docs/.nojekyll` first (`touch docs/.nojekyll`): without it GitHub runs Jekyll, whose Liquid parser
     chokes on the `{{ .Token }}` email-template example in `v1-architecture.md` and the deploy fails.
   - Optional: a custom domain you control, so the URLs survive a change of host.
3. Open each URL on a phone. Use them for `EXPO_PUBLIC_PRIVACY_POLICY_URL`, `EXPO_PUBLIC_SUPPORT_URL`,
   `EXPO_PUBLIC_TERMS_URL` (§5.1) and App Store Connect (§6). They must stay online while the app is
   listed. Changing the legal text later means regenerating, rebuilding the app (the in-app copy) and
   republishing the pages (§9).

---

## 5. Expo / EAS build and TestFlight

Prerequisites: §2.3 (keys rotated, so the anon key you set below stays valid) and §4 (placeholders
replaced, legal screens regenerated and committed, pages hosted). A build made earlier would ship the
`__LEGAL_NAME__`-style placeholders in its in-app Terms, an anon key that §2.3 may invalidate, or no valid
privacy and support URLs. The demo content (§3.3) only has to be fresh at submission time.

### 5.1 EAS environment variables

Set these for both the `preview` and `production` EAS environments (the profiles in
`apps/mobile/eas.json` select them). They are `EXPO_PUBLIC_*` values embedded in the app, so none is
secret; use visibility **plaintext** (or sensitive), never **secret**, because `app.config.ts` must read
them while EAS CLI resolves the config.

| Variable | Required | Value |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | yes | `https://<ref>.supabase.co`. Pinned in `eas.json` for preview/production; change it there if the project changes |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | yes | The project's current anon / publishable key, after §2.3 (alias `EXPO_PUBLIC_SUPABASE_KEY`). Never the secret key |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | yes | `__SUPPORT_EMAIL__` (Settings → Contact support and the in-app legal screens); must equal `supportEmail` in `docs/legal/values.json` (§4) |
| `EXPO_PUBLIC_PRIVACY_POLICY_URL` | yes | `__PRIVACY_POLICY_URL__`, https (hosted `privacy.html`, §4) |
| `EXPO_PUBLIC_SUPPORT_URL` | yes | `__SUPPORT_URL__`, https (hosted `support.html`, §4) |
| `EXPO_PUBLIC_TERMS_URL` | no | Hosted `terms.html`; without it the app shows the in-app Terms screen |
| `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` | yes (preview/production builds refuse to start without a `pk.` token) | Mapbox **public** token (`pk.…`); `sk.` tokens are rejected |

```sh
cd apps/mobile
for env in preview production; do
  npx eas-cli@latest env:set --environment "$env" --visibility plaintext --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value '<anon key>'
  npx eas-cli@latest env:set --environment "$env" --visibility plaintext --name EXPO_PUBLIC_SUPPORT_EMAIL --value 'support@joinfestie.com'
  npx eas-cli@latest env:set --environment "$env" --visibility plaintext --name EXPO_PUBLIC_PRIVACY_POLICY_URL --value 'https://joinfestie.com/privacy'
  npx eas-cli@latest env:set --environment "$env" --visibility plaintext --name EXPO_PUBLIC_SUPPORT_URL --value 'https://joinfestie.com/support'
  npx eas-cli@latest env:set --environment "$env" --visibility plaintext --name EXPO_PUBLIC_TERMS_URL --value 'https://joinfestie.com/terms'
  npx eas-cli@latest env:set --environment "$env" --visibility plaintext --name EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN --value 'pk.…'
done
npx eas-cli@latest env:list --environment production
```

`apps/mobile/app.config.ts` **fails the build** for the `preview` and `production` profiles when
`EXPO_PUBLIC_SUPABASE_URL` (https), the anon key, `EXPO_PUBLIC_SUPPORT_EMAIL` (an email address),
`EXPO_PUBLIC_PRIVACY_POLICY_URL` or `EXPO_PUBLIC_SUPPORT_URL` (https) is missing or malformed, and lists
what is wrong. It also fails those builds while the bundled legal screens (`apps/mobile/app/legal/*.tsx`)
still contain a `__PLACEHOLDER__` token other than `__SUPPORT_EMAIL__` (do §4 first: the same tokens make
`generate.mjs --release` fail), or while any file in `apps/mobile/assets/images/` is still the Expo
template artwork or the icon is not a 1024×1024 PNG without alpha. Development builds never fail; they
show a configuration-error screen instead.

### 5.2 Mapbox

Create a public access token in your Mapbox account (default public scopes are enough) and set it as
`EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`. No secret download token is needed: the installed `@rnmapbox/maps`
10.3.0 podspec marks `RNMapboxMapsDownloadToken` as deprecated and no longer required
(`node_modules/@rnmapbox/maps/rnmapbox-maps.podspec`), and `app.json` pins the native SDK with
`RNMapboxMapsVersion: 11.18.2`. Do not set `RNMAPBOX_MAPS_DOWNLOAD_TOKEN`. The app disables Mapbox
telemetry at every launch (a user can opt in from the map's (i) menu until the next launch; see
[`app-store-privacy.md`](./app-store-privacy.md)). Watch the token's monthly usage in the Mapbox dashboard.

### 5.3 Build and submit

```sh
cd apps/mobile
npx eas-cli@latest build -p ios --profile production
npx eas-cli@latest submit -p ios --profile production --latest
```

The production profile auto-increments the build number (`appVersionSource: remote`) and submits to app
`6761392490`. Use `--profile preview` the same way for TestFlight-only builds (same store distribution,
`preview` environment).

### 5.4 Checks after the first TestFlight upload

1. **ITMS-91053 and other warnings.** App Store Connect emails the account holder after processing. A
   "Missing API declaration" (ITMS-91053) means a required-reason API is used without a reason in the
   privacy manifest: add the category and reason to `ios.privacyManifests` in `apps/mobile/app.json`
   (currently UserDefaults CA92.1, FileTimestamp C617.1, SystemBootTime 35F9.1, DiskSpace E174.1/85F4.1)
   and rebuild. Release gate 7 requires a clean upload.
2. **Info.plist.** Download the `.ipa` from the EAS build page and inspect it:

   ```sh
   unzip -q -o festie.ipa -d /tmp/festie-ipa
   python3 - <<'PY'
   import plistlib, glob
   p = plistlib.load(open(glob.glob('/tmp/festie-ipa/Payload/*.app/Info.plist')[0], 'rb'))
   for k in sorted(p):
       if k.startswith(('NS', 'UIBackground', 'ITSAppUsesNonExempt')):
           print(k, '=', p[k])
   PY
   ```

   Expect `NSLocationWhenInUseUsageDescription`, `NSCameraUsageDescription` and
   `NSPhotoLibraryUsageDescription` with the Festie wording, `ITSAppUsesNonExemptEncryption = False`, and
   **no** `NSLocationAlways…`, `NSMicrophoneUsageDescription` or `location` background mode.
   `NSLocalNetworkUsageDescription` ("Expo Dev Launcher uses the local network…") may be present: the
   `expo-dev-client` config plugin adds it to every profile, but the dev launcher is not compiled into
   release builds, so iOS never shows the prompt. Confirm on a device that no local-network prompt
   appears ([`qa-checklist.md`](./qa-checklist.md) §1). If App Review questions it, exclude
   `expo-dev-client` from production builds (an app-config change for the mobile shell owner).
3. **Privacy manifests and App Privacy.** App Privacy answers must cover the data the SDKs collect. In
   the `.ipa` unzipped above, list what every bundled privacy manifest declares:

   ```sh
   python3 - <<'PY'
   import plistlib, glob
   for f in sorted(glob.glob('/tmp/festie-ipa/Payload/*.app/**/PrivacyInfo.xcprivacy', recursive=True)):
       for t in plistlib.load(open(f, 'rb')).get('NSPrivacyCollectedDataTypes', []):
           print(f.split('.app/')[-1], '|', t.get('NSPrivacyCollectedDataType'), '| linked:',
                 t.get('NSPrivacyCollectedDataTypeLinked'), '| tracking:', t.get('NSPrivacyCollectedDataTypeTracking'),
                 '|', t.get('NSPrivacyCollectedDataTypePurposes'))
   PY
   ```

   (With a local Xcode archive, Organizer → the archive → **Generate Privacy Report** gives the same as a
   PDF.) Every collected type listed must appear in [`app-store-privacy.md`](./app-store-privacy.md) §1
   with matching "linked" and "tracking" answers (a type Festie itself already declares as linked stays
   linked). The Mapbox Maps 11.18.2 manifest declares User ID, Precise Location and Coarse Location, not
   linked, for App Functionality and Analytics (already covered by those rows), and Mapbox may also
   declare a Device ID (already in the Device ID row); if it, or another SDK, declares anything else, add it to that page, the privacy
   policy and [`legal/data-compliance.md`](./legal/data-compliance.md), regenerate (§4) and rebuild
   before you answer App Privacy.
4. **Mapbox telemetry is really off.** The privacy policy (§2) and
   [`app-store-privacy.md`](./app-store-privacy.md) say the map's optional telemetry is off unless the
   user opts in from the map's (i) menu, and that the next launch turns it off again. The app calls
   `Mapbox.setTelemetryEnabled(false)` (`apps/mobile/src/providers/app-providers.tsx`); in `@rnmapbox/maps`
   10.3.0 that writes the `MGLMapboxMetricsEnabled` user default on iOS (`ios/RNMBX/RNMBXModule.swift`),
   and Mapbox Maps SDK 11.18.2 observes that key and applies it to its events collection
   ([`EventsManager.swift` at v11.18.2](https://github.com/mapbox/mapbox-maps-ios/blob/v11.18.2/Sources/MapboxMaps/Foundation/Events/EventsManager.swift)). That is the source, not the build: if
   `RNMapboxMapsVersion` or `@rnmapbox/maps` changed, re-read `EventsManager.swift` at the new tag first.
   A privacy manifest lists declared types, not what the SDK does at run time, so step 3 cannot catch a
   regression. Check the TestFlight build:
   - Route one iPhone through an HTTPS-inspecting proxy on your Mac (Proxyman or Charles: install and
     trust its root certificate on the phone, enable SSL proxying for `*.mapbox.com`).
   - Fresh install, sign in, allow location when sharing asks for it, open the Map tab so your own dot
     shows, and keep the map on screen for 10 minutes, moving around a little. Do not open the map's (i)
     menu during this run: its "Mapbox Telemetry" → "Participate" choice turns telemetry on by design.
   - Expected: style, tile and font requests to `api.mapbox.com`, and to `events.mapbox.com` at most the
     billing events (the turnstile event `appUserTurnstile`, and map-load events, which the opt-out does not
     stop: [mapbox-maps-ios#1964](https://github.com/mapbox/mapbox-maps-ios/issues/1964)). Nothing else: no
     `location` events, no gesture or performance events, no repeated POSTs carrying coordinates.
   - If the proxy cannot decrypt `events.mapbox.com` (certificate pinning), count the requests instead:
     more than a few POSTs to `events.mapbox.com` during the 10 minutes means telemetry is on. Xcode's
     Instruments (Network template) on a development build shows the same connections.
   - **If telemetry is on, do not submit.** Ask the mobile owner to turn it off through the Mapbox SDK's
     own telemetry API (MapboxCommon), rebuild and repeat this check. Only if that is impossible, say in
     the privacy policy §2 and §4, [`app-store-privacy.md`](./app-store-privacy.md) and
     [`legal/data-compliance.md`](./legal/data-compliance.md) that Mapbox telemetry is always on (the
     Location rows already carry the Analytics purpose for the opt-in) before you answer App Privacy.
   - Reset at launch: tap the map's (i) button, "Mapbox Telemetry", "Participate", then close Festie
     completely (swipe it away) and reopen it. With the map on screen for another few minutes,
     `events.mapbox.com` again receives at most the billing events. If location events continue, the
     launch reset no longer works: the privacy policy and App Privacy answers say it does, so do not
     submit until it is fixed or those documents are changed.
   Record the result (build number, date, what `events.mapbox.com` received) in the QA sign-off.
5. **Physical-device QA:** install from TestFlight on two iPhones and complete
   [`qa-checklist.md`](./qa-checklist.md).

---

## 6. App Store Connect

1. **App Information:** name "Festie", subtitle, primary category (`__APP_CATEGORY__`), content rights
   (the app shows third-party festival and artist names as factual information, see
   [`legal/ip-review.md`](./legal/ip-review.md)). Do not put festival or artist trademarks in the name,
   subtitle or keywords.
2. **Privacy Policy URL:** the hosted `privacy.html` (§4).
3. **App Privacy:** answer exactly as [`app-store-privacy.md`](./app-store-privacy.md) §1 says.
4. **Age rating:** answer as [`app-store-privacy.md`](./app-store-privacy.md) §3 says (user-generated
   content and location sharing with other users declared); result 13+ or higher.
5. **Pricing and availability:** free; choose countries. Distributing in the EU requires the Digital
   Services Act trader-status declaration (App Store Connect → Business / app availability); decide
   whether you are a trader (`__DSA_TRADER_STATUS__`).
6. **Version page:** description, keywords, support URL (hosted `support.html`), marketing URL optional,
   screenshots for the iPhone display size App Store Connect requires (currently 6.9-inch); iPad
   screenshots are not needed (`supportsTablet: false`). Use the demo festival or a real festival without
   logos or artwork in screenshots.
7. **App Review Information:** sign-in required → the demo email and 8-digit code; your contact details;
   Notes from [`app-review-notes.md`](./app-review-notes.md).
8. **Build:** select the processed build (no export-compliance question, see
   [`app-store-privacy.md`](./app-store-privacy.md) §4). Choose manual release, then **Submit for Review**.

---

## 7. Pre-submission checklist

### 7.1 Placeholders (all must be replaced; none may ship)

`node docs/legal/generate.mjs --release` is the check for the legal sources: it ignores comments and the
`__SUPPORT_EMAIL__` template variable and fails on anything else, and on an empty or mismatched
`supportEmail`. (A plain `grep` for `__…__` tokens cannot come back clean: the generator, the generated
screens and the source comments mention token names on purpose.) The App Store Connect and secret
values below are entered in App Store Connect, EAS and Supabase only, never in the repository:
`docs/app-review-notes.md` keeps its placeholders.

| Placeholder | Where | What to decide |
|---|---|---|
| ~~`__LEGAL_NAME__`~~ | privacy policy, terms | Filled: Kevin M Pi (must match the App Store seller name) |
| ~~`__POSTAL_ADDRESS__`~~ | privacy policy, terms | Removed by decision: contact is name + support email (no home address published). Add a PO box or virtual mailbox to §12/§17 if you want one later |
| `__SUPPORT_EMAIL__` | `supportEmail` in `docs/legal/values.json`, `EXPO_PUBLIC_SUPPORT_EMAIL`, review notes | Set: `support@joinfestie.com` (`values.json`; Cloudflare Email Routing forwards it to the owner's inbox). Use the same value for `EXPO_PUBLIC_SUPPORT_EMAIL` in EAS. The legal Markdown keeps the token; the generator and the app fill it in |
| ~~`__SUPABASE_REGION__`~~ | privacy policy | Filled: the United States (Oregon, AWS us-west-2), the project's region. Update it if you move to a project in another region |
| ~~`__EMAIL_PROVIDER__`~~ | privacy policy, §2.7 | Filled: Resend. Accept Resend's data processing addendum when you create the account (privacy policy §4 promises one) |
| ~~`__GOVERNING_LAW__`~~ | terms §14 | Filled: the State of Texas |
| ~~`__GOVERNING_VENUE__`~~ | terms §14 | Filled: state and federal courts in Dallas County, Texas |
| `__PRIVACY_POLICY_URL__` | app-store-privacy, EAS env, App Store Connect | `https://joinfestie.com/privacy` (hosted `privacy.html`, §4) |
| `__SUPPORT_URL__` | app-store-privacy, EAS env, App Store Connect | `https://joinfestie.com/support` (hosted `support.html`, §4) |
| `__DEMO_LOGIN_EMAIL__` | review notes, function secret (§2.10) | A mailbox you control; never committed |
| `__DEMO_LOGIN_CODE__` | review notes, function secret (§2.10) | Random 8 digits; never committed |
| `__REAL_FESTIVALS__` | review notes | The real festivals published at submission |
| `__APP_CATEGORY__` | §6 | App Store primary category |
| `__DSA_TRADER_STATUS__` | §6 | EU Digital Services Act trader status |

Legal text is not legal advice; have it reviewed if you can.

### 7.2 Manual gates (contract §7 gate 7 plus release hygiene), in runbook order

- [ ] All automated gates green on the release commit (§1.3), CI green.
- [ ] Hosted project restored, backed up (§2.1–2.2).
- [ ] Railway services deleted; service-role key rotated and stored only in your local `.env`; if the
      legacy JWT keys were rotated, the new anon key is the one in EAS (§2.3).
- [ ] Migrations 006–014 applied, cron jobs and buckets verified, Security Advisor clean (§2.4–2.6).
- [ ] Head Trip 2026 (test data) either verified against its official source and recorded in
      `seed-data/head-trip-2026-changes.md`, or set back to `draft` and seeded (`festival-data.md` §4.1).
- [ ] Custom SMTP live; the hosted email templates send 8-digit codes with no links; the per-user email
      interval is 60 seconds, not 1 second (§2.7–2.8).
- [ ] Auth audit logs no longer written to the database and `purge-auth-audit-log` scheduled (or support
      asked to purge); plan log retention is 90 days or less (§2.8).
- [ ] Legacy fabricated festivals deleted (§2.9); legacy edge functions removed; `delete-account` and
      `demo-login` deployed (§2.10).
- [ ] X-Forwarded-For shape verified (§2.11); report notifications arrive and carry no personal data
      (§2.12); real-email smoke test passed (§2.13).
- [ ] **At least one real upcoming festival published with `source_url`** (§3.1).
- [ ] **Demo login works on the hosted project** with the code in App Review Information; `demo:seed`
      re-run after migration 007; demo dates shifted into the review window (§3.3).
- [ ] Placeholders replaced, `supportEmail` set, legal pages regenerated, committed and hosted; URLs open
      on a phone (§4, §7.1).
- [ ] **App icon and splash reviewed.** `apps/mobile/assets/images/` holds original Festie artwork (a tent
      with a flag on a pink gradient) in place of the Expo template, and `app.config.ts` fails preview and
      production builds if template artwork comes back. Look at the icon at home-screen size and decide
      whether to replace it with a designer's version (see [`legal/ip-review.md`](./legal/ip-review.md)
      §3). Trademark search for "Festie" recorded there.
- [ ] If the legal text changed materially since a build that testers accepted, `TERMS_VERSION` in
      `apps/mobile/src/config/app-info.ts` was bumped so everyone agrees again.
- [ ] EAS environment variables set for production; the production build succeeded (§5.1–5.3).
- [ ] `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` (`pk.…`) set for the preview and production EAS environments;
      the Map tab renders the map, not the list fallback (§5.2).
- [ ] **First TestFlight upload has no ITMS-91053**; Info.plist checked; no local-network prompt; privacy
      manifests reconciled with [`app-store-privacy.md`](./app-store-privacy.md); **Mapbox sends no
      telemetry beyond billing events**, and a user's opt-in from the map's (i) menu is reset at the next
      launch (§5.4).
- [ ] [`qa-checklist.md`](./qa-checklist.md) completed and signed off on two physical iPhones.
- [ ] **Festival times spot-checked on physical iOS and Android devices** (gate 7 wording; QA §7).
- [ ] **App Privacy answers match [`app-store-privacy.md`](./app-store-privacy.md)**.
- [ ] **Age rating declares user-generated content and location sharing** (13+ or higher).
- [ ] Privacy policy and support URLs entered; screenshots, description, review notes and demo
      credentials entered (§6).
- [ ] Someone will run `reports:list` every day and answer data requests by email after release (§8).

---

## 8. Moderation, admin routine and data requests

Start this with the first TestFlight build and keep it up after release.

### 8.1 Routine

All admin work is local: `set -a; . ./.env; set +a` (§1.2), then `npm run admin -- <command>`. Commands
and their options are documented in [`festival-data.md`](./festival-data.md) (sections 5 and 6); run every
write with `--dry-run` first.

- **Every day:** `npm run admin -- reports:list` and act on each open report within 24 hours
  (`reports:remove-content <report_id>`, `users:ban <user_id>`, or dismiss in the table editor), as
  described in [`festival-data.md`](./festival-data.md) section 6. Every new block also appears as a
  report with target `block`: close it with `reports:remove-content <id>` (it only marks it actioned) or
  `users:ban`. `reports:remove-content` on a photo report deletes the reported photo, not the meetup's
  current one, and prints a `WARNING` when they differ. Users cannot delete a reported photo, so it
  stays until you act.
- **Weekly:** `npm run admin -- storage:sweep-orphans --dry-run`, then without `--dry-run` (§3.2). The
  privacy policy promises that photo files of deleted crews and meetups are removed "within about a
  week", so do not skip it.
- **Disallowed words:** `moderation:list-terms` / `moderation:add-terms` (same section).
- **Data requests** by email: §8.2.

### 8.2 Data requests: deletion and copies

The privacy policy (§6, §9) and the support page let people ask by email for their account to be
deleted or for a copy of their information. Answer within **30 days** (the GDPR allows one month, the
CCPA 45 days; the policy promises "within the time the law requires"), and keep a note of the request,
the date and what you did (not the exported data).

1. **Check who is asking.** Act only on a request sent from the email address of the account. If it
   comes from another address, reply asking them to write from the address they sign in with. Then find
   the account in the SQL editor:

   ```sql
   select au.id as auth_user_id, u.id as profile_id, u.display_name, au.created_at
   from auth.users au
   left join public.users u on u.auth_user_id = au.id
   where lower(au.email) = lower('<their email>');
   ```

2. **Deletion.** The simplest answer is the app itself (Settings → Delete account), which works in one
   minute. If they cannot use it, delete the account with the same server steps as the app's
   `delete-account` function. Do **not** just delete the user in the Supabase dashboard: that skips
   `prepare_account_deletion`, so crews whose only admin was this user are left without an admin and
   the user's totem photos stay in storage, which contradicts privacy policy §6. From the repository
   root:

   ```sh
   set -a; . ./.env; set +a
   AUTH_USER_ID='<auth_user_id>' node --input-type=module <<'EOF'
   import { createClient } from '@supabase/supabase-js';

   const authUserId = process.env.AUTH_USER_ID;
   const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
   const db = createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });

   // 1. Leave every crew with the admin hand-off; returns the photo paths to delete.
   const prepared = await db.rpc('prepare_account_deletion', { p_auth_user_id: authUserId });
   if (prepared.error) throw prepared.error;
   const paths = (prepared.data ?? []).map((row) => row.storage_path).filter(Boolean);
   // 2. Remove the photos (batches of 1000).
   for (let i = 0; i < paths.length; i += 1000) {
     const { error } = await db.storage.from('totems').remove(paths.slice(i, i + 1000));
     if (error) throw error;
   }
   // 3. Delete the auth user; cascades to the profile and everything that belongs to it.
   const deleted = await db.auth.admin.deleteUser(authUserId);
   if (deleted.error && deleted.error.status !== 404) throw deleted.error;
   console.log(`Deleted auth user ${authUserId}; removed ${paths.length} photo(s).`);
   EOF
   ```

   Every step is safe to repeat if it stops half-way. Deleting the auth user also deletes its sign-in
   sessions and refresh tokens (`auth.sessions` and its dependants cascade), but not the sign-in audit log,
   which has no link to `auth.users`. For an emailed request, remove those entries now too, in the SQL
   editor (the privacy policy only promises the 90-day limit, so a permission error here is not a
   blocker):

   ```sql
   delete from auth.audit_log_entries
   where payload->>'actor_id' = '<auth_user_id>'
      or payload->'traits'->>'user_id' = '<auth_user_id>'
      or lower(payload->>'actor_username') = lower('<their email>');
   ```

   Run the lookup query again (no rows), then reply confirming the deletion and that reports they sent
   are kept without their name (privacy policy §5).

3. **Copy of their information.** Run this in the SQL editor with their `auth_user_id`. It returns one
   JSON document with everything privacy policy §1 lists for that account (no ids of other people):

   ```sql
   with me as (
     -- left join: also works for an account that signed in but never set up a profile
     select u.id, au.id as auth_user_id
     from auth.users au
     left join public.users u on u.auth_user_id = au.id
     where au.id = '<auth_user_id>'
   )
   select jsonb_pretty(jsonb_build_object(
     'account', (select jsonb_build_object('email', au.email, 'created_at', au.created_at)
                 from auth.users au where au.id = (select auth_user_id from me)),
     'profile', (select jsonb_build_object('display_name', u.display_name, 'avatar_type', u.avatar_type,
                                           'avatar_value', u.avatar_value, 'created_at', u.created_at)
                 from public.users u where u.id = (select id from me)),
     'followed_festivals', (select coalesce(jsonb_agg(jsonb_build_object('festival', f.name, 'since', uf.selected_at)), '[]')
                 from public.user_festivals uf join public.festivals f on f.id = uf.festival_id
                 where uf.user_id = (select id from me)),
     'set_picks', (select coalesce(jsonb_agg(jsonb_build_object('festival', f.name, 'artist', a.name,
                                             'starts', s.start_time, 'ends', s.end_time, 'picked_at', p.selected_at)), '[]')
                 from public.user_set_selections p
                 join public.sets s on s.id = p.set_id
                 join public.artists a on a.id = s.artist_id
                 join public.festivals f on f.id = p.festival_id
                 where p.user_id = (select id from me)),
     'crews', (select coalesce(jsonb_agg(jsonb_build_object('crew', g.name, 'role', m.role, 'joined_at', m.joined_at)), '[]')
                 from public.group_members m join public.groups g on g.id = m.group_id
                 where m.user_id = (select id from me)),
     'meetups_created', (select coalesce(jsonb_agg(jsonb_build_object('crew', g.name, 'title', mt.title, 'starts_at', mt.starts_at,
                                                   'notes', mt.notes, 'pin', case when mt.latitude is null then null
                                                     else jsonb_build_array(mt.latitude, mt.longitude) end,
                                                   'photo', mt.totem_path)), '[]')
                 from public.meetups mt join public.groups g on g.id = mt.group_id
                 where mt.created_by_user_id = (select id from me)),
     'shared_location', (select coalesce(jsonb_agg(jsonb_build_object('crew', g.name, 'lat', l.lat, 'lng', l.lng,
                                                   'accuracy', l.accuracy, 'heading', l.heading, 'recorded_at', l.recorded_at)), '[]')
                 from public.location_shares l join public.groups g on g.id = l.group_id
                 where l.user_id = (select id from me)),
     'blocked_users', (select coalesce(jsonb_agg(jsonb_build_object('display_name', b.display_name, 'blocked_at', ub.created_at)), '[]')
                 from public.user_blocks ub join public.users b on b.id = ub.blocked_id
                 where ub.blocker_id = (select id from me)),
     'reports_sent', (select coalesce(jsonb_agg(jsonb_build_object('reported', r.target_type, 'reason', r.reason, 'details', r.details,
                                                'reported_text', r.target_snapshot, 'status', r.status, 'created_at', r.created_at)), '[]')
                 from public.reports r
                 where r.reporter_id = (select id from me)),
     'sign_in_sessions', (select coalesce(jsonb_agg(jsonb_build_object('created_at', se.created_at, 'last_refreshed_at', se.refreshed_at,
                                                    'ip_address', se.ip, 'device', se.user_agent) order by se.created_at), '[]')
                 from auth.sessions se
                 where se.user_id = (select auth_user_id from me)),
     'sign_in_log', (select coalesce(jsonb_agg(jsonb_build_object('at', e.created_at, 'event', e.payload->>'action',
                                               'ip_address', e.ip_address) order by e.created_at), '[]')
                 from auth.audit_log_entries e
                 where e.payload->>'actor_id' = (select auth_user_id::text from me)
                    or e.payload->'traits'->>'user_id' = (select auth_user_id::text from me))
   )) as festie_data_export;
   ```

   Download the photos listed under `meetups_created[].photo` from Storage → `totems` and attach them
   with the JSON. Reports **about** the person are moderation records; if you include them, never reveal
   who sent them. `sign_in_sessions` and `sign_in_log` cover the sign-in data in your own database
   (privacy policy §1, "Sign-in logs"); after §2.8, `sign_in_log` holds only entries written before
   database audit logging was turned off, none older than 90 days. The same sign-in events, and server request logs with IP addresses,
   are also in Supabase's log storage for the plan's log retention (dashboard → Logs; the **User** filter
   matches Auth events). If the person asks for logs, filter on their user id and attach the CSV or JSON
   download. Corrections: they can change their name and avatar in Settings → Profile.

The export query and `prepare_account_deletion` were run against a database built from migrations 001–009
(with `auth.sessions` and `auth.audit_log_entries` reproduced from the Supabase Auth schema), and the
deletion script against an unreachable URL to check that it loads from the repository root.

---

## 9. After release

- Daily: moderation queue (§8.1). Weekly: orphaned-photo sweep (§3.2). Data requests within 30 days (§8.2).
- Daily, and whenever someone says the code email never came: Supabase dashboard → Logs → Auth, search
  for `email rate limit exceeded`. Hits mean the project-wide `email_sent` budget ran out (§2.7 step 6);
  raise it with the SMTP plan or ship the CAPTCHA.
- Keep festival schedules current from their sources ([`festival-data.md`](./festival-data.md) section 4).
- Before every new submission: repeat §3.3 and the relevant [`qa-checklist.md`](./qa-checklist.md)
  sections.
- Material change to the Terms or Privacy Policy: edit `docs/legal/*.md`, regenerate (§4), republish the
  pages, bump `TERMS_VERSION` in `apps/mobile/src/config/app-info.ts` and ship a build.
- Restore drills: keep the latest backup procedure (§2.2) working.
