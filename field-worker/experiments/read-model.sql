-- Lab only. Immutable, version-addressed raw catalog, NEVER an authorization cache.
CREATE TABLE IF NOT EXISTS field_experiment_read_model (
  tenant_id integer NOT NULL, territory_id integer NOT NULL, block_id integer NOT NULL,
  round_number integer NOT NULL, revision text NOT NULL, payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,territory_id,block_id,round_number,revision)
);
TRUNCATE field_experiment_read_model;
CREATE OR REPLACE FUNCTION field_experiment_store(t integer,te integer,b integer,r integer,v text,p jsonb)
RETURNS integer LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO field_experiment_read_model(tenant_id,territory_id,block_id,round_number,revision,payload)
  VALUES(t,te,b,r,v,p) ON CONFLICT DO NOTHING;
  RETURN 1;
END $$;
