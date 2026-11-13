-- WhatsApp bot · the `integrations` tables and their internal helpers (M22 / L7)
--
-- Restores the WhatsApp channel of the pre-baseline schema on the posts model: the channel
-- switch, message templates, phone identities and consent, the inbound log, link codes,
-- the outbound queue, bot conversation sessions, the origin of bot posts and the review
-- queue of low-confidence bot posts.
--
-- Every table lives in `integrations` with forced RLS, no policies and no client grant. Edge
-- Functions reach them only through the `public.api_*` functions of the later WhatsApp
-- migrations (service role); the app reaches them through member and staff RPCs.
--
-- Rate limits reuse kc_private.rate_limit with keys prefixed `wa_`; the limits themselves
-- are the one row of integrations.whatsapp_send_limits, so the console can tune them.
--
-- A purged member's identity is unlinked (user_id set null) but the phone row and its
-- consent history stay, so a STOP sent from that phone keeps being honoured.

-- ── State machine of a review decision ───────────────────────────────────────
-- Both decisions are final. Who may decide is checked by the RPC.
insert into kc_private.fsm_state (machine_id, status) values
  ('review_decision', 'pending'), ('review_decision', 'approved'), ('review_decision', 'rejected');
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  ('review_decision', 'pending', 'approved', ''),
  ('review_decision', 'pending', 'rejected', '');

-- ── Channel switch ──────────────────────────────────────────────────────────
-- One row. The channel starts disabled: nothing is sent until staff switch it on.
create table integrations.whatsapp_channel_config (
  id                boolean primary key default true check (id),
  phone_number_id   text check (char_length(phone_number_id) between 1 and 64),
  graph_api_version text not null default 'v21.0' check (graph_api_version ~ '^v[0-9]{1,3}\.[0-9]{1,3}$'),
  is_enabled        boolean not null default false,
  updated_by        uuid references public.users (id) on delete set null,
  updated_at        timestamptz not null default now()
);
comment on table integrations.whatsapp_channel_config is 'WhatsApp channel switch (kill switch) and Graph API settings; one row.';
create index whatsapp_channel_config_updated_by_idx on integrations.whatsapp_channel_config (updated_by)
  where updated_by is not null;
alter table integrations.whatsapp_channel_config enable row level security;
alter table integrations.whatsapp_channel_config force row level security;
create trigger whatsapp_channel_config_set_updated_at
  before update on integrations.whatsapp_channel_config
  for each row execute function kc_private.set_updated_at();
insert into integrations.whatsapp_channel_config (id, is_enabled) values (true, false);

-- ── Message templates (reference data) ─────────────────────────────────────
-- Mirror of supabase/functions/_shared/whatsapp/templates.json (#936): one row per name and
-- language. A template is sent only while Meta has approved it.
create table integrations.whatsapp_message_templates (
  id               uuid primary key default gen_random_uuid(),
  template_name    text not null check (template_name ~ '^[a-z][a-z0-9_]{0,60}_v[0-9]{1,3}$'),
  language_code    text not null check (language_code in ('he', 'en')),
  category         text not null check (category in ('marketing', 'utility', 'authentication')),
  body_preview     text not null check (char_length(body_preview) between 1 and 1024),
  params           jsonb not null default '[]'::jsonb check (jsonb_typeof(params) = 'array'),
  registry_version integer not null check (registry_version > 0),
  meta_status      text not null default 'draft'
                     check (meta_status in ('draft', 'submitted', 'approved', 'rejected', 'paused', 'deprecated')),
  -- Derived from meta_status, kept as a column for the queue's index-free lookup.
  is_approved      boolean generated always as (meta_status = 'approved') stored,
  meta_template_id text check (char_length(meta_template_id) between 1 and 64),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint whatsapp_message_templates_name_lang_key unique (template_name, language_code)
);
comment on table integrations.whatsapp_message_templates is 'WhatsApp message templates (registry mirror) and their Meta approval state.';
alter table integrations.whatsapp_message_templates enable row level security;
alter table integrations.whatsapp_message_templates force row level security;
create trigger whatsapp_message_templates_set_updated_at
  before update on integrations.whatsapp_message_templates
  for each row execute function kc_private.set_updated_at();

insert into integrations.whatsapp_message_templates
  (template_name, language_code, category, body_preview, params, registry_version)
values
  ('match_found_v1', 'he', 'utility', 'נמצאה התאמה חדשה עבורך בעולם {{1}} בקהילת קארמה. פתח/י את האפליקציה כדי לראות ולאשר. להסרה מהודעות: השב/י "הסר".', '["world_label"]', 1),
  ('match_found_v1', 'en', 'utility', 'We found a new match for you in {{1}} on Karma Community. Open the app to view and confirm it. Reply STOP to unsubscribe.', '["world_label"]', 1),
  ('confirm_handoff_v1', 'he', 'utility', 'ההתאמה שלך, {{1}}, אישרה את ההעברה של "{{2}}". אפשר לתאם איסוף או מסירה בצ''אט באפליקציה. להסרה מהודעות: השב/י "הסר".', '["partner_name","listing_title"]', 1),
  ('confirm_handoff_v1', 'en', 'utility', 'Your match {{1}} confirmed the handoff for "{{2}}". Coordinate pickup or delivery in the app chat. Reply STOP to unsubscribe.', '["partner_name","listing_title"]', 1),
  ('reminder_v1', 'he', 'utility', 'תזכורת: "{{1}}" עדיין ממתין לתשובתך בקהילת קארמה. להסרה מתזכורות: השב/י "הסר".', '["listing_title"]', 1),
  ('reminder_v1', 'en', 'utility', 'Reminder: "{{1}}" is still waiting for your reply on Karma Community. Reply STOP to stop reminders.', '["listing_title"]', 1),
  ('opt_in_confirm_v1', 'he', 'utility', 'נרשמת להתראות התאמה מקהילת קארמה ב-WhatsApp. אפשר להסיר את עצמך בכל עת: השב/י "הסר".', '[]', 1),
  ('opt_in_confirm_v1', 'en', 'utility', 'You''re subscribed to Karma Community match alerts on WhatsApp. Reply STOP at any time to unsubscribe.', '[]', 1);

-- ── Send limits ─────────────────────────────────────────────────────────────
-- One row: Meta tier defaults that operators tune from the console.
create table integrations.whatsapp_send_limits (
  id                             boolean primary key default true check (id),
  per_user_hour                  integer not null default 5    check (per_user_hour between 1 and 1000),
  per_user_day                   integer not null default 20   check (per_user_day between 1 and 10000),
  reply_per_phone_hour           integer not null default 30   check (reply_per_phone_hour between 1 and 10000),
  global_per_minute              integer not null default 60   check (global_per_minute between 1 and 100000),
  global_template_recipients_day integer not null default 1000 check (global_template_recipients_day between 1 and 1000000),
  inbound_per_phone_minute       integer not null default 20   check (inbound_per_phone_minute between 1 and 10000),
  llm_per_phone_day              integer not null default 30   check (llm_per_phone_day between 1 and 10000),
  llm_global_day                 integer not null default 2000 check (llm_global_day between 1 and 1000000),
  max_attempts                   integer not null default 5    check (max_attempts between 1 and 20),
  backoff_base_seconds           integer not null default 30   check (backoff_base_seconds between 1 and 3600),
  updated_by                     uuid references public.users (id) on delete set null,
  updated_at                     timestamptz not null default now()
);
comment on table integrations.whatsapp_send_limits is 'WhatsApp caps, LLM budget and retry policy; one row.';
create index whatsapp_send_limits_updated_by_idx on integrations.whatsapp_send_limits (updated_by)
  where updated_by is not null;
alter table integrations.whatsapp_send_limits enable row level security;
alter table integrations.whatsapp_send_limits force row level security;
create trigger whatsapp_send_limits_set_updated_at
  before update on integrations.whatsapp_send_limits
  for each row execute function kc_private.set_updated_at();
insert into integrations.whatsapp_send_limits (id) values (true);

-- ── Phone identities and consent ────────────────────────────────────────────
-- One row per WhatsApp number. The phone-level consent (STOP / START) lives here; the
-- 24-hour customer-service window opens at `last_inbound_at`.
create table integrations.whatsapp_identities (
  id                 uuid primary key default gen_random_uuid(),
  wa_id              text not null unique check (char_length(btrim(wa_id)) between 1 and 32),
  user_id            uuid references public.users (id) on delete set null,
  consent_status     text not null default 'unknown' check (consent_status in ('unknown', 'opted_in', 'opted_out')),
  consent_updated_at timestamptz,
  last_inbound_at    timestamptz,
  preferred_language text not null default 'he' check (preferred_language in ('he', 'en')),
  last_upsell_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table integrations.whatsapp_identities is 'WhatsApp numbers, the member each is linked to, phone consent and the session window.';
create index whatsapp_identities_user_idx on integrations.whatsapp_identities (user_id) where user_id is not null;
create index whatsapp_identities_recent_idx on integrations.whatsapp_identities (updated_at desc, id desc);
alter table integrations.whatsapp_identities enable row level security;
alter table integrations.whatsapp_identities force row level security;
create trigger whatsapp_identities_set_updated_at
  before update on integrations.whatsapp_identities
  for each row execute function kc_private.set_updated_at();

-- The member's own switch for WhatsApp match alerts (app toggle, mirrored from keywords).
create table integrations.whatsapp_consents (
  user_id      uuid primary key references public.users (id) on delete cascade,
  opted_in     boolean not null,
  opted_in_at  timestamptz,
  opted_out_at timestamptz,
  updated_at   timestamptz not null default now()
);
comment on table integrations.whatsapp_consents is 'A member''s opt-in to WhatsApp match alerts.';
alter table integrations.whatsapp_consents enable row level security;
alter table integrations.whatsapp_consents force row level security;
create trigger whatsapp_consents_set_updated_at
  before update on integrations.whatsapp_consents
  for each row execute function kc_private.set_updated_at();

-- ── Inbound log ─────────────────────────────────────────────────────────────
-- Meta retries a delivery it did not see answered; the webhook claims each message id first.
create table integrations.whatsapp_inbound_claims (
  message_id text primary key check (char_length(btrim(message_id)) between 1 and 200),
  claimed_at timestamptz not null default now()
);
comment on table integrations.whatsapp_inbound_claims is 'Message ids the webhook already took, so a retried delivery is skipped.';
create index whatsapp_inbound_claims_claimed_idx on integrations.whatsapp_inbound_claims (claimed_at);
alter table integrations.whatsapp_inbound_claims enable row level security;
alter table integrations.whatsapp_inbound_claims force row level security;

-- Raw inbound messages, kept until `retain_until` (stamped from the retention rule).
create table integrations.whatsapp_inbound_messages (
  id           uuid primary key default gen_random_uuid(),
  message_id   text not null unique check (char_length(btrim(message_id)) between 1 and 200),
  wa_id        text check (char_length(wa_id) between 1 and 32),
  payload      jsonb not null check (jsonb_typeof(payload) = 'object'),
  received_at  timestamptz not null default now(),
  retain_until timestamptz not null default now() + interval '90 days'
);
comment on table integrations.whatsapp_inbound_messages is 'Inbound WhatsApp messages as Meta delivered them; purged after retain_until.';
create index whatsapp_inbound_messages_retain_idx on integrations.whatsapp_inbound_messages (retain_until);
alter table integrations.whatsapp_inbound_messages enable row level security;
alter table integrations.whatsapp_inbound_messages force row level security;

-- Append-only history of every consent change and HELP request.
create table integrations.whatsapp_consent_events (
  id                 uuid primary key default gen_random_uuid(),
  wa_id              text,
  user_id            uuid references public.users (id) on delete set null,
  action             text not null check (action in ('opt_in', 'opt_out', 'help')),
  source             text not null check (source in ('keyword', 'app', 'admin', 'system')),
  keyword            text check (char_length(keyword) <= 40),
  inbound_message_id uuid references integrations.whatsapp_inbound_messages (id) on delete set null,
  created_at         timestamptz not null default now()
);
comment on table integrations.whatsapp_consent_events is 'History of WhatsApp consent changes and help requests.';
create index whatsapp_consent_events_wa_idx on integrations.whatsapp_consent_events (wa_id, created_at desc);
create index whatsapp_consent_events_user_idx on integrations.whatsapp_consent_events (user_id, created_at desc)
  where user_id is not null;
create index whatsapp_consent_events_inbound_idx on integrations.whatsapp_consent_events (inbound_message_id)
  where inbound_message_id is not null;
alter table integrations.whatsapp_consent_events enable row level security;
alter table integrations.whatsapp_consent_events force row level security;

-- ── Link codes ──────────────────────────────────────────────────────────────
-- One live code per member; only its hash is stored.
create table integrations.whatsapp_link_codes (
  user_id    uuid primary key references public.users (id) on delete cascade,
  code_hash  text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
comment on table integrations.whatsapp_link_codes is 'One-time codes that link a WhatsApp number to a member (hash only).';
create index whatsapp_link_codes_hash_idx on integrations.whatsapp_link_codes (code_hash);
create index whatsapp_link_codes_expires_idx on integrations.whatsapp_link_codes (expires_at);
alter table integrations.whatsapp_link_codes enable row level security;
alter table integrations.whatsapp_link_codes force row level security;

create table integrations.whatsapp_link_failures (
  id        bigint generated always as identity primary key,
  wa_id     text not null check (char_length(wa_id) between 1 and 32),
  failed_at timestamptz not null default now()
);
comment on table integrations.whatsapp_link_failures is 'Failed link-code attempts per number, for the lockout.';
create index whatsapp_link_failures_wa_idx on integrations.whatsapp_link_failures (wa_id, failed_at);
create index whatsapp_link_failures_failed_idx on integrations.whatsapp_link_failures (failed_at);
alter table integrations.whatsapp_link_failures enable row level security;
alter table integrations.whatsapp_link_failures force row level security;

-- ── Outbound queue ──────────────────────────────────────────────────────────
-- Every message the product wanted to send, with its outcome. A `skipped_*` row is written
-- with that status and never sent. Polling with `for update skip locked` is the queue.
create table integrations.whatsapp_outbound_messages (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references public.users (id) on delete set null,
  kind            text not null check (kind in ('template', 'session')),
  to_wa_id        text check (char_length(to_wa_id) between 1 and 32),
  language        text not null default 'he' check (language in ('he', 'en')),
  template_name   text,
  body            text check (char_length(body) <= 4096),
  payload         jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status          text not null check (status in (
                    'queued', 'sending', 'sent', 'failed', 'skipped_rate_limit', 'skipped_no_consent',
                    'skipped_outside_window', 'skipped_template_unapproved', 'skipped_no_identity',
                    'skipped_global_cap', 'skipped_channel_disabled')),
  attempts        integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  claimed_at      timestamptz,
  sent_at         timestamptz,
  wa_message_id   text,
  last_error      text check (char_length(last_error) <= 500),
  created_at      timestamptz not null default now(),
  constraint whatsapp_outbound_kind_chk check (
    (kind = 'template' and template_name is not null) or (kind = 'session' and body is not null))
);
comment on table integrations.whatsapp_outbound_messages is 'WhatsApp outbound queue and send log (templates and session replies).';
create index whatsapp_outbound_due_idx on integrations.whatsapp_outbound_messages (next_attempt_at) where status = 'queued';
create index whatsapp_outbound_sending_idx on integrations.whatsapp_outbound_messages (claimed_at) where status = 'sending';
create index whatsapp_outbound_user_idx on integrations.whatsapp_outbound_messages (user_id, created_at desc)
  where user_id is not null;
create index whatsapp_outbound_to_idx on integrations.whatsapp_outbound_messages (to_wa_id, created_at desc);
create index whatsapp_outbound_recent_idx on integrations.whatsapp_outbound_messages (created_at desc, id desc);
alter table integrations.whatsapp_outbound_messages enable row level security;
alter table integrations.whatsapp_outbound_messages force row level security;

-- ── Bot conversations, bot posts and their review ───────────────────────────
-- `draft` holds the extraction (world, kind, direction, title, summary, details).
create table integrations.bot_conversation_sessions (
  id                 uuid primary key default gen_random_uuid(),
  identity_id        uuid not null references integrations.whatsapp_identities (id) on delete cascade,
  inbound_message_id uuid references integrations.whatsapp_inbound_messages (id) on delete set null,
  state              text not null default 'collecting' check (state in ('collecting', 'confirm', 'published', 'idle')),
  draft              jsonb not null default '{}'::jsonb check (jsonb_typeof(draft) = 'object'),
  confidence         numeric(4, 3) check (confidence between 0 and 1),
  post_id            uuid references public.posts (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table integrations.bot_conversation_sessions is 'WhatsApp bot conversations that draft and publish a post.';
create index bot_conversation_sessions_identity_idx on integrations.bot_conversation_sessions (identity_id, updated_at desc);
create index bot_conversation_sessions_recent_idx on integrations.bot_conversation_sessions (updated_at desc, id desc);
create index bot_conversation_sessions_inbound_idx on integrations.bot_conversation_sessions (inbound_message_id)
  where inbound_message_id is not null;
create index bot_conversation_sessions_post_idx on integrations.bot_conversation_sessions (post_id)
  where post_id is not null;
alter table integrations.bot_conversation_sessions enable row level security;
alter table integrations.bot_conversation_sessions force row level security;
create trigger bot_conversation_sessions_set_updated_at
  before update on integrations.bot_conversation_sessions
  for each row execute function kc_private.set_updated_at();

-- Provenance of a post the bot created: the session and the message it came from.
create table integrations.bot_post_origins (
  post_id            uuid primary key references public.posts (id) on delete cascade,
  session_id         uuid references integrations.bot_conversation_sessions (id) on delete set null,
  inbound_message_id uuid references integrations.whatsapp_inbound_messages (id) on delete set null,
  created_at         timestamptz not null default now()
);
comment on table integrations.bot_post_origins is 'Posts created by the WhatsApp bot and the conversation they came from.';
create index bot_post_origins_session_idx on integrations.bot_post_origins (session_id) where session_id is not null;
create index bot_post_origins_inbound_idx on integrations.bot_post_origins (inbound_message_id)
  where inbound_message_id is not null;
alter table integrations.bot_post_origins enable row level security;
alter table integrations.bot_post_origins force row level security;

-- Low-confidence extractions and the draft posts they produced, waiting for staff.
create table integrations.bot_review_items (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid references integrations.bot_conversation_sessions (id) on delete set null,
  post_id     uuid references public.posts (id) on delete cascade,
  reason      text not null check (reason in ('low_confidence_extraction', 'publish_pending_review')),
  status      text not null default 'pending',
  reviewer_id uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  constraint bot_review_items_resolved_chk check ((status = 'pending') = (resolved_at is null))
);
comment on table integrations.bot_review_items is 'Review queue of low-confidence WhatsApp bot posts (machine review_decision).';
create index bot_review_items_queue_idx on integrations.bot_review_items (status, created_at desc, id desc);
create index bot_review_items_session_idx on integrations.bot_review_items (session_id) where session_id is not null;
create index bot_review_items_post_idx on integrations.bot_review_items (post_id) where post_id is not null;
create index bot_review_items_reviewer_idx on integrations.bot_review_items (reviewer_id) where reviewer_id is not null;
alter table integrations.bot_review_items enable row level security;
alter table integrations.bot_review_items force row level security;
create trigger bot_review_items_status_fsm
  before insert or update of status on integrations.bot_review_items
  for each row execute function kc_private.fsm_guard_status('review_decision', 'status');

-- Which notification kinds also go out on WhatsApp, as which template, with which params.
create table integrations.whatsapp_notification_templates (
  kind          text primary key,
  template_name text not null,
  param_builder text not null check (param_builder in ('world_label', 'partner_and_title'))
);
comment on table integrations.whatsapp_notification_templates is 'Notification kinds mirrored to WhatsApp and their template.';
alter table integrations.whatsapp_notification_templates enable row level security;
alter table integrations.whatsapp_notification_templates force row level security;
insert into integrations.whatsapp_notification_templates (kind, template_name, param_builder) values
  ('match_suggested', 'match_found_v1', 'world_label'),
  ('match_accepted', 'confirm_handoff_v1', 'partner_and_title');

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- Hits of a rate-limit key in its live window; 0 once the window ended or before the first hit.
create function kc_private.rate_limit_peek(p_key text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.hits from kc_private.rate_limit_counters c
                    where c.key = p_key and c.expires_at > now()), 0);
$$;
comment on function kc_private.rate_limit_peek(text) is 'Hits counted for a rate-limit key in its current window (no hit is counted).';

-- The one row of send limits.
create function kc_private.whatsapp_limits()
returns integrations.whatsapp_send_limits
language sql
stable
security definer
set search_path = ''
as $$
  select l.* from integrations.whatsapp_send_limits l where l.id;
$$;
comment on function kc_private.whatsapp_limits() is 'The WhatsApp send limits row.';

-- Whether the channel switch is on.
create function kc_private.whatsapp_channel_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.is_enabled from integrations.whatsapp_channel_config c where c.id), false);
$$;
comment on function kc_private.whatsapp_channel_enabled() is 'True while the WhatsApp channel switch is on.';

-- A phone number as staff see it: four stars and the last four characters.
create function kc_private.whatsapp_mask(p_wa_id text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_wa_id is null or p_wa_id = '' then null
              when char_length(p_wa_id) <= 4 then '****'
              else '****' || right(p_wa_id, 4) end;
$$;
comment on function kc_private.whatsapp_mask(text) is 'Masks a WhatsApp number to its last four characters.';

-- SHA-256 of a link code (the only form stored).
create function kc_private.whatsapp_link_code_hash(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to('kc-wa-link:' || btrim(coalesce(p_code, '')), 'UTF8')), 'hex');
$$;
comment on function kc_private.whatsapp_link_code_hash(text) is 'Hash under which a WhatsApp link code is stored.';

-- Exact-match consent keywords in Hebrew and English: {action, language, keyword} or null.
-- Punctuation and emoji are dropped with explicit ranges (not [:alnum:]), so Hebrew letters
-- survive under a C collation. A message that merely contains "stop" is not a keyword.
create function kc_private.whatsapp_parse_keyword(p_text text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  if p_text is null then
    return null;
  end if;
  v := regexp_replace(p_text, '[[:punct:]־׳״ -⯿️]', '', 'g');
  v := regexp_replace(v, '[\U0001F000-\U0001FAFF]', '', 'g');
  v := lower(btrim(regexp_replace(v, '\s+', ' ', 'g')));
  if v = '' or char_length(v) > 24 then
    return null;
  end if;
  return case
    when v in ('stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'opt out', 'optout')
      then jsonb_build_object('action', 'opt_out', 'language', 'en', 'keyword', v)
    when v in ('הסר', 'הסרה', 'הסירו', 'עצור', 'די', 'ביטול', 'הפסק')
      then jsonb_build_object('action', 'opt_out', 'language', 'he', 'keyword', v)
    when v in ('start', 'subscribe', 'yes', 'unstop', 'opt in', 'optin')
      then jsonb_build_object('action', 'opt_in', 'language', 'en', 'keyword', v)
    when v in ('הצטרף', 'הצטרפות', 'התחל', 'כן', 'אישור', 'הרשמה')
      then jsonb_build_object('action', 'opt_in', 'language', 'he', 'keyword', v)
    when v in ('help', 'info') then jsonb_build_object('action', 'help', 'language', 'en', 'keyword', v)
    when v in ('עזרה', 'מידע') then jsonb_build_object('action', 'help', 'language', 'he', 'keyword', v)
  end;
end;
$$;
comment on function kc_private.whatsapp_parse_keyword(text) is 'Parses a STOP / START / HELP keyword (he, en); null for any other text.';

-- Proactive sends need the member's opt-in and no STOP from any of their numbers.
create function kc_private.whatsapp_user_can_receive(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.opted_in from integrations.whatsapp_consents c where c.user_id = p_user_id), false)
     and not exists (select 1 from integrations.whatsapp_identities i
                      where i.user_id = p_user_id and i.consent_status = 'opted_out');
$$;
comment on function kc_private.whatsapp_user_can_receive(uuid) is 'The member opted in to WhatsApp alerts and no linked number said STOP.';

-- Sets a member's alert opt-in and records it. An opt-out also stops every linked number;
-- an opt-in never lifts a phone-level STOP (the phone must send START).
create function kc_private.whatsapp_set_user_consent(
  p_user_id uuid, p_opted_in boolean, p_source text, p_keyword text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into integrations.whatsapp_consents as c (user_id, opted_in, opted_in_at, opted_out_at)
  values (p_user_id, p_opted_in, case when p_opted_in then now() end, case when not p_opted_in then now() end)
  on conflict (user_id) do update
    set opted_in = excluded.opted_in,
        opted_in_at = case when excluded.opted_in then now() else c.opted_in_at end,
        opted_out_at = case when excluded.opted_in then null else now() end;
  if not p_opted_in then
    update integrations.whatsapp_identities i
       set consent_status = 'opted_out', consent_updated_at = now()
     where i.user_id = p_user_id and i.consent_status <> 'opted_out';
  end if;
  insert into integrations.whatsapp_consent_events (wa_id, user_id, action, source, keyword)
  values ((select i.wa_id from integrations.whatsapp_identities i
            where i.user_id = p_user_id order by i.updated_at desc limit 1),
          p_user_id, case when p_opted_in then 'opt_in' else 'opt_out' end, p_source, p_keyword);
end;
$$;
comment on function kc_private.whatsapp_set_user_consent(uuid, boolean, text, text) is
  'Sets a member''s WhatsApp alert opt-in (an opt-out also stops their numbers) and records the event.';

-- Raises unless the member exists and holds an active account (the explicit-user twin of
-- kc_private.require_active_caller, for service-role tools that act for a linked member).
create function kc_private.whatsapp_require_active_user(p_user_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'user_id_required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.users u where u.id = p_user_id and u.is_active) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;
  return p_user_id;
end;
$$;
comment on function kc_private.whatsapp_require_active_user(uuid) is 'Returns the member id; raises unless the account is active.';
