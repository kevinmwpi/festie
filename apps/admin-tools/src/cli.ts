import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';

import { formatCandidateTable, listCandidates, promoteCandidate, evaluateCandidate, formatEvalReport } from './candidates/store';
import { scaffoldCandidate } from './candidates/scaffold';
import { buildDemoPlan } from './demo/plan';
import { describeDemoPlan, runDemoSeed } from './demo/seed';
import {
  createAdminClient,
  readJsonFile,
  readSupabaseConfig,
  repoRoot,
  requireSupabaseConfig,
  resolveInputPath,
  resolveOutputPath,
  UsageError,
} from './env';
import { buildSeedFromCsv, CSV_FILES, type CsvInput } from './festival/import-csv';
import { applyFestivalSeed, describeSeedPlan, planFestivalSeed } from './festival/seed';
import { shiftFestivalDates } from './festival/shift-dates';
import type { FestivalSeed } from './festival/types';
import { formatIssues, validateFestivalSeed } from './festival/validate';
import { MEDIA_COMMANDS, MEDIA_HELP } from './media/command';
import { banUser, describeBan, resolveBanTarget } from './moderation/ban';
import { formatReportTable, listReports, planContentRemoval, REPORT_STATUSES, type ReportStatus } from './moderation/reports';
import { addTerms, listTerms, normalizeTerms, removeTerms } from './moderation/terms';
import { REVIEW_SERVE_USAGE, reviewServeCommand } from './review/server';
import { storageSweepOrphans } from './storage/command';
import {
  formatSuggestionTable,
  isSuggestionStatus,
  listSuggestions,
  setSuggestionStatus,
  SUGGESTION_STATUSES,
  suggestionToCandidate,
  type SuggestionStatus,
} from './suggestions/list';
import {
  addWatchlistEntry,
  formatSuggestionRanking,
  formatWatchlistTable,
  goldenNameMap,
  groupSuggestions,
  loadSignals,
  noSignals,
  rankWatchlist,
  readWatchlist,
  removeWatchlistEntry,
  setWatchlistStatus,
  TIERS,
  WATCH_STATUSES,
  type Tier,
  type WatchStatus,
} from './watchlist/watchlist';

const HELP = `Festie admin tools (service role). Usage:

  npm run admin -- <command> [options]

Festival data
  festival:validate <file>                         Validate a festival JSON file (offline)
  festival:seed <file> [--dry-run]                 Validate and write a festival (auto-bumps version)
  festival:import-csv <dir> [--out <file>]         festival.csv, stages.csv, artists.csv, sets.csv -> JSON
  festival:shift-dates <file> --start <YYYY-MM-DD> [--out <file>] [--dry-run]
                                                   Move a demo festival to new dates (wall-clock preserved)
  demo:seed [--file <file>] [--dry-run]            Demo festival + fake crew, picks, meetup photo, live map

Moderation
  reports:list [--status open|reviewed|actioned|dismissed|all] [--limit <n>] [--json]
  reports:remove-content <report_id> [--dry-run]   Delete the reported meetup/photo (or reset name) + mark actioned
  users:ban <user_id> [--dry-run]                  Ban, remove memberships/locations/content, new invite codes
  moderation:list-terms
  moderation:add-terms <term...> [--dry-run]
  moderation:remove-terms <term...> [--dry-run]

Storage
  storage:sweep-orphans [--dry-run]                Delete totem photos no meetup references (older than 24 h)

Watchlist (which festivals the scout may work on: flagship tier, user demand, or an admin request)
  watchlist:list [--json]                          Priority order; "scout = yes" is what a scheduled run may take
  watchlist:add --name <name> --tier A|B|C [--slug <slug>] [--year <n>] [--url <official>] [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--note <text>]
  watchlist:set-status <slug> watching|candidate|published|passed|dropped
  watchlist:remove <slug>
  suggestions:ranking [--json]                     What users ask for most, with watchlist/golden matches

Candidates (seed-data/candidates, reviewed before anything is seeded; docs/agents/festival-pipeline.md)
  candidate:list [--json]                          Candidate bundles with counts, images and validation issues
  candidate:new <slug> --name <name> [--source <url>]
                                                   Empty bundle (headed CSVs, candidate.json, REVIEW.md)
  ${REVIEW_SERVE_USAGE}
                                                   Local review page for the candidates (127.0.0.1 only)
  candidate:promote <slug> [--dry-run]             Approved candidate -> seed-data/<slug>.json + CSV dir, media, golden index
  scout:eval <slug> --golden <seed.json> [--tolerance <min>] [--json]
                                                   Score a candidate against a golden festival file

Suggestions (festival_suggestions from the app's "Suggest a festival" form)
  suggestions:list [--status new|accepted|rejected|duplicate|all] [--limit <n>] [--json]
  suggestions:to-candidate <id> [--slug <slug>]    Scaffold a candidate from a suggestion and mark it accepted
  suggestions:set-status <id> <new|accepted|rejected|duplicate>

${MEDIA_HELP}

Environment: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).
See docs/festival-data.md.`;

type Log = (line: string) => void;
const log: Log = (line) => process.stdout.write(`${line}\n`);

interface Parsed {
  positionals: string[];
  values: Record<string, string | boolean | undefined>;
}

function parse(args: string[], options: ParseArgsConfig['options'], positionals: { min: number; max: number; usage: string }): Parsed {
  let parsed;
  try {
    parsed = parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(`${(error as Error).message}\nUsage: ${positionals.usage}`);
  }
  if (parsed.positionals.length < positionals.min || parsed.positionals.length > positionals.max) {
    throw new UsageError(`Usage: ${positionals.usage}`);
  }
  return parsed as Parsed;
}

const DRY_RUN = { 'dry-run': { type: 'boolean' } } as const;

function loadValidSeed(fileArgument: string): { seed: FestivalSeed; filePath: string } {
  const filePath = resolveInputPath(fileArgument);
  const result = validateFestivalSeed(readJsonFile(filePath));
  if (result.warnings.length > 0) {
    log(`Warnings in ${filePath}:\n${formatIssues(result.warnings)}`);
  }
  if (!result.seed) {
    throw new UsageError(`${filePath} is not a valid festival file:\n${formatIssues(result.errors)}`);
  }
  return { seed: result.seed, filePath };
}

function summarizeSeed(seed: FestivalSeed): string {
  const f = seed.festival;
  return `${f.name} (${f.id}) ${f.start_date}..${f.end_date} ${f.timezone}, ${f.status}${f.is_demo ? ', demo' : ''}: ` +
    `${seed.stages.length} stages, ${seed.artists.length} artists, ${seed.sets.length} sets`;
}

function writeSeedFile(filePath: string, seed: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
}

async function festivalValidate(args: string[]): Promise<void> {
  const { positionals } = parse(args, {}, { min: 1, max: 1, usage: 'festival:validate <file>' });
  const { seed, filePath } = loadValidSeed(positionals[0]);
  log(`OK ${filePath}\n${summarizeSeed(seed)}`);
}

async function festivalSeed(args: string[]): Promise<void> {
  const { positionals, values } = parse(args, DRY_RUN, { min: 1, max: 1, usage: 'festival:seed <file> [--dry-run]' });
  const { seed } = loadValidSeed(positionals[0]);
  log(summarizeSeed(seed));
  const config = values['dry-run'] ? readSupabaseConfig() : requireSupabaseConfig();
  if (!config) {
    log('Dry run: file is valid. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to also diff against the database.');
    return;
  }
  const client = createAdminClient(config);
  const plan = await planFestivalSeed(client, seed);
  log(describeSeedPlan(plan));
  if (values['dry-run']) {
    log('Dry run: nothing written.');
    return;
  }
  await applyFestivalSeed(client, seed, plan);
  log(`Seeded ${seed.festival.name} at version ${plan.nextVersion} (${seed.festival.status}).`);
}

async function festivalImportCsv(args: string[]): Promise<void> {
  const { positionals, values } = parse(
    args,
    { out: { type: 'string' } },
    { min: 1, max: 1, usage: 'festival:import-csv <dir> [--out <file>]' },
  );
  const dir = resolveInputPath(positionals[0]);
  const input = {} as CsvInput;
  for (const file of CSV_FILES) {
    const filePath = path.join(dir, file);
    if (!existsSync(filePath)) {
      throw new UsageError(`Missing ${filePath} (expected ${CSV_FILES.join(', ')})`);
    }
    input[file] = readFileSync(filePath, 'utf8');
  }
  const built = buildSeedFromCsv(input);
  if (!built.seed) {
    throw new UsageError(`CSV import failed:\n${formatIssues(built.errors)}`);
  }
  const result = validateFestivalSeed(built.seed);
  if (result.warnings.length > 0) {
    process.stderr.write(`Warnings:\n${formatIssues(result.warnings)}\n`);
  }
  if (!result.seed) {
    throw new UsageError(`Imported data is not a valid festival:\n${formatIssues(result.errors)}`);
  }
  if (typeof values.out === 'string') {
    const outPath = resolveOutputPath(values.out);
    writeSeedFile(outPath, result.seed);
    log(`Wrote ${outPath}\n${summarizeSeed(result.seed)}`);
  } else {
    process.stdout.write(`${JSON.stringify(result.seed, null, 2)}\n`);
  }
}

async function festivalShiftDates(args: string[]): Promise<void> {
  const { positionals, values } = parse(
    args,
    { start: { type: 'string' }, out: { type: 'string' }, ...DRY_RUN },
    { min: 1, max: 1, usage: 'festival:shift-dates <file> --start <YYYY-MM-DD> [--out <file>] [--dry-run]' },
  );
  if (typeof values.start !== 'string') {
    throw new UsageError('Usage: festival:shift-dates <file> --start <YYYY-MM-DD> [--out <file>] [--dry-run]');
  }
  const { seed, filePath } = loadValidSeed(positionals[0]);
  let shifted;
  try {
    shifted = shiftFestivalDates(seed, values.start);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const check = validateFestivalSeed(shifted.seed);
  if (!check.seed) {
    throw new Error(`Shifted festival failed validation:\n${formatIssues(check.errors)}`);
  }
  log(`Shifting by ${shifted.days} day(s): ${seed.festival.start_date}..${seed.festival.end_date} -> ` +
    `${shifted.seed.festival.start_date}..${shifted.seed.festival.end_date}`);
  if (values['dry-run']) {
    log('Dry run: nothing written.');
    return;
  }
  const outPath = typeof values.out === 'string' ? resolveOutputPath(values.out) : filePath;
  writeSeedFile(outPath, shifted.seed);
  log(`Wrote ${outPath}. Run festival:seed (or demo:seed) to publish it.`);
}

async function demoSeed(args: string[]): Promise<void> {
  const { values } = parse(
    args,
    { file: { type: 'string' }, ...DRY_RUN },
    { min: 0, max: 0, usage: 'demo:seed [--file <file>] [--dry-run]' },
  );
  const file = typeof values.file === 'string' ? values.file : path.join(repoRoot(), 'seed-data', 'demo-festival.json');
  const { seed } = loadValidSeed(file);
  let plan;
  try {
    plan = buildDemoPlan(seed);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  log(summarizeSeed(seed));
  log(describeDemoPlan(plan));
  const totemPath = path.join(repoRoot(), 'seed-data', 'demo-totem.jpg');
  if (!existsSync(totemPath)) {
    throw new UsageError(`Missing demo totem photo ${totemPath}`);
  }
  if (values['dry-run']) {
    log('Dry run: nothing written.');
    return;
  }
  const client = createAdminClient(requireSupabaseConfig());
  await runDemoSeed(client, seed, plan, readFileSync(totemPath), log);
  log('Demo content seeded. The reviewer account joins "Festie Demo Crew" on every demo login (prepare_demo_account).');
}

async function reportsList(args: string[]): Promise<void> {
  const { values } = parse(
    args,
    { status: { type: 'string' }, limit: { type: 'string' }, json: { type: 'boolean' } },
    { min: 0, max: 0, usage: 'reports:list [--status open|reviewed|actioned|dismissed|all] [--limit <n>] [--json]' },
  );
  const status = (typeof values.status === 'string' ? values.status : 'open') as ReportStatus | 'all';
  if (status !== 'all' && !REPORT_STATUSES.includes(status)) {
    throw new UsageError(`--status must be one of ${[...REPORT_STATUSES, 'all'].join(', ')}`);
  }
  const limit = typeof values.limit === 'string' ? Number(values.limit) : 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new UsageError('--limit must be an integer between 1 and 1000');
  }
  const reports = await listReports(createAdminClient(requireSupabaseConfig()), { status, limit });
  log(values.json ? JSON.stringify(reports, null, 2) : formatReportTable(reports));
}

async function reportsRemoveContent(args: string[]): Promise<void> {
  const { positionals, values } = parse(args, DRY_RUN, {
    min: 1,
    max: 1,
    usage: 'reports:remove-content <report_id> [--dry-run]',
  });
  const client = createAdminClient(requireSupabaseConfig());
  const actions = await planContentRemoval(client, positionals[0]);
  log(actions.map((action) => `  - ${action.description}`).join('\n'));
  if (values['dry-run']) {
    log('Dry run: nothing changed.');
    return;
  }
  for (const action of actions) {
    await action.run();
  }
  log('Done.');
}

async function usersBan(args: string[]): Promise<void> {
  const { positionals, values } = parse(args, DRY_RUN, { min: 1, max: 1, usage: 'users:ban <user_id> [--dry-run]' });
  const client = createAdminClient(requireSupabaseConfig());
  const target = await resolveBanTarget(client, positionals[0]);
  log(describeBan(target));
  if (values['dry-run']) {
    log('Dry run: nothing changed.');
    return;
  }
  const { removedObjects } = await banUser(client, target);
  log(`Banned. Removed ${removedObjects} photo(s).`);
}

async function moderationListTerms(args: string[]): Promise<void> {
  parse(args, {}, { min: 0, max: 0, usage: 'moderation:list-terms' });
  const terms = await listTerms(createAdminClient(requireSupabaseConfig()));
  log(terms.join('\n'));
  log(`${terms.length} term(s).`);
}

async function moderationChangeTerms(args: string[], mode: 'add' | 'remove'): Promise<void> {
  const usage = `moderation:${mode}-terms <term...> [--dry-run]`;
  const { positionals, values } = parse(args, DRY_RUN, { min: 1, max: 500, usage });
  const { terms, errors } = normalizeTerms(positionals);
  if (errors.length > 0) {
    throw new UsageError(`Invalid term(s):\n${errors.map((error) => `  - ${error}`).join('\n')}`);
  }
  log(`${mode === 'add' ? 'Add' : 'Remove'}: ${terms.join(', ')}`);
  if (values['dry-run']) {
    log('Dry run: nothing changed.');
    return;
  }
  const client = createAdminClient(requireSupabaseConfig());
  if (mode === 'add') {
    await addTerms(client, terms);
    log(`Added ${terms.length} term(s) (existing ones are kept). New names/titles are checked immediately; existing content is not rescanned.`);
  } else {
    log(`Removed ${await removeTerms(client, terms)} term(s).`);
  }
}

async function candidateList(args: string[]): Promise<void> {
  const { values } = parse(args, { json: { type: 'boolean' } }, { min: 0, max: 0, usage: 'candidate:list [--json]' });
  const candidates = await listCandidates();
  log(values.json ? JSON.stringify(candidates, null, 2) : formatCandidateTable(candidates));
}

async function candidateNew(args: string[]): Promise<void> {
  const usage = 'candidate:new <slug> --name <name> [--source <url>]';
  const { positionals, values } = parse(args, { name: { type: 'string' }, source: { type: 'string' } }, { min: 1, max: 1, usage });
  if (typeof values.name !== 'string' || values.name.trim() === '') {
    throw new UsageError(`Usage: ${usage}`);
  }
  let result;
  try {
    result = scaffoldCandidate({
      slug: positionals[0],
      name: values.name.trim(),
      trigger: { kind: 'manual' },
      sources:
        typeof values.source === 'string'
          ? [{ url: values.source, title: null, kind: 'other', accessed_at: new Date().toISOString(), used_for: [] }]
          : [],
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  log(`Created ${result.dir}\n${result.files.map((file) => `  - ${file}`).join('\n')}`);
  log('Fill the CSVs (or run the festival-scout agent), then: npm run admin -- review:serve');
}

async function candidatePromote(args: string[]): Promise<void> {
  const { positionals, values } = parse(args, DRY_RUN, { min: 1, max: 1, usage: 'candidate:promote <slug> [--dry-run]' });
  let result;
  try {
    result = await promoteCandidate(positionals[0], { dryRun: Boolean(values['dry-run']) });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  log(result.actions.map((action) => `  - ${action}`).join('\n'));
  if (values['dry-run']) {
    log('Dry run: nothing written.');
    return;
  }
  log(`Promoted ${result.slug} (${result.mediaMerged} image(s) merged). Next: npm run admin -- media:upload --dry-run, then festival:seed ${result.seedFile} --dry-run.`);
}

async function scoutEval(args: string[]): Promise<void> {
  const usage = 'scout:eval <slug> --golden <seed.json> [--tolerance <min>] [--json]';
  const { positionals, values } = parse(
    args,
    { golden: { type: 'string' }, tolerance: { type: 'string' }, json: { type: 'boolean' } },
    { min: 1, max: 1, usage },
  );
  if (typeof values.golden !== 'string') {
    throw new UsageError(`Usage: ${usage}`);
  }
  const tolerance = typeof values.tolerance === 'string' ? Number(values.tolerance) : 10;
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 240) {
    throw new UsageError('--tolerance must be a whole number of minutes between 0 and 240');
  }
  let report;
  try {
    report = await evaluateCandidate(positionals[0], resolveInputPath(values.golden), { toleranceMinutes: tolerance });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  log(values.json ? JSON.stringify(report, null, 2) : formatEvalReport(report));
}

async function suggestionsList(args: string[]): Promise<void> {
  const usage = 'suggestions:list [--status new|accepted|rejected|duplicate|all] [--limit <n>] [--json]';
  const { values } = parse(args, { status: { type: 'string' }, limit: { type: 'string' }, json: { type: 'boolean' } }, { min: 0, max: 0, usage });
  const status = typeof values.status === 'string' ? values.status : 'new';
  if (status !== 'all' && !isSuggestionStatus(status)) {
    throw new UsageError(`--status must be one of ${[...SUGGESTION_STATUSES, 'all'].join(', ')}`);
  }
  const limit = typeof values.limit === 'string' ? Number(values.limit) : 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new UsageError('--limit must be an integer between 1 and 1000');
  }
  const rows = await listSuggestions(createAdminClient(requireSupabaseConfig()), { status: status as SuggestionStatus | 'all', limit });
  log(values.json ? JSON.stringify(rows, null, 2) : formatSuggestionTable(rows));
}

async function suggestionsToCandidate(args: string[]): Promise<void> {
  const { positionals, values } = parse(args, { slug: { type: 'string' } }, { min: 1, max: 1, usage: 'suggestions:to-candidate <id> [--slug <slug>]' });
  let result;
  try {
    result = await suggestionToCandidate(createAdminClient(requireSupabaseConfig()), {
      id: positionals[0],
      slug: typeof values.slug === 'string' ? values.slug : undefined,
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  log(`Created ${result.dir} and marked the suggestion accepted. Next: run the festival-scout agent for it, then review:serve.`);
}

async function suggestionsSetStatus(args: string[]): Promise<void> {
  const usage = 'suggestions:set-status <id> <new|accepted|rejected|duplicate>';
  const { positionals } = parse(args, {}, { min: 2, max: 2, usage });
  if (!isSuggestionStatus(positionals[1])) {
    throw new UsageError(`Usage: ${usage}`);
  }
  try {
    await setSuggestionStatus(createAdminClient(requireSupabaseConfig()), positionals[0], positionals[1]);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  log(`Suggestion ${positionals[0]} is now ${positionals[1]}.`);
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function watchlistList(args: string[]): Promise<void> {
  const { values } = parse(args, { json: { type: 'boolean' } }, { min: 0, max: 0, usage: 'watchlist:list [--json]' });
  const config = readSupabaseConfig();
  const signals = config ? await loadSignals(createAdminClient(config)) : noSignals();
  const ranked = rankWatchlist(readWatchlist(), signals, todayKey());
  log(values.json ? JSON.stringify(ranked, null, 2) : formatWatchlistTable(ranked, { signalsLoaded: Boolean(config) }));
}

async function watchlistAdd(args: string[]): Promise<void> {
  const usage =
    'watchlist:add --name <name> --tier A|B|C [--slug <slug>] [--year <n>] [--url <official>] [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--note <text>]';
  const { values } = parse(
    args,
    {
      name: { type: 'string' }, tier: { type: 'string' }, slug: { type: 'string' }, year: { type: 'string' },
      url: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, note: { type: 'string' },
    },
    { min: 0, max: 0, usage },
  );
  if (typeof values.name !== 'string' || values.name.trim() === '' || !TIERS.includes(values.tier as Tier)) {
    throw new UsageError(`Usage: ${usage}`);
  }
  const year = typeof values.year === 'string' ? Number(values.year) : null;
  if (year !== null && !Number.isInteger(year)) {
    throw new UsageError('--year must be a whole number');
  }
  let result;
  try {
    result = addWatchlistEntry({
      slug: typeof values.slug === 'string' ? values.slug : undefined,
      name: values.name,
      tier: values.tier as Tier,
      year,
      officialUrl: typeof values.url === 'string' ? values.url : null,
      startDate: typeof values.start === 'string' ? values.start : null,
      endDate: typeof values.end === 'string' ? values.end : null,
      note: typeof values.note === 'string' ? values.note : null,
      addedBy: process.env.USER ?? process.env.USERNAME ?? null,
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  log(`${result.replaced ? 'Updated' : 'Added'} ${result.entry.slug} (tier ${result.entry.tier}).`);
}

async function watchlistSetStatus(args: string[]): Promise<void> {
  const usage = `watchlist:set-status <slug> ${WATCH_STATUSES.join('|')}`;
  const { positionals } = parse(args, {}, { min: 2, max: 2, usage });
  if (!(WATCH_STATUSES as readonly string[]).includes(positionals[1])) {
    throw new UsageError(`Usage: ${usage}`);
  }
  try {
    const entry = setWatchlistStatus(positionals[0], positionals[1] as WatchStatus);
    log(`${entry.slug} is now ${entry.status}.`);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

async function watchlistRemove(args: string[]): Promise<void> {
  const { positionals } = parse(args, {}, { min: 1, max: 1, usage: 'watchlist:remove <slug>' });
  log(removeWatchlistEntry(positionals[0]) ? `Removed ${positionals[0]}.` : `${positionals[0]} was not on the watchlist.`);
}

async function suggestionsRanking(args: string[]): Promise<void> {
  const { values } = parse(args, { json: { type: 'boolean' } }, { min: 0, max: 0, usage: 'suggestions:ranking [--json]' });
  const rows = await listSuggestions(createAdminClient(requireSupabaseConfig()), { status: 'all', limit: 1000 });
  const groups = groupSuggestions(rows, readWatchlist(), goldenNameMap());
  log(values.json ? JSON.stringify(groups, null, 2) : formatSuggestionRanking(groups));
}

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  'festival:validate': festivalValidate,
  'festival:seed': festivalSeed,
  'festival:import-csv': festivalImportCsv,
  'festival:shift-dates': festivalShiftDates,
  'demo:seed': demoSeed,
  'reports:list': reportsList,
  'reports:remove-content': reportsRemoveContent,
  'users:ban': usersBan,
  'moderation:list-terms': moderationListTerms,
  'moderation:add-terms': (args) => moderationChangeTerms(args, 'add'),
  'moderation:remove-terms': (args) => moderationChangeTerms(args, 'remove'),
  'storage:sweep-orphans': (args) => storageSweepOrphans(args, log),
  'candidate:list': candidateList,
  'candidate:new': candidateNew,
  'candidate:promote': candidatePromote,
  'review:serve': (args) => reviewServeCommand(args, log),
  'scout:eval': scoutEval,
  'suggestions:list': suggestionsList,
  'suggestions:to-candidate': suggestionsToCandidate,
  'suggestions:set-status': suggestionsSetStatus,
  'suggestions:ranking': suggestionsRanking,
  'watchlist:list': watchlistList,
  'watchlist:add': watchlistAdd,
  'watchlist:set-status': watchlistSetStatus,
  'watchlist:remove': watchlistRemove,
  ...Object.fromEntries(
    Object.entries(MEDIA_COMMANDS).map(([name, run]) => [name, (args: string[]) => run(args, log)]),
  ),
};

export async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    log(HELP);
    return command ? 0 : 2;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    process.stderr.write(`Unknown command "${command}".\n\n${HELP}\n`);
    return 2;
  }
  try {
    await handler(args);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (require.main === module) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
