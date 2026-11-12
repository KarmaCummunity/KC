import { defineMachine } from '../machine';

/**
 * The embedding job of a post (`kc_private.embedding_jobs.status`), the queue of the embedding
 * worker behind matching.
 *
 * - A worker claims a waiting job (`pending → processing`) and ends it with the stored vector
 *   (`→ done`) or the provider's error (`→ failed`).
 * - A post that changes asks for a fresh embedding from any state (`→ pending`).
 * - Taking over a job whose worker went silent keeps it `processing`: no move.
 *
 * SQL copy: `supabase/migrations/0050_knowledge_topic_embedding_job_machines.sql`.
 */
export const embeddingJobMachine = defineMachine({
  id: 'embedding_job',
  states: ['pending', 'processing', 'done', 'failed'] as const,
  edges: [
    { from: 'pending', to: 'processing' },
    { from: 'processing', to: 'done' },
    { from: 'processing', to: 'failed' },
    { from: 'processing', to: 'pending' },
    { from: 'done', to: 'pending' },
    { from: 'failed', to: 'pending' },
  ],
});
