-- 0433_whatsapp_pro_gate | Issue #1086: the personal WhatsApp bot is Pro only, enforced
-- server-side. Free-text from a number that is not linked, or linked to a non-Pro account,
-- gets an upsell reply at most once per 24h per number (no reply spam, no LLM cost).
-- Consent keywords (STOP/START/HELP) and link codes keep working for everyone.

alter table public.whatsapp_identities
  add column if not exists last_upsell_at timestamptz;

create or replace function public.api_whatsapp_bot_access(p_wa_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_access text;
  v_upsell boolean := false;
begin
  if p_wa_id is null or btrim(p_wa_id) = '' then
    raise exception 'wa_id_required' using errcode = '22023';
  end if;

  select user_id into v_user from public.whatsapp_identities where wa_id = p_wa_id;

  if v_user is null then
    v_access := 'unlinked';
  elsif public.is_pro(v_user) then
    return jsonb_build_object('access', 'pro', 'user_id', v_user, 'upsell', false);
  else
    v_access := 'not_pro';
  end if;

  update public.whatsapp_identities
     set last_upsell_at = now()
   where wa_id = p_wa_id
     and (last_upsell_at is null or last_upsell_at < now() - interval '24 hours');
  v_upsell := found;

  return jsonb_build_object('access', v_access, 'user_id', v_user, 'upsell', v_upsell);
end;
$$;

revoke all on function public.api_whatsapp_bot_access(text) from public, anon, authenticated;
grant execute on function public.api_whatsapp_bot_access(text) to service_role;
