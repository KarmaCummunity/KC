import { describe, expect, it } from 'vitest';
import type { AppLogger } from '../../logging/appLogger';
import { BackgroundWork } from '../backgroundWork';

/** A background runner whose log is kept, and a piece of work the test ends by hand. */
function setup() {
  const errors: Array<Record<string, unknown>> = [];
  const logger = { error: (fields: Record<string, unknown>) => errors.push(fields) } as unknown as AppLogger;
  return { background: new BackgroundWork(logger), errors };
}

describe('BackgroundWork', () => {
  it('returns at once and lets the work finish on its own', async () => {
    const { background } = setup();
    let done = false;
    // The work waits on a gate the test opens, so "not done yet" is not a matter of timing.
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));

    background.start('slow', () => gate.then(() => void (done = true)));
    expect(done).toBe(false);
    open();
    await background.idle();

    expect(done).toBe(true);
  });

  it('logs a failure with the name of the work and keeps running the rest', async () => {
    const { background, errors } = setup();
    const failure = new Error('provider unavailable');
    let other = false;

    background.start('whatsapp photo', () => Promise.reject(failure));
    background.start('other', () => Promise.resolve(void (other = true)));
    await background.idle();

    expect(errors).toEqual([{ err: failure, work: 'whatsapp photo' }]);
    expect(other).toBe(true);
  });

  it('logs work that throws before it returns a promise', async () => {
    const { background, errors } = setup();

    background.start('broken', () => {
      throw new Error('thrown at once');
    });
    await background.idle();

    expect(errors).toHaveLength(1);
  });

  it('waits at shutdown for what is running, including work started meanwhile', async () => {
    const { background } = setup();
    const ended: string[] = [];

    background.start('first', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      background.start('second', () => Promise.resolve(void ended.push('second')));
      ended.push('first');
    });
    await background.onApplicationShutdown();

    expect(ended).toEqual(['first', 'second']);
  });
});
