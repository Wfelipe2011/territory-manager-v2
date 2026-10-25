-- Disposable derived catalog. Business data and authorization remain authoritative.
CREATE TABLE IF NOT EXISTS field_read_model (
  tenant_id integer NOT NULL,
  territory_id integer NOT NULL,
  block_id integer NOT NULL,
  round_number integer NOT NULL,
  revision text NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz(6) NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,territory_id,block_id,round_number,revision)
);
CREATE INDEX IF NOT EXISTS field_read_model_updated_at_idx ON field_read_model(updated_at);

-- Called only after the source RepeatableRead transaction commits. Versions are
-- immutable: a late writer cannot overwrite another revision or its payload.
CREATE OR REPLACE FUNCTION field_store_read_model(t integer,te integer,b integer,r integer,v text,p jsonb)
RETURNS integer LANGUAGE plpgsql AS $$ BEGIN
  -- Serialize only derived writes for this scope across worker processes.
  -- This lock is outside the source snapshot and never guards a house marking.
  PERFORM pg_advisory_xact_lock(t,hashtext('field_read_model:'||te||':'||b||':'||r));
  INSERT INTO field_read_model(tenant_id,territory_id,block_id,round_number,revision,payload)
  VALUES(t,te,b,r,v,p) ON CONFLICT DO NOTHING;
  -- Bound historical versions per scope; missing entries are always rebuilt.
  DELETE FROM field_read_model WHERE tenant_id=t AND territory_id=te AND block_id=b AND round_number=r
    AND revision NOT IN (SELECT revision FROM field_read_model
      WHERE tenant_id=t AND territory_id=te AND block_id=b AND round_number=r
      ORDER BY updated_at DESC,revision DESC LIMIT 2);
  RETURN 1;
END $$;

CREATE OR REPLACE FUNCTION field_notify_revision()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  PERFORM pg_notify('field_revision_changed',json_build_array(NEW.tenant_id,NEW.territory_id,NEW.block_id)::text);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS field_notify_revision ON field_revision;
CREATE TRIGGER field_notify_revision AFTER INSERT OR UPDATE ON field_revision
FOR EACH ROW EXECUTE FUNCTION field_notify_revision();
