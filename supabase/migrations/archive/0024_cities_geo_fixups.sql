-- 0024_cities_geo_fixups | P1.2 hotfix — fill in cities missed by 0023.
--
-- 0023 matched by name_he but a handful of major-city names use slightly
-- different spacing/punctuation in the dev seed than my UPDATE strings
-- (Tel Aviv as "תל אביב - יפו" rather than "תל אביב-יפו" etc.). This
-- migration matches by `city_id` (CBS code) for maximum reliability.

update public.cities set lat = 32.0853, lon = 34.7818 where city_id = '5000'; -- תל אביב - יפו
update public.cities set lat = 32.0114, lon = 34.7900 where city_id = '2400'; -- אור יהודה
update public.cities set lat = 32.7170, lon = 35.1247 where city_id = '2300'; -- קרית טבעון
update public.cities set lat = 31.6939, lon = 35.1208 where city_id = '3780'; -- ביתר עילית
update public.cities set lat = 32.4717, lon = 34.9706 where city_id = '7800'; -- פרדס חנה-כרכור
update public.cities set lat = 32.1500, lon = 34.8889 where city_id = '9700'; -- הוד השרון
