-- External post import, place resolution (FR-IMPORT-004): the normalizer, the alias table and
-- api_resolve_place resolve the place words of a shared post to the official catalogs only.
-- Hebrew fixtures are written as escapes. T1 is the official "Tel Aviv - Yafo", T3 starts with a
-- prefix letter, T4 and T5 both contain "gan" (a tie), T6 is a short name.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(29);

insert into public.cities (city_id, name_he, name_en) values
  ('T1', U&'\05EA\05DC \05D0\05D1\05D9\05D1 - \05D9\05E4\05D5', 'Tel Aviv-Yafo'),
  ('T2', U&'\05D1\05D0\05E8 \05E9\05D1\05E2', 'Beer Sheva'),
  ('T3', U&'\05D1\05E0\05D9 \05D1\05E8\05E7', 'Bnei Brak'),
  ('T4', U&'\05E8\05DE\05EA \05D2\05DF', 'Ramat Gan'),
  ('T5', U&'\05D2\05DF \05D9\05D1\05E0\05D4', 'Gan Yavne'),
  ('T6', U&'\05D7\05D9\05E4\05D4', 'Haifa');
insert into public.streets (city_id, street_id, name_he) values
  ('T1', 101, U&'\05D4\05E8\05E6\05DC'),
  ('T1', 102, U&'\05E9\05D3\05E8\05D5\05EA \05D4\05E8\05E6\05DC'),
  ('T1', 103, U&'\05D4\05D2\05E4\05DF'),
  ('T2', 101, U&'\05D4\05E8\05E6\05DC');
insert into public.road_junctions (junction_id, kind, name_he, name_en, roads, location) values
  (9001, 'junction', U&'\05E6\05D5\05DE\05EA \05D1\05D9\05EA \05D3\05D2\05DF', 'Beit Dagan', '4',
   extensions.st_setsrid(extensions.st_makepoint(34.83, 32.0), 4326)::extensions.geography);

select is(public.import_normalize_place_text(U&'\05EA\05DC \05D0\05D1\05D9\05D1 - \05D9\05E4\05D5'), U&'\05EA\05DC \05D0\05D1\05D9\05D1 \05D9\05E4\05D5', 'a dash becomes a space');
select is(public.import_normalize_place_text(U&'\05EA"\05D0'), U&'\05EA\05D0', 'quote marks are dropped');
select is(public.import_normalize_place_text(U&'\05E9\05B8\05C1\05DC\05D5\05B9\05DD'), U&'\05E9\05DC\05D5\05DD', 'niqqud is dropped');
select is(public.import_normalize_place_text(null), '', 'null normalizes to empty');
select is((select place_id from public.api_resolve_place('city', U&'\05D1\05E0\05D9 \05D1\05E8\05E7') limit 1), 'T3', 'a name that starts with a prefix letter keeps its own match');
select is((select score from public.api_resolve_place('city', U&'\05D1\05E0\05D9 \05D1\05E8\05E7') limit 1), 1::real, 'the same name scores 1');
select is((select place_id from public.api_resolve_place('city', U&'\05EA\05DC \05D0\05D1\05D9\05D1') limit 1), 'T1', 'part of an official name finds it');
select is((select score from public.api_resolve_place('city', U&'\05EA\05DC \05D0\05D1\05D9\05D1') limit 1), 0.9::real, 'a contained query scores 0.9');
select ok((select margin >= 0.1 from public.api_resolve_place('city', U&'\05EA\05DC \05D0\05D1\05D9\05D1') limit 1), 'a clear winner has a margin of at least 0.1');
select is((select place_id from public.api_resolve_place('city', U&'\05D1\05EA\05DC \05D0\05D1\05D9\05D1') limit 1), 'T1', 'the in-prefix is removed');
select is((select place_id from public.api_resolve_place('city', U&'\05D1\05D7\05D9\05E4\05D4') limit 1), 'T6', 'the in-prefix finds a short name');
select is((select place_id from public.api_resolve_place('city', U&'\05EA"\05D0') limit 1), 'T1', 'an alias resolves to the city');
select is((select place_id from public.api_resolve_place('city', U&'\05D5\05D1\05EA\05DC \05D0\05D1\05D9\05D1') limit 1), 'T1', 'two stacked prefixes are removed');
select is((select margin from public.api_resolve_place('city', U&'\05D2\05DF') limit 1), 0::real, 'two equal matches have no lead');
select is((select count(*) from public.api_resolve_place('city', 'qqqq')), 0::bigint, 'nothing resembling the query returns nothing');
select is((select count(*) from public.api_resolve_place('city', U&'\05D2\05DF', null, 1)), 1::bigint, 'the limit is honoured');
select is((select place_id from public.api_resolve_place('street', U&'\05D4\05E8\05E6\05DC', 'T1') limit 1), '101', 'the exact street wins');
select is((select margin from public.api_resolve_place('street', U&'\05D4\05E8\05E6\05DC', 'T1') limit 1), 0.1::real, 'a longer street name trails the exact one by 0.1');
select is((select count(*) from public.api_resolve_place('street', U&'\05D4\05E8\05E6\05DC', 'T2')), 1::bigint, 'streets of other cities are not offered');
select is((select city_id from public.api_resolve_place('street', U&'\05D4\05E8\05E6\05DC', 'T2') limit 1), 'T2', 'a street row carries its city');
select is((select place_id from public.api_resolve_place('junction', U&'\05D1\05D9\05EA \05D3\05D2\05DF') limit 1), '9001', 'a junction is found by part of its name');
select throws_ok($$select * from public.api_resolve_place('planet', 'x1')$$, '22023', null, 'an unknown level is refused');
select throws_ok($$select * from public.api_resolve_place('city', 'x')$$, '22023', null, 'a one-character query is refused');
select throws_ok($$select * from public.api_resolve_place('street', U&'\05D4\05E8\05E6\05DC')$$, '22023', null, 'a street without a city is refused');
select throws_ok($$select * from public.api_resolve_place('city', U&'\05D7\05D9\05E4\05D4', null, 0)$$, '22023', null, 'a limit of zero is refused');
select ok(has_function_privilege('authenticated', 'public.api_resolve_place(text, text, text, integer)', 'execute'), 'a member may resolve places');
select ok(has_function_privilege('service_role', 'public.api_resolve_place(text, text, text, integer)', 'execute'), 'the service role may resolve places');
select ok(not has_function_privilege('anon', 'public.api_resolve_place(text, text, text, integer)', 'execute'), 'a signed-out caller may not resolve places');
select ok(has_table_privilege('authenticated', 'public.place_import_aliases', 'select') and not has_table_privilege('authenticated', 'public.place_import_aliases', 'insert'), 'aliases are read-only for members');

select * from finish();
rollback;
