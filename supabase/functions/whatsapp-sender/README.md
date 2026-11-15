# whatsapp-sender

Outbound worker for the WhatsApp bot (issue #938). The `whatsapp_send` scheduled job
(`kc_private.scheduled_jobs`, every minute) invokes it with the service role:
`POST /functions/v1/whatsapp-sender` with optional body `{ "batch": 20 }`.

It does nothing (`{ skipped: "channel_disabled" | "not_configured" }`) until the channel is
switched on (the kill switch in the admin WhatsApp console, `integrations.whatsapp_channel_config`)
**and** `WHATSAPP_CLOUD_API_TOKEN` plus a phone number id are set. It reads the channel settings
through `api_whatsapp_channel_config()`, because the `integrations` schema is not exposed to the API.

## Flow

1. `api_whatsapp_outbound_claim(batch, visibility)` takes due rows of
   `integrations.whatsapp_outbound_messages` (`for update skip locked`; a `sending` row whose
   claim is older than the visibility window is taken again), capped by
   `whatsapp_send_limits.global_per_minute`. Template rows whose member has since opted out are
   marked `skipped_no_consent` here and never sent.
2. Send via Graph `/{version}/{phone_number_id}/messages` (`_shared/whatsapp/meta.ts`).
3. `api_whatsapp_outbound_result(...)`: `sent`; or retryable (429, 5xx, network, Meta
   throttling codes) → `queued` again with exponential backoff
   (`backoff_base_seconds * 2^attempts`, max 1h); otherwise or after `max_attempts` → `failed`.

## Limits enforced in the DB (`integrations.whatsapp_send_limits`, super admin tunes them in the console)

| Limit | Default | Where |
|-------|---------|-------|
| Proactive templates per user / hour, / day | 5 / 20 | `kc_private.whatsapp_queue_template` |
| Unique template recipients / 24h (Meta tier) | 1000 | `kc_private.whatsapp_queue_template` |
| Session replies per phone / hour | 30 | `api_whatsapp_queue_reply` |
| Global sends / minute | 60 | `api_whatsapp_outbound_claim` |
| Inbound messages per phone / minute | 20 | `api_whatsapp_inbound_allowed` (webhook) |
| LLM calls per phone / day, global / day | 30 / 2000 | `api_whatsapp_llm_budget_take` (the Pro agent in `whatsapp-webhook`) |

Rules: a proactive (non-reply) message needs the member's alert consent
(`integrations.whatsapp_consents.opted_in`) and no phone-level STOP, a linked WhatsApp identity,
the channel switched on, and an **approved** template. Free-form replies only go out inside the
24h window after the user's last inbound message; after STOP only the STOP confirmation is allowed.

Secrets: see `../whatsapp-webhook/README.md` (names only).
