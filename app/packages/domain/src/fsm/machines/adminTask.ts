import { defineMachine } from '../machine';

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
