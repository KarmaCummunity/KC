-- Profiles · the biography link filter flags real domains only (FR-PROFILE-014 AC2, KC#1721)
--
-- The CHECK took any dotted word with a two-letter suffix for a domain, so ordinary text
-- such as "Node.js", "Dr.Smith" or "hello.world" could not be saved. A bare word now counts
-- as a link only when it ends in a top-level domain of a curated list (common generic TLDs,
-- the country TLDs of the link shorteners and messaging links, and those of KC's audience);
-- http(s):// and www. are flagged as before. The pattern is the same string as
-- BIOGRAPHY_URL_PATTERN_SOURCE in @kc/domain (value-objects.ts); edit both together.
--
-- The new pattern matches a subset of what the old one matched, so every stored biography
-- already satisfies it and re-adding the constraint cannot fail.

alter table public.users drop constraint users_biography_check;
alter table public.users add constraint users_biography_check check (
  char_length(biography) <= 200
  and biography !~* '(https?://|www\.|(^|[^a-z0-9_-])[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|info|biz|io|co|me|ly|gl|gd|gy|ee|app|dev|xyz|link|site|online|shop|store|live|tv|gg|ai|il|uk|de|fr|ru|eu|ca|au)([^a-z0-9-]|$))');
