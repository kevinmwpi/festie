/**
 * `candidate:new`: an empty candidate bundle for an operator (or the scout agent) to fill in. The
 * CSVs get only their header rows, candidate.json starts with every section pending and low
 * confidence, and REVIEW.md is a template for the reviewer's summary.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CSV_FILES, CSV_SCHEMAS, type CsvFileName } from '../festival/import-csv';
import { assertSlug } from './slug';
import { candidatesRoot, CANDIDATE_FILE, REVIEW_FILE } from './store';
import { CANDIDATE_SECTIONS, CANDIDATE_VERSION, type CandidateFile, type CandidateSource } from './types';

export { isSlug, SLUG_PATTERN, slugify } from './slug';

export interface ScaffoldOptions {
  slug: string;
  name: string;
  trigger: CandidateFile['trigger'];
  sources?: CandidateSource[];
  /** The `seed-data` directory (defaults to the repo's). */
  root?: string;
  /** Recorded in `agent.tool`; defaults to `manual`. */
  tool?: string;
  now?: Date;
}

export interface ScaffoldResult {
  dir: string;
  file: CandidateFile;
  /** Files written, relative to `dir`. */
  files: string[];
}

/** Header row of a CSV: required columns first, then the optional ones with `id` last. */
export function csvHeader(file: CsvFileName): string {
  const schema = CSV_SCHEMAS[file];
  const optional = schema.optional.filter((column) => column !== 'id');
  return [...schema.required, ...optional, ...(schema.optional.includes('id') ? ['id'] : [])].join(',');
}

function reviewTemplate(file: CandidateFile): string {
  return [
    `# ${file.name} — candidate review`,
    '',
    `Slug: \`${file.slug}\`. Created ${file.created_at.slice(0, 10)} (${file.trigger.kind}${file.trigger.suggestion_id ? `, suggestion ${file.trigger.suggestion_id}` : ''}).`,
    '',
    '## Summary',
    '',
    '_What was found: dates, venue, how many stages, artists and sets; what is official and what is not._',
    '',
    '## Sources',
    '',
    ...(file.sources.length > 0
      ? file.sources.map((source) => `- ${source.url}${source.title ? ` — ${source.title}` : ''} (${source.kind})`)
      : ['_List every page the data came from, with what it was used for._']),
    '',
    '## Confidence',
    '',
    ...CANDIDATE_SECTIONS.map((section) => `- ${section}: ${file.confidence[section]} — _why_`),
    '',
    '## Double-check before approving',
    '',
    '- [ ] Dates and time zone match the official source',
    '- [ ] Late-night sets fall on the right festival day',
    '- [ ] Every stage and artist name is spelled as the organizer spells it',
    '',
    '## Open questions',
    '',
    '_Anything estimated, missing or contradictory between sources._',
    '',
  ].join('\n');
}

export function scaffoldCandidate(options: ScaffoldOptions): ScaffoldResult {
  const slug = assertSlug(options.slug);
  const name = options.name.trim();
  if (name === '') {
    throw new Error('A candidate needs a festival name');
  }
  const dir = path.join(candidatesRoot(options.root), slug);
  if (existsSync(dir)) {
    throw new Error(`Candidate "${slug}" already exists at ${dir}`);
  }
  const now = (options.now ?? new Date()).toISOString();
  const file: CandidateFile = {
    version: CANDIDATE_VERSION,
    slug,
    name,
    created_at: now,
    status: 'needs_review',
    trigger: {
      kind: options.trigger.kind,
      suggestion_id: options.trigger.suggestion_id ?? null,
      note: options.trigger.note ?? null,
    },
    agent: { tool: options.tool ?? 'manual', run_id: null, started_at: now, finished_at: null },
    sources: options.sources ?? [],
    confidence: { festival: 'low', stages: 'low', artists: 'low', sets: 'low' },
    notes: '',
    review: {
      decisions: { festival: 'pending', stages: 'pending', artists: 'pending', sets: 'pending' },
      by: null,
      at: null,
      notes: null,
    },
    promoted: null,
  };

  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const csv of CSV_FILES) {
    writeFileSync(path.join(dir, csv), `${csvHeader(csv)}\n`, 'utf8');
    files.push(csv);
  }
  writeFileSync(path.join(dir, CANDIDATE_FILE), `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  files.push(CANDIDATE_FILE);
  writeFileSync(path.join(dir, REVIEW_FILE), reviewTemplate(file), 'utf8');
  files.push(REVIEW_FILE);
  return { dir, file, files };
}
