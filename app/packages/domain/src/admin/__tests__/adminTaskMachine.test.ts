import { describe, expect, it } from 'vitest';
import { isTerminal } from '../../fsm/machine';
import { adminTaskMachine } from '../../fsm/machines/adminTask';
import { ADMIN_TASK_STATUSES, isStatusTransitionAllowed } from '../AdminTask';

const LEGAL_EDGES: readonly (readonly [string, string])[] = [
  ['open', 'in_progress'],
  ['open', 'blocked'],
  ['in_progress', 'open'],
  ['in_progress', 'blocked'],
  ['in_progress', 'done'],
  ['blocked', 'open'],
  ['blocked', 'in_progress'],
  ['blocked', 'done'],
  ['done', 'in_progress'],
  ['done', 'archived'],
];

describe('adminTaskMachine pilot graph', () => {
  it('declares exactly the admin task statuses', () => {
    expect(adminTaskMachine.states).toEqual(ADMIN_TASK_STATUSES);
  });

  it.each(LEGAL_EDGES)('allows %s -> %s', (from, to) => {
    expect(isStatusTransitionAllowed(from as never, to as never)).toBe(true);
  });

  it('allows exactly the ten legal edges between distinct statuses', () => {
    const legal = new Set(LEGAL_EDGES.map(([from, to]) => `${from}->${to}`));
    const rejected: string[] = [];
    for (const from of ADMIN_TASK_STATUSES) {
      for (const to of ADMIN_TASK_STATUSES) {
        if (from === to || legal.has(`${from}->${to}`)) continue;
        rejected.push(`${from}->${to}`);
        expect(isStatusTransitionAllowed(from, to), `${from}->${to}`).toBe(false);
      }
    }
    expect(LEGAL_EDGES).toHaveLength(10);
    expect(rejected).toHaveLength(ADMIN_TASK_STATUSES.length * (ADMIN_TASK_STATUSES.length - 1) - 10);
  });

  it('treats only archived as terminal', () => {
    expect(isTerminal(adminTaskMachine, 'archived')).toBe(true);
    expect(isTerminal(adminTaskMachine, 'done')).toBe(false);
  });
});
