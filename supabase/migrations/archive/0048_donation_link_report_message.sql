-- 0048_donation_link_report_message | FR-DONATE AC2 (alignment with FR-MOD-001 AC4)
--
-- Donation-link reports previously went out as plain user messages
-- (see donationLinkRowHandlers.ts before this commit). This migration
-- introduces a SECURITY DEFINER PG function that injects a system message
-- with kind='donation_link_reported' into the reporter's support thread,
-- matching the admin-side UX shipped in 0046.
--
-- Payload schema:
--   { kind: 'donation_link_reported',
--     link_id: <uuid>,
--     url: <text>,
--     display_name: <text>,
--     category_slug: <text> }
--
-- Called from the application layer via SupabaseDonationLinksRepository.report().
-- Caller is `authenticated`. The function uses auth.uid() as the reporter — no
-- separate reporter param needed.

create or replace function public.report_donation_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reporter   uuid := auth.uid();
  v_url        text;
  v_name       text;
  v_category   text;
  v_chat       uuid;
  v_payload    jsonb;
begin
  if v_reporter is null then
    raise exception 'report_donation_link: not authenticated' using errcode = '42501';
  end if;

  select url, display_name, category_slug
    into v_url, v_name, v_category
    from public.donation_links
   where id = p_link_id;

  if v_url is null then
    raise exception 'report_donation_link: link % not found', p_link_id using errcode = 'P0002';
  end if;

  v_chat := public.find_or_create_support_chat(v_reporter);
  if v_chat is null then
    raise warning 'report_donation_link: no support chat for reporter % (no super admin?)', v_reporter;
    return;
  end if;

  v_payload := jsonb_build_object(
    'kind',          'donation_link_reported',
    'link_id',       p_link_id,
    'url',           v_url,
    'display_name',  v_name,
    'category_slug', v_category
  );

  perform public.inject_system_message(v_chat, v_payload, null);
end;
$$;

grant execute on function public.report_donation_link(uuid) to authenticated;
