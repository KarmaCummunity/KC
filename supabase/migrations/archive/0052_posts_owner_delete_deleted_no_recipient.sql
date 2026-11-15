-- FR-POST-010 extension: owner may hard-delete own post when it is `open` OR
-- `deleted_no_recipient` (closed without marking a recipient — no link to another user).
-- `closed_delivered` (recipient row exists) remains non-deletable by owner delete.

drop policy if exists posts_delete_self_open on public.posts;

create policy posts_delete_self_unlinked on public.posts
  for delete using (
    auth.uid() = owner_id
    and (
      status = 'open'
      or (
        status = 'deleted_no_recipient'
        and not exists (
          select 1 from public.recipients r where r.post_id = posts.post_id
        )
      )
    )
  );

comment on policy posts_delete_self_unlinked on public.posts is
  'Owner delete: open posts, or closed-without-recipient (FR-POST-010 + D-18).';
