# whatsapp-webhook

Meta WhatsApp Cloud API webhook (issues #843, #937, #938). Logic is in `handler.ts`
(dependency-injected, unit-tested in `handler.test.ts`); `index.ts` only wires Supabase.

Per inbound message:

0. `api_whatsapp_claim_inbound(wamid)` — dedupe of Meta retries (#1089). A duplicate wamid is
   skipped entirely; if processing fails the claim is released so the retry is handled.
   Signature: `X-Hub-Signature-256` HMAC with `WHATSAPP_APP_SECRET`; with no secret the POST
   is rejected (401) unless `WHATSAPP_SKIP_SIGNATURE_VERIFY=true` (dev only).
1. `api_whatsapp_inbound_allowed(wa_id)` — per-phone inbound throttle (#938). Throttled
   messages are not stored or handed to the agent (Meta still gets `200`).
2. `api_whatsapp_ingest_inbound` — idempotent storage in `integrations.whatsapp_inbound_messages`
   (kept 90 days); stamps `whatsapp_identities.last_inbound_at` (opens the 24h customer-service window).
3. `api_whatsapp_handle_keyword` — exact STOP/START/HELP keywords in he/en
   (`stop`, `unsubscribe`, `הסר`, `עצור`, … / `start`, `הצטרף`, … / `help`, `עזרה`, …).
   Consent changes are written to `whatsapp_identities`, mirrored to
   `whatsapp_consents` and recorded in `whatsapp_consent_events`. Always runs, even when
   throttled, so a STOP is never lost.
4. For a keyword, `api_whatsapp_queue_reply` queues the he/en confirmation
   (`_shared/whatsapp/replies.ts`). Delivery is done by `whatsapp-sender`.

## Supabase Edge secrets (names only — set in dashboard / `supabase secrets set`)

| Name | Purpose |
|------|---------|
| `WHATSAPP_VERIFY_TOKEN` | Meta webhook verify token (GET challenge) |
| `WHATSAPP_APP_SECRET` | Meta app secret for HMAC signature verification |
| `WHATSAPP_CLOUD_API_TOKEN` | Graph API bearer token for outbound sends (`whatsapp-sender`) and photo downloads (here) |
| `KC_APP_BASE_URL` | Optional web origin of the "finish in the app" links (default `https://karma-community-kc.com`) |
| `WHATSAPP_PHONE_NUMBER_ID` | Sending phone number id (`whatsapp-sender`) |
| `WHATSAPP_GRAPH_API_VERSION` | e.g. `v21.0` (optional; DB config has default) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini key for the Pro agent (#1091). Unset → agent disabled, no LLM calls |
| `GEMINI_MODEL_ID` | Optional, default `gemini-flash-latest` |
| `WHATSAPP_SKIP_SIGNATURE_VERIFY` | Dev only: set `true` when `WHATSAPP_APP_SECRET` is unset |

`whatsapp-sender` also needs the database to be able to call it: the `whatsapp_send` job uses
`kc_private.invoke_edge_function`, configured like the other scheduled workers.

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
   A number linked to a deactivated account (`inactive`) gets neither the agent nor an upsell.
3. Pro → Gemini agent (`_shared/whatsapp/agent`) with KC tools: `search_listings`, `post_listing`
   (needs explicit confirmation), `my_listings`, `my_matches`, all scoped to the linked user and
   backed by `api_bot_search_posts`, `api_bot_open_session` → `api_bot_apply_extraction` →
   `api_bot_publish_post`, `api_bot_my_posts`, `api_bot_my_matches`. A bot post is a native,
   Public, city-level post of the linked owner and counts against the post rate limit. It is
   published at confidence ≥ 0.85; otherwise it stays a draft for staff review. An offer in a
   photo world stays a draft until it has a photo: the bot asks for one in the chat and gives the
   draft's edit link in the app (`/edit-post/<id>` for items, `/edit-listing/<id>` otherwise). A food
   offer needs the expiry the user states; the agent asks for it and never invents one.
4. Photo (D158): an `image` message from a linked Pro member goes to `_shared/whatsapp/photo.ts`,
   never to the language model. `api_bot_pending_photo_draft` names the member's bot draft of the
   last 24 hours; with none, the bot says so and the image is not downloaded or stored. Otherwise
   the photo is fetched from the Graph API (`GET /{media-id}` → URL → bytes, with
   `WHATSAPP_CLOUD_API_TOKEN`), checked as a post photo (JPEG or PNG by its bytes, at most 8 MB),
   uploaded to `post-images/<owner>/<uuid>/0.<ext>` and attached by `api_bot_attach_post_photo`,
   which publishes the post through the bot gates (below 0.85 confidence it stays in staff review).
   A refused attach removes the uploaded file.
   Runs after the 200 (EdgeRuntime.waitUntil), metered by `api_whatsapp_llm_budget_take`, replies via the
   outbound queue.
