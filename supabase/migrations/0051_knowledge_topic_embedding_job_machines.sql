-- FSM kernel · the two status lifecycles that had no graph (issue #2202, FR-KNOW-001 AC5)
--
-- A sweep of every status column found two lifecycles written without a transition graph:
--
--   knowledge_topics.status   came back with 0024_world_content.sql as a plain check list,
--                             so a merged topic could be revived and an active one sent back
--                             to "proposed". The graph it had before the baseline is restored.
--   embedding_jobs.status     the queue of the embedding worker. Its three writers each held
--                             their own `where status = …`; the graph now states what they do.
--
-- Both tables are written by trusted code only (administrators through row security, the
-- worker through its security-definer calls), so every edge is open to any writer: the
-- graph refuses impossible moves, access stays where it already is.
-- Errors: illegal_transition, unknown_state (P0001).

-- ── Knowledge topic ─────────────────────────────────────────────────────────────────────
insert into kc_private.fsm_state (machine_id, status) values
  ('knowledge_topic', 'proposed'), ('knowledge_topic', 'active'), ('knowledge_topic', 'merged');

insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  -- A suggested topic is approved.
  ('knowledge_topic', 'proposed', 'active', ''),
  -- A topic is folded into another one, whether it was only suggested or already shown.
  -- `merged` is final: its slug keeps resolving to the topic that replaced it.
  ('knowledge_topic', 'proposed', 'merged', ''),
  ('knowledge_topic', 'active', 'merged', '');

create trigger knowledge_topics_status_fsm
  before insert or update of status on public.knowledge_topics
  for each row execute function kc_private.fsm_guard_status('knowledge_topic', 'status');

-- ── Embedding job ───────────────────────────────────────────────────────────────────────
insert into kc_private.fsm_state (machine_id, status) values
  ('embedding_job', 'pending'), ('embedding_job', 'processing'),
  ('embedding_job', 'done'), ('embedding_job', 'failed');

insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  -- A worker takes the job (embedding_jobs_claim). Taking over a job whose worker went
  -- silent keeps it `processing`, which is no move.
  ('embedding_job', 'pending', 'processing', ''),
  -- The worker stores the vector, or reports that the provider failed.
  ('embedding_job', 'processing', 'done', ''),
  ('embedding_job', 'processing', 'failed', ''),
  -- The post changed and asks for a fresh embedding, whatever the job was doing.
  ('embedding_job', 'processing', 'pending', ''),
  ('embedding_job', 'done', 'pending', ''),
  ('embedding_job', 'failed', 'pending', '');

create trigger embedding_jobs_status_fsm
  before insert or update of status on kc_private.embedding_jobs
  for each row execute function kc_private.fsm_guard_status('embedding_job', 'status');
