-- src/storage.mjs persists the entire application state as a single JSONB
-- document (normalized/denormalized by src/server.mjs), not as relational
-- tables. This is the only table the running application reads or writes.
CREATE TABLE IF NOT EXISTS application_state (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
