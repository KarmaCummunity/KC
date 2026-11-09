import { defineMachine } from '../machine';

/**
 * Admin task lifecycle (FR-ADMIN-018). Pilot machine of the FSM kernel.
 * `archived` is terminal. No edge is role-restricted: who may move a task (assignee,
 * creator or super admin) is checked by `admin_task_set_status` before the graph.
 * SQL copy: `supabase/migrations/0680_fsm_catalog.sql`.
 */
export const adminTaskMachine = defineMachine({
  id: 'admin_task',
  states: ['open', 'in_progress', 'blocked', 'done', 'archived'] as const,
  edges: [
    { from: 'open', to: 'in_progress' },
    { from: 'open', to: 'blocked' },
    { from: 'in_progress', to: 'open' },
    { from: 'in_progress', to: 'blocked' },
    { from: 'in_progress', to: 'done' },
    { from: 'blocked', to: 'open' },
    { from: 'blocked', to: 'in_progress' },
    { from: 'blocked', to: 'done' },
    { from: 'done', to: 'in_progress' },
    { from: 'done', to: 'archived' },
  ],
});
