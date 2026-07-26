CREATE TABLE gateway_tickets (
  ticket_hash text PRIMARY KEY,
  actor_id text NOT NULL,
  assigned_gateway_id text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL
);

CREATE INDEX gateway_tickets_expires_at_idx
  ON gateway_tickets (expires_at);

CREATE INDEX gateway_tickets_assigned_gateway_id_idx
  ON gateway_tickets (assigned_gateway_id);

CREATE TABLE message_streams (
  stream_id text PRIMARY KEY,
  target_type text NOT NULL,
  target_id text NOT NULL,
  last_sequence integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX message_streams_target_idx
  ON message_streams (target_type, target_id);

CREATE TABLE messages (
  message_id text PRIMARY KEY,
  stream_id text NOT NULL REFERENCES message_streams(stream_id),
  sequence integer NOT NULL,
  sender_actor_id text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  client_message_id text NOT NULL,
  content_type text NOT NULL,
  content_text text NOT NULL,
  sent_at_client timestamptz NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT messages_content_type_text_check CHECK (content_type = 'text'),
  CONSTRAINT messages_content_text_utf8_8kib_check CHECK (octet_length(content_text) <= 8192),
  UNIQUE (stream_id, sequence),
  UNIQUE (sender_actor_id, stream_id, client_message_id)
);

CREATE INDEX messages_stream_sequence_idx
  ON messages (stream_id, sequence);
