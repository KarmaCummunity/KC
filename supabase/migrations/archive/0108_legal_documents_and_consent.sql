-- 0108_legal_documents_and_consent.sql
-- Spec: docs/superpowers/specs/2026-05-24-server-driven-legal-documents-design.md
-- Replaces the static /legal screen with a server-driven two-document model
-- (Terms of Service + Privacy Policy), captures per-version consent for
-- GDPR Art. 7 / Israeli Privacy Protection Law audit-readiness.

begin;

-- pgcrypto provides digest() for SHA-256 content_hash computation.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enum: legal_doc_type
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'legal_doc_type') then
    create type public.legal_doc_type as enum ('terms', 'privacy');
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- Table: legal_documents (current pointer, two rows total)
-- ---------------------------------------------------------------------------
create table if not exists public.legal_documents (
  id                       uuid primary key default gen_random_uuid(),
  doc_type                 public.legal_doc_type not null unique,
  current_version          int not null default 1,
  current_effective_date   timestamptz not null,
  last_material_version    int not null default 1,
  last_material_severity   text null,
  updated_at               timestamptz not null default now(),
  constraint legal_documents_last_material_severity_chk
    check (last_material_severity is null or last_material_severity in ('standard', 'critical'))
);

comment on table public.legal_documents is
  'Current-pointer table for legal documents. Exactly two rows: one per doc_type.';

-- ---------------------------------------------------------------------------
-- Table: legal_document_versions (immutable history, append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.legal_document_versions (
  id              uuid primary key default gen_random_uuid(),
  doc_type        public.legal_doc_type not null,
  version         int not null,
  language        text not null default 'he',
  effective_date  timestamptz not null,
  body_md         text not null,
  content_hash    text not null default '',
  severity        text not null,
  change_summary  text null,
  published_by    uuid not null references auth.users(id),
  published_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  constraint legal_document_versions_unique unique (doc_type, version),
  constraint legal_document_versions_severity_chk
    check (severity in ('minor', 'standard', 'critical')),
  constraint legal_document_versions_summary_required_for_material
    check (severity = 'minor' or (change_summary is not null and length(trim(change_summary)) > 0))
);

comment on table public.legal_document_versions is
  'Append-only history of every legal document publish. Immutability enforced by trigger.';

-- ---------------------------------------------------------------------------
-- Table: user_legal_acceptances (append-only event log)
-- ---------------------------------------------------------------------------
create table if not exists public.user_legal_acceptances (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  doc_type     public.legal_doc_type not null,
  version      int not null,
  accepted_at  timestamptz not null default now(),
  ip_inet      inet null,
  user_agent   text null,
  locale       text null,
  constraint user_legal_acceptances_version_fk
    foreign key (doc_type, version)
    references public.legal_document_versions (doc_type, version)
);

comment on table public.user_legal_acceptances is
  'Append-only event log. One row per acceptance event per user per doc_type. GDPR Art. 7(1).';

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- BEFORE INSERT: compute SHA-256 of body_md into content_hash.
-- pgcrypto installs into the `extensions` schema on Supabase, so digest()
-- must be schema-qualified — the trigger fires in callers' search_paths.
create or replace function public.legal_document_versions_set_content_hash()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  new.content_hash := encode(extensions.digest(new.body_md, 'sha256'), 'hex');
  return new;
end;
$$;

drop trigger if exists legal_document_versions_content_hash_trg on public.legal_document_versions;
create trigger legal_document_versions_content_hash_trg
before insert on public.legal_document_versions
for each row execute function public.legal_document_versions_set_content_hash();

-- BEFORE UPDATE OR DELETE: block. legal_document_versions is append-only.
create or replace function public.legal_document_versions_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'legal_document_versions is append-only';
end;
$$;

drop trigger if exists legal_document_versions_immutable_trg on public.legal_document_versions;
create trigger legal_document_versions_immutable_trg
before update or delete on public.legal_document_versions
for each row execute function public.legal_document_versions_block_mutation();

-- BEFORE UPDATE OR DELETE: block. user_legal_acceptances is append-only.
create or replace function public.user_legal_acceptances_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'user_legal_acceptances is append-only';
end;
$$;

drop trigger if exists user_legal_acceptances_immutable_trg on public.user_legal_acceptances;
create trigger user_legal_acceptances_immutable_trg
before update or delete on public.user_legal_acceptances
for each row execute function public.user_legal_acceptances_block_mutation();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists legal_document_versions_latest_idx
  on public.legal_document_versions (doc_type, version desc);

-- Partial index for diagnostic queries on material publishes.
-- (Hot-path gate query uses denormalized last_material_version, not this index.)
create index if not exists legal_document_versions_material_idx
  on public.legal_document_versions (doc_type, version)
  where severity in ('standard', 'critical');

create index if not exists user_legal_acceptances_latest_idx
  on public.user_legal_acceptances (user_id, doc_type, accepted_at desc);

-- ---------------------------------------------------------------------------
-- View: user_legal_acceptances_latest
-- ---------------------------------------------------------------------------
create or replace view public.user_legal_acceptances_latest as
select distinct on (user_id, doc_type)
  user_id, doc_type, version, accepted_at
from public.user_legal_acceptances
order by user_id, doc_type, accepted_at desc;

comment on view public.user_legal_acceptances_latest is
  'Most recent acceptance per (user_id, doc_type). Used by needs_legal_reacknowledgement.';

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------

alter table public.legal_documents          enable row level security;
alter table public.legal_document_versions  enable row level security;
alter table public.user_legal_acceptances   enable row level security;

-- Documents: any authenticated user can read; nobody writes directly.
drop policy if exists legal_documents_select_authenticated on public.legal_documents;
create policy legal_documents_select_authenticated
  on public.legal_documents
  for select to authenticated
  using (true);

drop policy if exists legal_document_versions_select_authenticated on public.legal_document_versions;
create policy legal_document_versions_select_authenticated
  on public.legal_document_versions
  for select to authenticated
  using (true);

revoke all on public.legal_documents          from anon, authenticated;
revoke all on public.legal_document_versions  from anon, authenticated;
grant select on public.legal_documents          to authenticated;
grant select on public.legal_document_versions  to authenticated;

-- Acceptances: a user can read & insert only their own rows.
-- UPDATE/DELETE blocked by the append-only trigger (RLS alone is insufficient
-- because the insert RPC runs SECURITY DEFINER).
drop policy if exists user_legal_acceptances_select_self on public.user_legal_acceptances;
create policy user_legal_acceptances_select_self
  on public.user_legal_acceptances
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists user_legal_acceptances_insert_self on public.user_legal_acceptances;
create policy user_legal_acceptances_insert_self
  on public.user_legal_acceptances
  for insert to authenticated
  with check (auth.uid() = user_id);

revoke all on public.user_legal_acceptances from anon, authenticated;
grant select, insert on public.user_legal_acceptances to authenticated;

-- The view inherits the underlying table's RLS (security_invoker by default
-- in PG15+). Be explicit:
alter view public.user_legal_acceptances_latest set (security_invoker = true);
grant select on public.user_legal_acceptances_latest to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: publish_legal_document (super-admin only, SECURITY DEFINER)
-- ---------------------------------------------------------------------------
create or replace function public.publish_legal_document(
  p_doc_type        public.legal_doc_type,
  p_body_md         text,
  p_severity        text,
  p_change_summary  text,
  p_effective_date  timestamptz
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_version int;
  v_hash        text;
begin
  -- 1. Auth + role
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 2. Severity validation
  if p_severity not in ('minor', 'standard', 'critical') then
    raise exception 'severity must be one of minor|standard|critical' using errcode = '22023';
  end if;

  -- 3. change_summary required for non-minor
  if p_severity <> 'minor' and (p_change_summary is null or length(trim(p_change_summary)) = 0) then
    raise exception 'change_summary required for non-minor severity' using errcode = '22023';
  end if;

  -- 4. effective_date in the future or now
  if p_effective_date < now() then
    raise exception 'effective_date must be in the future or now' using errcode = '22023';
  end if;

  -- 5. critical must publish immediately (within 1 hour)
  if p_severity = 'critical' and p_effective_date > now() + interval '1 hour' then
    raise exception 'critical severity must be effective immediately (within 1 hour)' using errcode = '22023';
  end if;

  -- 6. Compute next version per doc_type
  select current_version + 1 into v_new_version
    from public.legal_documents
   where doc_type = p_doc_type
   for update;
  if v_new_version is null then
    raise exception 'unknown doc_type %', p_doc_type using errcode = '22023';
  end if;

  -- 7. Insert immutable version row (trigger computes content_hash)
  insert into public.legal_document_versions (
    doc_type, version, language, effective_date, body_md, severity, change_summary, published_by
  ) values (
    p_doc_type, v_new_version, 'he', p_effective_date, p_body_md, p_severity, p_change_summary, auth.uid()
  )
  returning content_hash into v_hash;

  -- 8. Update current pointer; bump last_material_* only on material severities
  update public.legal_documents
     set current_version          = v_new_version,
         current_effective_date   = p_effective_date,
         updated_at               = now(),
         last_material_version    = case
                                      when p_severity in ('standard','critical') then v_new_version
                                      else last_material_version
                                    end,
         last_material_severity   = case
                                      when p_severity in ('standard','critical') then p_severity
                                      else last_material_severity
                                    end
   where doc_type = p_doc_type;

  return json_build_object(
    'version', v_new_version,
    'effective_date', p_effective_date,
    'content_hash', v_hash
  );
end;
$$;

revoke all on function public.publish_legal_document(public.legal_doc_type, text, text, text, timestamptz) from public, anon;
grant execute on function public.publish_legal_document(public.legal_doc_type, text, text, text, timestamptz) to authenticated;

comment on function public.publish_legal_document is
  'Super-admin only. Publishes a new version of a legal document; bumps last_material_* on standard|critical severity.';


-- ---------------------------------------------------------------------------
-- RPC: accept_legal_document (any authenticated user, SECURITY DEFINER)
-- ---------------------------------------------------------------------------
create or replace function public.accept_legal_document(
  p_doc_type    public.legal_doc_type,
  p_version     int,
  p_locale      text,
  p_user_agent  text
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid          uuid := auth.uid();
  v_last_material int;
  v_current      int;
  v_id           uuid;
  v_ts           timestamptz;
  v_ua_trim      text;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Atomic read of last_material_version + current_version
  select last_material_version, current_version
    into v_last_material, v_current
    from public.legal_documents
   where doc_type = p_doc_type;

  if v_last_material is null then
    raise exception 'unknown doc_type %', p_doc_type using errcode = '22023';
  end if;

  -- Acceptance must satisfy the gate: at least the latest material version,
  -- and not beyond the current published version.
  if p_version < v_last_material or p_version > v_current then
    raise exception 'accepted version % must be in [%, %]', p_version, v_last_material, v_current
      using errcode = '22023';
  end if;

  v_ua_trim := case
    when p_user_agent is null then null
    else substring(p_user_agent for 500)
  end;

  insert into public.user_legal_acceptances (
    user_id, doc_type, version, ip_inet, user_agent, locale
  ) values (
    v_uid, p_doc_type, p_version, inet_client_addr(), v_ua_trim, p_locale
  )
  returning id, accepted_at into v_id, v_ts;

  return json_build_object('acceptance_id', v_id, 'accepted_at', v_ts);
end;
$$;

revoke all on function public.accept_legal_document(public.legal_doc_type, int, text, text) from public, anon;
grant execute on function public.accept_legal_document(public.legal_doc_type, int, text, text) to authenticated;

comment on function public.accept_legal_document is
  'Logs a per-version legal-document acceptance for auth.uid(). Enforces version >= last_material_version.';


-- ---------------------------------------------------------------------------
-- RPC: needs_legal_reacknowledgement (any authenticated user, SECURITY INVOKER)
-- ---------------------------------------------------------------------------
create or replace function public.needs_legal_reacknowledgement()
returns table (
  doc_type                public.legal_doc_type,
  current_version         int,
  current_effective_date  timestamptz,
  last_material_version   int,
  last_material_severity  text,
  last_accepted_version   int,
  block_mode              text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    ld.doc_type,
    ld.current_version,
    ld.current_effective_date,
    ld.last_material_version,
    ld.last_material_severity,
    coalesce(ula.version, 0) as last_accepted_version,
    case
      when ld.last_material_severity = 'critical' then 'modal'
      when ld.last_material_severity = 'standard'
           and (now() - ld.current_effective_date) >= interval '7 days' then 'modal'
      else 'banner'
    end as block_mode
  from public.legal_documents ld
  left join public.user_legal_acceptances_latest ula
    on ula.doc_type = ld.doc_type
   and ula.user_id  = auth.uid()
  where
    auth.uid() is not null
    and ld.current_effective_date <= now()
    and coalesce(ula.version, 0) < ld.last_material_version;
$$;

revoke all on function public.needs_legal_reacknowledgement() from public, anon;
grant execute on function public.needs_legal_reacknowledgement() to authenticated;

comment on function public.needs_legal_reacknowledgement is
  'Returns one row per doc_type where auth.uid() owes re-acknowledgement. block_mode (banner|modal) is computed server-side from severity and the database clock.';


-- ---------------------------------------------------------------------------
-- Seed: v1 of both documents (severity='standard' so existing users see the
-- 7-day soft-grace flow on next foreground — see spec §8).
-- ---------------------------------------------------------------------------

-- Stub pointer rows (always present after migration, even with no admin).
-- current_version = 0, last_material_version = 0 mean the gate finds nothing
-- pending (coalesce(0,0) < 0 is false) and the publish RPC bootstraps v1 by
-- advancing 0 → 1. Makes the migration deterministic across CI (no admin)
-- and prod (admin pre-provisioned).
insert into public.legal_documents (doc_type, current_version, current_effective_date, last_material_version, last_material_severity)
values
  ('terms',   0, now(), 0, null),
  ('privacy', 0, now(), 0, null)
on conflict (doc_type) do nothing;

-- Conditional v1 content seed: needs a super-admin row to satisfy the
-- published_by FK against auth.users. If none exists (CI's fresh stack), we
-- raise a NOTICE and skip — the smoke test (supabase/tests/0108_*.sql)
-- bootstraps its own admin and publishes v1 via the RPC, and prod operators
-- publish v1 via Supabase Studio per OPERATOR_RUNBOOK.md.
do $$
declare
  v_admin uuid;
begin
  select user_id into v_admin
    from public.users
   where is_super_admin = true
   order by created_at asc
   limit 1;

  if v_admin is null then
    raise notice 'no super-admin found; skipping v1 legal-doc seed. Prod operators must publish v1 via Supabase Studio before the FE depends on it.';
    return;
  end if;

  -- Idempotent inserts: re-running the migration on a partially applied state succeeds.
  insert into public.legal_document_versions (
    doc_type, version, language, effective_date, body_md, severity, change_summary, published_by
  )
  values (
    'terms', 1, 'he', now(),
    $md$# תנאי שימוש

**1. מי אנחנו ומה האפליקציה**
{{LEGAL_ENTITY_NAME}} מפעילה את אפליקציית "קהילת קארמה" — מרחב חברתי לנתינה. ניתן לפנות אלינו ב-{{CONTACT_EMAIL}}.

**2. תנאי שימוש כחוזה מחייב**
עצם השימוש באפליקציה מהווה אישור לתנאים אלה.

**3. גיל מינימום (13+)**
האפליקציה מיועדת לבני 13 ומעלה. נשמור לעצמנו את הזכות להסיר חשבונות של משתמשים שמתחת לגיל.

**4. חשבון משתמש**
שמור על סודיות הסיסמה. אין להתחזות, אין לנהל יותר מחשבון אחד.

**5. תוכן שמשתמשים מעלים**
התוכן נשאר בבעלותך; אתה מעניק לנו רישיון להציג, לשמור ולהפיץ אותו כחלק מהשירות. אתה אחראי לחוקיות התוכן.

**6. שימוש אסור**
ספאם, הטעיה, הסתה, הטרדה, חשיפת פרטים אישיים של אחרים, פוסטים מסחריים, וניסיונות פריצה — אסורים.

**7. מודרציה**
אנחנו רשאים להסיר תוכן ולהשעות חשבונות לפי שיקול דעתנו. ניתן לערער דרך "דווח על בעיה".

**8. השירות As-Is**
השירות מסופק "כמות שהוא"; אין התחייבות לזמינות, לדיוק תוכן או להצלחת עסקאות. אנחנו לא צד לעסקאות בין משתמשים.

**9. הגבלת אחריות**
בכפוף לחוק, אחריותנו מוגבלת לסכום סמלי (ברירת מחדל: 0 ש"ח לשירות חינמי).

**10. שינויים בתנאים**
ייתכן שנעדכן את התנאים מעת לעת. שינוי מהותי = הודעה בתוך האפליקציה ובקשה לאישור מחודש.

**11. דין וסמכות שיפוט**
הדין הישראלי חל; סמכות שיפוט בלעדית לבתי המשפט המוסמכים בתל אביב-יפו.

**12. יצירת קשר**
{{CONTACT_EMAIL}} · {{CONTACT_ADDRESS}}
$md$,
    'standard',
    $cs$- העברנו את תנאי השימוש ומדיניות הפרטיות לפורמט חי שמתעדכן ישירות בלי צורך בעדכון של האפליקציה.
- התוכן עצמו לא השתנה מהותית מהגרסה הקודמת שהוצגה במסך ההגדרות.
- אנא קרא ואשר תוך 7 ימים כדי להמשיך להשתמש באפליקציה.$cs$,
    v_admin
  )
  on conflict (doc_type, version) do nothing;

  insert into public.legal_document_versions (
    doc_type, version, language, effective_date, body_md, severity, change_summary, published_by
  )
  values (
    'privacy', 1, 'he', now(),
    $md$# מדיניות פרטיות

**1. מי בעל הבקרה על המידע**
{{LEGAL_ENTITY_NAME}}. ליצירת קשר: {{CONTACT_EMAIL}}.

**2. איזה מידע אנחנו אוספים**
- שמסרת: שם, עיר, ביוגרפיה, אווטר, טלפון/אימייל (לאימות), פוסטים, הודעות.
- שנאסף אוטומטית: סוג מכשיר, גרסת אפליקציה, IP, לוגים תפעוליים, אירועי הסכמה משפטיים.

**3. למה אנחנו צריכים את המידע**
תפעול השירות, אבטחה, מודרציה, תמיכה, סטטיסטיקות אגרגטיביות.

**4. הבסיס החוקי**
הסכמה; אינטרס לגיטימי (אבטחה, מניעת ספאם); חובה חוקית (תגובה לדרישת רשויות מוסמכות).

**5. שיתוף עם צדדים שלישיים (sub-processors)**
- **Supabase, Inc.** (US/EU regions) — אחסון מסד נתונים, אימות, אחסון קבצים, Realtime.
- **Google LLC / Apple Inc.** — לאימות SSO בלבד; מקבלים display name, email, avatar.
- **Expo / EAS** — לשליחת push notifications.

אין מכירת מידע. אין שימוש פרסומי. אין tracking של גורמי צד שלישי.

**6. העברה לחו"ל**
חלק מהמידע מאוחסן בשרתי Supabase מחוץ לישראל; ההעברה בכפוף ל-EU Standard Contractual Clauses.

**7. זמן שמירה**
תוכן פעיל: כל עוד החשבון פעיל. תוכן שהוסר על-ידי מודרציה: 90 יום ואז מחיקה. חשבון מחוק: 30 יום ואז מחיקה קשה.

**8. זכויותיך**
גישה, תיקון, מחיקה, ניידות (data export — JSON תוך 30 יום דרך "דווח על בעיה" → קטגוריה Privacy), ביטול הסכמה (מחיקת חשבון).

**9. קטינים (13-18)**
שירות מגיל 13. הורים שמעוניינים שחשבון של ילדם יוסר יכולים לפנות באמצעות "דווח על בעיה" → קטגוריה Privacy.

**10. אבטחה**
TLS בתעבורה, הצפנה במנוחה אצל Supabase, RLS על כל הטבלאות. אין אחריות מוחלטת.

**11. שינויים במדיניות**
שינוי מהותי = חובת אישור מחדש.

**12. תלונות וערעורים**
פנייה אלינו ב-{{CONTACT_EMAIL}}; זכות פנייה לרשות להגנת הפרטיות בישראל (https://www.gov.il/he/departments/the_privacy_protection_authority).
$md$,
    'standard',
    $cs$- העברנו את תנאי השימוש ומדיניות הפרטיות לפורמט חי שמתעדכן ישירות בלי צורך בעדכון של האפליקציה.
- התוכן עצמו לא השתנה מהותית מהגרסה הקודמת שהוצגה במסך ההגדרות.
- אנא קרא ואשר תוך 7 ימים כדי להמשיך להשתמש באפליקציה.$cs$,
    v_admin
  )
  on conflict (doc_type, version) do nothing;
end$$;

-- Advance the stub pointer rows to v1 wherever v1 was actually seeded above.
-- last_material_* mirrors v1 so existing users enter the 7-day soft-grace flow
-- (block_mode='banner' until day 7). When v1 wasn't seeded (CI, fresh stack),
-- pointers stay at version 0 and the gate finds nothing pending.
update public.legal_documents ld
   set current_version        = ldv.version,
       current_effective_date = ldv.effective_date,
       updated_at             = now(),
       last_material_version  = ldv.version,
       last_material_severity = ldv.severity
  from public.legal_document_versions ldv
 where ldv.doc_type = ld.doc_type
   and ldv.version  = 1
   and ld.current_version = 0;

commit;
