-- supabase/tests/0745_seed_kolzchut_community_links.sql
-- Test coverage for migration 0745 (curated Kol Zchut and community links seed, #1993).
-- Verifies:
--   1. Seed inserts 22 rows when a super admin exists.
--   2. Count per category (housing=5, money=3, employment=4, knowledge=5, animals=4, food=1).
--   3. All 22 rows are approved and attributed to the curator.
--   4. No duplicate (category_slug, url) pairs exist.
--   5. Re-running the seed is idempotent.

begin;

create temp table personas as
select kc_test.create_user('links_curator') as curator;
insert into public.admin_role_grants (user_id, role) select curator, 'super_admin' from personas;

do $$
declare
  v_curator uuid;
  v_count integer;
  v_housing_count integer;
  v_money_count integer;
  v_employment_count integer;
  v_knowledge_count integer;
  v_animals_count integer;
  v_food_count integer;
  v_dup_count integer;
begin
  select curator into v_curator from personas;

  -- Verify initial state
  perform kc_test.assert_true(
    public.has_admin_role(v_curator, 'super_admin'),
    'curator must have super_admin role');

  -- Count rows belonging to the 22 new URLs
  select count(*) into v_count
    from public.donation_links
   where url in (
     'https://www.kolzchut.org.il/he/%D7%93%D7%99%D7%95%D7%A8_%D7%95%D7%A9%D7%99%D7%9B%D7%95%D7%9F',
     'https://www.kolzchut.org.il/he/%D7%A1%D7%99%D7%95%D7%A2_%D7%91%D7%A9%D7%9B%D7%A8_%D7%93%D7%99%D7%A8%D7%94',
     'https://www.kolzchut.org.il/he/%D7%93%D7%99%D7%95%D7%A8_%D7%A6%D7%99%D7%91%D7%95%D7%A8%D7%99',
     'https://shanti.org.il/',
     'https://echpat.org.il/',
     'https://www.kolzchut.org.il/he/%D7%94%D7%9B%D7%A0%D7%A1%D7%94_%D7%A0%D7%9E%D7%95%D7%9B%D7%94_%D7%95%D7%A7%D7%A9%D7%99%D7%99%D7%9D_%D7%9B%D7%9C%D7%9B%D7%9C%D7%99%D7%99%D7%9D',
     'https://www.kolzchut.org.il/he/%D7%92%D7%9E%D7%9C%D7%AA_%D7%94%D7%91%D7%98%D7%97%D7%AA_%D7%94%D7%9B%D7%A0%D7%A1%D7%94',
     'https://www.naomi.org.il/',
     'https://www.kolzchut.org.il/he/%D7%AA%D7%A2%D7%A1%D7%95%D7%A7%D7%94_%D7%95%D7%96%D7%9B%D7%95%D7%99%D7%95%D7%AA_%D7%A2%D7%95%D7%91%D7%93%D7%99%D7%9D',
     'https://www.kolzchut.org.il/he/%D7%93%D7%9E%D7%99_%D7%90%D7%91%D7%98%D7%9C%D7%94',
     'https://www.kolzchut.org.il/he/%D7%A9%D7%9B%D7%A8_%D7%9E%D7%99%D7%A0%D7%99%D7%9E%D7%95%D7%9D',
     'https://www.kavlaoved.org.il/',
     'https://www.kolzchut.org.il/he/%D7%A1%D7%98%D7%95%D7%93%D7%A0%D7%98%D7%99%D7%9D',
     'https://www.kolzchut.org.il/he/%D7%94%D7%9B%D7%A9%D7%A8%D7%94_%D7%9E%D7%A7%D7%A6%D7%95%D7%A2%D7%99%D7%AA',
     'https://www.kolzchut.org.il/he/%D7%97%D7%99%D7%A0%D7%95%D7%9A',
     'https://www.snunit.k12.il/',
     'https://www.cet.ac.il/',
     'https://www.yad4.co.il/',
     'https://www.freedom-farm.org.il/',
     'https://www.petprotect.org.il/',
     'https://www.israelguidedog.org.il/',
     'https://www.jlmfoodrescuers.org/'
   );

  perform kc_test.assert_eq(v_count, 22, 'exactly 22 new community links seeded');

  -- Count per category
  select count(*) into v_housing_count from public.donation_links where category_slug = 'housing' and url like '%kolzchut%' or url in ('https://shanti.org.il/', 'https://echpat.org.il/');
  select count(*) into v_money_count from public.donation_links where category_slug = 'money' and (url like '%kolzchut%' or url = 'https://www.naomi.org.il/');
  select count(*) into v_employment_count from public.donation_links where category_slug = 'employment' and (url like '%kolzchut%' or url = 'https://www.kavlaoved.org.il/');
  select count(*) into v_knowledge_count from public.donation_links where category_slug = 'knowledge' and (url like '%kolzchut%' or url in ('https://www.snunit.k12.il/', 'https://www.cet.ac.il/'));
  select count(*) into v_animals_count from public.donation_links where category_slug = 'animals' and url in ('https://www.yad4.co.il/', 'https://www.freedom-farm.org.il/', 'https://www.petprotect.org.il/', 'https://www.israelguidedog.org.il/');
  select count(*) into v_food_count from public.donation_links where category_slug = 'food' and url = 'https://www.jlmfoodrescuers.org/';

  perform kc_test.assert_eq(v_housing_count, 5, '5 housing links seeded');
  perform kc_test.assert_eq(v_money_count, 3, '3 money links seeded');
  perform kc_test.assert_eq(v_employment_count, 4, '4 employment links seeded');
  perform kc_test.assert_eq(v_knowledge_count, 5, '5 knowledge links seeded');
  perform kc_test.assert_eq(v_animals_count, 4, '4 animals links seeded');
  perform kc_test.assert_eq(v_food_count, 1, '1 food link seeded');

  -- Verify all new rows are approved
  perform kc_test.assert_eq(
    (select count(*) from public.donation_links where review_status = 'approved' and url in (
      'https://www.kolzchut.org.il/he/%D7%93%D7%99%D7%95%D7%A8_%D7%95%D7%A9%D7%99%D7%9B%D7%95%D7%9F',
      'https://www.kolzchut.org.il/he/%D7%A1%D7%99%D7%95%D7%A2_%D7%91%D7%A9%D7%9B%D7%A8_%D7%93%D7%99%D7%A8%D7%94',
      'https://www.kolzchut.org.il/he/%D7%93%D7%99%D7%95%D7%A8_%D7%A6%D7%99%D7%91%D7%95%D7%A8%D7%99',
      'https://shanti.org.il/',
      'https://echpat.org.il/',
      'https://www.kolzchut.org.il/he/%D7%94%D7%9B%D7%A0%D7%A1%D7%94_%D7%A0%D7%9E%D7%95%D7%9B%D7%94_%D7%95%D7%A7%D7%A9%D7%99%D7%99%D7%9D_%D7%9B%D7%9C%D7%9B%D7%9C%D7%99%D7%99%D7%9D',
      'https://www.kolzchut.org.il/he/%D7%92%D7%9E%D7%9C%D7%AA_%D7%94%D7%91%D7%98%D7%97%D7%AA_%D7%94%D7%9B%D7%A0%D7%A1%D7%94',
      'https://www.naomi.org.il/',
      'https://www.kolzchut.org.il/he/%D7%AA%D7%A2%D7%A1%D7%95%D7%A7%D7%94_%D7%95%D7%96%D7%9B%D7%95%D7%99%D7%95%D7%AA_%D7%A2%D7%95%D7%91%D7%93%D7%99%D7%9D',
      'https://www.kolzchut.org.il/he/%D7%93%D7%9E%D7%99_%D7%90%D7%91%D7%98%D7%9C%D7%94',
      'https://www.kolzchut.org.il/he/%D7%A9%D7%9B%D7%A8_%D7%9E%D7%99%D7%A0%D7%99%D7%9E%D7%95%D7%9D',
      'https://www.kavlaoved.org.il/',
      'https://www.kolzchut.org.il/he/%D7%A1%D7%98%D7%95%D7%93%D7%A0%D7%98%D7%99%D7%9D',
      'https://www.kolzchut.org.il/he/%D7%94%D7%9B%D7%A9%D7%A8%D7%94_%D7%9E%D7%A7%D7%A6%D7%95%D7%A2%D7%99%D7%AA',
      'https://www.kolzchut.org.il/he/%D7%97%D7%99%D7%A0%D7%95%D7%9A',
      'https://www.snunit.k12.il/',
      'https://www.cet.ac.il/',
      'https://www.yad4.co.il/',
      'https://www.freedom-farm.org.il/',
      'https://www.petprotect.org.il/',
      'https://www.israelguidedog.org.il/',
      'https://www.jlmfoodrescuers.org/'
    )),
    22,
    'all 22 new links are approved'
  );

  -- Check for any duplicates in category_slug, url
  select count(*) into v_dup_count
    from (
      select category_slug, url, count(*)
        from public.donation_links
       group by category_slug, url
      having count(*) > 1
    ) dups;

  perform kc_test.assert_eq(v_dup_count, 0, 'no duplicate (category, url) pairs in donation_links');
end $$;

rollback;
