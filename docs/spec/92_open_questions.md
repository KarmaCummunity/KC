# 92 — Open questions for the PM

1. **WhatsApp import consent (D47, D54):** may KC show (anonymously, for 72h) messages of people who have not joined KC, or only of those who approved? → [13](./13_growth_gtm.md)
2. **Future org revenue model:** everything is free for orgs now (D55) — whether and when to consider a subscription? → [08](./08_organizations.md)
3. **Iron-constitution core** — to be discussed when the PM is ready (D50). → [11](./11_governance.md)

4. **Reconciliation questions Q-1…Q-8 (2026-10-30)** — launch flags vs D3, moderation thresholds (D33), legacy worlds in code, chat reports, listing-handoff karma, TestFlight database (D8), canonical Supabase project refs, account deletion vs. shared chat images. Details and evidence: [95 §4](./95_reconciliation.md#4-questions-for-the-pm-copied-to-92).

5. **Private profile scope (PM 2026-11-03):** should a private profile hide the whole profile (bio, posts, counters) from people who are not approved followers, or only the optional fields of D110? Today a private profile looks like a public one (FR-PROFILE-003, D-21); hiding all of it reverses that. → [07.12](./07_cross_cutting_systems.md)
6. **Housing & spaces (`D112`)** — details: [`SSOT/spec/21_housing.md`](../SSOT/spec/21_housing.md). Q-H1, Q-H2, Q-H3, Q-H5 and Q-H7 were decided on 2026-11-03 (decision log).
   - **Q-H4** Stays longer than 30 nights (lone soldiers, students, new immigrants, families between homes). A long free stay starts to look like a tenancy (harder to end, occupancy rights), needs a written stay agreement with an end date, longer safety follow-up and a renewal flow. Options: (a) keep 30 nights in v1 and serve longer needs through organizations; (b) allow one renewal up to 60 nights with a signed stay agreement; (c) a separate long-stay sub-type after counsel review.
   - **Q-H6** In a declared emergency (mass evacuation), may an organization (municipality evacuation centre, NGO) confirm an evacuee **guest** who left home without documents, in place of ID verification? Hosts always verify.

6. **Knowledge world ([18](./18_knowledge_world.md), PM 2026-11-03):**
   - Default hub tab: the give & take feed (D107) or the library once usage shows which one people open? ({{S:knowledge-hub-tabs}})
   - Who reviews library resources in K1: KC admins only, or also a community "knowledge curator" role from the start? ({{S:knowledge-review-before-publish}})
   - File uploads (PDF, slides) in the library: none in K1 as proposed ({{S:knowledge-no-file-uploads-k1}}), or allowed from the start with a copyright attestation?
   - Consulting hour: require ID verification as proposed ({{S:knowledge-consulting-hour-verification}}), or phone verification with a declared profession only?
   - Wording and look of the completion record ({{S:knowledge-completion-record}}): "KC completion record" vs "certificate of participation".

Also pending: card/detail design depth (D6*); D8 TestFlight DB check (G7); size of extra org vote weight (D49).
