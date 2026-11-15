-- 0142_ride_chat_system_messages.sql — FR-RIDE-015 chat system messages on ride lifecycle.
--
-- Parity with 0026_chat_anchor_lifecycle for posts. When a ride leaves the
-- 'open' state — owner closed/cancelled, or cron expired it — every chat
-- anchored to it gets a system message describing what just happened, and
-- THEN the anchor is cleared (0137 only cleared; this migration replaces the
-- 0137 trigger function with a version that emits the message first).
--
-- Status → message body (Hebrew, inline because system messages are stored
-- as text on the message row; the existing posts trigger uses the same
-- pattern of hardcoded literals):
--   closed     → 'הטרמפ נסגר על ידי המפרסם'
--   cancelled  → 'הטרמפ בוטל על ידי המפרסם'
--   expired    → 'מועד היציאה של הטרמפ עבר'
--
-- system_payload carries machine-readable fields for the client:
--   {kind: 'ride_lifecycle', ride_id, status}

BEGIN;

CREATE OR REPLACE FUNCTION public.ride_listings_clear_chat_anchor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_body    text;
  v_payload jsonb;
  v_chat    record;
BEGIN
  IF NOT (OLD.status = 'open' AND NEW.status <> 'open') THEN
    RETURN NEW;
  END IF;

  v_body := CASE NEW.status
    WHEN 'closed'    THEN 'הטרמפ נסגר על ידי המפרסם'
    WHEN 'cancelled' THEN 'הטרמפ בוטל על ידי המפרסם'
    WHEN 'expired'   THEN 'מועד היציאה של הטרמפ עבר'
    ELSE 'הטרמפ לא פעיל יותר'
  END;

  v_payload := jsonb_build_object(
    'kind',    'ride_lifecycle',
    'ride_id', NEW.ride_id,
    'status',  NEW.status
  );

  -- Emit a system message into each chat anchored to this ride BEFORE the
  -- anchor clear; otherwise the SELECT below would find nothing.
  FOR v_chat IN
    SELECT chat_id
      FROM public.chats
     WHERE anchor_ride_id = NEW.ride_id
  LOOP
    INSERT INTO public.messages (
      chat_id, sender_id, kind, body, system_payload, status, delivered_at
    ) VALUES (
      v_chat.chat_id, NULL, 'system', v_body, v_payload, 'delivered', now()
    );
  END LOOP;

  -- Now clear the anchors (same effect as the 0137 version).
  UPDATE public.chats
     SET anchor_ride_id = NULL
   WHERE anchor_ride_id = NEW.ride_id;

  RETURN NEW;
END $$;

-- Trigger already exists from 0137; CREATE OR REPLACE on the function is
-- sufficient to swap the body.

COMMIT;
