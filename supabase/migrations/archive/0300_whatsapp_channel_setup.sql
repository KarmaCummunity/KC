-- 0300_whatsapp_channel_setup | Issue #842
-- Channel metadata + template registry (secrets live in Edge env only).

begin;

insert into public.ingestion_sources (slug, source_type, label, consent_ref)
values (
  'whatsapp-cloud',
  'whatsapp',
  'WhatsApp Business Cloud API',
  'PRD V2 WhatsApp matching bot — explicit opt-in required (#845)'
)
on conflict (slug) do nothing;

create table public.whatsapp_message_templates (
  template_id   uuid primary key default gen_random_uuid(),
  template_name text not null unique,
  language_code text not null default 'he',
  category      text not null check (category in ('marketing','utility','authentication')),
  body_preview  text not null,
  is_approved   boolean not null default false,
  created_at    timestamptz not null default now()
);

insert into public.whatsapp_message_templates (template_name, language_code, category, body_preview, is_approved)
values
  ('match_found_v1', 'he', 'utility', 'נמצאה התאמה חדשה ב-{{world}}. {{action}}', false),
  ('intake_confirm_v1', 'he', 'utility', 'לאשר פרסום: {{title}}?', false),
  ('opt_in_v1', 'he', 'utility', 'לאשר קבלת התראות התאמה ב-WhatsApp?', false)
on conflict (template_name) do nothing;

create table public.whatsapp_channel_config (
  config_id          uuid primary key default gen_random_uuid(),
  source_id          uuid not null references public.ingestion_sources(source_id),
  phone_number_id    text,
  graph_api_version  text not null default 'v21.0',
  is_enabled         boolean not null default false,
  updated_at         timestamptz not null default now(),
  constraint whatsapp_channel_config_single unique (source_id)
);

insert into public.whatsapp_channel_config (source_id, is_enabled)
select source_id, false from public.ingestion_sources where slug = 'whatsapp-cloud'
on conflict (source_id) do nothing;

alter table public.whatsapp_message_templates enable row level security;
alter table public.whatsapp_channel_config enable row level security;

create policy whatsapp_templates_read on public.whatsapp_message_templates
  for select to authenticated using (true);

create policy whatsapp_channel_config_operator on public.whatsapp_channel_config
  for select to authenticated using (public.is_listing_operator(auth.uid()));

commit;
