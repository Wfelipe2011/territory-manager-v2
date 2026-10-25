-- Scope 0 is the global distinct-device count; positive scopes are tenant IDs.
-- No tokens, device identifiers or request payloads are retained in analytics.
CREATE TABLE field_concurrency_sample (
  sampled_at timestamptz NOT NULL,
  scope_id integer NOT NULL CHECK (scope_id >= 0),
  active integer NOT NULL CHECK (active >= 0),
  PRIMARY KEY (sampled_at, scope_id)
);
CREATE TABLE field_concurrency_hour (
  bucket_at timestamptz NOT NULL,
  scope_id integer NOT NULL CHECK (scope_id >= 0),
  samples integer NOT NULL CHECK (samples > 0),
  active_sum bigint NOT NULL,
  peak integer NOT NULL,
  peak_at timestamptz NOT NULL,
  PRIMARY KEY (bucket_at, scope_id)
);
CREATE INDEX field_concurrency_hour_scope_idx ON field_concurrency_hour(scope_id, bucket_at);
