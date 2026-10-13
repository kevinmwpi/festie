import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DataAccessError, TransientAuthError, ValidationError, isAppErrorCode } from '../src/errors';
import {
  FESTIVAL_SUGGESTION_NAME_MAX_LENGTH,
  FESTIVAL_SUGGESTION_NOTE_MAX_LENGTH,
  normaliseSuggestionUrl,
  suggestFestival,
  validateFestivalSuggestion,
} from '../src/suggestions';
import { SUGGESTION_RATE_LIMITED_MESSAGE, toSuggestionErrorMessage, toUserMessage } from '../src/user-messages';
import { setupDataAccessTest, storeSession, teardownDataAccessTest } from './helpers';
import type { FakeSupabase } from './mocks/supabase-client';

describe('suggestFestival', () => {
  let fake: FakeSupabase;

  beforeEach(() => {
    fake = setupDataAccessTest();
  });
  afterEach(teardownDataAccessTest);

  it('sends the trimmed suggestion as the signed-in user and resolves the id', async () => {
    storeSession();
    fake.setRpcHandler(() => ({ data: '33333333-3333-4333-8333-333333333333' }));

    await expect(suggestFestival({ name: '  Zenith Fest ', url: ' zenith.example ', note: '   ' })).resolves.toBe(
      '33333333-3333-4333-8333-333333333333',
    );
    expect(fake.rpcCalls).toEqual([
      { name: 'suggest_festival', args: { p_name: 'Zenith Fest', p_url: 'https://zenith.example', p_note: null } },
    ]);
  });

  it('sends null for the optional fields when they are left out', async () => {
    storeSession();
    fake.setRpcHandler(() => ({ data: 'id-1' }));
    await suggestFestival({ name: 'Fest' });
    expect(fake.rpcCalls[0]?.args).toEqual({ p_name: 'Fest', p_url: null, p_note: null });
  });

  it('validates before sending anything', async () => {
    storeSession();
    await expect(suggestFestival({ name: '   ' })).rejects.toMatchObject({ name: 'ValidationError', code: 'invalid_input', field: 'name' });
    await expect(suggestFestival({ name: 'x'.repeat(FESTIVAL_SUGGESTION_NAME_MAX_LENGTH + 1) })).rejects.toMatchObject({ field: 'name' });
    await expect(suggestFestival({ name: 'Fest', url: 'http://insecure.example' })).rejects.toMatchObject({ field: 'url' });
    await expect(suggestFestival({ name: 'Fest', url: 'https://' })).rejects.toMatchObject({ field: 'url' });
    await expect(suggestFestival({ name: 'Fest', url: `https://fest.example/${'a'.repeat(500)}` })).rejects.toMatchObject({ field: 'url' });
    await expect(suggestFestival({ name: 'Fest', note: 'n'.repeat(FESTIVAL_SUGGESTION_NOTE_MAX_LENGTH + 1) })).rejects.toMatchObject({
      field: 'note',
    });
    expect(fake.rpcCalls).toEqual([]);
  });

  it('throws TransientAuthError without a session and sends nothing', async () => {
    await expect(suggestFestival({ name: 'Fest' })).rejects.toBeInstanceOf(TransientAuthError);
    expect(fake.rpcCalls).toEqual([]);
  });

  it('surfaces server verdicts; the daily limit gets its own copy', async () => {
    storeSession();
    fake.setRpcHandler(() => ({ error: { message: 'rate_limited', code: 'P0001' }, status: 400 }));
    const limited = await suggestFestival({ name: 'Fest' }).catch((error: unknown) => error);
    expect(limited).toBeInstanceOf(DataAccessError);
    expect(isAppErrorCode(limited, 'rate_limited')).toBe(true);
    expect(toSuggestionErrorMessage(limited)).toBe(SUGGESTION_RATE_LIMITED_MESSAGE);

    fake.setRpcHandler(() => ({ error: { message: 'content_not_allowed', code: 'P0001' }, status: 400 }));
    const rejected = await suggestFestival({ name: 'Fest' }).catch((error: unknown) => error);
    expect(isAppErrorCode(rejected, 'content_not_allowed')).toBe(true);
    expect(toSuggestionErrorMessage(rejected)).toBe(toUserMessage(rejected));
    expect(toSuggestionErrorMessage(rejected)).toMatch(/isn't allowed/);
  });

  it('never reads an empty reply as success', async () => {
    storeSession();
    fake.setRpcHandler(() => ({ data: null }));
    await expect(suggestFestival({ name: 'Fest' })).rejects.toMatchObject({ name: 'DataAccessError', status: 0 });
  });
});

describe('validateFestivalSuggestion', () => {
  it('adds https:// to a bare website and keeps a typed scheme', () => {
    expect(normaliseSuggestionUrl(undefined)).toBeNull();
    expect(normaliseSuggestionUrl('   ')).toBeNull();
    expect(normaliseSuggestionUrl('coachella.com')).toBe('https://coachella.com');
    expect(normaliseSuggestionUrl(' HTTPS://Coachella.com/ ')).toBe('HTTPS://Coachella.com/');
    expect(validateFestivalSuggestion({ name: 'Fest', url: 'www.fest.example/lineup?year=2027' }).url).toBe(
      'https://www.fest.example/lineup?year=2027',
    );
  });

  it('rejects anything that is not an https address', () => {
    for (const url of ['http://fest.example', 'mailto:hi@fest.example', 'https://fest example.com', 'ftp://fest.example']) {
      expect(() => validateFestivalSuggestion({ name: 'Fest', url })).toThrow(ValidationError);
    }
  });

  it('allows the server limits exactly and trims every field', () => {
    const valid = validateFestivalSuggestion({
      name: ` ${'n'.repeat(FESTIVAL_SUGGESTION_NAME_MAX_LENGTH)} `,
      url: null,
      note: ` ${'x'.repeat(FESTIVAL_SUGGESTION_NOTE_MAX_LENGTH)} `,
    });
    expect(valid).toEqual({ name: 'n'.repeat(120), url: null, note: 'x'.repeat(300) });
  });
});
