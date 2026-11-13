# MCP / RPC contract — WhatsApp matching bot (#846)

The WhatsApp bot and any MCP adapter **must call only** the `api_*` functions below
(via Supabase service role or authenticated operator for review). No direct table access
from bot services.

## Inbound / channel (#843)

| RPC | Args | Returns | Notes |
|-----|------|---------|-------|
| `api_whatsapp_ingest_inbound` | `p_message_id text`, `p_payload jsonb`, `p_run_id uuid?` | `uuid` (record_id) | Idempotent on `wa:{message_id}` |
| `api_whatsapp_outbound_log` | `p_user_id`, `p_template_name`, `p_payload` | `uuid` | Audit only; prefer queue below |
| `api_whatsapp_queue_outbound` | `p_user_id`, `p_template_name`, `p_payload`, `p_max_per_hour?` | `uuid` | Consent + rate limit (#845) |

## Intake / listings (#844)

| RPC | Args | Returns | Notes |
|-----|------|---------|-------|
| `api_bot_link_identity` | `p_wa_id`, `p_user_id` | `uuid` (identity_id) | Link WA id to KC user |
| `api_bot_open_session` | `p_wa_id`, `p_record_id?` | `uuid` (session_id) | New conversation session |
| `api_bot_apply_extraction` | session + world/kind/direction/title/details/confidence | `uuid` (extraction_id) | LLM output shape |
| `api_bot_publish_listing` | `p_session_id`, `p_owner_id` | `uuid` (listing_id) | After user confirm |

## Matching / search / dedupe

| RPC | Args | Returns | Notes |
|-----|------|---------|-------|
| `api_bot_find_matches` | `p_owner_id`, `p_listing_id`, `p_limit?` | setof match row | Wraps `find_matches` |
| `api_bot_search_listings` | `p_owner_id`, `p_query`, `p_world_slug?`, `p_limit?` | setof search row | Wraps `search_listings` |
| `api_bot_find_duplicate_listings` | title, world, min_similarity?, limit? | similar listings | Trigram dedupe hint |
| `api_bot_register_er_candidate` | two listing ids, score, reason? | `uuid` | Opens ER candidate |

## Consent / notifications (#845)

| RPC | Args | Returns | Notes |
|-----|------|---------|-------|
| `api_bot_set_match_consent` | `p_user_id`, `p_opted_in boolean` | void | Explicit opt-in |
| `api_bot_enqueue_match_notifications` | `p_match_id` | `jsonb` | Both owners; uses templates |
| `api_bot_record_match_response` | match_id, user_id, accept\|decline | `uuid` | Updates match status |

## Admin review

| RPC | Args | Returns | Notes |
|-----|------|---------|-------|
| `api_bot_admin_review_enqueue` | extraction_id, reason | `uuid` | Service |
| `api_bot_admin_review_list` | limit? | pending rows | Service |
| `api_bot_admin_review_resolve` | review_id, approved\|rejected, reviewer_id | void | Operator JWT |

## MCP mapping (suggested tool names)

- `marketplace_whatsapp_ingest` → `api_whatsapp_ingest_inbound`
- `marketplace_bot_apply_extraction` → `api_bot_apply_extraction`
- `marketplace_bot_publish_listing` → `api_bot_publish_listing`
- `marketplace_find_matches` → `api_bot_find_matches`
- `marketplace_search_listings` → `api_bot_search_listings`
- `marketplace_set_whatsapp_consent` → `api_bot_set_match_consent`
- `marketplace_match_respond` → `api_bot_record_match_response`

Edge entrypoints: `whatsapp-webhook` (the Pro agent's tools) and `whatsapp-sender`. The `whatsapp-intake-worker` stub is retired; the bot RPCs on posts are `api_bot_search_posts`, `api_bot_publish_post`, `api_bot_my_posts` and `api_bot_my_matches` (the `integrations` module).

Migrations: `0300`–`0304`. Contract tests: `supabase/tests/0300_whatsapp_bot_contract.sql`.
