# 14 — Phase map

Order within a phase is a KC fill. **Planning baseline (2026-11-08): initial store release resumed** (TestFlight / Play internal, then public listing prep per `docs/store/`); spec, architecture and GTM continue in parallel.

## Verified store checkpoint, 2026-11-19

App Store submission of version 1.0, binary 1.9.176 (36), is Rejected: guest access and subscription-model clarification are required. Limited guest browsing (D178, #2511) is development work, not yet a production release. Google Play production is inactive: 2 testers are opted in, against a requirement of at least 12 for at least 14 days (#2305). Apple subscription products remain Prepare for Submission. Full evidence and limits: [store-review checkpoint](./97_store_review_checkpoint.md). The phase table below is a plan, not an implementation-completion report.

## Launch sequence, owner correction 2026-11-19 19:17 Jerusalem

1. Quiet launch as soon as safely possible. No fixed date is approved.
2. Pilot approximately one week after the quiet launch, depending on readiness and observed state. Quiet launch and pilot are separate steps.
3. Broad launch is outside the plan until the owner says otherwise; substantial work remains.

The proposed November 26 / December 20 targets and derived November 24 / December 17 checkpoints were not accepted and are not part of the plan. Audience, distribution and the exact distinction between quiet launch and pilot remain to be defined; no group size, invitation or channel is inferred here. This planning direction is not permission to publish, invite, submit a store build or deploy outside the established authority. Mandatory safety and core-function checks still apply. The phase table below is the product roadmap, not a dated broad-launch commitment.

| Phase | Contents |
|---|---|
| MVP — now | Launch wedge: items + rides + food with matching (D102); time, knowledge and challenges active; medical, democracy and money portals; housing, animals and employment active on kc-dev and switched per environment from the admin portal (D165). The main feed carries every world's posts. One Post, form per type, feed with basic recommendations, sort & filter, toggle, closing, chat, likes & comments, notifications, karma config, expiry, volunteering & hours, events, reports, phone verification, rating & trust engine, org links, donation to KC via Grow, clean prod environment, WhatsApp message paste (S22). |
| Next to launch | Housing & spaces (D30, `D112`): H0 verification → H1 stays first, then event space + storage, the assisted shelter track and the evacuee template (`spec/requirements/21_housing.md`); medical page in hub; chat-export import and group bridge (D38); general emergency by main admin (D42, D51). |
| Phase 2 | Full JGive-style money + section 46 (D20); org finance books, 46(a) tracking, imports, reconciliation, reports and alerts (D76–D80, `spec/requirements/19_org_finance.md` phases 1–2); smart recommendation engine (D27); knowledge, medical, animals, employment and challenges worlds with their sub-categories (D100) — knowledge phase **K1**: topic graph, six exchange post types, library of external resources with review, hybrid search with real embeddings, agent read API ([18](./18_knowledge_world.md) §18.11); multi-world posts (D101); challenges (D43); democracy knowledge & directory (D40); live WhatsApp bot; local & targeted emergency; ID + blue check. Organization profiles & accounts: one entity, registration, public profile, act-as, posts in the org's name, Search organizations filter, team, inbox (D88–D91, `spec/requirements/20_organizations.md` phases 1–2); |
| Phase 3 | Community polls & council (D40, GeoPoll); heritage timeline (D44); org CRM; org documents vault + public transparency snapshots on the org profile (D81, D82); AI assistant; connecting people in need to nonprofits. Knowledge **K2–K3**: native articles and courses with quizzes, progress and completion records, curators, open catalog export ([18](./18_knowledge_world.md) §18.11). Claiming catalog organizations, Registrar enrichment, verification-level badges (D53, `20_organizations` phase 3); |
| Vision | Binding votes, iron constitution, handover to the community (D40); international expansion. |
