-- Demo data (FR-ADMIN-031) · the wipe, in two phases so each fits one short RPC call.
--
-- AC3: only the demo members (kc_private.demo_member_ids) and the three demo nonprofits
-- (kc_private.demo_org_ids) are ever touched. Real members, the e2e members and every other
-- organization are out of scope by construction.

-- Phase 1: what the demo members wrote and the threads they are in. Removed while the members
-- still exist, so the cascades of the next phase have little left to walk.
create or replace function kc_private.demo_wipe_content(p_member_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_posts integer;
  v_chats integer;
begin
  if coalesce(cardinality(p_member_ids), 0) = 0 then
    return jsonb_build_object('posts_deleted', 0, 'chats_deleted', 0);
  end if;

  -- A direct chat with a demo member goes as a whole; its members and messages cascade.
  delete from public.chats c
   where c.kind = 'direct'
     and (c.direct_user_a = any (p_member_ids) or c.direct_user_b = any (p_member_ids));
  get diagnostics v_chats = row_count;

  delete from public.follows f
   where f.follower_id = any (p_member_ids) or f.followed_id = any (p_member_ids);

  -- Details, saves, reactions and handoffs of the posts cascade with them.
  delete from public.posts p where p.owner_id = any (p_member_ids);
  get diagnostics v_posts = row_count;

  return jsonb_build_object('posts_deleted', v_posts, 'chats_deleted', v_chats);
end;
$$;
comment on function kc_private.demo_wipe_content(uuid[]) is
  'Demo wipe phase 1: chats, follows and posts of the given demo members.';

-- Phase 2: the accounts (everything left cascades from auth.users) and the demo nonprofits.
-- AC4: a nonprofit with payment history (billing keeps a restricting foreign key) stays and
-- is counted instead of failing the wipe.
create or replace function kc_private.demo_wipe_accounts(p_member_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_users integer := 0;
  v_orgs_deleted integer := 0;
  v_orgs_kept integer := 0;
  v_org_id uuid;
begin
  if coalesce(cardinality(p_member_ids), 0) > 0 then
    delete from auth.users u where u.id = any (p_member_ids);
    get diagnostics v_users = row_count;
  end if;

  foreach v_org_id in array kc_private.demo_org_ids() loop
    begin
      delete from public.organizations o where o.id = v_org_id;
      if found then
        v_orgs_deleted := v_orgs_deleted + 1;
      end if;
    exception when foreign_key_violation then
      v_orgs_kept := v_orgs_kept + 1;
    end;
  end loop;

  return jsonb_build_object('users_deleted', v_users, 'organizations_deleted', v_orgs_deleted,
                            'organizations_kept', v_orgs_kept);
end;
$$;
comment on function kc_private.demo_wipe_accounts(uuid[]) is
  'Demo wipe phase 2: the demo auth accounts (with all they own) and the [DEMO] nonprofits.';
