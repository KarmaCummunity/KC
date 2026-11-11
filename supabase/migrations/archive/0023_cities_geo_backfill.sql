-- 0023_cities_geo_backfill | P1.2 hotfix — populate cities.lat/lon by name_he
--
-- Migration 0021 seeded coordinates by slug (`city_id = 'tel-aviv'` …) but the
-- live cities table on dev is keyed by Israeli CBS municipality codes (e.g.
-- '5000' for Tel Aviv-Yafo) so none of those UPDATEs matched any row. Result:
-- every city.lat/lon stayed NULL, and the distance-sort RPC produced NULL
-- distances for every post.
--
-- This migration backfills coordinates by `name_he` instead. We cover the
-- ~30 largest Israeli cities + the three villages where dev test posts
-- currently live, so the proximity sort produces meaningful rankings out of
-- the box. Uncovered cities keep NULL lat/lon and sink to the tail of any
-- distance-sorted result — acceptable for MVP; broader coverage is tracked
-- as a separate tech-debt item.

update public.cities set lat = 32.0853, lon = 34.7818 where name_he = 'תל אביב -יפו';
update public.cities set lat = 32.0853, lon = 34.7818 where name_he = 'תל אביב-יפו';
update public.cities set lat = 31.7683, lon = 35.2137 where name_he = 'ירושלים';
update public.cities set lat = 32.7940, lon = 34.9896 where name_he = 'חיפה';
update public.cities set lat = 31.9647, lon = 34.8044 where name_he = 'ראשון לציון';
update public.cities set lat = 32.0922, lon = 34.8878 where name_he = 'פתח תקווה';
update public.cities set lat = 31.7918, lon = 34.6497 where name_he = 'אשדוד';
update public.cities set lat = 32.3215, lon = 34.8532 where name_he = 'נתניה';
update public.cities set lat = 31.2518, lon = 34.7913 where name_he = 'באר שבע';
update public.cities set lat = 32.0808, lon = 34.8328 where name_he = 'בני ברק';
update public.cities set lat = 32.0167, lon = 34.7795 where name_he = 'חולון';
update public.cities set lat = 32.0823, lon = 34.8141 where name_he = 'רמת גן';
update public.cities set lat = 31.6688, lon = 34.5742 where name_he = 'אשקלון';
update public.cities set lat = 31.8928, lon = 34.8113 where name_he = 'רחובות';
update public.cities set lat = 32.0167, lon = 34.7500 where name_he = 'בת ים';
update public.cities set lat = 32.1664, lon = 34.8434 where name_he = 'הרצליה';
update public.cities set lat = 32.1750, lon = 34.9067 where name_he = 'כפר סבא';
update public.cities set lat = 32.4365, lon = 34.9196 where name_he = 'חדרה';
update public.cities set lat = 31.8969, lon = 35.0103 where name_he = 'מודיעין-מכבים-רעות';
update public.cities set lat = 32.7022, lon = 35.2978 where name_he = 'נצרת';
update public.cities set lat = 32.1849, lon = 34.8714 where name_he = 'רעננה';

-- Secondary cities
update public.cities set lat = 31.9293, lon = 34.8669 where name_he = 'רמלה';
update public.cities set lat = 31.9514, lon = 34.8951 where name_he = 'לוד';
update public.cities set lat = 32.0712, lon = 34.8104 where name_he = 'גבעתיים';
update public.cities set lat = 31.7780, lon = 35.2966 where name_he = 'מעלה אדומים';
update public.cities set lat = 31.6100, lon = 34.7642 where name_he = 'קרית גת';
update public.cities set lat = 29.5577, lon = 34.9519 where name_he = 'אילת';
update public.cities set lat = 32.7959, lon = 35.5300 where name_he = 'טבריה';
update public.cities set lat = 31.8782, lon = 34.7388 where name_he = 'יבנה';
update public.cities set lat = 32.8011, lon = 35.1106 where name_he = 'קרית אתא';
update public.cities set lat = 32.8467, lon = 35.0689 where name_he = 'קרית ים';
update public.cities set lat = 32.8347, lon = 35.0856 where name_he = 'קרית ביאליק';
update public.cities set lat = 32.8350, lon = 35.0833 where name_he = 'קרית מוצקין';
update public.cities set lat = 32.0608, lon = 34.8542 where name_he = 'קרית אונו';
update public.cities set lat = 33.0058, lon = 35.0989 where name_he = 'נהריה';
update public.cities set lat = 32.6075, lon = 35.2900 where name_he = 'עפולה';
update public.cities set lat = 31.0700, lon = 35.0333 where name_he = 'דימונה';
update public.cities set lat = 32.2667, lon = 35.0167 where name_he = 'טייבה';
update public.cities set lat = 31.5239, lon = 34.5959 where name_he = 'שדרות';

-- Test-data villages currently used by dev posts (so distance sort produces
-- non-NULL results during P1.2 manual verification).
update public.cities set lat = 31.2310, lon = 34.7800 where name_he = 'אבו עבדון (שבט)';
update public.cities set lat = 31.7611, lon = 34.7531 where name_he = 'בן זכאי';
update public.cities set lat = 31.2222, lon = 34.3000 where name_he = 'כרם שלום';
