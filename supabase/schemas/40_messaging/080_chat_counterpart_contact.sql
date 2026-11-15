-- Messaging · the counterpart's contact phone (FR-CHAT-014 AC7, FR-PROFILE-007)
--
-- A member may enter a contact phone for the people they talk to. `user_private` is
-- readable by its owner only, so the other side of a direct chat gets it through this
-- definer function and nowhere else. The spec asks for no access log: the number is one the
-- owner chose to share with chat counterparts, and nothing is recorded.

-- The contact phone of the other member of a direct chat the caller can access, verbatim
-- (no normalisation, AC7). Null when the chat is not a direct chat the caller may use (a
-- support thread, a chat hidden by moderation, a blocked pair, a chat of someone else), the
-- counterpart's account is gone or inactive, or the field is empty. A caller outside the chat
-- gets null as well, so that the function does not reveal which chats exist.
create function public.chat_counterpart_contact(p_chat_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
begin
  if not kc_access.can_access_chat(p_chat_id) then
    return null;
  end if;
  return (
    select up.contact_phone
      from public.chats c
      join public.users u on u.id = case v_user_id when c.direct_user_a then c.direct_user_b
                                                   else c.direct_user_a end
      join public.user_private up on up.user_id = u.id
     where c.id = p_chat_id and c.kind = 'direct' and u.is_active);
end;
$$;
comment on function public.chat_counterpart_contact(uuid) is
  'Contact phone of the other member of a direct chat the caller can access; null otherwise (FR-CHAT-014 AC7).';
grant execute on function public.chat_counterpart_contact(uuid) to authenticated;
