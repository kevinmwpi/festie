import { ValidationError, unexpectedResponseError } from './errors';
import { textLength } from './profile';
import { requireStoredSession } from './session';
import { callRpc } from './supabase';

/** Limits of `public.suggest_festival` (migration 013); the server raises `invalid_input` past them. */
export const FESTIVAL_SUGGESTION_NAME_MAX_LENGTH = 120;
export const FESTIVAL_SUGGESTION_URL_MAX_LENGTH = 500;
export const FESTIVAL_SUGGESTION_NOTE_MAX_LENGTH = 300;

export interface FestivalSuggestionInput {
  name: string;
  /** Official website; `https://` is added when the scheme is left out. */
  url?: string | null;
  note?: string | null;
}

export interface FestivalSuggestion {
  name: string;
  url: string | null;
  note: string | null;
}

const HTTPS_URL = /^https:\/\/[^\s/?#]+[^\s]*$/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Trims a typed website address and adds `https://` when no scheme was typed ("coachella.com").
 * Returns `null` for an empty value. The result is not guaranteed valid: `validateFestivalSuggestion`
 * checks it.
 */
export function normaliseSuggestionUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return null;
  }
  return HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Trims and validates a suggestion (same limits as the server). Throws `ValidationError` with `field`. */
export function validateFestivalSuggestion(input: FestivalSuggestionInput): FestivalSuggestion {
  const name = input.name.trim();
  if (textLength(name) < 1) {
    throw new ValidationError("Enter the festival's name.", 'name');
  }
  if (textLength(name) > FESTIVAL_SUGGESTION_NAME_MAX_LENGTH) {
    throw new ValidationError(`Festival names can be at most ${FESTIVAL_SUGGESTION_NAME_MAX_LENGTH} characters.`, 'name');
  }

  const url = normaliseSuggestionUrl(input.url);
  if (url !== null) {
    if (!HTTPS_URL.test(url)) {
      throw new ValidationError('Enter the website as an https:// address.', 'url');
    }
    if (url.length > FESTIVAL_SUGGESTION_URL_MAX_LENGTH) {
      throw new ValidationError('That website address is too long.', 'url');
    }
  }

  const note = input.note?.trim() || null;
  if (note && textLength(note) > FESTIVAL_SUGGESTION_NOTE_MAX_LENGTH) {
    throw new ValidationError(`Notes can be at most ${FESTIVAL_SUGGESTION_NOTE_MAX_LENGTH} characters.`, 'note');
  }

  return { name, url, note };
}

/**
 * Suggests a festival to add (RPC `suggest_festival`, online only — never queued). Resolves the
 * suggestion id; suggesting the same name again resolves the same id. Throws `ValidationError` before
 * sending anything, `TransientAuthError` without a session, and `DataAccessError` for P0001
 * `rate_limited` (5 a day), `content_not_allowed` or `invalid_input` (show with
 * `toSuggestionErrorMessage`).
 */
export async function suggestFestival(input: FestivalSuggestionInput): Promise<string> {
  const valid = validateFestivalSuggestion(input);
  requireStoredSession();
  const id = await callRpc('suggest_festival', { p_name: valid.name, p_url: valid.url, p_note: valid.note });
  // The RPC returns a uuid; anything else (an empty reply, which supabase-js reports as null) did not
  // come from PostgREST and must not read as success.
  if (typeof id !== 'string' || id.length === 0) {
    throw unexpectedResponseError();
  }
  return id;
}
