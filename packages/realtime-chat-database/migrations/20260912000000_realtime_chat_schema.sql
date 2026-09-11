CREATE SCHEMA IF NOT EXISTS realtime_chat;

ALTER TABLE IF EXISTS public.gateway_tickets SET SCHEMA realtime_chat;
ALTER TABLE IF EXISTS public.message_streams SET SCHEMA realtime_chat;
ALTER TABLE IF EXISTS public.messages SET SCHEMA realtime_chat;
ALTER TABLE IF EXISTS public.send_message_receipts SET SCHEMA realtime_chat;
ALTER TABLE IF EXISTS public.message_reactions SET SCHEMA realtime_chat;
ALTER TABLE IF EXISTS public.stream_read_positions SET SCHEMA realtime_chat;

DO $$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET search_path TO realtime_chat, public',
    current_database()
  );
END
$$;

SET search_path TO realtime_chat, public;
