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
  stream_id text GENERATED ALWAYS AS (target_type || ':' || target_id) STORED PRIMARY KEY,
  target_type text NOT NULL,
  target_id text NOT NULL,
  last_sequence integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT message_streams_target_type_check
    CHECK (target_type IN ('channel', 'dm', 'thread')),
  CONSTRAINT message_streams_target_id_nonempty_check
    CHECK (length(target_id) > 0),
  CONSTRAINT message_streams_sequence_check
    CHECK (last_sequence >= 0),
  CONSTRAINT message_streams_target_unique
    UNIQUE (target_type, target_id)
);

CREATE TABLE messages (
  message_id text PRIMARY KEY,
  stream_id text NOT NULL,
  sequence integer NOT NULL,
  sender_actor_id text NOT NULL,
  parent_message_id text NULL,
  version integer NOT NULL DEFAULT 1,
  content jsonb NULL,
  sender_display_snapshot jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz NULL,
  deleted_at timestamptz NULL,

  CONSTRAINT messages_stream_fk
    FOREIGN KEY (stream_id)
    REFERENCES message_streams (stream_id)
    ON DELETE RESTRICT,
  CONSTRAINT messages_stream_sequence_unique
    UNIQUE (stream_id, sequence),
  CONSTRAINT messages_identity_stream_unique
    UNIQUE (message_id, stream_id),
  CONSTRAINT messages_parent_same_stream_fk
    FOREIGN KEY (parent_message_id, stream_id)
    REFERENCES messages (message_id, stream_id)
    ON DELETE RESTRICT,
  CONSTRAINT messages_sequence_check
    CHECK (sequence > 0),
  CONSTRAINT messages_version_check
    CHECK (version >= 1),
  CONSTRAINT messages_parent_not_self_check
    CHECK (parent_message_id IS NULL OR parent_message_id <> message_id),
  CONSTRAINT messages_lifecycle_check
    CHECK (
      (deleted_at IS NULL AND content IS NOT NULL)
      OR
      (deleted_at IS NOT NULL AND content IS NULL)
    ),
  CONSTRAINT messages_version_timestamps_check
    CHECK (
      (edited_at IS NULL AND deleted_at IS NULL AND version = 1)
      OR
      ((edited_at IS NOT NULL OR deleted_at IS NOT NULL) AND version >= 2)
    ),
  CONSTRAINT messages_edited_at_check
    CHECK (edited_at IS NULL OR edited_at >= created_at),
  CONSTRAINT messages_deleted_at_check
    CHECK (deleted_at IS NULL OR deleted_at >= created_at),
  CONSTRAINT messages_content_shape_check
    CHECK (
      content IS NULL
      OR (
        jsonb_typeof(content) = 'object'
        AND content ? 'schemaVersion'
        AND jsonb_typeof(content -> 'schemaVersion') = 'number'
        AND content ? 'kind'
        AND jsonb_typeof(content -> 'kind') = 'string'
      )
    ),
  CONSTRAINT messages_text_utf8_8kib_check
    CHECK (
      content IS NULL
      OR content ->> 'kind' <> 'text'
      OR (
        content ? 'text'
        AND jsonb_typeof(content -> 'text') = 'string'
        AND octet_length(content ->> 'text') <= 8192
      )
    ),
  CONSTRAINT messages_sender_snapshot_shape_check
    CHECK (
      sender_display_snapshot IS NULL
      OR (
        jsonb_typeof(sender_display_snapshot) = 'object'
        AND sender_display_snapshot ? 'schemaVersion'
        AND jsonb_typeof(sender_display_snapshot -> 'schemaVersion') = 'number'
      )
    )
);

CREATE TABLE send_message_receipts (
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
    REFERENCES messages (message_id)
    ON DELETE RESTRICT,
  CONSTRAINT send_message_receipts_canonicalization_version_check
    CHECK (canonicalization_version >= 1),
  CONSTRAINT send_message_receipts_algorithm_nonempty_check
    CHECK (length(fingerprint_algorithm) > 0),
  CONSTRAINT send_message_receipts_fingerprint_nonempty_check
    CHECK (octet_length(request_fingerprint) > 0)
);

CREATE TABLE message_reactions (
  message_id text NOT NULL,
  actor_id text NOT NULL,
  emoji text NOT NULL,
  reacted_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT message_reactions_pk
    PRIMARY KEY (message_id, actor_id, emoji),
  CONSTRAINT message_reactions_message_fk
    FOREIGN KEY (message_id)
    REFERENCES messages (message_id)
    ON DELETE RESTRICT,
  CONSTRAINT message_reactions_emoji_nonempty_check
    CHECK (length(emoji) > 0)
);

CREATE TABLE stream_read_positions (
  actor_id text NOT NULL,
  stream_id text NOT NULL,
  through_sequence integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT stream_read_positions_pk
    PRIMARY KEY (actor_id, stream_id),
  CONSTRAINT stream_read_positions_stream_fk
    FOREIGN KEY (stream_id)
    REFERENCES message_streams (stream_id)
    ON DELETE RESTRICT,
  CONSTRAINT stream_read_positions_sequence_check
    CHECK (through_sequence >= 0)
);
