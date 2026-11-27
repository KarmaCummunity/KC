# 92 — Open questions for the PM

1. **WhatsApp group import consent: answered 2026-11-20.** Admin approval and prior notice, anonymous publication, attribution after author verification, deletion after 72 hours; activation blocked until lawyer signature. Manual own-post paste/share scope is unchanged. → [13](./13_growth_gtm.md)
2. **Future revenue model:** on 2026-11-19 the owner described a future full management platform for organizations and a personal WhatsApp bot plus specific functions for individuals, with a social purpose. D143 contains historical price plans whose original user approval has not been recovered here. Do not present those amounts as newly confirmed or cancelled; purchase channels and launch timing remain future work. → [08](./08_organizations.md)
3. **Iron-constitution core** — to be discussed when the PM is ready (D50). → [11](./11_governance.md)

4. **Reconciliation questions Q-1…Q-8 (2026-10-30)** — launch flags vs D3, moderation thresholds (D33), legacy worlds in code, chat reports, listing-handoff karma, TestFlight database (D8), canonical Supabase project refs, account deletion vs. shared chat images. 2026-11-19 checkpoint: Q-1/2/3/5 are recorded as answered by historical repo decisions (not reapproved here). Q-4 remains open despite D134 mentioning chats. Q-6 has a tester-environment policy but build 36 provenance is unverified. Q-7 has historical environment evidence. Q-8 was answered on 2026-11-20 by D179: final purge removes shared images for both sides; the 30-day restore window is unchanged. Details and evidence: [95 §4](./95_reconciliation.md#4-questions-for-the-pm-copied-to-92).

5. **Private profile scope: answered 2026-11-20.** Public by default; Private hides the profile from non-approved followers and requires approval for new followers. Per-field visibility exists in both modes; Private caps even everyone fields at approved followers. Supersedes D-21 visibility semantics. → [07.12](./07_cross_cutting_systems.md)
6. **Knowledge questions: answered 2026-11-20.** Give-and-take default (S66); KC admin/moderator review and trusted-contributor direct publication with post-review (S65); v1 links/text only, no uploads (S71); consulting requires complete profile and profession declaration, no ID verification (S70); "KC community completion record", verification code and owner opt-in profile display (S69). → [18](./18_knowledge_world.md)

Also pending: card/detail design depth (D6*); submitted build 36 source/backend verification (historical D8/G7 policy is not provenance); size of extra org vote weight (D49).


## Closure checkpoint (2026-11-24, #1850)

- **Recipient unmark and the owner's delivery count:** historical FR-CLOSURE-007 AC3 said to decrement both members' counters. The current baseline `recipient_unmark_self` cancels the recipient mark and moves the post to `deleted_no_recipient`; `035_handoffs.sql` explicitly expects the owner's given count to remain one and the recipient's received count to return to zero. Should unmark mean only "not me" (retain owner delivery), or "not delivered" (reverse owner delivery)? The related copy currently uses the latter framing. No counter or copy change is authorized by this checkpoint. See [closure requirements](./requirements/05_closure_and_reopen.md).
- **Reopen after a completed or partial handoff:** current single-taker `reopen_post` withdraws its completed mark; #2089 covers the wider policy across partial/multi-recipient handoffs and other world machines. Do not infer that the generic item reopen may undo a completed ride, stay or event. D104's ban on deleting shared completed history does not itself settle the reopen policy.


## Public research checkpoint (2026-11-24, #1861)

The original criteria remain in [public research requirements](./requirements/16_public_research.md); this checkpoint does not waive them.

- Should web-only mean no native runner UI (current null fallback siblings), or literal route-file absence (FR-RESEARCH-001 AC1)? The latter is not met by the current Expo Router structure.
- Should submission remain service-gateway-only, or must direct anon RPC execution be restored (FR-RESEARCH-002 AC5)? Keep current protections unchanged pending a decision.
- Is the required additional thank-you email capture still intended, beyond optional contact capture on the survey (001 AC5 / 003 AC4)? It is absent from the current thank-you page.
- What admin read surface and deletion semantics are intended for private contact requests (003 AC2-3)? Source has forced RLS and response-to-contact cascade; it does not establish symmetric independent deletion or the required admin read workflow.
