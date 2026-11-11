-- Smoke check of the seed loaders: run after reference/load.sql and content/load.sql.
-- Raises on the first wrong number, so psql with ON_ERROR_STOP fails the build.
do $$
declare
  v_n bigint;
begin
  select count(*) into v_n from public.donation_link_categories;
  if v_n <> 11 then raise exception 'seed: % donation link categories, want 11', v_n; end if;

  select count(*) into v_n from public.donation_links where review_status = 'approved' and submitted_by is null;
  if v_n <> 86 then raise exception 'seed: % curated donation links, want 86', v_n; end if;

  -- Every list a member can open has links, and the lists match the worlds that show them.
  if exists (select 1 from public.donation_link_categories c
              where c.is_active and not exists (select 1 from public.donation_links l where l.category_slug = c.slug)) then
    raise exception 'seed: a donation link list is empty';
  end if;

  select count(*) into v_n from public.legal_documents d
   join public.legal_document_versions v on v.doc_type = d.doc_type and v.version = d.current_version
  where d.doc_type in ('terms', 'privacy') and v.language = 'he';
  if v_n <> 2 then raise exception 'seed: legal documents incomplete (% of 2)', v_n; end if;

  select count(*) into v_n from public.surveys s
   join public.survey_versions sv on sv.survey_id = s.id and sv.version = s.current_version
  where exists (select 1 from public.survey_questions q where q.survey_version_id = sv.id);
  if v_n <> 3 then raise exception 'seed: surveys incomplete (% of 3)', v_n; end if;

  select count(*) into v_n from public.organizations where is_platform and slug = 'karma-community';
  if v_n <> 1 then raise exception 'seed: platform organization missing'; end if;
  select count(*) into v_n from billing.org_finance_accounts a join public.organizations o on o.id = a.org_id where o.is_platform;
  if v_n <> 3 then raise exception 'seed: % platform finance accounts, want 3', v_n; end if;

  -- The reference data the content depends on.
  select count(*) into v_n from public.worlds;
  if v_n < 12 then raise exception 'seed: % worlds', v_n; end if;
end $$;
