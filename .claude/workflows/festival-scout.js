// Festival scout workflow: produces a reviewed-by-a-human candidate bundle in
// seed-data/candidates/<slug>/ (docs/agents/festival-pipeline.md). It never seeds the database.
//
// Workflow({ name: 'festival-scout', args: { slug, name, year, officialUrl, today, hints } })
//   slug        e.g. 'countdown-nye-2026'
//   name        festival name as the organizer writes it
//   year        edition year (number or string)
//   officialUrl optional known official site or schedule page
//   today       ISO date 'YYYY-MM-DD' (scripts cannot read the clock)
//   hints       optional free text (organizer, venue, city, suggestion id, known sources)
//   requestedBy 'admin' (default) or 'schedule'. A scheduled run must name a watchlist entry with
//               scout = true (`npm run admin -- watchlist:list --json`); the Assemble step refuses otherwise.
export const meta = {
  name: 'festival-scout',
  description: 'Scout a festival from official public sources into a candidate bundle for human review (never seeds)',
  whenToUse: 'Adding or updating a festival: lineup, stages, set times, schedule changes, licensed artist photos',
  phases: [
    { title: 'Discover', detail: 'parallel source sweeps' },
    { title: 'Extract', detail: 'facts, stages, artists, sets' },
    { title: 'Cross-check', detail: 'skeptics per section' },
    { title: 'Assemble', detail: 'CSVs, provenance, validation, photos, REVIEW.md' },
  ],
}

const a = args || {}
if (!a.slug || !a.name || !a.today) {
  throw new Error('festival-scout needs args { slug, name, today } (plus optional year, officialUrl, hints)')
}
const slug = String(a.slug)
const name = String(a.name)
const year = a.year ? String(a.year) : ''
const today = String(a.today)
const officialUrl = a.officialUrl ? String(a.officialUrl) : ''
const hints = a.hints ? String(a.hints) : ''
const requestedBy = a.requestedBy === 'schedule' ? 'schedule' : 'admin'
const candidateDir = `seed-data/candidates/${slug}`

const RULES = `Repo: /home/user/festie. Festival: "${name}" ${year} (slug ${slug}). Today: ${today}. ${officialUrl ? `Known official URL: ${officialUrl}.` : ''} ${hints ? `Hints: ${hints}.` : ''}
Rules (docs/agents/festival-pipeline.md §1, docs/festival-data.md §3): facts only from official public sources (organizer site or official app listing; press only to confirm); names as plain text; no artwork, logos, posters, brand colours; never invent times; record every page you tried with its URL, whether it opened (many hosts return 403 from this environment — record that), what it was used for and the access date. Never run festival:seed, demo:seed or media:upload; never write outside ${candidateDir}/. Scratch: /tmp/claude-0/-home-user/9d1a3812-444c-5bed-985c-fbc6a4a57d26/scratchpad/scout/${slug}/ (create it).`

const SOURCES = {
  type: 'object',
  properties: {
    sources: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          title: { type: 'string' },
          kind: { type: 'string', enum: ['official', 'official-app', 'press', 'aggregator', 'other'] },
          opened: { type: 'boolean' },
          used_for: { type: 'array', items: { type: 'string', enum: ['festival', 'stages', 'artists', 'sets'] } },
          summary: { type: 'string', description: 'What the page says that matters (dates, venue, stage names, how set times are published, when)' },
          note: { type: 'string' },
        },
        required: ['url', 'kind', 'opened', 'used_for', 'summary'],
      },
    },
    facts: { type: 'string', description: 'Dates, venue, city, time zone, organizer, edition, whether set times are out, and where/when they are usually published' },
  },
  required: ['sources', 'facts'],
}

const EXTRACT = {
  type: 'object',
  properties: {
    festival: {
      type: 'object',
      properties: {
        name: { type: 'string' }, start_date: { type: 'string' }, end_date: { type: 'string' }, timezone: { type: 'string' },
        venue_name: { type: 'string' }, source_url: { type: 'string' }, latitude: { type: 'number' }, longitude: { type: 'number' },
        default_zoom: { type: 'number' }, bounds_sw_lat: { type: 'number' }, bounds_sw_lng: { type: 'number' }, bounds_ne_lat: { type: 'number' }, bounds_ne_lng: { type: 'number' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, notes: { type: 'string' },
      },
      required: ['name', 'start_date', 'end_date', 'timezone', 'confidence'],
    },
    stages: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, zone: { type: 'string' }, latitude: { type: 'number' }, longitude: { type: 'number' }, sources: { type: 'array', items: { type: 'integer' } } }, required: ['name', 'sources'] } },
    artists: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, genre: { type: 'string' }, sources: { type: 'array', items: { type: 'integer' } } }, required: ['name', 'sources'] } },
    sets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          artist: { type: 'string' }, stage: { type: 'string' }, start: { type: 'string', description: 'YYYY-MM-DD HH:MM festival local' }, end: { type: 'string' },
          status: { type: 'string', enum: ['scheduled', 'moved', 'cancelled'] }, original_start: { type: 'string' }, note: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, sources: { type: 'array', items: { type: 'integer' } }, estimated_end: { type: 'boolean' },
        },
        required: ['artist', 'stage', 'start', 'end', 'confidence', 'sources'],
      },
    },
    missing: { type: 'array', items: { type: 'string' }, description: 'Acts announced without a usable time, TBA slots, stages without times' },
    confidence: { type: 'object', properties: { stages: { type: 'string' }, artists: { type: 'string' }, sets: { type: 'string' } }, required: ['stages', 'artists', 'sets'] },
    notes: { type: 'string' },
  },
  required: ['festival', 'stages', 'artists', 'sets', 'missing', 'confidence', 'notes'],
}

const CHECK = {
  type: 'object',
  properties: {
    section: { type: 'string' },
    problems: { type: 'array', items: { type: 'object', properties: { row: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' }, source: { type: 'string' } }, required: ['row', 'problem', 'fix'] } },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    summary: { type: 'string' },
  },
  required: ['section', 'problems', 'confidence', 'summary'],
}

phase('Discover')
const sweeps = [
  { key: 'official', prompt: `Find and read the ORGANIZER'S OWN pages for this festival: home, lineup, set times / schedule, venue + dates, official app listing (App Store / Play) and its latest "set times" post. Prefer WebFetch on the official domain; if it fails, say so and use WebSearch excerpts of the same official pages.` },
  { key: 'press', prompt: `Find PRESS and reputable coverage that copies the official schedule (EDM Identity, DJ Mag, Billboard, local news, the organizer's press releases): set-times posts, lineup announcements, last-minute changes (moved/cancelled acts, weather). Capture dates and exact times they quote.` },
  { key: 'history', prompt: `Find how this festival (or organizer) published set times in PREVIOUS editions: how many days before, in which app or page, as an image or text; stage names used; whether two weekends share a lineup; typical day start/end times and after-midnight sets. Also check seed-data/ and seed-data/golden/ for an earlier edition of this festival in the repo.` },
]
const found = (await parallel(sweeps.map((s) => () => agent(`${RULES}\n\nSweep "${s.key}": ${s.prompt}\nReturn every page you tried as a source entry (opened true/false) with a short factual summary.`, { label: `sweep:${s.key}`, phase: 'Discover', schema: SOURCES })))).filter(Boolean)
const allSources = found.flatMap((f) => f.sources)
const factsSummary = found.map((f) => f.facts).join('\n')
log(`${allSources.length} sources recorded (${allSources.filter((s) => s.opened).length} opened)`)

phase('Extract')
const extracted = await agent(
  `${RULES}\n\nSources found (index = position in this list, cite them by index):\n${JSON.stringify(allSources, null, 1)}\n\nFacts so far:\n${factsSummary}\n\nExtract the festival bundle. Re-open the official schedule page(s) yourself when they opened before. Dates festival-local; IANA time zone of the venue; stage names exactly as written; one artist per billed act; sets as YYYY-MM-DD HH:MM festival local (after-midnight sets on the next calendar date); never invent a time — list acts without a usable time under "missing"; an estimated end is allowed only with estimated_end=true and a note saying how. Reuse artist names exactly as they appear in seed-data/*.json when the same act exists there (grep). Coordinates/bounds only from public map data (OpenStreetMap/Nominatim) — leave empty if unsure. Schedule changes already announced: status moved/cancelled with original_start and a note.`,
  { label: 'extract', phase: 'Extract', schema: EXTRACT },
)
if (!extracted) throw new Error('extraction returned nothing')
log(`extracted ${extracted.stages.length} stages, ${extracted.artists.length} artists, ${extracted.sets.length} sets, ${extracted.missing.length} missing`)

phase('Cross-check')
const checks = (await parallel(['festival', 'stages', 'artists', 'sets'].map((section) => () =>
  agent(
    `${RULES}\n\nYou are a skeptical checker for the "${section}" section. Sources:\n${JSON.stringify(allSources, null, 1)}\n\nExtracted bundle:\n${JSON.stringify(extracted, null, 1)}\n\nRe-verify the ${section} rows against the cited sources (open them again where possible). Report concrete problems only: wrong value, wrong source, invented or rounded time, naming not as billed, after-midnight date errors, time zone mistakes, missing announced changes, duplicate acts, stage names that differ between map and schedule. Set the section confidence you would defend to a reviewer.`,
    { label: `check:${section}`, phase: 'Cross-check', schema: CHECK },
  ),
))).filter(Boolean)
const problemCount = checks.reduce((n, c) => n + c.problems.length, 0)
log(`${problemCount} problems from cross-checks`)

phase('Assemble')
const assembled = await agent(
  `${RULES}\n\nWrite the candidate bundle to ${candidateDir}/ (create it; if it already exists, keep candidate.json's created_at/trigger and treat this as an update).
Inputs — sources:\n${JSON.stringify(allSources, null, 1)}\n\nExtracted:\n${JSON.stringify(extracted, null, 1)}\n\nCross-check problems (apply every fix you agree with; mention the rest in REVIEW.md):\n${JSON.stringify(checks, null, 1)}

Steps:
0. Scope check: run \`npm run admin -- watchlist:list --json\`. This run was requested by: ${requestedBy}. If "schedule" and the slug ${slug} is not an entry with "scout": true, STOP: write nothing and return "not scoutable on schedule: <reason>". If "admin" and the slug is not on the watchlist, add it: \`npm run admin -- watchlist:add --slug ${slug} --name "${name}" --tier A${officialUrl ? ` --url ${officialUrl}` : ''}\`.
1. Try \`npm run admin -- candidate:new ${slug} --name "${name}"${officialUrl ? ` --source ${officialUrl}` : ''}\` to scaffold; if the command is unavailable or the dir exists, write the files yourself following docs/festival-data.md §2 and apps/admin-tools/src/candidates/types.ts.
2. Write festival.csv (status draft, a neutral accent_color like #E4D9FF, source_url = the official schedule page), stages.csv, artists.csv, sets.csv (header artist,stage,start,end,status,original_start,note; status/original_start/note only when a change applies; estimated ends get note "end time estimated (<how>)").
3. Write candidate.json: version 1, slug, name, created_at ${today}T00:00:00Z (keep existing), status needs_review, trigger {kind:'manual'}, agent {tool:'claude-code workflow festival-scout', started_at}, sources (url,title,kind,accessed_at ${today},used_for,note incl. "could not open"), confidence per section (from the checks), notes, items.sets keyed "<artist>|<YYYY-MM-DD HH:MM>" → {sources:[indexes], confidence, note}, review {decisions all pending, by null, at null}.
4. Run \`npm run admin -- festival:import-csv ${candidateDir} --out ${candidateDir}/_seed.json\` then \`npm run admin -- festival:validate ${candidateDir}/_seed.json\`; fix errors in the CSVs until there are none; keep the warnings for REVIEW.md.
5. Photos: run \`npm run admin -- media:fetch-commons --seed ${candidateDir}/_seed.json --into ${candidateDir}/media\` once (it may fail without network — record the outcome). Never fetch images any other way.
6. Delete ${candidateDir}/_seed.json. Write REVIEW.md: what this is; sources opened vs failed; counts per day; estimated/low-confidence rows; missing acts; cross-check problems not applied and why; photo results; validation warnings.
7. Run \`npm run admin -- watchlist:set-status ${slug} candidate\`, then \`git -C /home/user/festie status --short ${candidateDir} seed-data/golden/watchlist.json\` and list the files. Do not commit.
Return a short report: files, counts, warnings, what the reviewer must check first.`,
  { label: 'assemble', phase: 'Assemble' },
)

return {
  candidateDir,
  sources: allSources.length,
  opened: allSources.filter((s) => s.opened).length,
  counts: { stages: extracted.stages.length, artists: extracted.artists.length, sets: extracted.sets.length, missing: extracted.missing.length },
  checkProblems: problemCount,
  report: assembled,
  next: 'npm run admin -- review:serve',
}
