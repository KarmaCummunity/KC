import { describe, expect, it } from 'vitest';
import type { DependencyProbe } from '../dependencyProbe';
import { checkDependencies, ProbeTimeoutError } from '../readiness';

const up = (name: string): DependencyProbe => ({ name, ping: () => Promise.resolve() });
const down = (name: string, cause: Error): DependencyProbe => ({ name, ping: () => Promise.reject(cause) });
/** A dependency that accepts the request and never answers. */
const hanging = (name: string): DependencyProbe => ({ name, ping: () => new Promise<void>(() => {}) });

describe('checkDependencies', () => {
  it('is ready when every dependency answers', async () => {
    const report = await checkDependencies([up('database'), up('redis')], 50);

    expect(report).toEqual({ ready: true, checks: { database: 'up', redis: 'up' }, failures: [] });
  });

  it('is ready with nothing to probe', async () => {
    expect((await checkDependencies([], 50)).ready).toBe(true);
  });

  it('reports which dependency is down and keeps the cause for the log', async () => {
    const cause = new Error('connection refused');

    const report = await checkDependencies([up('database'), down('redis', cause)], 50);

    expect(report.ready).toBe(false);
    expect(report.checks).toEqual({ database: 'up', redis: 'down' });
    expect(report.failures).toEqual([{ name: 'redis', cause }]);
  });

  it('counts a dependency that does not answer in time as down', async () => {
    const report = await checkDependencies([hanging('database')], 10);

    expect(report.checks).toEqual({ database: 'down' });
    expect(report.failures[0]?.cause).toBeInstanceOf(ProbeTimeoutError);
  });

  it('does not let one slow dependency hide the others', async () => {
    const report = await checkDependencies([hanging('database'), up('redis')], 10);

    expect(report.checks).toEqual({ database: 'down', redis: 'up' });
  });
});
