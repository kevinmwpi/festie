/**
 * Runs set-reminder reconciliation one task at a time. Two reconciliations can otherwise interleave:
 * one reading picks from just before a festival update (stale) can write after one with fresh picks,
 * and put a moved set's reminder back at its old time. In a queue, the run with fresh picks always
 * reads the stale run's writes and corrects them.
 */
let tail: Promise<unknown> = Promise.resolve();

export function runReminderTask<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task);
  // The next task waits for this one whether it resolves or rejects.
  tail = run.catch(() => undefined);
  return run;
}
