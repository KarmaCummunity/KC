-- Orphan closed_delivered: when the marked recipient's user row is deleted,
-- recipients CASCADE away but posts.status can remain `closed_delivered`.
-- Extend owner DELETE to match "no link" = no row in public.recipients, plus
-- safe statuses (FR-POST-010 + D-18 follow-up).

drop policy if exists posts_delete_self_unlinked on public.posts;

create policy posts_delete_self_unlinked on public.posts
  for delete using (
    auth.uid() = owner_id
    and (
      status = 'open'
      or (
        not exists (select 1 from public.recipients r where r.post_id = posts.post_id)
        and status in ('deleted_no_recipient', 'closed_delivered')
      )
    )
  );

comment on policy posts_delete_self_unlinked on public.posts is
  'Owner delete: open; or closed tomb/orphan (no recipients row) (FR-POST-010 + D-18).';
