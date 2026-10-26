CREATE TABLE request_metric_minute (
  bucket_at timestamptz NOT NULL,
  component text NOT NULL,
  instance_id text NOT NULL,
  category text NOT NULL,
  requests integer NOT NULL,
  errors integer NOT NULL,
  client_errors integer NOT NULL,
  aborted integer NOT NULL,
  total_ms double precision NOT NULL,
  max_ms double precision NOT NULL,
  histogram integer[] NOT NULL,
  revision integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_at, component, instance_id, category)
);
