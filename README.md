# Festie

Festie is an iOS-first festival planner for groups of friends. Each person builds a schedule of the sets
they want to see; crews see each other's picks, plan meetups (with an optional "totem" photo so friends
can spot the meeting point) and can choose to share their live location with their crew while the app is
open. It keeps working offline at the festival: schedules, crews and meetups are cached on the phone and
changes sync when the signal comes back.

- Mobile app: Expo SDK 55 / React Native 0.83, expo-router, SQLite + MMKV offline cache, Mapbox maps.
- Backend: Supabase (Postgres with row-level security, Auth with emailed 8-digit codes, Storage, two Edge
  Functions). No other servers.
- Admin: a local TypeScript CLI for festival data, the App Review demo and moderation.

The authoritative design and security contract is [`docs/v1-architecture.md`](docs/v1-architecture.md).
The visual design follows the separate `festival_app_aistudio` prototype, which is only a design
reference: it is not part of this repository, not built and not shipped.

## Repository layout

```text
apps/
  mobile/              Expo app (bundle id com.kevin.festivalapp, scheme festivalapp://)
    app/               expo-router screens: auth, (tabs) fests/lineup/schedule/group/map, settings, legal
    src/               config, providers (session, sign-out), location sharing, hooks, components
  admin-tools/         `npm run admin -- <command>`: festival import/seed, demo seed, moderation, storage sweep
packages/
  data-access/         Supabase client, offline-safe session, auth, RPC wrappers, cache-first reads, photos
  sync-engine/         SQLite schema, offline write queue, flush/retry and error classification
  domain/              Festival-time formatting, day bucketing (days start 06:00), conflicts, set status (vitest)
  map-utils/           Camera/bounds and stage/meetup coordinates
  notification-utils/  Local set and meetup reminders
  ui/                  Design tokens and primitives (pastel palette, accessible link colour)
supabase/
  migrations/          001–014 (006–009 are the v1 overhaul; 007 is idempotent; 011 set status; 012–013 image credits, festival suggestions, artwork bucket; 014 announced lineup)
  functions/           delete-account, demo-login, _shared (Deno)
  tests/               rls.sql (pgTAP-style) and local stubs, fixtures and race scripts
  templates/           Code-only sign-in email templates
  config.toml          Local config; pushed to hosted after review (runbook §2.8)
seed-data/             Golden festival files (demo + Head Trip 2026), media registry (licensed photos), candidates awaiting review
scripts/db-test.sh     Throwaway Postgres 16 harness for the database tests
docs/                  Contract, runbook, QA, festival data, App Store and legal documents, static site
docs/agents/           How festival data and artwork get in: scout agent -> human review -> publish (the flywheel)
.claude/               /festival-scout skill and the festival-scout workflow for Claude Code sessions
```

## Setup

Requirements: Node 20 (`.nvmrc`: 20.19.4) with npm 10. For the database tests, PostgreSQL 16 binaries
(`/usr/lib/postgresql/16/bin`, override with `PG_BIN`) or a `DATABASE_URL`; for edge functions,
[Deno 2](https://deno.com). Xcode or EAS for iOS builds.

```sh
npm ci                     # also builds the workspace packages the app imports
```

Run the app against a Supabase project (local or hosted) with a development build:

```sh
cd apps/mobile
cat > .env <<'EOF'         # git-ignored; EXPO_PUBLIC_* values end up in the app, so never put secrets here
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon or publishable key>
EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.<optional, enables the map>
EXPO_PUBLIC_SUPPORT_EMAIL=<optional in development>
EOF
npx expo run:ios           # or: npx eas-cli build --profile development-device, then npm run start:dev-client
```

Without the Supabase variables the app shows a configuration-error screen. Release builds need more
variables and fail without them; see [`docs/release-runbook.md`](docs/release-runbook.md) §5.1.

Local Supabase (optional): `npx supabase start`, then `npx supabase db reset` applies the migrations and
`npm run supabase:functions:serve` serves the functions.

Admin commands run locally with the service-role key from a git-ignored root `.env`
(`SUPABASE_URL`, `SUPABASE_SECRET_KEY`); see [`docs/festival-data.md`](docs/festival-data.md) and
[`docs/release-runbook.md`](docs/release-runbook.md) §1.2.

## Running the app after a pull

The mobile app bundles the shared packages (`@festival/domain`, `sync-engine`, `data-access`, `ui`,
`map-utils`, `notification-utils`) from their compiled `dist/`, which is not committed. After `git pull`
rebuild them before starting Metro, or you get a stale package on the phone (`X is not a function
(it is undefined)` on a screen that uses something added since your last build):

```sh
npm run build:mobile-workspace-deps          # from the repo root
cd apps/mobile && npm run start:dev-client    # or npm run start; both rebuild the packages first
```

`npm install` also rebuilds them (`postinstall`). Running `npx expo start` directly skips the rebuild.

## Verification gates

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all of these on every push and pull
request; run them locally before pushing:

```sh
npm run build                       # turbo: package builds + mobile tsc
npm run lint                        # turbo: tsc --noEmit everywhere
npm run test                        # vitest: domain, sync-engine, data-access, map-utils, admin-tools
npm run db:test                     # migrations 001–014 on a throwaway Postgres 16 + rls.sql + races
(cd supabase/functions && deno check */index.ts && deno test && deno lint)
node docs/legal/generate.mjs --check    # in-app legal screens and docs/site match docs/legal/*.md
(cd apps/mobile && EXPO_PUBLIC_SUPABASE_URL=https://example.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=dummy \
  npx expo export --platform ios --output-dir /tmp/festie-export) && rm -rf /tmp/festie-export
```

Never run `deno` against `supabase/` from the repository root without `--config`; it creates a stray
`deno.lock`.

## Documentation

| Document | Purpose |
|---|---|
| [`docs/v1-architecture.md`](docs/v1-architecture.md) | Authoritative v1 contract: schema, RLS, RPCs, functions, client and app rules, gates |
| [`docs/release-runbook.md`](docs/release-runbook.md) | Ordered path from this repo to App Store submission, including the pre-submission checklist |
| [`docs/qa-checklist.md`](docs/qa-checklist.md) | Manual device QA for every v1 flow |
| [`docs/festival-data.md`](docs/festival-data.md) | Entering real festivals, the demo festival, moderation commands |
| [`docs/app-store-privacy.md`](docs/app-store-privacy.md) | App Privacy answers, age rating, export compliance, URLs |
| [`docs/app-review-notes.md`](docs/app-review-notes.md) | Template for the App Review notes |
| [`docs/legal/`](docs/legal) | Privacy policy, terms, support page sources (`generate.mjs` builds the app screens and `docs/site/`), data inventory, security controls, IP review |

## Legal content

`docs/legal/privacy-policy.md`, `terms-of-use.md` and `support.md` are the single source for the in-app
legal screens (`apps/mobile/app/legal/*.tsx`) and the hostable pages in `docs/site/`. Edit the Markdown,
then run `node docs/legal/generate.mjs`. Placeholders such as `__LEGAL_NAME__` must be replaced before
release (`node docs/legal/generate.mjs --release`, runbook §4 and §7.1). `__SUPPORT_EMAIL__` is a template
variable: it stays in the Markdown and is filled in from `docs/legal/values.json` (web pages) and
`EXPO_PUBLIC_SUPPORT_EMAIL` (in-app screens).

## License

See [`LICENSE`](LICENSE).
