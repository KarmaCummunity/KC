-- FR-POST-014 / FR-CLOSURE-003 — third-party viewers who may read a closed_delivered post
-- must hydrate the recipients join (RecipientCallout on post detail). Prior policy allowed
-- only owner + recipient, so PostgREST returned null recipient for everyone else.

drop policy if exists recipients_select_participants on public.recipients;

create policy recipients_select_participants on public.recipients
  for select using (
    auth.uid() = recipient_user_id
    or exists (
      select 1 from public.posts p
      where p.post_id = recipients.post_id
        and p.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.posts p
      where p.post_id = recipients.post_id
        and p.status = 'closed_delivered'
        and auth.uid() is not null
        and public.is_post_visible_to(p.*, auth.uid())
    )
  );
