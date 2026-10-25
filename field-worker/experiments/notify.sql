-- Apply ONLY to the isolated synthetic lab DB, never to the workspace DB.
CREATE OR REPLACE FUNCTION field_experiment_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('field_experiment_revision',
    json_build_array(NEW.tenant_id,NEW.territory_id,NEW.block_id)::text);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS field_experiment_notify ON field_revision;
CREATE TRIGGER field_experiment_notify AFTER INSERT OR UPDATE ON field_revision
FOR EACH ROW EXECUTE FUNCTION field_experiment_notify();
