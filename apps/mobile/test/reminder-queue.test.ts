import { describe, expect, it } from 'vitest';

import { runReminderTask } from '../src/notifications/reminder-queue';

describe('runReminderTask', () => {
  it('runs reminder work one task at a time, in call order, even after a failure', async () => {
    const log: string[] = [];
    let releaseFirst!: () => void;
    const first = runReminderTask(async () => {
      log.push('first:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      log.push('first:end');
      throw new Error('boom');
    });
    const second = runReminderTask(async () => {
      log.push('second');
      return 2;
    });

    await Promise.resolve();
    expect(log).toEqual(['first:start']);
    releaseFirst();
    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe(2);
    expect(log).toEqual(['first:start', 'first:end', 'second']);
  });
});
