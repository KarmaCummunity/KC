# KC dev seed (Hebrew fake data)

DEV ONLY (kc-dev, ref `enbqriuxvvuontiwslun`). Never run against prod.

- `seed.sql` – wipes previous seed, then creates ~200 users (`userN@seed.kc.test`, password from the `E2E_SEED_PASSWORD` secret, fake), ~600 item posts (give/request, incl. delivered with recipients), **120 ride posts** in the rides world (offer + request, with matching `listings` rows for matching v2 — migration `0676`), demo **listings** in food / time / housing / animals / knowledge (give + request), 8 community/personal **challenge** posts, ~1.5k follows, saved posts, 150 chats with 900 messages, and **synthetic matching-v2 `match_candidates`** (hub “מומלצים בשבילך” + feed strips); notifications are produced by existing triggers. Portal worlds (money, medical, democracy, employment) use curated community links (`0595`) and, for money, the three `[DEMO]` nonprofits.
- Also upserts 3 demo verified nonprofits (`[DEMO] …`, slugs `demo-*`, `verification_method='demo_seed'`) for the money world (#982). Migration `0400` adds the same rows on kc-dev without a reseed; it is a no-op on any DB without the seed users (prod, CI).
- `wipe.sql` – deletes everything created by the seed (all rows hang off `@seed.kc.test` auth users).
- The seed logic lives in the DB as `kc_dev_seed_demo_data` (migration `0592`); `seed.sql` / `wipe.sql` are thin wrappers. A super admin can also delete and restore all demo data from the Admin Portal (Demo data screen: `admin_wipe_demo_data` `0591`, `admin_seed_demo_data` `0592`). Only a database with the `kc_dev_demo_config` marker row (kc-dev) can be seeded.
- Both refuse to run unless `kc.seed_target = 'dev'` is set in the session.

Run: GitHub Actions → **Seed KC dev** (action: seed | wipe), or
`psql "$KC_DEV_DB_URL" -c "set kc.seed_target='dev'" -f supabase/seed/kc-dev/seed.sql` (same session).

Not seeded yet: comments/reactions on KC posts – see issues #867, #824.
