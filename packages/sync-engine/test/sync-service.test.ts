import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-community/netinfo', () => ({
  default: {
    addEventListener: vi.fn(() => () => undefined),
    fetch: vi.fn(async () => ({
      isConnected: true,
      isInternetReachable: true,
    })),
  },
}));

import { createSqlJsDatabase, getDb, resetDbForTests, setDatabaseFactoryForTests, upsertRows, type LocalDatabase } from '../src/db';
import {
  MAX_SYNC_ATTEMPTS,
  clearFailedOperations,
  clearLocalUserData,
  configureSyncService,
  enqueue,
  flush,
  getFailedOperations,
  getPendingCount,
  getPendingOperationIds,
  getPendingOperations,
  resetSyncServiceForTests,
  retryParkedOperations,
  setOnlineStatusForTests,
  setRetrySchedulerForTests,
  subscribeToSyncEvents,
  trackQueueActivity,
} from '../src/sync-service';
import { CACHE_TABLES, LOCAL_SCHEMA_VERSION, createTableSql, type TableDefinition } from '../src/schema';
import { SyncTransportError, type SyncEvent, type SyncTransport } from '../src/types';

const USER = 'user-1';

function selection(id: string, setId: string) {
  return {
    id,
    user_id: USER,
    festival_id: 'festival-1',
    set_id: setId,
    selected_at: '2026-08-21T18:00:00.000Z',
    note: null,
  };
}

function meetup(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    group_id: 'group-1',
    title: 'Meet at the big tree',
    stage_id: null,
    starts_at: '2026-08-21T20:00:00.000Z',
    notes: null,
    latitude: 41.87,
    longitude: -87.62,
    totem_path: null,
    created_by_user_id: USER,
    created_at: '2026-08-21T10:00:00.000Z',
    updated_at: '2026-08-21T10:00:00.000Z',
    ...overrides,
  };
}

function pgError(code: string, status: number, message = code) {
  return new SyncTransportError(message, { code, status });
}

async function localRows(table: string): Promise<Array<Record<string, unknown>>> {
  const db = await getDb();
  return db.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${table} ORDER BY rowid;`);
}

describe('sync-service', () => {
  let transport: SyncTransport & {
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let scheduledDelays: number[];
  let scheduledCallbacks: Array<() => void>;
  let events: SyncEvent[];

  beforeEach(() => {
    setDatabaseFactoryForTests(() => createSqlJsDatabase());
    resetSyncServiceForTests();
    setOnlineStatusForTests(true);
    scheduledDelays = [];
    scheduledCallbacks = [];
    // Record retries without running them; tests fire them explicitly.
    setRetrySchedulerForTests((delayMs, callback) => {
      scheduledDelays.push(delayMs);
      scheduledCallbacks.push(callback);
      return delayMs;
    });
    transport = {
      upsert: vi.fn(async () => undefined),
      update: vi.fn(async () => ({ found: true })),
      delete: vi.fn(async () => undefined),
    };
    configureSyncService({ transport });
    events = [];
    subscribeToSyncEvents((event) => events.push(event));
  });

  afterEach(() => {
    resetDbForTests();
    resetSyncServiceForTests();
  });

  it('applies mutations locally and tracks pending operations while offline', async () => {
    setOnlineStatusForTests(false);

    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: selection('s1', 'set-1') });
    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: selection('s2', 'set-2') });
    await enqueue({ table: 'meetups', type: 'upsert', payload: meetup('m1') });

    expect(await getPendingCount()).toBe(3);
    expect(await getPendingOperationIds('user_set_selections')).toEqual(['s1', 's2']);
    expect(await getPendingOperationIds('meetups')).toEqual(['m1']);
    const rows = await localRows('user_set_selections');
    expect(rows.map((row) => [row.id, row.pending_sync])).toEqual([
      ['s1', 1],
      ['s2', 1],
    ]);
    expect(transport.upsert).not.toHaveBeenCalled();
  });

  it('flushes in order when connectivity returns and strips payloads to the server whitelist', async () => {
    setOnlineStatusForTests(false);
    await enqueue({
      table: 'meetups',
      type: 'upsert',
      payload: { ...meetup('m1', { totem_path: 'g/m/x.jpg' }), custom_map_x: 0.5, custom_map_y: 0.5, pending_sync: 1, synced_at: 'x' },
    });
    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: { ...selection('s1', 'set-1'), pending_sync: true } });

    setOnlineStatusForTests(true);
    await flush();

    expect(transport.upsert).toHaveBeenCalledTimes(2);
    expect(transport.upsert.mock.calls[0]).toEqual([
      'meetups',
      {
        id: 'm1',
        group_id: 'group-1',
        title: 'Meet at the big tree',
        stage_id: null,
        starts_at: '2026-08-21T20:00:00.000Z',
        notes: null,
        latitude: 41.87,
        longitude: -87.62,
        created_by_user_id: USER,
      },
    ]);
    expect(transport.upsert.mock.calls[1]).toEqual(['user_set_selections', selection('s1', 'set-1')]);
    expect(await getPendingCount()).toBe(0);
    const [meetupRow] = await localRows('meetups');
    expect(meetupRow.pending_sync).toBe(0);
    expect(meetupRow.synced_at).toEqual(expect.any(String));
    expect(meetupRow.totem_path).toBe('g/m/x.jpg');
  });

  it('deletes selections by user_id + set_id and removes the local row immediately', async () => {
    setOnlineStatusForTests(false);
    await upsertRows('user_set_selections', [{ ...selection('server-id', 'set-1'), pending_sync: 0 }]);
    await enqueue({ table: 'user_set_selections', type: 'delete', payload: { id: 'local-id', user_id: USER, set_id: 'set-1' } });
    expect(await localRows('user_set_selections')).toEqual([]);

    setOnlineStatusForTests(true);
    await flush();
    expect(transport.delete).toHaveBeenCalledWith('user_set_selections', { id: 'local-id', user_id: USER, set_id: 'set-1' });
    expect(await getPendingCount()).toBe(0);
  });

  it('retries transient failures with exponential backoff and parks after the attempt cap', async () => {
    transport.upsert.mockRejectedValue(pgError('', 503, 'Service Unavailable'));
    setOnlineStatusForTests(false);
    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: selection('s1', 'set-1') });
    setOnlineStatusForTests(true);

    await flush();
    expect(scheduledDelays).toEqual([1_000]);
    let [operation] = await getPendingOperations();
    expect(operation.attemptCount).toBe(1);
    expect(operation.parked).toBe(false);

    // Make the row due again and keep failing until the cap.
    const db = await getDb();
    for (let attempt = 2; attempt <= MAX_SYNC_ATTEMPTS; attempt += 1) {
      await db.runAsync('UPDATE sync_queue SET next_retry_at = NULL;');
      // Fire the scheduled retry (as the timer would) and wait for that flush to record the attempt.
      scheduledCallbacks.shift()?.();
      await vi.waitFor(async () => {
        const [current] = await getPendingOperations();
        expect(current.attemptCount).toBe(attempt);
        expect(current.parked || scheduledCallbacks.length > 0).toBe(true);
      });
    }

    expect(transport.upsert).toHaveBeenCalledTimes(MAX_SYNC_ATTEMPTS);
    // Backoff doubles from 1 s and is capped at 30 s (extra entries are re-schedules of the same due time).
    expect(scheduledDelays).toEqual(expect.arrayContaining([1_000, 2_000, 4_000, 8_000, 16_000, 30_000]));
    expect(scheduledDelays.every((delay) => delay <= 30_000)).toBe(true);
    expect(Math.max(...scheduledDelays)).toBe(30_000);
    [operation] = await getPendingOperations();
    expect(operation.parked).toBe(true);
    expect(operation.attemptCount).toBe(MAX_SYNC_ATTEMPTS);
    expect(events.some((event) => event.type === 'parked')).toBe(true);

    // The engine's own retries never resend a parked operation; it still counts as pending.
    scheduledCallbacks.splice(0).forEach((callback) => callback());
    await vi.waitFor(async () => expect(await getPendingOperations()).toHaveLength(1));
    expect(transport.upsert).toHaveBeenCalledTimes(MAX_SYNC_ATTEMPTS);
    expect(await getPendingCount()).toBe(1);
    // The optimistic local row is kept.
    expect((await localRows('user_set_selections')).length).toBe(1);

    transport.upsert.mockResolvedValue(undefined);
    await retryParkedOperations();
    expect(await getPendingCount()).toBe(0);
  });

  it('gives parked operations a fresh round on the next outside flush, but not on internal retries', async () => {
    transport.upsert.mockRejectedValue(new SyncTransportError('Request timed out after 15000 ms', { status: 0 }));
    setOnlineStatusForTests(false);
    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: selection('s1', 'set-1') });
    const db = await getDb();
    await db.runAsync('UPDATE sync_queue SET attempt_count = ?;', [MAX_SYNC_ATTEMPTS - 1]);
    setOnlineStatusForTests(true);
    await flush();
    let [operation] = await getPendingOperations();
    expect(operation.parked).toBe(true);
    const sentBefore = transport.upsert.mock.calls.length;

    // An enqueue for another record flushes internally: the parked operation stays parked and blocks
    // nothing else.
    transport.upsert.mockResolvedValue(undefined);
    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: selection('s2', 'set-2') });
    await vi.waitFor(async () => expect(await getPendingCount()).toBe(1));
    expect(transport.upsert.mock.calls.slice(sentBefore).map(([, body]) => (body as { id: string }).id)).toEqual(['s2']);
    [operation] = await getPendingOperations();
    expect(operation).toMatchObject({ recordId: 's1', parked: true });

    // Foreground / token refresh / pull to refresh call flush(): the parked operation is sent again.
    await flush();
    expect(await getPendingCount()).toBe(0);
    expect(events.filter((event) => event.type === 'synced').map((event) => 'recordId' in event && event.recordId)).toEqual(['s2', 's1']);
  });

  it('releases parked operations when NetInfo reports the device back online', async () => {
    const netInfo = (await import('@react-native-community/netinfo')).default as unknown as {
      addEventListener: ReturnType<typeof vi.fn>;
    };
    resetSyncServiceForTests();
    setRetrySchedulerForTests(() => 0);
    let netInfoListener: ((state: { isConnected: boolean; isInternetReachable: boolean }) => void) | undefined;
    netInfo.addEventListener.mockImplementationOnce((listener: typeof netInfoListener) => {
      netInfoListener = listener;
      return () => undefined;
    });
    configureSyncService({ transport });
    setOnlineStatusForTests(true);

    transport.upsert.mockRejectedValue(new SyncTransportError('Request timed out after 15000 ms', { status: 0 }));
    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: selection('s1', 'set-1') });
    await vi.waitFor(async () => expect((await getPendingOperations())[0].attemptCount).toBe(1));
    const db = await getDb();
    await db.runAsync('UPDATE sync_queue SET parked = 1, attempt_count = ?, next_retry_at = NULL;', [MAX_SYNC_ATTEMPTS]);
    transport.upsert.mockResolvedValue(undefined);

    netInfoListener?.({ isConnected: false, isInternetReachable: false });
    netInfoListener?.({ isConnected: true, isInternetReachable: true });
    await vi.waitFor(async () => expect(await getPendingCount()).toBe(0));
  });

  it('stops the pass on a network error so later operations keep their attempts', async () => {
    transport.upsert.mockRejectedValue(new SyncTransportError('TypeError: Network request failed', { status: 0 }));
    setOnlineStatusForTests(false);
    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: selection('s1', 'set-1') });
    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: selection('s2', 'set-2') });
    setOnlineStatusForTests(true);

    await flush();
    expect(transport.upsert).toHaveBeenCalledTimes(1);
    const operations = await getPendingOperations();
    expect(operations.map((operation) => operation.attemptCount)).toEqual([1, 0]);
  });

  it('does not send later operations for a record whose earlier operation is waiting to retry', async () => {
    transport.upsert.mockRejectedValueOnce(pgError('P0001', 400, 'rate_limited'));
    setOnlineStatusForTests(false);
    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: selection('s1', 'set-1') });
    await enqueue({ table: 'user_set_selections', type: 'delete', payload: { id: 's1', user_id: USER, set_id: 'set-1' } });
    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: selection('s2', 'set-2') });
    setOnlineStatusForTests(true);

    await flush();
    expect(transport.delete).not.toHaveBeenCalled();
    expect(transport.upsert).toHaveBeenCalledTimes(2);
    expect(transport.upsert.mock.calls[1][1]).toMatchObject({ id: 's2' });
    expect(await getPendingCount()).toBe(2);
  });

  it('drops a permanently failing insert, records it and rolls back the optimistic row', async () => {
    transport.upsert.mockRejectedValue(pgError('42501', 403, 'new row violates row-level security policy'));
    await enqueue({ table: 'meetups', type: 'upsert', payload: meetup('m1') });
    await flush();

    expect(await getPendingCount()).toBe(0);
    expect(await localRows('meetups')).toEqual([]);
    const failures = await getFailedOperations();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ table: 'meetups', type: 'upsert', recordId: 'm1', errorCode: '42501' });
    expect(events.find((event) => event.type === 'failed')).toBeTruthy();

    await clearFailedOperations();
    expect(await getFailedOperations()).toEqual([]);
  });

  it('restores the previous server row when an update or delete fails permanently', async () => {
    await upsertRows('meetups', [{ ...meetup('m1', { title: 'Original' }), pending_sync: 0, synced_at: '2026-08-21T10:00:00.000Z' }]);
    transport.update.mockRejectedValue(pgError('23514', 400, 'violates check constraint'));
    transport.delete.mockRejectedValue(pgError('P0001', 400, 'not_group_member'));

    await enqueue({ table: 'meetups', type: 'update', payload: meetup('m1', { title: 'x'.repeat(200) }) });
    await flush();
    let [row] = await localRows('meetups');
    expect(row.title).toBe('Original');
    expect(row.pending_sync).toBe(0);

    await enqueue({ table: 'meetups', type: 'delete', payload: { id: 'm1' } });
    await flush();
    [row] = await localRows('meetups');
    expect(row?.title).toBe('Original');
    expect(await getFailedOperations()).toHaveLength(2);
  });

  it('sends an update with the stripped payload and marks the row synced', async () => {
    await upsertRows('meetups', [{ ...meetup('m1', { totem_path: 'group-1/m1/a.jpg' }), pending_sync: 0, synced_at: 'earlier' }]);
    await enqueue({ table: 'meetups', type: 'update', payload: meetup('m1', { title: 'Moved to the gate', totem_path: 'group-1/m1/a.jpg' }) });
    await flush();

    expect(transport.upsert).not.toHaveBeenCalled();
    expect(transport.update).toHaveBeenCalledTimes(1);
    const [table, body] = transport.update.mock.calls[0];
    expect(table).toBe('meetups');
    expect(body).not.toHaveProperty('totem_path');
    expect(body).toMatchObject({ id: 'm1', title: 'Moved to the gate' });
    const [row] = await localRows('meetups');
    expect([row.title, row.totem_path, row.pending_sync]).toEqual(['Moved to the gate', 'group-1/m1/a.jpg', 0]);
    expect(await getPendingCount()).toBe(0);
  });

  it('drops an update whose record was deleted on the server instead of re-creating it', async () => {
    await upsertRows('meetups', [{ ...meetup('m1', { title: 'Original' }), pending_sync: 0, synced_at: 'earlier' }]);
    transport.update.mockResolvedValue({ found: false });
    setOnlineStatusForTests(false);
    await enqueue({ table: 'meetups', type: 'update', payload: meetup('m1', { title: 'Edit 1' }) });
    await enqueue({ table: 'meetups', type: 'update', payload: meetup('m1', { title: 'Edit 2' }) });

    setOnlineStatusForTests(true);
    await flush();

    expect(transport.update).toHaveBeenCalledTimes(2);
    expect(transport.upsert).not.toHaveBeenCalled();
    expect(await localRows('meetups')).toEqual([]);
    expect(await getPendingCount()).toBe(0);
    expect(await getFailedOperations()).toEqual([]);
    expect(events.filter((event) => event.type === 'missing')).toEqual([
      { type: 'missing', table: 'meetups', recordId: 'm1' },
      { type: 'missing', table: 'meetups', recordId: 'm1' },
    ]);
  });

  it('keeps the local row for a later queued edit while an earlier update finds nothing', async () => {
    await upsertRows('meetups', [{ ...meetup('m1', { title: 'Original' }), pending_sync: 0, synced_at: 'earlier' }]);
    setOnlineStatusForTests(false);
    await enqueue({ table: 'meetups', type: 'update', payload: meetup('m1', { title: 'Edit 1' }) });
    await enqueue({ table: 'meetups', type: 'update', payload: meetup('m1', { title: 'Edit 2' }) });
    transport.update.mockResolvedValueOnce({ found: false }).mockRejectedValueOnce(pgError('08006', 503, 'connection failure'));

    setOnlineStatusForTests(true);
    await flush();

    const rows = await localRows('meetups');
    expect(rows.map((row) => [row.title, row.pending_sync])).toEqual([['Edit 2', 1]]);
    expect(await getPendingCount()).toBe(1);
  });

  it('rolls a later rejected edit back to the version the server accepted earlier', async () => {
    setOnlineStatusForTests(false);
    transport.upsert.mockImplementation(async (_table: string, payload: Record<string, unknown>) => {
      if (payload.title === 'bad words') {
        throw pgError('P0001', 400, 'content_not_allowed');
      }
    });
    await enqueue({ table: 'meetups', type: 'upsert', payload: meetup('m1', { title: 'Meet' }) });
    await enqueue({ table: 'meetups', type: 'upsert', payload: meetup('m1', { title: 'bad words' }) });

    setOnlineStatusForTests(true);
    await flush();

    const rows = await localRows('meetups');
    expect(rows.map((row) => [row.title, row.pending_sync])).toEqual([['Meet', 0]]);
    expect(await getPendingCount()).toBe(0);
    expect((await getFailedOperations()).map((failure) => failure.errorMessage)).toEqual(['content_not_allowed']);
  });

  it('passes the last confirmed row on when an earlier queued edit is rejected', async () => {
    await upsertRows('meetups', [{ ...meetup('m1', { title: 'Original' }), pending_sync: 0, synced_at: '2026-08-21T10:00:00.000Z' }]);
    setOnlineStatusForTests(false);
    transport.upsert.mockRejectedValue(pgError('23514', 400, 'violates check constraint'));
    await enqueue({ table: 'meetups', type: 'upsert', payload: meetup('m1', { title: 'Edit 1' }) });
    await enqueue({ table: 'meetups', type: 'upsert', payload: meetup('m1', { title: 'Edit 2' }) });

    setOnlineStatusForTests(true);
    await flush();

    const rows = await localRows('meetups');
    expect(rows.map((row) => [row.title, row.pending_sync])).toEqual([['Original', 0]]);
    expect(await getFailedOperations()).toHaveLength(2);
  });

  it('does not restore a deleted record when a later re-create is rejected', async () => {
    await upsertRows('user_set_selections', [{ ...selection('s1', 'set-1'), pending_sync: 0 }]);
    setOnlineStatusForTests(false);
    transport.upsert.mockRejectedValue(pgError('23503', 409, 'violates foreign key constraint'));
    await enqueue({ table: 'user_set_selections', type: 'delete', payload: { id: 's1', user_id: USER, set_id: 'set-1' } });
    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: selection('s2', 'set-1') });

    setOnlineStatusForTests(true);
    await flush();

    expect(await localRows('user_set_selections')).toEqual([]);
  });

  it('treats 23505 on user_set_selections as success but not on meetups', async () => {
    transport.upsert.mockRejectedValue(pgError('23505', 409, 'duplicate key value violates unique constraint'));
    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: selection('s1', 'set-1') });
    await flush();
    expect(await getPendingCount()).toBe(0);
    expect(await getFailedOperations()).toEqual([]);
    const [selectionRow] = await localRows('user_set_selections');
    expect(selectionRow.pending_sync).toBe(0);

    await enqueue({ table: 'meetups', type: 'upsert', payload: meetup('m1') });
    await flush();
    expect(await getFailedOperations()).toHaveLength(1);
    expect(await localRows('meetups')).toEqual([]);
  });

  it('never sends without a usable stored session', async () => {
    let session: { expiresAt: number } | null = null;
    configureSyncService({ transport, getSession: () => session });

    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: selection('s1', 'set-1') });
    await flush();
    expect(transport.upsert).not.toHaveBeenCalled();

    session = { expiresAt: Date.now() + 30_000 };
    await flush();
    expect(transport.upsert).not.toHaveBeenCalled();
    expect(scheduledDelays).toContain(5_000);
    expect((await getPendingOperations())[0].attemptCount).toBe(0);

    session = { expiresAt: Date.now() + 3_600_000 };
    await flush();
    expect(transport.upsert).toHaveBeenCalledTimes(1);
    expect(await getPendingCount()).toBe(0);
  });

  it("never sends the local queue with a session that is not the local owner's", async () => {
    let session: { expiresAt: number; authUserId?: string } | null = { expiresAt: Date.now() + 3_600_000, authUserId: 'user-a' };
    let owner: string | null = 'user-a';
    configureSyncService({ transport, getSession: () => session, getLocalOwner: async () => owner });
    setOnlineStatusForTests(false);
    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: selection('s1', 'set-1') });
    setOnlineStatusForTests(true);

    // Account B's session is stored before its owner check wiped A's queue.
    session = { expiresAt: Date.now() + 3_600_000, authUserId: 'user-b' };
    await flush();
    expect(transport.upsert).not.toHaveBeenCalled();
    expect((await getPendingOperations())[0].attemptCount).toBe(0);

    // A session without a user id cannot be matched to the owner either.
    session = { expiresAt: Date.now() + 3_600_000 };
    await flush();
    expect(transport.upsert).not.toHaveBeenCalled();

    // Nobody owns the cache yet.
    session = { expiresAt: Date.now() + 3_600_000, authUserId: 'user-a' };
    owner = null;
    await flush();
    expect(transport.upsert).not.toHaveBeenCalled();

    owner = 'user-a';
    await flush();
    expect(transport.upsert).toHaveBeenCalledTimes(1);
    expect(await getPendingCount()).toBe(0);
  });

  it('stops a pass when the stored session switches account mid-pass', async () => {
    let session: { expiresAt: number; authUserId: string } = { expiresAt: Date.now() + 3_600_000, authUserId: 'user-a' };
    configureSyncService({ transport, getSession: () => session, getLocalOwner: async () => 'user-a' });
    setOnlineStatusForTests(false);
    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: selection('s1', 'set-1') });
    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: selection('s2', 'set-2') });
    transport.upsert.mockImplementationOnce(async () => {
      session = { expiresAt: Date.now() + 3_600_000, authUserId: 'user-b' };
    });
    setOnlineStatusForTests(true);

    await flush();
    expect(transport.upsert).toHaveBeenCalledTimes(1);
    expect(await getPendingOperationIds('user_set_selections')).toEqual(['s2']);
  });

  it('treats a transport-side missing session as transient without spending an attempt', async () => {
    const missing = Object.assign(new Error('No session'), { name: 'TransientAuthError', code: 'session_missing' });
    transport.upsert.mockRejectedValueOnce(missing);
    await enqueue({ table: 'user_set_selections', type: 'upsert', payload: selection('s1', 'set-1') });
    await flush();
    const [operation] = await getPendingOperations();
    expect(operation.attemptCount).toBe(0);
    expect(await getFailedOperations()).toEqual([]);
  });

  it('trackQueueActivity records operations enqueued while it runs and notices a wipe', async () => {
    setOnlineStatusForTests(false);
    await enqueue({ table: 'meetups', type: 'upsert', payload: meetup('before') });
    const tracker = trackQueueActivity();
    await enqueue({ table: 'user_set_selections', type: 'delete', payload: { id: 's1', user_id: USER, set_id: 'set-1' } });
    expect(tracker.operations).toEqual([
      { table: 'user_set_selections', type: 'delete', recordId: 's1', payload: { id: 's1', user_id: USER, set_id: 'set-1' } },
    ]);
    expect(tracker.cleared).toBe(false);

    await clearLocalUserData();
    expect(tracker.cleared).toBe(true);

    tracker.stop();
    await enqueue({ table: 'meetups', type: 'upsert', payload: meetup('after') });
    expect(tracker.operations).toHaveLength(1);
  });

  it('reads the queue through a transaction handle', async () => {
    setOnlineStatusForTests(false);
    await enqueue({ table: 'meetups', type: 'upsert', payload: meetup('m1') });
    const db = await getDb();
    const ids = await db.transaction((tx) => getPendingOperationIds('meetups', tx));
    expect(ids).toEqual(['m1']);
  });

  it('clearLocalUserData wipes user rows and the queue but keeps the festival catalog', async () => {
    setOnlineStatusForTests(false);
    await upsertRows('festivals', [{ id: 'f1', name: 'Fest', start_date: '2026-08-01', end_date: '2026-08-03', timezone: 'UTC' }]);
    await upsertRows('users', [{ id: USER, display_name: 'Kev', avatar_type: 'initials', avatar_value: 'K' }]);
    await upsertRows('user_blocks', [{ blocked_id: 'user-2', created_at: '2026-08-01T00:00:00Z' }]);
    await enqueue({ table: 'meetups', type: 'upsert', payload: meetup('m1') });

    await clearLocalUserData();

    expect(await getPendingCount()).toBe(0);
    expect(await localRows('meetups')).toEqual([]);
    expect(await localRows('users')).toEqual([]);
    expect(await localRows('user_blocks')).toEqual([]);
    expect(await localRows('festivals')).toHaveLength(1);
  });
});

describe('local schema v2', () => {
  afterEach(() => {
    resetDbForTests();
    resetSyncServiceForTests();
  });

  it('rebuilds v1 cache tables on upgrade and keeps the queue', async () => {
    const legacy: LocalDatabase = await createSqlJsDatabase();
    await legacy.execAsync(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, avatar_type TEXT, avatar_value TEXT, created_at TEXT NOT NULL);
      CREATE TABLE groups (id TEXT PRIMARY KEY, festival_id TEXT NOT NULL, name TEXT NOT NULL, created_by_user_id TEXT NOT NULL, invite_code TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE sync_queue (id TEXT PRIMARY KEY, table_name TEXT NOT NULL, operation_type TEXT NOT NULL, payload_json TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0, next_retry_at TEXT, last_error TEXT, created_at TEXT NOT NULL, pending_sync INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO users VALUES ('u1', 'a@example.com', 'A', 'initials', 'A', '2026-01-01');
      INSERT INTO sync_queue (id, table_name, operation_type, payload_json, created_at) VALUES ('q1', 'user_set_selections', 'delete', '{"id":"s1"}', '2026-01-01T00:00:00Z');
    `);
    setDatabaseFactoryForTests(async () => legacy);

    const db = await getDb();
    const userColumns = (await db.getAllAsync<{ name: string }>('PRAGMA table_info(users);')).map((column) => column.name);
    expect(userColumns).not.toContain('email');
    expect(await db.getAllAsync('SELECT * FROM users;')).toEqual([]);

    const groupColumns = await db.getAllAsync<{ name: string; notnull: number }>('PRAGMA table_info(groups);');
    expect(groupColumns.find((column) => column.name === 'created_by_user_id')?.notnull).toBe(0);
    expect(groupColumns.map((column) => column.name)).toContain('invite_code_rotated_at');

    const meetupColumns = (await db.getAllAsync<{ name: string }>('PRAGMA table_info(meetups);')).map((column) => column.name);
    expect(meetupColumns).toEqual(expect.arrayContaining(['latitude', 'longitude', 'totem_path', 'created_at', 'updated_at']));
    expect(meetupColumns).not.toContain('custom_map_x');
    const festivalColumns = (await db.getAllAsync<{ name: string }>('PRAGMA table_info(festivals);')).map((column) => column.name);
    expect(festivalColumns).toEqual(
      expect.arrayContaining(['status', 'is_demo', 'latitude', 'longitude', 'default_zoom', 'bounds_sw_lat', 'bounds_ne_lng', 'source_url']),
    );
    expect(await db.getAllAsync('SELECT * FROM user_festivals;')).toEqual([]);

    const queue = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM sync_queue;');
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ id: 'q1', parked: 0, seq: 0 });
    expect(await db.getFirstAsync('SELECT value FROM app_meta WHERE key = ?;', ['schema_version'])).toEqual({ value: '2' });
  });

  /**
   * The previous release's cache: today's schema minus the given columns (and minus whole tables
   * listed under `missing['*']`), at the current version.
   */
  async function previousReleaseCache(missing: Record<string, readonly string[]>): Promise<LocalDatabase> {
    const database = await createSqlJsDatabase();
    for (const [name, definition] of Object.entries(CACHE_TABLES) as Array<[string, TableDefinition]>) {
      if ((missing['*'] ?? []).includes(name)) {
        continue;
      }
      const columns = definition.columns.filter(([column]) => !(missing[name] ?? []).includes(column));
      await database.execAsync(createTableSql(name, { ...definition, columns }));
    }
    await database.execAsync(`
      CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO app_meta VALUES ('schema_version', '${LOCAL_SCHEMA_VERSION}');
      INSERT INTO festivals (id, name, start_date, end_date, timezone, version, bundle_version) VALUES ('f1', 'Fest', '2026-10-10', '2026-10-11', 'UTC', 5, 5), ('f2', 'Unopened', '2026-11-01', '2026-11-02', 'UTC', 1, NULL);
      INSERT INTO sets (id, festival_id, artist_id, stage_id, start_time, end_time) VALUES ('s1', 'f1', 'a1', 'st1', '2026-10-10T20:00:00Z', '2026-10-10T21:00:00Z');
      INSERT INTO user_set_selections (id, user_id, festival_id, set_id, selected_at, pending_sync) VALUES ('sel1', 'u1', 'f1', 's1', '2026-10-01T00:00:00Z', 1);
    `);
    return database;
  }

  it('adds the set status columns in place on upgrade, keeps cached rows and marks bundles stale', async () => {
    // Exactly what the release before migration 011 had on devices.
    const existing = await previousReleaseCache({ sets: ['status', 'original_start_time', 'change_note'] });
    setDatabaseFactoryForTests(async () => existing);

    const db = await getDb();
    expect(await db.getAllAsync('SELECT id, status, original_start_time, change_note FROM sets;')).toEqual([
      { id: 's1', status: 'scheduled', original_start_time: null, change_note: null },
    ]);
    expect(await db.getAllAsync('SELECT id, bundle_version FROM festivals ORDER BY id;')).toEqual([
      { id: 'f1', bundle_version: 0 },
      { id: 'f2', bundle_version: null },
    ]);
    expect(await db.getAllAsync('SELECT id, pending_sync FROM user_set_selections;')).toEqual([{ id: 'sel1', pending_sync: 1 }]);
    expect(await db.getFirstAsync('SELECT value FROM app_meta WHERE key = ?;', ['schema_version'])).toEqual({
      value: String(LOCAL_SCHEMA_VERSION),
    });

    // Nothing left to add on the next launch: bundles fetched since are not marked stale again.
    await db.runAsync('UPDATE festivals SET bundle_version = 6 WHERE id = ?;', ['f1']);
    resetDbForTests();
    setDatabaseFactoryForTests(async () => existing);
    const reopened = await getDb();
    expect(await reopened.getFirstAsync('SELECT bundle_version FROM festivals WHERE id = ?;', ['f1'])).toEqual({ bundle_version: 6 });
  });

  it('adds the photo credit columns in place on upgrade and marks bundles stale', async () => {
    // Exactly what the release before migration 012 had on devices.
    const existing = await previousReleaseCache({
      artists: ['image_credit', 'image_license', 'image_source_url'],
      festivals: ['image_credit', 'image_license', 'image_source_url'],
    });
    await existing.runAsync("INSERT INTO artists (id, name, image_url) VALUES ('a1', 'Artist', NULL);");
    setDatabaseFactoryForTests(async () => existing);

    const db = await getDb();
    expect(await db.getAllAsync('SELECT id, image_url, image_credit, image_license, image_source_url FROM artists;')).toEqual([
      { id: 'a1', image_url: null, image_credit: null, image_license: null, image_source_url: null },
    ]);
    expect(await db.getAllAsync('SELECT id, image_credit, image_source_url, bundle_version FROM festivals ORDER BY id;')).toEqual([
      { id: 'f1', image_credit: null, image_source_url: null, bundle_version: 0 },
      { id: 'f2', image_credit: null, image_source_url: null, bundle_version: null },
    ]);
  });

  it('creates the lineup table in place on upgrade and marks bundles stale', async () => {
    // Exactly what the release before migration 014 had on devices: no festival_artists table.
    const existing = await previousReleaseCache({ '*': ['festival_artists'] });
    setDatabaseFactoryForTests(async () => existing);

    const db = await getDb();
    expect(await db.getAllAsync('SELECT * FROM festival_artists;')).toEqual([]);
    expect(await db.getAllAsync('SELECT id, bundle_version FROM festivals ORDER BY id;')).toEqual([
      { id: 'f1', bundle_version: 0 },
      { id: 'f2', bundle_version: null },
    ]);
    expect(await db.getAllAsync('SELECT id FROM sets;')).toEqual([{ id: 's1' }]);

    // The table exists on the next launch: bundles fetched since are not marked stale again.
    await db.runAsync('UPDATE festivals SET bundle_version = 6 WHERE id = ?;', ['f1']);
    resetDbForTests();
    setDatabaseFactoryForTests(async () => existing);
    const reopened = await getDb();
    expect(await reopened.getFirstAsync('SELECT bundle_version FROM festivals WHERE id = ?;', ['f1'])).toEqual({ bundle_version: 6 });
  });

  it('keeps bundles current when only a non-catalog cache table gains a column', async () => {
    const existing = await previousReleaseCache({ groups: ['invite_code_rotated_at'] });
    setDatabaseFactoryForTests(async () => existing);

    const db = await getDb();
    const groupColumns = (await db.getAllAsync<{ name: string }>('PRAGMA table_info(groups);')).map((column) => column.name);
    expect(groupColumns).toContain('invite_code_rotated_at');
    expect(await db.getFirstAsync('SELECT bundle_version FROM festivals WHERE id = ?;', ['f1'])).toEqual({ bundle_version: 5 });
  });

  it('keeps cached data when the schema version is current', async () => {
    const database = await createSqlJsDatabase();
    setDatabaseFactoryForTests(async () => database);
    const db = await getDb();
    await upsertRows('artists', [{ id: 'a1', name: 'Artist' }]);

    // Simulate the next launch.
    setDatabaseFactoryForTests(async () => database);
    const reopened = await getDb();
    expect(reopened).toBe(database);
    expect(await db.getAllAsync('SELECT id FROM artists;')).toEqual([{ id: 'a1' }]);
  });
});
