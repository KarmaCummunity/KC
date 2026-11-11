-- Research · in-app surveys (FR-SETTINGS-015, FR-SETTINGS-016)
--
-- Surveys are server-driven: the app renders whatever the current version of a survey
-- holds, so wording changes without an app release. Publishing creates a new immutable
-- version with its questions; answers belong to a question, hence to one version, and a
-- new version starts every member over. Members read the catalog and their own answers
-- under RLS; they write answers only through upsert_survey_answers().

create table public.surveys (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  title_he        text not null check (char_length(title_he) between 1 and 200),
  description_he  text check (char_length(description_he) <= 1000),
  is_active       boolean not null default true,
  -- 0 until the first version is published.
  current_version integer not null default 0 check (current_version >= 0),
  -- When the prompt banner is offered (FR-SETTINGS-016 AC6, AC10):
  --   { "min_sessions": 3, "min_active_days_14d": 2, "require_closure": true,
  --     "require_profile_complete": true }
  prompt_rules    jsonb not null default '{}'::jsonb check (jsonb_typeof(prompt_rules) = 'object'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.surveys is 'Catalog of server-driven surveys; current_version advances on each publish.';

create trigger surveys_set_updated_at
  before update on public.surveys
  for each row execute function kc_private.set_updated_at();

create table public.survey_versions (
  id           uuid primary key default gen_random_uuid(),
  survey_id    uuid not null references public.surveys (id) on delete cascade,
  version      integer not null check (version >= 1),
  -- The admin who published it; kept as null once their account is removed.
  published_by uuid references public.users (id) on delete set null,
  published_at timestamptz not null default now(),
  -- Also the lookup of a survey's current version; covers the survey foreign key.
  constraint survey_versions_survey_version_key unique (survey_id, version)
);
comment on table public.survey_versions is 'One immutable row per published version of a survey.';

-- Covers the publisher foreign key (account removal).
create index survey_versions_published_by_idx on public.survey_versions (published_by)
  where published_by is not null;

create table public.survey_questions (
  id                    uuid primary key default gen_random_uuid(),
  survey_version_id     uuid not null references public.survey_versions (id) on delete cascade,
  sort_order            integer not null,
  -- A 1–7 rating, or exactly one of `choice_options`; both take an optional text.
  question_type         text not null default 'rating_1_7_with_optional_text' check (question_type in
                          ('rating_1_7_with_optional_text', 'single_choice_with_optional_text')),
  short_label_he        text not null,
  prompt_he             text not null,
  context_he            text not null default '',
  text_placeholder_he   text not null default '',
  -- Labels of the two ends of the rating scale.
  rating_anchor_low_he  text not null default '',
  rating_anchor_high_he text not null default '',
  -- Single-choice questions only: ordered [{ "key", "label_he" }], two to six options.
  choice_options        jsonb,
  -- Questions of a version in display order; covers the version foreign key.
  constraint survey_questions_version_order_key unique (survey_version_id, sort_order),
  constraint survey_questions_choice_options_chk check (case question_type
    when 'single_choice_with_optional_text' then
      jsonb_typeof(choice_options) = 'array' and jsonb_array_length(choice_options) between 2 and 6
    else choice_options is null end)
);
comment on table public.survey_questions is 'Ordered questions of one survey version.';

create table public.survey_answers (
  user_id     uuid not null references public.users (id) on delete cascade,
  question_id uuid not null references public.survey_questions (id) on delete cascade,
  rating      integer check (rating between 1 and 7),
  choice_key  text check (char_length(choice_key) between 1 and 64),
  answer_text text check (char_length(answer_text) between 1 and 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- One answer per member per question; editable while the version is current.
  primary key (user_id, question_id),
  -- An answer is a rating or a chosen option, never both (FR-SETTINGS-016 AC9).
  constraint survey_answers_one_value_chk check (num_nonnulls(rating, choice_key) = 1)
);
comment on table public.survey_answers is 'A member''s answer to one survey question. Written through upsert_survey_answers().';

-- Results of a question; covers the question foreign key.
create index survey_answers_question_idx on public.survey_answers (question_id);

create trigger survey_answers_set_updated_at
  before update on public.survey_answers
  for each row execute function kc_private.set_updated_at();

alter table public.surveys enable row level security;
alter table public.surveys force row level security;
alter table public.survey_versions enable row level security;
alter table public.survey_versions force row level security;
alter table public.survey_questions enable row level security;
alter table public.survey_questions force row level security;
alter table public.survey_answers enable row level security;
alter table public.survey_answers force row level security;

-- Members read surveys that are active and published, with their versions and questions.
-- The version and question subqueries run under the caller's access to the parent table.
create policy surveys_select_published on public.surveys
  for select to authenticated
  using (is_active and current_version > 0);
create policy survey_versions_select_member on public.survey_versions
  for select to authenticated
  using (exists (select 1 from public.surveys s where s.id = survey_versions.survey_id));
create policy survey_questions_select_member on public.survey_questions
  for select to authenticated
  using (exists (select 1 from public.survey_versions v where v.id = survey_questions.survey_version_id));
-- A member reads only their own answers.
create policy survey_answers_select_own on public.survey_answers
  for select to authenticated
  using (user_id = (select auth.uid()));
-- The super admin reads every survey (retired ones too) and every answer, for the results
-- screens (FR-ADMIN, survey reports).
create policy surveys_select_super_admin on public.surveys
  for select to authenticated
  using ((select kc_access.has_admin_role('super_admin')));
create policy survey_answers_select_super_admin on public.survey_answers
  for select to authenticated
  using ((select kc_access.has_admin_role('super_admin')));

grant select on public.surveys to authenticated;
grant select on public.survey_versions to authenticated;
grant select on public.survey_questions to authenticated;
grant select on public.survey_answers to authenticated;
