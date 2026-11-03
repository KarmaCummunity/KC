# 13 — Growth and go-to-market (D38, D47, D54)

The biggest risk is critical mass, and the solution already exists: a huge market of rides and item giveaways living in WhatsApp groups (D38). Instead of building from zero, KC migrates existing communities — live via bot, in chunks via chat export, group by group.

**GTM (D47):** migrate **one group at a time**, items or rides; learn; only then the next.

## Import channels (S22)
1. **Manual paste (MVP)** — paste a WhatsApp message → post draft.
2. **Chat-export upload (next to launch)** — group admin uploads an export; auto-classification to post type, world, city; low confidence → review queue.
3. **Live bot (phase 2)** — only in groups whose admin added it, and only via an interface permitted by WhatsApp's terms.
4. **Bridge & migration (S23)** — each group gets a parallel community in the app; bot posts summaries with links to the group; when most activity moved, the admin locks the group.

## Privacy & consent (S21) — consent of non-members is an OPEN question (D54)
Working assumption: only in groups whose admin approved and announced to members; no phone numbers, names or private chats imported; imported post shown as "from group X" without identity until its author claims it via phone verification; unclaimed → deleted after 72h; anyone may request removal.

Other channels: partner orgs bringing volunteers (D37), challenges inviting friends (D43), emergencies bringing waves of users (D42).

Model: `ExternalGroupImport`, `ImportedPostCandidate`, `GroupBridge`. Gap: G27.
