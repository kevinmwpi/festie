/**
 * Candidate festival bundles: what the scout agent produces and a human reviews before anything is
 * seeded (docs/agents/festival-pipeline.md). One directory per candidate under `seed-data/candidates/`:
 *
 *   <slug>/festival.csv, stages.csv, artists.csv, sets.csv   the usual CSV format (festival-data.md §2)
 *   <slug>/candidate.json                                     this file: sources, confidence, review
 *   <slug>/media/registry.json + media/artists/<id>.jpg       image candidates (media/types.ts), pending
 *   <slug>/REVIEW.md                                          the agent's summary for the reviewer
 *
 * `candidate:promote` turns an approved candidate into `seed-data/<slug>-csv/`, `seed-data/<slug>.json`,
 * entries in `seed-data/media/registry.json` and a row in `seed-data/golden/index.json`.
 */

export const CANDIDATE_VERSION = 1;

export type CandidateStatus = 'needs_review' | 'approved' | 'rejected' | 'promoted';
export type Confidence = 'high' | 'medium' | 'low';
export type SourceKind = 'official' | 'official-app' | 'press' | 'aggregator' | 'other';
export type CandidateSection = 'festival' | 'stages' | 'artists' | 'sets';
export type SectionDecision = 'pending' | 'approved' | 'rejected';

export const CANDIDATE_SECTIONS: readonly CandidateSection[] = ['festival', 'stages', 'artists', 'sets'];

export interface CandidateSource {
  url: string;
  title: string | null;
  kind: SourceKind;
  accessed_at: string;
  /** Which parts of the bundle this source supports. */
  used_for: CandidateSection[];
  /** E.g. "set-times graphic as of Oct 9", "could not open; search excerpt only". */
  note?: string | null;
}

/** Per-row provenance, keyed as `<artist name>|<start in festival time YYYY-MM-DD HH:MM>` for sets. */
export interface RowProvenance {
  /** Indexes into `sources`. */
  sources: number[];
  confidence: Confidence;
  note?: string | null;
}

export interface CandidateReview {
  decisions: Record<CandidateSection, SectionDecision>;
  by: string | null;
  at: string | null;
  notes?: string | null;
}

export interface CandidateAgentRun {
  /** E.g. `claude-code festival-scout` plus the session or workflow run id. */
  tool: string;
  run_id?: string | null;
  started_at: string;
  finished_at?: string | null;
}

export interface CandidateFile {
  version: typeof CANDIDATE_VERSION;
  slug: string;
  /** Human-readable festival name as the agent found it (the CSV holds the one that is seeded). */
  name: string;
  created_at: string;
  status: CandidateStatus;
  /** Where the request came from: a user suggestion id, a scheduled scan, or an operator. */
  trigger: { kind: 'suggestion' | 'scan' | 'manual'; suggestion_id?: string | null; note?: string | null };
  agent: CandidateAgentRun;
  sources: CandidateSource[];
  confidence: Record<CandidateSection, Confidence>;
  /** Agent notes for the reviewer: what was estimated, what is missing, what to double-check. */
  notes: string;
  items?: { sets?: Record<string, RowProvenance>; artists?: Record<string, RowProvenance> };
  review: CandidateReview;
  /** Set by `candidate:promote`. */
  promoted?: { at: string; seed_file: string; csv_dir: string } | null;
}

/** `seed-data/golden/index.json`: every festival that passed review, with where its files live. */
export interface GoldenIndex {
  version: 1;
  festivals: GoldenFestival[];
}

export interface GoldenFestival {
  slug: string;
  festival_id: string;
  name: string;
  seed_file: string;
  csv_dir: string | null;
  /** The candidate directory it came from, when it went through the pipeline. */
  candidate: string | null;
  promoted_at: string;
  /** Last human verification against the official source. */
  verified: { at: string; by: string; source_url: string } | null;
  notes?: string | null;
}

/** Result of `scout:eval`: an agent's bundle compared with a golden one. */
export interface EvalReport {
  candidate: string;
  golden: string;
  festival_fields: { field: string; candidate: unknown; golden: unknown; match: boolean }[];
  stages: { precision: number; recall: number; missing: string[]; extra: string[] };
  artists: { precision: number; recall: number; missing: string[]; extra: string[] };
  sets: {
    /** True when the candidate has no sets (set times not published yet): precision/recall are 0 and say nothing. */
    lineup_only: boolean;
    precision: number;
    recall: number;
    /** Matched by artist + festival day; a set matches when start and end are within `tolerance_minutes`. */
    exact: number;
    time_errors: { artist: string; golden_start: string; candidate_start: string; minutes_off: number }[];
    stage_mismatches: { artist: string; golden_stage: string; candidate_stage: string }[];
    missing: string[];
    extra: string[];
  };
  tolerance_minutes: number;
}
