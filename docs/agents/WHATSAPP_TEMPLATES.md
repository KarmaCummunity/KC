# WhatsApp message templates — as code (#936)

**Source of truth:** `supabase/functions/_shared/whatsapp/templates.json`
(placed under `_shared/` so `supabase functions deploy` does not treat it as a function).

| Template | Purpose | Params (`{{1}}`…) |
|----------|---------|-------------------|
| `match_found_v1` | A suggested match was found (listing_matches trigger) | `world_label` |
| `confirm_handoff_v1` | Both sides accepted; coordinate the handoff | `partner_name`, `listing_title` |
| `reminder_v1` | Pending match / handoff not answered | `listing_title` |
| `opt_in_confirm_v1` | Confirms an in-app opt-in (outside a 24h session) | — |

Every template ships in **he** and **en**. The DB mirror is `public.whatsapp_message_templates`
(one row per name + language, seeded by migration 0307). The sender resolves params by name from
the queued row's payload: `payload["<param>_<lang>"]`, then `payload["<param>"]`. A missing param
fails the row; a broken template is never sent. Code refers to names through `TEMPLATE` in
`_shared/whatsapp/templates.ts`, not string literals.

## Changing a template

1. Edit `templates.json`. **Never reword an approved template in place:** add a new `_v2` entry
   and keep the old one until the new one is approved.
2. `cd supabase/functions && deno test --allow-read _shared/whatsapp`. This checks Meta-style rules:
   name format, `_vN` suffix, he/en parity, placeholder count equals params, examples, 1024 chars,
   no leading/trailing or adjacent params, opt-out wording.
3. `node scripts/whatsapp-templates.mjs sql`, then paste the rows into a **new** forward
   migration (a `next-NN_slug.sql` file; the number is assigned on merge, see `MIGRATION_RANGES.md`). The upsert resets `is_approved` /
   `meta_status` when the wording changed. The sync test points at the migration that holds the
   current seed. Update it in the same PR.

## Submission checklist (when real Meta credentials exist)

- [ ] WhatsApp Business Account verified; display name approved; phone number registered.
- [ ] Secrets set only as Supabase Edge / local env, never committed: `WHATSAPP_CLOUD_API_TOKEN`,
      `WHATSAPP_PHONE_NUMBER_ID`; for submission also `WHATSAPP_WABA_ID`.
- [ ] Category is `UTILITY` for transactional match and handoff messages. Meta re-categorises
      promotional wording as `MARKETING`, which has stricter limits and pricing.
- [ ] Every body names the brand and tells the user how to opt out (STOP / הסר). Opt-out keywords
      are handled by `api_whatsapp_handle_keyword` (#937).
- [ ] Examples are realistic and contain no real personal data.
- [ ] Dry run: `node scripts/whatsapp-templates.mjs payloads`, then review the JSON.
- [ ] Submit: `WHATSAPP_CLOUD_API_TOKEN=… WHATSAPP_WABA_ID=… node scripts/whatsapp-templates.mjs submit --yes`.
- [ ] Record the outcome per name + language. In SQL as service role / operator, after Meta approves:
      `update whatsapp_message_templates set meta_status='approved', is_approved=true, meta_template_id='<id>' where template_name='…' and language_code='…';`
      Only approved rows can be queued (`skipped_template_unapproved` otherwise).
- [ ] Rejected: fix the wording under a new `_vN` name and resubmit. Do not edit in place.
- [ ] Turn the channel on last: `whatsapp_channel_config.is_enabled = true` (kc-dev first; prod only
      with explicit approval).
- [ ] Watch `bot_outbound_messages` statuses and `last_error` for the first sends.
      `whatsapp_send_limits` holds the tier caps (#938).
