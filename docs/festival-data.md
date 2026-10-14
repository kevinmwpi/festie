# Festival data, demo content and moderation

How festival schedules get into Festie, how the App Review demo is prepared, and how
reported content is handled. Everything here goes through `apps/admin-tools`, a small
TypeScript CLI that talks to Supabase with the **service-role** key. Contract:
[`v1-architecture.md`](./v1-architecture.md) §2 and §6.

```sh
export SUPABASE_URL=https://<project-ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service role / secret key>   # or SUPABASE_SECRET_KEY
npm run admin -- help
```

Never put the service-role key in the mobile app, a `EXPO_PUBLIC_*` variable or a commit.
Commands that write accept `--dry-run`; run it first. `festival:validate`, `festival:import-csv`,
`festival:shift-dates` and the `--dry-run` of `festival:seed`/`demo:seed` work without credentials.

| Command | What it does |
|---|---|
| `festival:validate <file>` | Strict offline validation of a festival file |
| `festival:seed <file> [--dry-run]` | Validate, diff and write a festival; bumps `version` |
| `festival:import-csv <dir> [--out <file>]` | Four CSV files → festival JSON (validated) |
| `festival:shift-dates <file> --start <YYYY-MM-DD> [--out <file>] [--dry-run]` | Move a **demo** festival to new dates |
| `demo:seed [--file <file>] [--dry-run]` | Demo festival + fake crew for App Review |
| `reports:list [--status …] [--limit n] [--json]` | Moderation queue (default: open, oldest first) |
| `reports:remove-content <report_id> [--dry-run]` | Remove reported content, mark reports actioned |
| `users:ban <user_id> [--dry-run]` | Ban an account and remove it from every group |
| `moderation:list-terms` / `add-terms` / `remove-terms` | Manage the disallowed-words list |

Paths are resolved from the directory you run `npm run admin` in, then from the repo root.

---

## 1. Festival file format

One JSON file per festival (see [`seed-data/demo-festival.json`](../seed-data/demo-festival.json)):

```json
{
  "festival": { "id": "…", "name": "…", "start_date": "2027-08-06", "end_date": "2027-08-08",
                "timezone": "America/Chicago", "status": "draft", "source_url": "https://…" },
  "stages":  [{ "id": "…", "name": "Main Stage", "zone": "North", "latitude": 41.87, "longitude": -87.62 }],
  "artists": [{ "id": "…", "name": "…", "genre": "Indie Rock" }],
  "sets":    [{ "id": "…", "artist_id": "…", "stage_id": "…",
                "start_time": "2027-08-06T19:30:00-05:00", "end_time": "2027-08-06T20:30:00-05:00" }]
}
```

Validation is strict — unknown fields are errors, so typos never silently drop data.

**festival**

| Field | Rules |
|---|---|
| `id` | UUID (stable forever — users' groups and picks hang off it) |
| `name` | 1–120 characters, the festival's public name |
| `start_date`, `end_date` | Calendar dates `YYYY-MM-DD` in the festival's local calendar; end ≥ start |
| `timezone` | IANA zone (`America/Chicago`, `Europe/London`), never an abbreviation |
| `venue_name` | Optional, ≤ 120 |
| `status` | `draft` (default) or `published`; only published festivals are visible to the app |
| `is_demo` | `true` only for the sample festival (shown with a "Sample" badge, sorted last) |
| `source_url` | **Required** unless `is_demo`: `https://` link to the official public schedule used |
| `accent_color` | Optional `#RRGGBB`, used as a fill colour in the app (pick a light/pastel tone) |
| `latitude`, `longitude` | Optional map centre (both or neither) |
| `default_zoom` | Optional, 0–22 (app default 15) |
| `bounds_sw_lat`, `bounds_sw_lng`, `bounds_ne_lat`, `bounds_ne_lng` | Optional bounding box (all four or none); must contain the centre |
| `version` | Optional floor; `festival:seed` always writes `max(stored + 1, version)` |
| `image_url`, `map_asset_url` | Must be absent/null (no festival artwork — see §3) |

**stages**: `id` (UUID), `name` (≤ 80, unique per festival), optional `zone` (≤ 40), optional
`latitude`/`longitude` (inside the festival bounds when bounds are set). Stages without
coordinates still work but do not get a map pin. `festival_id` may be omitted.

**artists**: `id` (UUID), `name` (≤ 120, unique in the file), optional `genre` (≤ 60), optional
`billing_order` (integer 1–10000: the position or tier as the organizer lists the lineup, 1 = top;
acts sharing a number are shown alphabetically within it, so a poster's tiers map to 1, 2, 3…; left
out = alphabetical). Artists are a global table shared by all festivals; use the
same id for the same act across festivals (the CSV importer does this automatically). No `image_url`.
The file's `artists` are the festival's **announced lineup** (`festival_artists`, migration 014): every
artist is listed in the app whether or not it has a set yet (§4.2), and `billing_order` is stored per
festival, not on the artist.

**sets**: `id` (UUID), `artist_id` and `stage_id` referencing entries in the same file, `start_time`
and `end_time` as ISO 8601 **with an explicit offset** (`-05:00` or `Z`), `end_time` after
`start_time`, at most 24 h long, starting on a local date between `start_date − 1 day` and
`end_date + 1 day`. Optional `set_type` (default `performance`). Overlapping sets on one stage
produce a warning (cancelled sets are left out of that check). Optional schedule-change fields (§4.1):

| Field | Rule |
|---|---|
| `status` | `scheduled` (default), `moved` or `cancelled` |
| `original_start_time` | Only when `status` is `moved`: the start before the move, ISO 8601 with an offset, inside the festival dates ±1 day. Leave it out for a stage-only move or an unknown old time (warning) |
| `change_note` | Optional, one line, at most 140 characters after trimming: the reason shown in the app ("Moved to Sunday (weather)"). Allowed on any status, e.g. "Cut short by lightning" on a set that kept its slot |

The validator always writes all three, so removing them from the file and seeding again reverts the set
to `scheduled`.

A late-night set at 00:30 belongs to the previous festival day in the app (days start at 06:00
local time), so write the real calendar timestamp: `2027-08-08T00:30:00-05:00` for "Saturday night,
12:30 AM".

## 2. CSV import

For entering a schedule by hand, keep four CSV files in one directory and convert them:

```sh
npm run admin -- festival:import-csv path/to/riverside-2027 --out seed-data/riverside-2027.json
```

[`seed-data/demo-festival-csv/`](../seed-data/demo-festival-csv) is a complete example (it is the source
of `demo-festival.json`; a unit test keeps the two identical).

| File | Required columns | Optional columns |
|---|---|---|
| `festival.csv` (exactly one row) | `name, start_date, end_date, timezone` | `id, venue_name, source_url, status, is_demo, accent_color, latitude, longitude, default_zoom, bounds_sw_lat, bounds_sw_lng, bounds_ne_lat, bounds_ne_lng` |
| `stages.csv` | `name` | `id, zone, latitude, longitude` |
| `artists.csv` | `name` | `id, genre, billing` |
| `sets.csv` | `artist, stage, start, end` | `id, set_type, status, original_start, note` |

- Standard CSV: quote fields containing commas (`"Juniper & the Low Moons, Live"`), double inner quotes.
  Header names are case-insensitive; unknown columns are errors.
- `sets.csv` refers to artists and stages **by name** (case-insensitive) or by id.
- Times are festival local time `YYYY-MM-DD HH:MM` (converted with the festival time zone, DST-aware;
  a time skipped by a daylight-saving change is an error) or ISO 8601 with an offset.
- Ids you leave out are derived deterministically (UUID v5), so re-importing an updated schedule keeps
  them stable and users keep their picks: festival ← name + start date; stage ← festival + stage name;
  artist ← artist name (shared across festivals); set ← festival + artist + festival day (+ an
  ordinal if the act plays twice that day). Moving a set to another time or stage keeps its id;
  renaming an artist or stage changes it. If you must rename, put the old id in the `id` column.
- A set marked `moved` with an `original_start` takes its festival day from `original_start`, so it
  keeps its id (and users keep their picks) even when it moves to another day (§4.1). Without
  `original_start`, a set moved to another day gets a new id unless you put the old one in `id`.
- `status`, `original_start` and `note` fill `status`, `original_start_time` and `change_note`
  (`original_start` takes the same time formats as `start`).
- `billing` in `artists.csv` fills `billing_order` (a whole number: position or tier as the organizer
  lists the lineup, 1 = top; acts may share a number); leave it empty for alphabetical order. `sets.csv`
  may hold only its header when set times are not out yet (§4.2).
- Errors are reported as `file:line column: message`; the output is then validated exactly like a
  hand-written JSON file.

## 3. Sourcing rules (read before entering a real festival)

Festie is an independent app, not affiliated with or endorsed by any festival, organizer or artist,
and the app says so (`FESTIVAL_DISCLAIMER` on the Fests list, Lineup and the schedule browser, a line in
Settings, and Terms §8). Data must keep it that way:

1. **Facts only.** Enter what the organizer has publicly announced: festival name, dates, venue,
   stage names, artist names and set times. Copy no descriptions, bios, editorial text or ticket info.
2. **Official public sources.** Use the festival's own published schedule (website or official app
   listing made public). Do not use leaked, paywalled or "rumoured" lineups or other apps' data.
   Record the page you used in `source_url` — it is required to publish and is how the data is audited
   and corrected later.
3. **Nominative names only.** Use names as plain text to identify the festival, stages and artists.
   No logos, wordmarks, posters, artwork, official maps, photos or brand colours copied from the
   festival — `image_url` and `map_asset_url` are rejected by the validator in festival files. Pick your
   own neutral `accent_color`. Images reach the app only through the media registry (§6): licensed
   artist photos with attribution, and festival marks only with the organizer's permission.
4. **Coordinates** come from public map data (e.g. the venue's public address/park outline on
   OpenStreetMap), not from the festival's site map artwork.
5. **Keep it current.** Schedules change; re-check the source before the festival and update
   (§4). If an organizer asks for removal or correction, unpublish first (`"status": "draft"`) and then fix.

## 4. Publishing workflow

1. Enter the festival as CSV (or JSON) with `"status": "draft"`; validate:
   `npm run admin -- festival:validate seed-data/<festival>.json`
2. Seed the draft: `npm run admin -- festival:seed seed-data/<festival>.json --dry-run`, review the
   plan, then run it without `--dry-run`. Drafts are invisible to the app (RLS shows only
   `status = 'published'` to anon and signed-in users).
3. Review the data in the Supabase table editor against `source_url` (spot-check times in the
   festival time zone, stage names, late-night sets).
4. Publish: set `"status": "published"` in the file and seed again. The validator refuses to publish a
   real festival without `source_url` or without a lineup (at least one artist; set times may follow,
   §4.2), and the database enforces `status = 'draft' or is_demo or source_url is not null`.
5. Updates: edit the file and seed again. `festival:seed` upserts the festival, artists, the lineup
   (`festival_artists`), stages and sets, **deletes sets, stages and lineup rows of that festival that
   are no longer in the file** (users' picks of deleted sets are deleted with them; meetups pinned to a
   deleted stage lose the pin), and writes the bumped `version` and `status` last so clients refetch a
   complete bundle. Keep ids stable (§2).
6. Unpublish: set `"status": "draft"` and seed. Groups and picks stay in the database.

### 4.1 Schedule changes (moved and cancelled sets)

When the organizer changes the schedule after publishing (weather, a withdrawal), **mark the set
instead of editing it silently or deleting it** (migration 011):

- **Moved:** set `status` to `moved`, put the new times in `start`/`end` and the old start in
  `original_start` (CSV) or `original_start_time` (JSON). The app shows a "Moved" chip and "Was Sat
  11:00 PM", lists the set under its new day, and moves users' reminders to the new time.
- **Cancelled:** set `status` to `cancelled` and keep the set in the file with its old times. The app
  shows it struck through with a "Cancelled" chip, cancels reminders for it, leaves it out of clash
  and "up next" checks, and no longer offers to add it. Users keep their pick so they can see what
  happened. **Never delete a cancelled set from the file**: `festival:seed` deletes sets that are
  missing, and users' picks of them are deleted with them.
- **Note:** add a short `note` / `change_note` with the reason. My Schedule lists every moved or
  cancelled pick at the top.
- **Replacement act:** add it as a new set (new artist row if needed). Only enter it when the slot
  time is public.
- **Reverting:** set `status` back to `scheduled` (or remove the three fields) and seed again.

Then seed as usual (`--dry-run` shows `changes N moved, M cancelled sets`). Clients pick the change up
only when `festivals.version` changes, which `festival:seed` does; an edit made in the Supabase table
editor reaches no phone until the festival is seeded again. App builds released before migration 011
show moved sets at their new time and cancelled sets as normal sets.
[`seed-data/head-trip-2026.json`](../seed-data/head-trip-2026.json) is a real example (one act moved
from Saturday to Sunday, one cancelled; see `head-trip-2026-changes.md`).

### 4.2 Lineup announced, set times to be announced

Most festivals announce who plays months before they publish when. A festival can be published as soon
as the lineup is official (migration 014):

- Enter the festival and its `artists` as usual and leave `sets` empty (`sets.csv` with only its header).
  `festival:validate` warns `no set times yet: the app shows the lineup as "set times to be announced"`
  and otherwise treats the file like any other; `festival:seed` writes one `festival_artists` row per
  artist and the dry run reports `lineup N artists, N without a set`.
- Use `billing` / `billing_order` to keep the organizer's billing (1 = top; acts on the same poster
  tier share a number and sort alphabetically within it). Without it the app lists the acts
  alphabetically. Names and their order are facts; poster artwork is not (§3).
- Only from a lineup the organizer has published: artists are a global, public table, so even a
  **draft** seed makes new artist names readable to any client (not which festival they play).
- The demo festival is the exception: it must keep its sets (`demo:seed` builds the sample crew's picks
  and meetups from them); the validator refuses an `is_demo` file without sets.
- In the app, the Lineup tab lists every announced act with "Set time TBA" and no Add button; Add sets
  and My Schedule say that set times are coming. Crews, chat, meetups and the map already work, so people
  can follow the festival and form crews months ahead.
- When set times arrive, add the sets (all at once or stage by stage, day by day) and seed again. Acts
  that have a set move into the timed list; the rest stay under "Set times to be announced". An act
  removed from the lineup disappears from the app on the next seed (its `festival_artists` row is
  deleted); an act that was announced and then cancelled before any set time existed is simply removed.
- Every set's artist must be in `artists` (the validator checks it and the database enforces it with
  `sets_lineup_fkey`), so the lineup never lags the schedule. A project without migration 014 fails
  `festival:seed` and `demo:seed` during planning, before any write (`--dry-run` with credentials too).
- On the watchlist (§7), set the festival to `awaiting_times` after publishing the lineup
  (`npm run admin -- watchlist:set-status <slug> awaiting_times`): scheduled scouting then keeps looking
  for the set times, and the urgency score rises as the dates near. Set it to `published` with the seed
  that carries the set times.

Migration 007 sets every legacy non-demo festival without a `source_url` to draft; real festivals
appear only after being entered through this workflow.

## 5. Demo festival and App Review

`seed-data/demo-festival.json` is the fictional **Festie Demo Fest** (`is_demo: true`, published,
June 2027) with fictional artists, placed in Central Park, New York (a large public open space) with
every stage inside the park. The app labels it "Sample".

Prepare the review build:

```sh
# Optional: move the demo so "now playing / up next" is live during review
npm run admin -- festival:shift-dates seed-data/demo-festival.json --start 2026-10-09 --out /tmp/demo.json
npm run admin -- demo:seed --file /tmp/demo.json --dry-run
npm run admin -- demo:seed --file /tmp/demo.json
```

`festival:shift-dates` keeps every set at the same local clock time (DST-safe) and refuses non-demo
festivals. Do not commit shifted dates unless you mean to.

`demo:seed` is idempotent and creates:

- the demo festival (via the same path as `festival:seed`);
- three fake members (`festie-demo-maya|jordan|sam@example.com`, confirmed auth users that can never
  receive mail, marked with `app_metadata.festie_demo = true`) with profiles; Maya is the admin;
- the group **"Festie Demo Crew"** (fixed id derived from the festival id, created by Maya) with their
  memberships and set picks. Its invite code is random, generated on the first seed and kept on
  re-seeds; it is never printed or derived from repository data (a group still carrying the guessable
  code earlier versions derived gets a fresh random code). Nobody but the reviewer is meant to join;
- a meetup by Jordan with a totem photo (`seed-data/demo-totem.jpg`, uploaded to the private
  `totems` bucket at `<group>/<meetup>/<uuid>.jpg`);
- live location rows near the stages.

Re-seeding also removes photos in the demo group's storage folder that no meetup references.

The reviewer signs in through the `demo-login` edge function (`DEMO_LOGIN_EMAIL` /
`DEMO_LOGIN_CODE`, see the release runbook). On every successful demo login,
`public.prepare_demo_account` (service role) recreates the reviewer's profile if needed, re-joins
them to "Festie Demo Crew", makes them follow the demo festival and places the fake members on the
map again with a fresh timestamp. The demo crew then stays current however long the reviewer keeps
the app open: `private.refresh_demo_crew` re-stamps the fake members' location rows (which otherwise
expire after 15 minutes) and moves their meetups that have started or start within 30 minutes to the
start of the current hour plus 2 hours. It runs on every demo login, whenever `get_group_locations` is called for the
demo crew (the map polls it) and every 5 minutes from the pg_cron job `refresh-demo-crew`; it is a no-op
for every other crew. The reviewer can delete the demo account in Settings and log in again with the
same code.

The demo crew is recognised by its creator, never by name alone: it is the "Festie Demo Crew" on a
published `is_demo` festival created by a profile whose auth user has `app_metadata.festie_demo =
true`. Only the service role can write `app_metadata` (users can edit their own `user_metadata`, which
is ignored), so a same-named group made by a real user is never chosen. On every demo login the crew
is reset to the fake members plus the reviewer: anyone else is removed together with the meetups they
posted there, blocks between the reviewer and the fake members are cleared (App Review tests Block on
the shared login; a leftover block would hide that member's location, meetups and picks from the next
reviewer), and live locations are only ever written for the fake members. After upgrading from a
build that seeded the demo before this marker existed, run `demo:seed` again (it adds the marker to
the existing fake users and replaces the guessable invite code).

## 6. Images: the media registry

Festival files never carry images. Approved, licensed images live in `seed-data/media/registry.json`
(one entry per artist or festival: the stored file, its sha256, where it came from, the licence, the
attribution text, and who approved it) with the files next to it. `media:validate` checks the registry
against the rules (allowed licences, attribution present where the licence requires it, file hashes,
subjects that exist). `media:upload` pushes approved files to the public `artwork` storage bucket
(migration 013) and writes `image_url`, `image_credit`, `image_license` and `image_source_url` on the
artist or festival row (migration 012), then bumps the version of every published festival whose lineup
(`festival_artists`) or sets include a changed artist, so phones refetch (a festival published before its
set times exist is bumped too). The app shows every credit under Settings → Photo credits, with a link
to each licence and a note that photos are resized and cropped.

- **Artists:** `npm run admin -- media:fetch-commons --artist "<name>" --artist-id <uuid>` (or
  `--seed <festival.json>` for every artist of a festival) fetches a Wikimedia Commons photo through
  Wikidata and records its licence. Only `CC0`, public domain, `CC BY` and `CC BY-SA` in their
  international or unported versions are accepted (`NC`: commercial app; `ND`: we crop; country
  versions: the app links the international deed). The credit is the line the author asks for on
  Commons, word for word, or else the author. Entries start as `pending`; approve them in the review
  tool or by editing `review.status`, after the checks in
  [`legal/ip-review.md`](./legal/ip-review.md) §2.
- **Festivals:** no posters or poster cut-outs. An official logo only with `organizer-permission` or
  `press-kit-editorial` recorded in the entry (link the permission or kit), never scraped.
- **Removal:** set `review.status` to `rejected` and run `media:upload`: it clears the row and deletes
  the object.

`seed-data/media/README.md` has the entry format. The reasoning is in
[`agents/festival-pipeline.md`](./agents/festival-pipeline.md) §4.

## 7. Candidates, review and the scout agent

New festivals arrive as **candidates** in `seed-data/candidates/<slug>/` (the four CSVs, a
`candidate.json` with sources and confidence, optional `media/`, and a `REVIEW.md`), written by the
scout agent (`/festival-scout` in Claude Code, or the `festival-scout` workflow) or scaffolded by hand
with `candidate:new`. Review them in the local tool (`npm run admin -- review:serve`, then open
http://127.0.0.1:8787): approve or reject each section and each image, then
`candidate:promote <slug>` copies the approved bundle into `seed-data/` and records it in
`seed-data/golden/index.json` (and the festival id on the matching watchlist entry, so follows count). Publish as in §4. The roles, rules and the flywheel are in
[`agents/festival-pipeline.md`](./agents/festival-pipeline.md).

A candidate may carry the lineup alone when set times are not out yet (§4.2): the review tool shows
"N artists without set times", the published festival is set to `awaiting_times` on the watchlist and
the scout runs again when the organizer publishes the times.

Which festivals get scouted is decided by the watchlist (`seed-data/golden/watchlist.json`:
`watchlist:list`, `watchlist:add`), not by sweeping every event: flagship tier, user demand, or an admin
request. User suggestions from the app ("Suggest a festival") land in `festival_suggestions`
(migration 012): `suggestions:ranking`, `suggestions:list`, `suggestions:to-candidate <id>`.

## 8. Moderation

Users report profiles, groups, meetups and photos in the app (reasons: spam, harassment, hate,
sexual, violence, impersonation, other) and are told "we'll review this within 24 hours". Reports
are only writable through the `report_content` RPC (rate limited to 20 per user per day) and store
a snapshot of the reported text at report time. Users can also block each other (blocked users'
meetups, picks and locations disappear for both) and group admins can remove members (which also
deletes the removed member's meetups in that crew). Every new block also files an open report with
target `block` (snapshot = the blocked user's display name, one per blocker and blocked user, not
counted against the reporter's daily budget), so blocks show up in `reports:list` too.

**Daily review**

```sh
npm run admin -- reports:list                      # open reports, oldest first
npm run admin -- reports:list --status all --limit 200 --json
```

Each entry shows the target, the snapshot, details and the reporter. Then act:

- `npm run admin -- reports:remove-content <report_id> --dry-run` then without `--dry-run`:
  - `meetup` → deletes the meetup and its totem photo;
  - `photo` → deletes the **reported** photo (the report's snapshot path) from storage, even if the
    meetup is gone or now shows another photo, and clears `meetups.totem_path` only if it still points
    at that photo. If the meetup now shows a different, unreviewed photo, the plan prints a `WARNING`
    line (also with `--dry-run`) and leaves it alone. Users cannot delete a photo while an open or
    reviewed report points at it, and `storage:sweep-orphans` keeps it, so the evidence survives until
    you act;
  - `group` → renames the group to "My crew";
  - `user` → resets the display name to "Festie user" and the avatar to initials;
  - `block` → nothing to remove; it only marks the block notice `actioned` (use `users:ban` if the
    blocked user broke the Terms);
  - then every open/reviewed report about the same target (for a photo: with the same snapshot path)
    is marked `actioned`.
  Storage is removed before rows, so a failed run can be retried safely.
- `npm run admin -- users:ban <user_id> [--dry-run]` (profile id or auth user id) for repeat or
  severe abuse: bans the auth user for 100 years (`ban_duration: 876000h`; sign-in and token refresh
  fail, and an access token already issued reads nothing from then on because the database treats a
  banned caller as having no profile, `private.is_banned`). Then `prepare_account_ban` removes all
  their group memberships and location rows with the same admin hand-off rules as leaving a group,
  gives every crew they were in a new invite code, deletes their meetups and returns every photo path
  to remove (their uploads, their meetups' photos and those of crews that became empty); the command
  removes those files and marks `user` and `block` reports about them `actioned`. If storage removal fails, run it again
  (each step is idempotent). Their profile stays for the record.
- No action needed: set the report's `status` to `dismissed` (or `reviewed`) in the table editor.

**Disallowed words.** Display names, group names and meetup titles/notes are checked on insert and
on change against `public.moderation_terms` (whole-word, case-insensitive; the user sees "content not
allowed"). Matching is anchored on non-alphanumeric boundaries, so "Grape Escape" passes while
"rape" is blocked, and every inflection must be listed separately ("fuck", "fucking", …).
Migration `009_seed_moderation_terms.sql` seeds a starter list of common English profanity, slurs
and hate slogans, deliberately leaving out words that are also everyday words or names ("dick",
"cock", "pussy", "cum", "dyke", "coon", "homo").

```sh
npm run admin -- moderation:list-terms
npm run admin -- moderation:add-terms "white power" slurword slurwords --dry-run
npm run admin -- moderation:add-terms "white power" slurword slurwords
npm run admin -- moderation:remove-terms someword
```

Terms are stored lower-case, 2–60 characters of letters, digits, spaces, apostrophes and hyphens,
starting and ending with a letter or digit. Adding a term affects new writes and edits immediately;
existing names are not rescanned (find them in the table editor and use `reports:remove-content` or
edit directly). Database cascades (account deletion, group deletion) never re-run the check. To make
an addition part of every fresh environment, also append it to a new migration
(`insert into public.moderation_terms (term) values (...) on conflict do nothing;`) — never edit an
applied migration.

## 9. Troubleshooting

- `Missing SUPABASE_URL …` — export both variables; the anon key is never accepted.
- `PGRST205` / missing columns — the target project is missing migrations 006–014; apply them first.
  Migration 014 is missing when `festival:seed` or `demo:seed` (also their `--dry-run` with credentials)
  stops with `Reading the existing lineup (festival_artists; apply migration 014 …) failed (PGRST205)`,
  or when the app cannot download any festival bundle (it selects `festival_artists` with every bundle).
  Migration 012 is missing when the app or `festival:seed` reports an unknown `image_credit` /
  `image_license` / `image_source_url` column (42703 / PGRST204) or `suggest_festival` is not found; 013
  when `media:upload` cannot find the `artwork` bucket.
  Migration 011 is missing when `festival:seed` or `demo:seed` stops with `Reading existing sets failed
  (42703): column sets.status does not exist` (the plan reads it before writing anything), or a write
  reports `Could not find the 'status' column of 'sets'` (PGRST204).
- `sets_status_check`, `sets_original_start_time_check`, `sets_change_note_check` — a set change the
  database refuses; `festival:validate` reports the same rules with the file path.
- The reviewer lands in no crew after a demo login — `demo:seed` has not run against this project
  (or ran before the `festie_demo` app_metadata marker existed); run it again.
- `festivals_published_requires_source` — a real festival was published without `source_url`.
- `festival_artists_billing_order_check` — `billing_order` outside 1–10000; `festival:validate` reports
  the same rule with the file path.
- `sets_lineup_fkey` — a set was written for an artist that is not in the festival's lineup, or a lineup
  row was deleted while a set still referenced it. Seed through `festival:seed` (it writes the lineup
  before the sets and removes dropped acts after their stale sets) instead of editing tables by hand.
- Local schema tests: `npm run db:test` (throwaway Postgres 16; see `scripts/db-test.sh`).
