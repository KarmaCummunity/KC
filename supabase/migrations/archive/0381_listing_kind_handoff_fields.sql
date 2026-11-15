-- 0381_listing_kind_handoff_fields | Pickup/delivery + windows on items/food give kinds.

begin;

update public.listing_kinds
   set detail_schema = detail_schema || jsonb_build_object(
     'properties', coalesce(detail_schema->'properties', '{}'::jsonb) || jsonb_build_object(
       'pickup_mode', jsonb_build_object('enum', jsonb_build_array('pickup', 'delivery', 'either')),
       'delivery_available', jsonb_build_object('type', 'boolean'),
       'pickup_window_start', jsonb_build_object('type', 'string', 'format', 'date-time'),
       'pickup_window_end', jsonb_build_object('type', 'string', 'format', 'date-time')
     )
   )
 where world_slug in ('items', 'food')
   and direction = 'give';

commit;
