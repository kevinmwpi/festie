import { isAuthApiError } from '@supabase/supabase-js';

import { getAppErrorCode } from './errors';

const APP_CODE_MESSAGES: Record<string, string> = {
  not_authenticated: 'Please sign in again.',
  profile_required: 'Finish setting up your profile first.',
  not_group_member: "You're no longer a member of this crew.",
  not_group_admin: 'Only crew admins can do that.',
  group_full: 'This crew is full (50 members max).',
  rate_limited: "You're doing that too often. Please wait a bit and try again.",
  content_not_allowed: "That text isn't allowed. Please try different wording.",
  invalid_input: 'Something in that form is not valid. Please check it and try again.',
  festival_not_found: "That festival isn't available.",
  meetup_not_found: 'That meetup no longer exists.',
  meetup_limit_reached: "You've reached the limit of 100 meetups in this crew. Delete an old one to add another.",
  cannot_remove_self: "You can't remove yourself. Leave the crew instead.",
};

const SESSION_EXPIRED_MESSAGE = 'Your session expired. Please sign in again.';

const CODE_MESSAGES: Record<string, string> = {
  config_error: "Festie isn't set up correctly. Please update the app.",
  session_missing: "You're signed out. Please sign in again.",
  invite_not_found: "We couldn't find a crew with that code. Check it and try again.",
  meetup_not_synced: 'Add the photo once this meetup syncs.',
  not_found: 'That item is no longer available.',
  profile_not_saved: "Your profile couldn't be saved. Please try again.",
  delete_not_confirmed: "We couldn't confirm your account was deleted. Please try again.",
  invalid_code: 'That code is incorrect or has expired. Request a new one.',
  '23505': 'That already exists.',
  '23514': 'Something in that form is not valid. Please check it and try again.',
  '42501': "You don't have permission to do that.",
  PGRST301: SESSION_EXPIRED_MESSAGE,
  PGRST303: SESSION_EXPIRED_MESSAGE,
};

const AUTH_CODE_MESSAGES: Record<string, string> = {
  otp_expired: 'That code is incorrect or has expired. Request a new one.',
  otp_disabled: 'Sign-in with email codes is unavailable right now.',
  email_address_invalid: 'Enter a valid email address.',
  validation_failed: 'Enter a valid email address.',
  over_email_send_rate_limit: 'Too many codes requested. Please wait a minute and try again.',
  over_request_rate_limit: 'Too many attempts. Please wait a minute and try again.',
  email_address_not_authorized: "We can't send email to that address.",
  signup_disabled: 'New sign-ups are paused right now.',
  user_banned: 'This account has been suspended. Contact support for help.',
  session_not_found: 'Your session expired. Please sign in again.',
  refresh_token_not_found: 'Your session expired. Please sign in again.',
};

/** `suggest_festival` allows 5 suggestions a day; the generic rate-limit copy would suggest waiting minutes. */
export const SUGGESTION_RATE_LIMITED_MESSAGE = "You've sent a lot of suggestions today. Try again tomorrow.";

export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';
export const OFFLINE_ERROR_MESSAGE = "You're offline or the connection is weak. Try again when you have signal.";
export const TIMEOUT_ERROR_MESSAGE = 'That took too long. Try again when you have a better signal.';

interface ErrorFields {
  name: string;
  message: string;
  code: string;
  status: number | null;
}

function fields(error: unknown): ErrorFields {
  if (typeof error !== 'object' || error === null) {
    return { name: '', message: typeof error === 'string' ? error : '', code: '', status: null };
  }

  const candidate = error as { name?: unknown; message?: unknown; code?: unknown; status?: unknown };
  return {
    name: typeof candidate.name === 'string' ? candidate.name : '',
    message: typeof candidate.message === 'string' ? candidate.message : '',
    code: typeof candidate.code === 'string' ? candidate.code : '',
    status: typeof candidate.status === 'number' ? candidate.status : null,
  };
}

function isTimeout({ name, message }: ErrorFields): boolean {
  return name === 'TimeoutError' || /timed out|TimeoutError|AbortError|aborted/i.test(message);
}

function isNetwork({ name, message, status, code }: ErrorFields): boolean {
  if (name === 'FunctionsFetchError' || name === 'AuthRetryableFetchError' || status === 0) {
    return true;
  }
  if (code && !/^E[A-Z]+$/.test(code)) {
    return false;
  }
  return /network request failed|failed to fetch|fetcherror|network error|load failed|internet connection/i.test(message);
}

/** Friendly copy for any error thrown by data-access, supabase-js or the sync engine. */
export function toUserMessage(error: unknown): string {
  if (error === null || error === undefined) {
    return GENERIC_ERROR_MESSAGE;
  }

  const appCode = getAppErrorCode(error);
  if (appCode) {
    return APP_CODE_MESSAGES[appCode] ?? GENERIC_ERROR_MESSAGE;
  }

  const details = fields(error);

  if (details.name === 'ValidationError' && details.message) {
    return details.message;
  }

  // PostgREST answers 42501 with 401 when the request ran as `anon` (supabase-js falls back to the anon
  // key while a token refresh is failing): that is an expired session, not a missing permission.
  if (details.code === '42501' && details.status === 401) {
    return SESSION_EXPIRED_MESSAGE;
  }

  if (details.code && CODE_MESSAGES[details.code]) {
    return CODE_MESSAGES[details.code];
  }

  // Client-side errors that reuse a server code without P0001 (e.g. `ProfileRequiredError`).
  if (details.code && APP_CODE_MESSAGES[details.code]) {
    return APP_CODE_MESSAGES[details.code];
  }

  if (isTimeout(details)) {
    return TIMEOUT_ERROR_MESSAGE;
  }

  if (isNetwork(details)) {
    return OFFLINE_ERROR_MESSAGE;
  }

  if (isAuthApiError(error) || details.name.startsWith('Auth')) {
    if (details.code && AUTH_CODE_MESSAGES[details.code]) {
      return AUTH_CODE_MESSAGES[details.code];
    }
    if (details.status === 429) {
      return 'Too many attempts. Please wait a minute and try again.';
    }
    if (/token has expired|invalid/i.test(details.message) && /otp|token|code/i.test(details.message)) {
      return AUTH_CODE_MESSAGES.otp_expired;
    }
    if (details.status !== null && details.status >= 500) {
      return 'Sign-in is having trouble right now. Please try again in a moment.';
    }
    if (details.name === 'AuthSessionMissingError') {
      return CODE_MESSAGES.session_missing;
    }
  }

  if (details.status === 401) {
    return SESSION_EXPIRED_MESSAGE;
  }
  if (details.status === 429) {
    return APP_CODE_MESSAGES.rate_limited;
  }
  if (details.status !== null && details.status >= 500) {
    return 'Festie is having trouble right now. Please try again in a moment.';
  }

  return GENERIC_ERROR_MESSAGE;
}

/**
 * Friendly copy for a failed `suggestFestival`: the daily limit gets its own message, everything else
 * (`content_not_allowed`, `invalid_input`, offline, …) the standard `toUserMessage` copy.
 */
export function toSuggestionErrorMessage(error: unknown): string {
  return getAppErrorCode(error) === 'rate_limited' ? SUGGESTION_RATE_LIMITED_MESSAGE : toUserMessage(error);
}
