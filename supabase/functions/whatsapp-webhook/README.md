# whatsapp-webhook

Meta WhatsApp Cloud API webhook (issues #843, #937, #938). Logic is in `handler.ts`
(dependency-injected, unit-tested in `handler.test.ts`); `index.ts` only wires Supabase.

Per inbound message:

0. `api_whatsapp_claim_inbound(wamid)` — dedupe of Meta retries (#1089). A duplicate wamid is
   skipped entirely; if processing fails the claim is released so the retry is handled.
   Signature: `X-Hub-Signature-256` HMAC with `WHATSAPP_APP_SECRET`; with no secret the POST
   is rejected (401) unless `WHATSAPP_SKIP_SIGNATURE_VERIFY=true` (dev only).
1. `api_whatsapp_inbound_allowed(wa_id)` — per-phone inbound throttle (#938). Throttled
   messages are not stored or sent to intake (Meta still gets `200`).
2. `api_whatsapp_ingest_inbound` — idempotent raw-record storage; stamps
   `whatsapp_identities.last_inbound_at` (opens the 24h customer-service window).
3. `api_whatsapp_handle_keyword` — exact STOP/START/HELP keywords in he/en
   (`stop`, `unsubscribe`, `הסר`, `עצור`, … / `start`, `הצטרף`, … / `help`, `עזרה`, …).
   Consent changes are written to `whatsapp_identities`, mirrored to
   `whatsapp_match_consent` and audited in `whatsapp_consent_events`. Always runs, even when
   throttled, so a STOP is never lost.
4. For a keyword, `api_whatsapp_queue_reply` queues the he/en confirmation
   (`_shared/whatsapp/replies.ts`). Delivery is done by `whatsapp-sender`.

## Supabase Edge secrets (names only — set in dashboard / `supabase secrets set`)

| Name | Purpose |
|------|---------|
| `WHATSAPP_VERIFY_TOKEN` | Meta webhook verify token (GET challenge) |
| `WHATSAPP_APP_SECRET` | Meta app secret for HMAC signature verification |
| `WHATSAPP_CLOUD_API_TOKEN` | Graph API bearer token for outbound sends (`whatsapp-sender`) |
| `WHATSAPP_PHONE_NUMBER_ID` | Sending phone number id (`whatsapp-sender`) |
| `WHATSAPP_GRAPH_API_VERSION` | e.g. `v21.0` (optional; DB config has default) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini key for the Pro agent (#1091). Unset → agent disabled, no LLM calls |
| `GEMINI_MODEL_ID` | Optional, default `gemini-flash-latest` |
| `WHATSAPP_SKIP_SIGNATURE_VERIFY` | Dev only: set `true` when `WHATSAPP_APP_SECRET` is unset |

Never commit real tokens. See `supabase/README.md` for the full WhatsApp bot env list.

## Tests

```bash
cd supabase/functions
deno test _shared/whatsapp whatsapp-webhook whatsapp-sender
```

All tests use a mocked RPC layer and a mocked Graph API `fetch`; no secrets are needed.

## Pro bot (#1086, #1090, #1091)

Free text (not a STOP/START/HELP keyword) goes through, in order:

1. Link code: `123456` / `LINK 123456` / `קישור 123456` → `api_whatsapp_redeem_link_code` (code from
   `api_whatsapp_create_link_code()` in the app, Pro only, 10 min, 5 failures/hour lockout).
2. Pro gate: `api_whatsapp_bot_access(wa_id)`. Unlinked / not Pro → upsell reply at most once per 24h.
3. Pro → Gemini agent (`_shared/whatsapp/agent`) with KC tools: `search_listings`, `post_listing`
   (needs explicit confirmation), `my_listings`, `my_matches`, all scoped to the linked user.
   Runs after the 200 (EdgeRuntime.waitUntil), metered by `api_whatsapp_llm_budget_take`, replies via the
   outbound queue.
