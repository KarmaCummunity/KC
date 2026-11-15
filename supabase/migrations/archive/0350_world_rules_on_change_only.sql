-- 0350_world_rules_on_change_only | follow-up to 0266 (#849) and #950
-- listings_enforce_world_rules used to fire BEFORE every INSERT or UPDATE. A legacy
-- items listing with no image therefore rejected status-only updates such as
-- pause/resume/fulfill/admin-remove with items_image_required.
--
-- New behaviour:
--   * INSERT: every world rule is still enforced (unchanged).
--   * UPDATE: rules run only when a rule input actually changes (world, kind,
--     details, direction, owner, origin, expiry, external body). The money
--     active-campaign cap also runs when a money listing becomes 'open', so
--     pause/resume can't be used to get around it.
-- The function body is unchanged. Only the trigger wiring changes.

begin;

drop trigger if exists listings_enforce_world_rules on public.listings;
drop trigger if exists listings_enforce_world_rules_on_change on public.listings;

create trigger listings_enforce_world_rules
  before insert on public.listings
  for each row execute function public.listings_enforce_world_rules();

-- Name sorts right after the insert trigger, so the BEFORE-trigger order is unchanged
-- (…before_write → enforce_world_rules* → food_expiry_block → validate_details).
create trigger listings_enforce_world_rules_on_change
  before update on public.listings
  for each row
  when (
       old.world_slug       is distinct from new.world_slug
    or old.kind_id          is distinct from new.kind_id
    or old.details          is distinct from new.details
    or old.direction        is distinct from new.direction
    or old.owner_id         is distinct from new.owner_id
    or old.origin           is distinct from new.origin
    or old.expires_at       is distinct from new.expires_at
    or old.external_body_id is distinct from new.external_body_id
    or (new.world_slug = 'money' and new.status = 'open' and old.status is distinct from 'open')
  )
  execute function public.listings_enforce_world_rules();

commit;
