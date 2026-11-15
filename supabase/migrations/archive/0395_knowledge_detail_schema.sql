-- 0395: knowledge lesson/mentoring detail schema (slots + modality).

begin;

update public.listing_kinds
   set detail_schema = '{
     "type":"object",
     "additionalProperties":false,
     "required":["topic","modality","slot_starts_at","slot_ends_at","slots_available"],
     "properties":{
       "topic":{"type":"string","minLength":2,"maxLength":80},
       "level":{"enum":["beginner","intermediate","advanced"]},
       "modality":{"enum":["in_person","video","phone"]},
       "slot_starts_at":{"type":"string","format":"date-time"},
       "slot_ends_at":{"type":"string","format":"date-time"},
       "slots_available":{"type":"integer","minimum":1,"maximum":20},
       "availability_note":{"type":"string","maxLength":280}
     }
   }'::jsonb
 where world_slug = 'knowledge' and slug = 'private_lesson';

update public.listing_kinds
   set detail_schema = '{
     "type":"object",
     "additionalProperties":false,
     "required":["topic","modality","slot_starts_at","slot_ends_at","slots_available"],
     "properties":{
       "topic":{"type":"string","minLength":2,"maxLength":80},
       "level":{"enum":["beginner","intermediate","advanced"]},
       "modality":{"enum":["in_person","video","phone"]},
       "slot_starts_at":{"type":"string","format":"date-time"},
       "slot_ends_at":{"type":"string","format":"date-time"},
       "slots_available":{"type":"integer","minimum":1,"maximum":50},
       "requires_org_approval":{"type":"boolean"}
     }
   }'::jsonb
 where world_slug = 'knowledge' and slug = 'course';

update public.listing_kinds
   set detail_schema = '{
     "type":"object",
     "additionalProperties":false,
     "required":["topic"],
     "properties":{
       "topic":{"type":"string","minLength":2,"maxLength":80},
       "level":{"type":"string"},
       "preferred_modality":{"enum":["in_person","video","phone"]}
     }
   }'::jsonb
 where world_slug = 'knowledge' and slug = 'mentorship_request';

commit;
