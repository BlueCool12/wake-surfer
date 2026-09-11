CREATE TABLE IF NOT EXISTS realtime_chat.send_message_receipts (
  sender_actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  canonicalization_version integer NOT NULL,
  fingerprint_algorithm text NOT NULL,
  fingerprint_key_id text NULL,
  request_fingerprint bytea NOT NULL,
  result_message_id text NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT send_message_receipts_pk
    PRIMARY KEY (sender_actor_id, idempotency_key),
  CONSTRAINT send_message_receipts_result_unique
    UNIQUE (result_message_id),
  CONSTRAINT send_message_receipts_message_fk
    FOREIGN KEY (result_message_id)
    REFERENCES realtime_chat.messages (message_id)
    ON DELETE RESTRICT,
  CONSTRAINT send_message_receipts_canonicalization_version_check
    CHECK (canonicalization_version >= 1),
  CONSTRAINT send_message_receipts_algorithm_nonempty_check
    CHECK (length(fingerprint_algorithm) > 0),
  CONSTRAINT send_message_receipts_fingerprint_nonempty_check
    CHECK (octet_length(request_fingerprint) > 0)
);

CREATE TABLE IF NOT EXISTS realtime_chat.message_reactions (
  message_id text NOT NULL,
  actor_id text NOT NULL,
  emoji text NOT NULL,
  reacted_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT message_reactions_pk
    PRIMARY KEY (message_id, actor_id, emoji),
  CONSTRAINT message_reactions_message_fk
    FOREIGN KEY (message_id)
    REFERENCES realtime_chat.messages (message_id)
    ON DELETE RESTRICT,
  CONSTRAINT message_reactions_emoji_nonempty_check
    CHECK (length(emoji) > 0)
);

CREATE TABLE IF NOT EXISTS realtime_chat.stream_read_positions (
  actor_id text NOT NULL,
  stream_id text NOT NULL,
  through_sequence integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT stream_read_positions_pk
    PRIMARY KEY (actor_id, stream_id),
  CONSTRAINT stream_read_positions_stream_fk
    FOREIGN KEY (stream_id)
    REFERENCES realtime_chat.message_streams (stream_id)
    ON DELETE RESTRICT,
  CONSTRAINT stream_read_positions_sequence_check
    CHECK (through_sequence >= 0)
);
