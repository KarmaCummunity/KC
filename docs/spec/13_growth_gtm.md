# 13 — Growth and go-to-market (D38, D47, D54)

The biggest risk is critical mass, and the solution already exists: a huge market of rides and item giveaways living in WhatsApp groups (D38). Instead of building from zero, KC migrates existing communities — live via bot, in chunks via chat export, group by group.

**GTM (D47):** migrate **one group at a time**, items or rides; learn; only then the next.

## Import channels (S22)
1. **Manual paste / share (MVP)** — paste or share (OS share sheet) a WhatsApp, Facebook or Yad2 post → extraction → reviewed post draft, only for the member's own post (`FR-IMPORT-*`, D167). KC never scrapes or reads those platforms.
2. **Chat-export upload (next to launch)** — group admin uploads an export; auto-classification to post type, world, city; low confidence → review queue.
3. **Live bot (phase 2)** — only in groups whose admin added it, and only via an interface permitted by WhatsApp's terms.
4. **Bridge & migration (S23)** — each group gets a parallel community in the app; bot posts summaries with links to the group; when most activity moved, the admin locks the group.

## Privacy & consent (S21) — approved model, activation blocked (D54)
Approved by the owner on 2026-11-20: only in groups whose admin approved and announced to members; no phone numbers, names or private chats imported; imported post shown as "from group X" without identity until its author is verified; deleted after 72h. The summary does not waive the existing S90 phone-verification claim requirement. Earlier working details, including removal on request, remain recorded as pending design, not rejected by this approval.

Other channels: partner orgs bringing volunteers (D37), challenges inviting friends (D43), emergencies bringing waves of users (D42).

Model: `ExternalGroupImport`, `ImportedPostCandidate`, `GroupBridge`. Gap: G27.

### Group-import activation gate (owner approval 2026-11-20)

The group-import model requires group-admin approval and prior notice to the group, anonymous publication, attribution to the author only after verification, and deletion after 72 hours. Activation is blocked until an actual lawyer signature covering this model is verified. The product approval is not that signature. This decision does not change the separate manual own-post paste/share channel or authorize its activation.
