# Candidate festival bundles

A candidate is a festival schedule that is **not yet trusted**. The scout agent (or an operator, with
`candidate:new`) writes it here, a human reviews it section by section, and `candidate:promote`
turns an approved candidate into regular seed data (`seed-data/<slug>.json`, `seed-data/<slug>-csv/`)
and records it in [`seed-data/golden/index.json`](../golden/README.md). Nothing in this directory
reaches the app or the database by itself: promotion only writes files, and publishing still goes
through `festival:seed` (docs/festival-data.md §4).

## Layout

```
seed-data/candidates/<slug>/
  festival.csv            the CSV format of docs/festival-data.md §2 (one row)
  stages.csv
  artists.csv
  sets.csv                includes the schedule-change columns status, original_start, note
  candidate.json          sources, per-section confidence, the review and its status (types.ts)
  REVIEW.md               the agent's summary for the reviewer: what was found, what was estimated
  media/registry.json     optional image candidates (apps/admin-tools/src/media/types.ts), each with
  media/artists/<id>.jpg  its own review status
```

`<slug>` is lower-case words joined by hyphens, usually name + year (`head-trip-2026`). It becomes the
seed file name on promotion. Directories whose name starts with `_` are ignored (scratch space).

The CSVs are the data; `candidate.json` is the paper trail around them:

| Field | Meaning |
|---|---|
| `sources[]` | Every page the data came from: `url`, `kind` (`official`, `official-app`, `press`, `aggregator`, `other`), `accessed_at`, which sections it was `used_for` |
| `confidence` | `high` / `medium` / `low` per section (festival, stages, artists, sets) |
| `items.sets`, `items.artists` | Optional per-row provenance, keyed by `<artist>\|<start YYYY-MM-DD HH:MM>` for sets |
| `notes` | What was estimated, what is missing, what to double-check |
| `review.decisions` | The human's verdict per section (below) |
| `status` | Derived from the decisions; `promoted` once `candidate:promote` ran |
| `promoted` | Where the files went (`seed_file`, `csv_dir`, relative to the repo root) |

## Review states

Each of the four sections gets a decision: `pending`, `approved` or `rejected`. The candidate's
`status` follows from them:

| Decisions | `status` |
|---|---|
| any section `rejected` | `rejected` |
| all four `approved` | `approved` — ready for `candidate:promote` |
| anything else | `needs_review` |
| after a successful promote | `promoted` — final; the review can no longer be changed |

Media entries are reviewed one by one (`review.status` `pending` / `approved` / `rejected`); only
**approved** entries are copied into `seed-data/media/` on promotion. Approving media means the licence
and attribution were checked (media/types.ts lists the licences the app may show).

Reviewing happens in the local review tool (`apps/admin-tools`, `review:*`), which writes
`review` back into `candidate.json`; editing the file by hand works too.

## Commands

```sh
npm run admin -- candidate:list                                  # every candidate with counts and issues
npm run admin -- candidate:new <slug> --name "<name>" [--source <url>]
                                                                 # empty bundle to fill in by hand
npm run admin -- candidate:promote <slug> --dry-run              # what promotion would write
npm run admin -- candidate:promote <slug>                        # write seed-data/<slug>.json + csv dir,
                                                                 # merge approved media, update golden/index.json
npm run admin -- scout:eval <slug> --golden seed-data/<x>.json   # score a candidate against a golden festival
npm run admin -- suggestions:to-candidate <suggestion_id> [--slug <slug>]
                                                                 # scaffold a candidate from an in-app suggestion
```

`candidate:promote` requires every section approved and a bundle that passes `festival:import-csv`
validation (warnings are fine, errors are not). It refuses to overwrite a `seed-data/<slug>.json` that
belongs to a different festival id, and refuses a candidate that was already promoted. The promoted
seed keeps the `status` from `festival.csv` (normally `draft`); publish it with `festival:seed` after
checking it once more against `source_url`.
