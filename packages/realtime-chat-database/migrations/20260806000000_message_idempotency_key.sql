ALTER TABLE messages
  RENAME COLUMN client_message_id TO idempotency_key;

ALTER TABLE messages
  DROP CONSTRAINT messages_sender_actor_id_stream_id_client_message_id_key;

ALTER TABLE messages
  ADD CONSTRAINT messages_sender_actor_id_idempotency_key_key
  UNIQUE (sender_actor_id, idempotency_key);

ALTER TABLE messages
  ALTER COLUMN content_type SET DEFAULT 'text';
