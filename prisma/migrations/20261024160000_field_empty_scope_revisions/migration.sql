BEGIN;
-- Include assigned but empty blocks, tenant settings, and both sides of moves.
-- Acquire revision locks in a deterministic order across OLD and NEW scopes.
CREATE OR REPLACE FUNCTION field_metadata_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE documents jsonb[]; s record;
BEGIN
  IF TG_OP = 'INSERT' THEN documents := ARRAY[to_jsonb(NEW)];
  ELSIF TG_OP = 'DELETE' THEN documents := ARRAY[to_jsonb(OLD)];
  ELSE documents := ARRAY[to_jsonb(OLD), to_jsonb(NEW)]; END IF;
  FOR s IN
    WITH affected AS (
      SELECT r.tenant_id, r.territory_id, r.round_number, r.block_id
      FROM round r JOIN house h ON h.id = r.house_id CROSS JOIN unnest(documents) AS document(d)
      WHERE r.tenant_id = (d->>'tenant_id')::integer AND (
        (TG_TABLE_NAME = 'house' AND h.id = (d->>'id')::integer)
        OR (TG_TABLE_NAME = 'address' AND h.address_id = (d->>'id')::integer)
        OR (TG_TABLE_NAME = 'block' AND r.block_id = (d->>'id')::integer)
      )
      UNION
      SELECT tb.tenant_id, tb.territory_id, ri.round_number, tb.block_id
      FROM territory_block tb JOIN round_info ri ON ri.tenant_id = tb.tenant_id
      CROSS JOIN unnest(documents) AS document(d)
      WHERE tb.tenant_id = CASE WHEN TG_TABLE_NAME = 'multi_tenancy' THEN (d->>'id')::integer ELSE (d->>'tenant_id')::integer END AND (
        (TG_TABLE_NAME IN ('house', 'territory_block') AND tb.territory_id = (d->>'territory_id')::integer AND tb.block_id = (d->>'block_id')::integer)
        OR (TG_TABLE_NAME = 'territory_overseer' AND tb.territory_id = (d->>'territory_id')::integer AND ri.round_number = (d->>'round_number')::integer)
        OR (TG_TABLE_NAME = 'territory' AND tb.territory_id = (d->>'id')::integer)
        OR (TG_TABLE_NAME = 'block' AND tb.block_id = (d->>'id')::integer)
        OR (TG_TABLE_NAME = 'address' AND EXISTS (SELECT 1 FROM territory_block_address tba WHERE tba.territory_block_id = tb.id AND tba.address_id = (d->>'id')::integer))
        OR (TG_TABLE_NAME = 'round_info' AND ri.round_number = (d->>'round_number')::integer)
        OR TG_TABLE_NAME = 'multi_tenancy'
        OR (TG_TABLE_NAME = 'signature' AND tb.signature_id = (d->>'id')::integer)
      )
      UNION
      SELECT t.tenant_id, t.id, ri.round_number, 0
      FROM territory t JOIN round_info ri ON ri.tenant_id = t.tenant_id
      CROSS JOIN unnest(documents) AS document(d)
      WHERE t.tenant_id = CASE WHEN TG_TABLE_NAME = 'multi_tenancy' THEN (d->>'id')::integer ELSE (d->>'tenant_id')::integer END AND (
        (TG_TABLE_NAME = 'territory' AND t.id = (d->>'id')::integer)
        OR (TG_TABLE_NAME = 'territory_overseer' AND t.id = (d->>'territory_id')::integer AND ri.round_number = (d->>'round_number')::integer)
        OR (TG_TABLE_NAME = 'round_info' AND ri.round_number = (d->>'round_number')::integer)
        OR TG_TABLE_NAME = 'multi_tenancy'
      )
    ) SELECT * FROM affected ORDER BY tenant_id, territory_id, round_number, block_id
  LOOP
    PERFORM bump_field_revision(s.tenant_id, s.territory_id, s.round_number, s.block_id);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER field_tenant_changed AFTER UPDATE ON multi_tenancy FOR EACH ROW EXECUTE FUNCTION field_metadata_changed();
CREATE TRIGGER field_signature_changed AFTER UPDATE ON signature FOR EACH ROW EXECUTE FUNCTION field_metadata_changed();
COMMIT;
