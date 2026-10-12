# Golden festivals

`index.json` lists every festival whose data a human approved: the "golden" set. It serves two
purposes:

1. **The truth for the app.** A festival is seeded only from files listed here (`seed_file`,
   `csv_dir`). Anything under `seed-data/candidates/` is unreviewed and never seeded directly.
2. **The baseline for evaluating the scout agent.** `scout:eval` compares a candidate bundle with
   the golden file of the same festival and reports precision/recall for stages, artists and sets,
   set times off by more than the tolerance, and stage mismatches. Run the agent against a festival
   that is already golden to measure it; use the score to decide whether its output is good enough
   to review.

"Golden" means a human reviewed the data, not that it is current. Schedules change: `verified`
records the **last check against the official source** (`at`, `by`, `source_url`) and is `null` until
somebody did one. Before publishing a real festival, verify it and record the check here (or in the
festival's notes file, as `head-trip-2026-changes.md` does), then seed.

## `index.json`

```json
{
  "version": 1,
  "festivals": [
    {
      "slug": "head-trip-2026",
      "festival_id": "132e6610-7242-5b9e-b8f8-2fb0c8fe58a6",
      "name": "Head Trip",
      "seed_file": "seed-data/head-trip-2026.json",
      "csv_dir": "seed-data/head-trip-2026-csv",
      "candidate": null,
      "promoted_at": "2026-10-12T00:00:00Z",
      "verified": null,
      "notes": "…"
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `slug` | The seed file name without extension; the candidate directory name when it came through the pipeline |
| `festival_id` | `festival.id` of the seed file (stable forever; groups and picks hang off it) |
| `seed_file`, `csv_dir` | Relative to the repo root; `csv_dir` is `null` for a festival entered as JSON only |
| `candidate` | `seed-data/candidates/<slug>` it was promoted from, or `null` for festivals entered by hand before the pipeline existed |
| `promoted_at` | When it became golden |
| `verified` | `{ at, by, source_url }` of the last human check against the official source, or `null` |
| `notes` | Free text: caveats, what still needs checking |

`candidate:promote` appends a festival here (or replaces the entry with the same slug or festival id,
keeping its `notes`) with `verified: null`. Edit `verified` by hand after checking the source.

## Commands

```sh
npm run admin -- candidate:promote <slug> [--dry-run]           # adds the festival to this index
npm run admin -- scout:eval <slug> --golden seed-data/<slug>.json [--tolerance <min>] [--json]
npm run admin -- festival:seed seed-data/<slug>.json --dry-run   # then publish as in docs/festival-data.md §4
```
