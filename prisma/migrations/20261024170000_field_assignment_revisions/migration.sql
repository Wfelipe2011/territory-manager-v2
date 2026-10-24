BEGIN;
-- New/removed assignments must refresh field screens even before houses exist.
CREATE FUNCTION field_assignment_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE documents jsonb[]; s record;
BEGIN
  IF TG_OP = 'INSERT' THEN documents := ARRAY[to_jsonb(NEW)];
  ELSIF TG_OP = 'DELETE' THEN documents := ARRAY[to_jsonb(OLD)];
  ELSE documents := ARRAY[to_jsonb(OLD), to_jsonb(NEW)]; END IF;
  FOR s IN
    WITH assignments AS (
      SELECT (d->>'tenant_id')::integer AS tenant_id, (d->>'territory_id')::integer AS territory_id, (d->>'block_id')::integer AS block_id
      FROM unnest(documents) AS document(d) WHERE TG_TABLE_NAME = 'territory_block'
      UNION
      SELECT tb.tenant_id, tb.territory_id, tb.block_id
      FROM territory_block tb CROSS JOIN unnest(documents) AS document(d)
      WHERE TG_TABLE_NAME = 'territory_block_address' AND tb.id = (d->>'territory_block_id')::integer
    ) SELECT DISTINCT a.tenant_id, a.territory_id, ri.round_number, a.block_id
      FROM assignments a JOIN round_info ri ON ri.tenant_id = a.tenant_id
      ORDER BY a.tenant_id, a.territory_id, ri.round_number, a.block_id
  LOOP
    PERFORM bump_field_revision(s.tenant_id, s.territory_id, s.round_number, s.block_id);
  END LOOP;
  RETURN NULL;
END $$;
DROP TRIGGER field_block_signature_changed ON territory_block;
CREATE TRIGGER field_block_assignment_changed AFTER INSERT OR UPDATE OR DELETE ON territory_block FOR EACH ROW EXECUTE FUNCTION field_assignment_changed();
CREATE TRIGGER field_address_assignment_changed AFTER INSERT OR UPDATE OR DELETE ON territory_block_address FOR EACH ROW EXECUTE FUNCTION field_assignment_changed();
COMMIT;
