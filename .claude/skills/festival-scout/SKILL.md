---
name: festival-scout
description: Build a festival candidate bundle (dates, stages, lineup, set times, schedule changes, licensed artist photos) in seed-data/candidates/<slug>/ from official public sources, for human review. Use when asked to add, scout, update or re-check a festival. Never seeds or publishes.
argument-hint: <slug> "<festival name>" [official url]
---

# Festival scout

You produce a **candidate** for a person to review in the review tool. You never publish: no
`festival:seed`, no `demo:seed`, no `media:upload`, no writes outside `seed-data/candidates/<slug>/`,
no edits to golden files (`seed-data/*.json`, `seed-data/*-csv/`, `seed-data/media/registry.json`,
`seed-data/golden/`). Read `docs/agents/festival-pipeline.md` §1 (rules) and `docs/festival-data.md`
§1–§3 (formats, sourcing) before the first write.

Arguments: `<slug>` (`^[a-z0-9]+(-[a-z0-9]+)*$`, e.g. `countdown-nye-2026`), the festival name, and
optionally the official URL. `$ARGUMENTS` holds them.

## Scope

Scout only a festival that is on the watchlist (`npm run admin -- watchlist:list`) or that the admin
names in this request (add it with `watchlist:add --name ... --tier ...` first so the record exists).
Never go looking for other events. After scaffolding, run `npm run admin -- watchlist:set-status <slug>
candidate`.

## Procedure

1. **Scaffold.** `npm run admin -- candidate:new <slug> --name "<name>" [--source <official url>]`.
   If the directory exists, continue from it (an update run) and say so in `REVIEW.md`.
2. **Find the official source.** The organizer's site or official app listing: the lineup page, the
   set-times page, the venue/dates page. Record every page you open in `candidate.json.sources`
   (`url`, `title`, `kind` official|official-app|press|aggregator, `accessed_at`, `used_for`). If a page
   cannot be opened (proxy 403, DNS), record the attempt with `note: "could not open"` and use press
   coverage only to *confirm*, never as the sole source for set times. Say which sources failed in
   `REVIEW.md`.
3. **Festival facts → `festival.csv`.** Name as the organizer writes it, dates (festival local), IANA
   time zone of the venue, venue name, `status` **draft**, a neutral `accent_color` you choose (never
   the festival's brand colour), `source_url` = the official schedule page, coordinates and bounds from
   public map data (OpenStreetMap / the venue's public address), not from the festival's map art.
4. **Stages → `stages.csv`.** Names exactly as the organizer writes them. Coordinates only from public
   map data; leave empty otherwise.
5. **Artists → `artists.csv`.** One row per billed act, named as billed (`Dom Dolla b2b KETTAMA` is one
   act). Check `seed-data/golden/` and `seed-data/*.json` for the same name: reuse it exactly so the
   derived id matches and the artist's approved photo is reused.
6. **Sets → `sets.csv`.** `artist, stage, start, end` in festival local time `YYYY-MM-DD HH:MM`. Sets
   after midnight carry the next calendar date (the app buckets them under the previous festival day).
   Never invent a time: a missing end time may be estimated **only** with `note` =
   `end time estimated (<how>)`; a missing start means the set is left out and listed under "Missing"
   in `REVIEW.md`. Schedule changes use `status, original_start, note` (`docs/festival-data.md` §4.1).
   Cross-check set times against a second source when one exists; record the sources per row in
   `candidate.json.items.sets` keyed `<artist>|<YYYY-MM-DD HH:MM>` with `confidence`.
7. **Photos (optional, only through the tool).**
   `npm run admin -- media:fetch-commons --seed seed-data/candidates/<slug>/_seed.json --into seed-data/candidates/<slug>/media`
   after step 8 produced `_seed.json`; it records licence and attribution and leaves entries
   `pending`. Do not download images any other way. Festival logos: do not fetch; note in `REVIEW.md`
   whether the organizer offers a press kit.
8. **Validate.** `npm run admin -- festival:import-csv seed-data/candidates/<slug> --out seed-data/candidates/<slug>/_seed.json`
   then `npm run admin -- festival:validate seed-data/candidates/<slug>/_seed.json`. Fix errors in the
   CSVs; keep warnings and explain them in `REVIEW.md`. Delete `_seed.json` when done (it is derived).
9. **Confidence and notes.** Fill `candidate.json.confidence` per section (`high`: official source
   opened and consistent; `medium`: official source unavailable but two independent copies agree;
   `low`: one source, or inferred) and `notes`.
10. **`REVIEW.md`** (for the reviewer, in this order): what this is and the trigger; sources opened and
    sources that failed; counts (stages, artists, sets per day); what is estimated or low confidence,
    row by row; what is missing (acts without times, TBA slots); photo results (found / none / licence
    refused); the agent run id. Keep it factual and short.
11. **Stop.** Report the candidate path and the review command (`npm run admin -- review:serve`).
    Do not run it for the user, do not seed.

## Quality bar

- Every row traceable to a source the reviewer can open.
- No text copied from the organizer beyond names and times; no artwork, no brand colours.
- Times verified against the official page when it could be opened; otherwise marked.
- The bundle passes `festival:validate` with zero errors.
