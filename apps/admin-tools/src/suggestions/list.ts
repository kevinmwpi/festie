/**
 * Festival suggestions from the in-app form (`public.festival_suggestions`, migration 012). The app
 * writes them through an RPC; admin-tools reads and triages them with the service role:
 * `suggestions:list`, `suggestions:set-status`, and `suggestions:to-candidate`, which scaffolds a
 * candidate bundle (../candidates/scaffold) for the scout agent or an operator to fill in.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { scaffoldCandidate, slugify, type ScaffoldResult } from '../candidates/scaffold';
import { assertSlug, isSlug } from '../candidates/slug';
import { normalizeName, readGoldenIndex } from '../candidates/store';
import { check } from '../env';
import { isUuid } from '../lib/uuid';

export const SUGGESTION_STATUSES = ['new', 'accepted', 'rejected', 'duplicate'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export interface SuggestionRow {
  id: string;
  user_id: string | null;
  name: string;
  url: string | null;
  note: string | null;
  status: SuggestionStatus;
  created_at: string;
}

export interface SuggestionListItem extends SuggestionRow {
  user_name: string | null;
}

const SUGGESTION_COLUMNS = 'id, user_id, name, url, note, status, created_at';
const TABLE = 'festival_suggestions';

export function isSuggestionStatus(value: unknown): value is SuggestionStatus {
  return typeof value === 'string' && (SUGGESTION_STATUSES as readonly string[]).includes(value);
}

/** Oldest first, like reports:list, with the suggesting user's display name. */
export async function listSuggestions(
  client: SupabaseClient,
  options: { status: SuggestionStatus | 'all'; limit: number },
): Promise<SuggestionListItem[]> {
  let query = client.from(TABLE).select(SUGGESTION_COLUMNS).order('created_at', { ascending: true }).limit(options.limit);
  if (options.status !== 'all') {
    query = query.eq('status', options.status);
  }
  const rows = (check(await query, 'Reading suggestions') ?? []) as SuggestionRow[];

  const userIds = [...new Set(rows.map((row) => row.user_id).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const users = (check(await client.from('users').select('id, display_name').in('id', userIds), 'Reading users') ??
      []) as Array<{ id: string; display_name: string }>;
    for (const user of users) {
      names.set(user.id, user.display_name);
    }
  }
  return rows.map((row) => ({ ...row, user_name: row.user_id ? names.get(row.user_id) ?? null : null }));
}

function truncate(value: string | null, length: number): string {
  if (!value) {
    return '';
  }
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

export function formatSuggestionTable(rows: SuggestionListItem[]): string {
  if (rows.length === 0) {
    return 'No suggestions.';
  }
  return rows
    .map((row) =>
      [
        `${row.id}  ${row.created_at.slice(0, 16).replace('T', ' ')}  ${row.status.toUpperCase()}  ${truncate(row.name, 80)}`,
        row.url ? `  url   ${truncate(row.url, 120)}` : null,
        row.note ? `  note  ${truncate(row.note, 100)}` : null,
        `  from  ${row.user_name ?? (row.user_id ? row.user_id : 'deleted account')}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}

export async function getSuggestion(client: SupabaseClient, id: string): Promise<SuggestionRow> {
  if (!isUuid(id)) {
    throw new Error(`"${id}" is not a suggestion id (UUID)`);
  }
  const row = check(await client.from(TABLE).select(SUGGESTION_COLUMNS).eq('id', id).maybeSingle(), 'Reading the suggestion') as
    | SuggestionRow
    | null;
  if (!row) {
    throw new Error(`Suggestion ${id} not found`);
  }
  return row;
}

export async function setSuggestionStatus(client: SupabaseClient, id: string, status: SuggestionStatus): Promise<SuggestionRow> {
  if (!isSuggestionStatus(status)) {
    throw new Error(`Status must be one of ${SUGGESTION_STATUSES.join(', ')} (got ${JSON.stringify(status)})`);
  }
  const current = await getSuggestion(client, id);
  check(await client.from(TABLE).update({ status }).eq('id', id), 'Updating the suggestion');
  return { ...current, status };
}

export interface SuggestionCandidateResult extends ScaffoldResult {
  suggestion: SuggestionRow;
}

/** The golden slug of the festival with this name (matched like the watchlist does), or null. */
function goldenSlugFor(name: string, root?: string): string | null {
  const key = normalizeName(name);
  if (key === '') {
    return null;
  }
  return readGoldenIndex(root).festivals.find((festival) => normalizeName(festival.name) === key)?.slug ?? null;
}

/**
 * Scaffolds `seed-data/candidates/<slug>/` from a suggestion (trigger `suggestion`, its URL as an
 * `other` source) and marks the suggestion accepted. The slug defaults to the golden slug when a
 * festival of that name is already in `golden/index.json` (so `candidate:promote` replaces that
 * festival's files instead of adding a second one), otherwise to the slugified name; pass one when the
 * name is ambiguous or already taken (e.g. add the year, or `<slug>-changes-<date>`).
 */
export async function suggestionToCandidate(
  client: SupabaseClient,
  options: { id: string; slug?: string; root?: string },
): Promise<SuggestionCandidateResult> {
  const suggestion = await getSuggestion(client, options.id);
  if (suggestion.status === 'rejected' || suggestion.status === 'duplicate') {
    throw new Error(`Suggestion ${suggestion.id} is ${suggestion.status}; run suggestions:set-status ${suggestion.id} new first`);
  }
  let slug: string;
  if (options.slug !== undefined) {
    slug = assertSlug(options.slug);
  } else {
    slug = goldenSlugFor(suggestion.name, options.root) ?? slugify(suggestion.name);
    if (!isSlug(slug)) {
      throw new Error(`Could not derive a slug from "${suggestion.name}"; pass --slug <slug>`);
    }
  }
  const now = new Date();
  const sources = suggestion.url
    ? [
        {
          url: suggestion.url,
          title: null,
          kind: 'other' as const,
          accessed_at: now.toISOString(),
          used_for: [],
          note: 'URL from the in-app suggestion; not yet checked',
        },
      ]
    : [];
  const scaffold = scaffoldCandidate({
    slug,
    name: suggestion.name,
    trigger: { kind: 'suggestion', suggestion_id: suggestion.id, note: suggestion.note },
    sources,
    root: options.root,
    now,
  });
  const accepted = await setSuggestionStatus(client, suggestion.id, 'accepted');
  return { ...scaffold, suggestion: accepted };
}
