-- 0207_ugc_translation_language_columns — FR-TRANSLATE-001 (foundations).
-- Adds language plumbing for cross-language UGC translation (see
-- docs/superpowers/specs/2026-06-29-ugc-translation-design.md §4).
-- All ADD COLUMN are nullable => metadata-only, no table rewrite. Idempotent.

-- Reader's preferred output language (BCP-47). Null => resolve from device locale at runtime.
alter table public.users
  add column if not exists preferred_language text;

comment on column public.users.preferred_language is
  'BCP-47 tag for the language UGC is translated INTO for this reader. Null = fall back to device locale (resolvePreferredLanguage). Validated app-side as a LanguageTag.';

alter table public.users drop constraint if exists users_preferred_language_chk;
alter table public.users
  add constraint users_preferred_language_chk check (
    preferred_language is null
    or char_length(preferred_language) between 2 and 35
  );

-- Detected source language of post content (set later by the translate pipeline).
alter table public.posts
  add column if not exists source_language text;
alter table public.posts
  add column if not exists source_language_confidence real;

comment on column public.posts.source_language is
  'Detected BCP-47 source language of title/description. Null = not yet detected. Set by the translate pipeline (Phase 1).';
comment on column public.posts.source_language_confidence is
  'Detector self-rated confidence 0..1 for source_language. Null = unknown.';

alter table public.posts drop constraint if exists posts_source_language_conf_chk;
alter table public.posts
  add constraint posts_source_language_conf_chk check (
    source_language_confidence is null
    or source_language_confidence between 0 and 1
  );

-- Detected source language of message body.
alter table public.messages
  add column if not exists source_language text;
alter table public.messages
  add column if not exists source_language_confidence real;

comment on column public.messages.source_language is
  'Detected BCP-47 source language of body. Null = not yet detected. Set by the translate pipeline (Phase 1).';
comment on column public.messages.source_language_confidence is
  'Detector self-rated confidence 0..1 for source_language. Null = unknown.';

alter table public.messages drop constraint if exists messages_source_language_conf_chk;
alter table public.messages
  add constraint messages_source_language_conf_chk check (
    source_language_confidence is null
    or source_language_confidence between 0 and 1
  );
