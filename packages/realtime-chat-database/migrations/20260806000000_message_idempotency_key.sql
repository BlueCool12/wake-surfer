ALTER TABLE messages
  RENAME COLUMN client_message_id TO idempotency_key;

ALTER TABLE messages
  DROP CONSTRAINT messages_sender_actor_id_stream_id_client_message_id_key;

WITH legacy_messages AS (
  SELECT
    message_id,
    row_number() OVER (
      PARTITION BY sender_actor_id
      ORDER BY created_at, message_id
    ) AS legacy_ordinal
  FROM messages
)
UPDATE messages AS messages_to_migrate
SET idempotency_key = 'legacy:' || legacy_messages.legacy_ordinal::text
FROM legacy_messages
WHERE legacy_messages.message_id = messages_to_migrate.message_id;

ALTER TABLE messages
  ADD CONSTRAINT messages_sender_actor_id_idempotency_key_key
  UNIQUE (sender_actor_id, idempotency_key);

ALTER TABLE messages
  ALTER COLUMN content_type SET DEFAULT 'text';
