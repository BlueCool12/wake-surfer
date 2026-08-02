DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM messages
    GROUP BY sender_actor_id, client_message_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'messages contains duplicate sender-scoped idempotency keys';
  END IF;
END
$$;

ALTER TABLE messages
  DROP CONSTRAINT messages_sender_actor_id_stream_id_client_message_id_key;

ALTER TABLE messages
  RENAME COLUMN client_message_id TO idempotency_key;

ALTER TABLE messages
  ADD CONSTRAINT messages_sender_actor_id_idempotency_key_key
  UNIQUE (sender_actor_id, idempotency_key);

ALTER TABLE messages
  DROP CONSTRAINT messages_content_type_text_check,
  DROP COLUMN content_type,
  DROP COLUMN sent_at_client;
