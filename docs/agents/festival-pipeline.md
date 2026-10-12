# Festival data pipeline: agents, human review and the flywheel

How festival data (dates, stages, lineups, set times, schedule changes) and artwork (artist photos,
festival marks) get into Festie, who does what, and how the loop gets faster and more accurate with
every festival. Read this before running or changing the scout agent, the review tool or the golden
data. It extends [`festival-data.md`](../festival-data.md) (file formats, sourcing rules, publishing)
and the contract in [`v1-architecture.md`](../v1-architecture.md) §9.8.

The short version: **agents draft, a person approves, tools publish.** Nothing an agent writes reaches
the app until a human has approved it in the review tool and run the publish commands.

## 0. Why the loop is shaped like this

Festie publishes facts about real events and shows images it does not own. Three things go wrong when
that is left to automation alone:

1. **Wrong facts at the worst moment.** A set time that is off by an hour, or a stage name nobody at the
   venue uses, is discovered by a crew standing in the wrong field with no signal. The app's whole
   promise is "this is the plan, offline". So every schedule row carries where it came from and how
   sure we are, and a person checks a sample against the official source before it is published.
2. **Images we have no right to show.** Festival posters, logos and most artist photos are copyrighted
   (and the festival's name and marks are trademarks). An app that scrapes them is exposed to takedowns
   and to App Review guideline 5.2.1. So an image reaches the app only with a licence record that says
   why we may show it, and attribution is shown in the app (Settings → Photo credits).
3. **Silent drift.** If agents could write straight to the database, a bad run would be a production
   incident. Agents write files into a candidate directory in git; the review tool and the publish
   commands are the only path from there to the database, and both are run by a person.

## 1. Rules every agent follows

These restate [`festival-data.md`](../festival-data.md) §3 for agents and add the pipeline's own rules.

- **Facts only, from official public sources.** Festival name, dates, venue, stage names, artist names,
  set times, schedule changes. No bios, descriptions, editorial text, ticket info. The organizer's own
  site or official app listing first; press coverage only to confirm or to fill a gap, and said so.
- **Nominative names only.** Names as plain text. No logos, wordmarks, posters, poster cut-outs,
  official maps or brand colours copied from the festival (§4 below says what *is* allowed).
- **Provenance on everything.** Every candidate records its sources with access dates, which sections
  each source supports, a confidence per section, and (where it matters) per-row provenance. Unknown
  stays unknown: an estimated end time is marked `estimated` in the note, never presented as fact.
- **Agents never publish.** They never run `festival:seed`, `demo:seed` or `media:upload`, never write
  outside `seed-data/candidates/<slug>/`, never edit golden files, and never bypass the validator.
- **Images only with a licence record.** An agent may fetch an image only through a tool that records
  source and licence (`media:fetch-commons`) or by filling a licence record for an image a human
  supplied. No licence record, no file.
- **Say what failed.** If a page could not be opened (common from cloud sessions: the proxy blocks
  many hosts), the agent writes that into `candidate.json.notes` and lowers the confidence instead
  of working around it.
- **Reproducible.** Candidate bundles are plain files in git with the agent run recorded, so a review
  decision can always be traced back to what the agent saw.

## 2. Stages and roles

```
   intake            scout (agent)        enrich (agent+tools)      validate (tools)
 suggestions  ──►  official sources  ──►  artist registry match  ──►  import-csv
 scheduled scan     extract CSVs          licensed photos            festival:validate
 manual             provenance            generated marks            media:validate
                        │                                                  │
                        ▼                                                  ▼
                 seed-data/candidates/<slug>/  ◄──────────────────  review (human)
                                                                   review:serve
                                                                        │ approve
                                                                        ▼
                                              publish (human-run tools): candidate:promote
                                              → media:upload → festival:seed --dry-run → festival:seed
                                                                        │
                                                                        ▼
                                                  golden: seed-data/*.json, media/registry.json,
                                                          golden/index.json  (= eval baseline)
```

| Role | Who | Does | Must not |
|---|---|---|---|
| Intake | tools + person | Turns a user suggestion (`suggestions:list`, `suggestions:to-candidate`), a scheduled scan, or a manual request into a candidate stub (`candidate:new`) | Start a candidate for a leaked or rumoured lineup |
| Scout | agent (`/festival-scout`, workflow `festival-scout`) | Finds the official schedule, extracts festival facts, stages, artists, sets and changes into the CSVs, records sources and confidence, writes `REVIEW.md` | Invent or round times; copy text; publish |
| Enricher | agent + `media:fetch-commons` | Matches artists to the golden registry (same name → same id), fetches licensed photos with their licence and attribution, leaves pending image entries | Fetch from sources without licence metadata; store an NC/ND image |
| Validator | tools | `festival:import-csv`, `festival:validate`, `media:validate`; errors block, warnings are listed for the reviewer | — |
| Reviewer | person, in `review:serve` | Opens the sources, checks the facts (§6 checklist), approves or rejects each section and each image, writes notes | Approve a section whose sources could not be opened |
| Publisher | person, with tools | `candidate:promote`, then `media:upload`, then `festival:seed --dry-run` and `festival:seed` | Seed a candidate that was not promoted |
| Maintainer | agent + person | Near and during the festival: watches the official channels, produces *change* candidates (moved / cancelled sets, `festival-data.md` §4.1) through the same review | Edit the database directly |
| Evaluator | tools (`scout:eval`) + person | Scores an agent run against golden data; feeds failure modes back into the agent instructions (§7) | — |

## 3. The golden database

"Golden" means **a person approved it against the official source**. It is the only data the app shows
and the baseline every agent run is measured against. It lives in git, not only in the database, so
every change is reviewed and reversible:

| Where | What |
|---|---|
| `seed-data/<slug>-csv/`, `seed-data/<slug>.json` | The festival bundles (`festival-data.md` §1–§2) |
| `seed-data/media/registry.json` + `seed-data/media/<file>` | Approved images with source, licence, attribution and the sha256 of the stored file |
| `seed-data/golden/index.json` | One row per golden festival: slug, id, files, which candidate it came from, when it was promoted, and `verified` (the last human check against the official source: when, by whom, which page) |
| Supabase (`festivals`, `stages`, `artists`, `sets`, the `artwork` bucket) | The published copy, written only by `festival:seed` and `media:upload` from the files above |

Rules:

- Golden changes only through `candidate:promote` or a reviewed edit of the files followed by a seed.
  An edit made in the Supabase table editor is not golden and is overwritten by the next seed.
- Artists are global (`festival-data.md` §2): the same name gives the same id across festivals, so an
  approved photo of an artist is reused by every later festival automatically. The registry grows with
  each festival; later candidates mostly reuse known artists.
- A festival that is published but not `verified` (Head Trip 2026 today) is flagged in the index and in
  the release checklist. Verify it or set it back to draft before App Review.
- Golden festivals double as the **eval set**: run the scout on a past festival and compare with
  `scout:eval` (§7).

## 4. Artwork: what the app may show

The founder's request was poster cut-outs for festivals and artist photos for artists, because initials
are hard to tell apart. The visual goal is right; the sources need care:

- **Festival posters, logos and poster cut-outs are not used by default.** They are the organizer's
  copyrighted artwork and trademarks. Nominative use covers the *name* as text, not a reproduction of
  the artwork. Default: the festival keeps a generated mark (its accent tint and the flag icon today; a
  typographic tile is a planned option). An official logo is allowed only with a licence record of
  `organizer-permission` (written permission on file) or `press-kit-editorial` (a public press kit whose
  terms allow this use; link the kit), approved by a person. Ask organizers for a logo: many say yes.
- **Artist photos come from Wikimedia Commons by default**, resolved from Wikidata (artist → P18 image)
  by `media:fetch-commons`, which records the file page, licence and attribution. Only `CC0`, public
  domain, `CC BY` and `CC BY-SA` are accepted; `NC` (we are a commercial app) and `ND` (we crop and
  resize) are refused automatically. CC licences require attribution, so the app shows every credit in
  Settings → Photo credits, and the entry's `attribution` text is exactly what is shown. Coverage is
  good for headliners and patchy for small acts; those keep the monogram.
- **Other sources are a decision, not a default.** Spotify and Apple Music provide artist images through
  their APIs under developer terms with their own display and attribution rules; a label's press kit
  may allow editorial use. Any of these needs the terms read and the licence id and source recorded.
  Nothing in the pipeline fetches from them today.
- **Takedowns.** If a rights holder objects: set the entry's review to `rejected`, run `media:upload`
  (it clears the row and removes the object), note it in the registry. Same day.

This is not legal advice; have the policy reviewed before a public launch.

## 5. The flywheel

```
  user suggestions ─┐
  scheduled scan   ─┼─► candidate ─► review ─► publish ─► crews use it at the festival
  manual request   ─┘       ▲                     │
                            │                     ▼
                     agent instructions   corrections, schedule-change candidates,
                     + eval failure modes ◄── in-app reports, re-verification ─► golden grows
```

Each turn of the loop should make the next one cheaper and better:

1. **Intake gets sharper.** Suggestions tell us which festivals people actually want; a scan of large
   upcoming festivals (multi-day, multi-stage, within ~90 days, lineup announced) fills the rest.
2. **Scouting gets cheaper.** Known artists (ids, photos) are reused from golden. Known organizers have
   known source patterns (where Insomniac posts set times, how many days before) recorded in §7.
3. **Review gets faster.** The reviewer edits less when the agent's precision is higher; `scout:eval`
   measures that, and the review tool records what was rejected and why.
4. **Publishing is routine.** The same four commands every time; the dry run shows what changes.
5. **Feedback closes the loop.** Schedule changes during the event go through the change workflow
   (`festival-data.md` §4.1) as change candidates; user reports and re-verification update golden;
   the eval set grows with every published festival.

Metrics worth tracking per candidate (write them in `REVIEW.md` or the review notes):

| Metric | Why |
|---|---|
| Sources opened / sources needed | The agent's real access to official pages (cloud sessions are often blocked) |
| Sets precision / recall and median start-time error vs the reviewer's corrections (or vs golden on a re-run) | Agent accuracy |
| Sections rejected, and why | What to fix in the instructions |
| Images found / artists, and licence rejections | Coverage of the photo source |
| Hours from trigger to publish | The cost of a festival |
| Post-publish corrections | What review missed |

Cadence: a scan of upcoming festivals weekly (a Claude Code Routine can run the `festival-scout`
workflow); set times land 2–7 days before most festivals, so expect a candidate update then; during the
festival watch for changes daily.

## 6. Operating it

### Commands

```sh
npm run admin -- suggestions:list                    # what users asked for
npm run admin -- suggestions:to-candidate <id>       # or: candidate:new <slug> --name "<festival>"
# scout (agent) fills seed-data/candidates/<slug>/ — see §6 "Running the scout"
npm run admin -- review:serve                        # http://127.0.0.1:8787 — approve / reject
npm run admin -- candidate:promote <slug> --dry-run  # then without --dry-run
npm run admin -- media:validate
npm run admin -- media:upload --dry-run              # then without --dry-run (bucket + image columns + version bumps)
npm run admin -- festival:seed seed-data/<slug>.json --dry-run
npm run admin -- festival:seed seed-data/<slug>.json
```

Order matters for the database: migrations 012–013 before `media:upload`; `media:upload` before the
festival seed that should show the images (the seed bumps the version clients refetch on).

### Running the scout

- In a Claude Code session: `/festival-scout <slug> "<festival name>" [official url]` (the skill in
  `.claude/skills/festival-scout/SKILL.md` holds the procedure).
- As a workflow: `Workflow({ name: 'festival-scout', args: { slug, name, year, officialUrl, today } })`
  (`.claude/workflows/festival-scout.js`): parallel source sweeps, extraction, cross-checks, media
  enrichment, assembly, validation.
- From a Routine: a weekly prompt that lists large upcoming festivals without a candidate, then runs the
  workflow for each. The Routine still only produces candidates.

Cloud sessions reach few festival sites (the proxy returns 403 for most hosts); a run from the founder's
machine sees more. The agent records which sources it could open either way.

### Reviewing a candidate (checklist)

1. Open every source link. If the official schedule could not be opened by the agent, open it yourself;
   do not approve `sets` from press copies alone.
2. Festival: dates, time zone, venue, status `draft` (always; publishing is a separate seed).
3. Stages: names exactly as the organizer writes them; coordinates from public map data or empty.
4. Artists: names as announced (b2b sets as one name); check the photo, its licence id and attribution;
   reject anything not clearly the artist.
5. Sets: spot-check at least five per day against the source, all headliners, every set after midnight
   (festival days start at 06:00: a 1:00 AM set belongs to the previous day), and every row the agent
   marked `estimated` or `low`. Overlaps on one stage are warnings for a reason.
6. Changes: a moved or cancelled set must carry `status`/`original_start`/`note`, never a silent edit.
7. Notes: write what you corrected; the evaluator reads them.

### Publishing a change during a festival

The maintainer agent (or you) edits the golden CSV for the festival (`festival-data.md` §4.1), validates,
and seeds. For a large change, create a change candidate instead (`candidate:new <slug>-changes-<date>`
seeded from the golden CSVs) and review it like any other; promote overwrites the golden files.

## 7. Making the agent better

- Instructions live in `.claude/skills/festival-scout/SKILL.md` (procedure) and
  `.claude/workflows/festival-scout.js` (orchestration). Change them when a review finds a repeated
  failure; record the failure mode below.
- `scout:eval <slug> --golden seed-data/<golden>.json` scores a candidate against golden data:
  stage/artist/set precision and recall, start-time errors, stage mismatches. Run it on past festivals
  (Head Trip 2026, the demo festival shifted into the future) after any instruction change.
- Known failure modes to check for (extend this list):
  - Set times published only as an image; the agent reads a press copy instead. Record it.
  - Two weekends with one lineup (Coachella, EDC Las Vegas 2027): two festivals, shared artist ids.
  - After-midnight sets written on the next calendar date; late-night day bucketing.
  - "TBA" times: do not invent; leave the set out and say so (lineup-only support is a product gap, §8).
  - b2b / "presents" / "vs" naming: one artist row per billed act, named as billed.
  - Replacement acts with no slot time; cancelled acts deleted instead of marked `cancelled`.
  - Stage names that differ between the map and the schedule.
  - A moved set whose derived id would change (keep `original_start`).
  - Time zone from the venue, not the publisher.

## 8. Limits and open items

- **Lineup announced, times TBA.** Most festivals announce the lineup months before set times, but the
  schema requires set times, so the app can only publish once times exist (2–7 days before). This is
  the biggest gap for the flywheel: an announcement mode (artists without sets) is the next data
  feature.
- **Cloud network access.** Scouting from a cloud session is partly blind; the review step compensates,
  and runs from a local machine see more.
- **Image terms.** The Commons path is automatable and license-aware; Spotify/Apple paths need a terms
  review; posters and logos need permission. See §4.
- **Suggestions are not a conversation.** The in-app form stores the request; there is no reply channel
  yet. Say in the app copy what happens next ("we check it and add it if it's public").
