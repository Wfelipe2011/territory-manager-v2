BEGIN;

CREATE TABLE block_signature (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES multi_tenancy(id),
  territory_block_id integer NOT NULL REFERENCES territory_block(id) ON DELETE CASCADE,
  round_number integer NOT NULL DEFAULT 0 CHECK (round_number >= 0),
  signature_id integer NOT NULL UNIQUE REFERENCES signature(id) ON DELETE CASCADE,
  UNIQUE (tenant_id, territory_block_id, round_number)
);

-- Metadata extraction only; authentication continues to verify JWTs per request.
-- Fail closed on malformed or mismatched legacy claims. Zero is catalogue scope.
CREATE FUNCTION legacy_block_signature_round(token text, signature_key text, tenant integer, territory integer, block integer)
RETURNS integer LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE payload jsonb; encoded text; n numeric;
BEGIN
  encoded := translate(split_part(token, '.', 2), '-_', '+/');
  encoded := encoded || repeat('=', (4-length(encoded)%4)%4);
  payload := convert_from(decode(encoded, 'base64'), 'UTF8')::jsonb;
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
     OR payload->>'id' IS DISTINCT FROM signature_key
     OR (payload->>'tenantId')::numeric IS DISTINCT FROM tenant
     OR (payload->>'territoryId')::numeric IS DISTINCT FROM territory
     OR (payload->>'blockId')::numeric IS DISTINCT FROM block
     OR jsonb_typeof(payload->'roles') IS DISTINCT FROM 'array'
     OR NOT (payload->'roles' @> '["publisher"]'::jsonb) THEN RETURN NULL; END IF;
  IF payload->>'round' IS NULL THEN RETURN 0; END IF;
  n := (payload->>'round')::numeric;
  IF n < 1 OR n > 2147483647 OR n <> trunc(n) THEN RETURN NULL; END IF;
  RETURN n::integer;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

-- Never silently discard a live legacy grant during cutover.
DO $$
DECLARE invalid_ids integer[];
BEGIN
  SELECT array_agg(tb.id ORDER BY tb.id) INTO invalid_ids
  FROM territory_block tb JOIN signature s ON s.id=tb.signature_id
  WHERE s.expiration_date > now() AND (
    s.tenant_id<>tb.tenant_id OR legacy_block_signature_round(s.token,s.key,tb.tenant_id,tb.territory_id,tb.block_id) IS NULL
  );
  IF invalid_ids IS NOT NULL THEN
    RAISE EXCEPTION 'Inspect live legacy block signature associations before migration: %', invalid_ids;
  END IF;
END $$;

INSERT INTO block_signature(tenant_id,territory_block_id,round_number,signature_id)
SELECT tb.tenant_id,tb.id,legacy_block_signature_round(s.token,s.key,tb.tenant_id,tb.territory_id,tb.block_id),s.id
FROM territory_block tb JOIN signature s ON s.id=tb.signature_id AND s.tenant_id=tb.tenant_id
WHERE legacy_block_signature_round(s.token,s.key,tb.tenant_id,tb.territory_id,tb.block_id) IS NOT NULL;

CREATE FUNCTION validate_block_signature() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM territory_block tb JOIN signature s ON s.id=NEW.signature_id
    WHERE tb.id=NEW.territory_block_id AND tb.tenant_id=NEW.tenant_id AND s.tenant_id=NEW.tenant_id
      AND legacy_block_signature_round(s.token,s.key,tb.tenant_id,tb.territory_id,tb.block_id)=NEW.round_number
  ) THEN RAISE EXCEPTION 'Invalid block signature scope'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER block_signature_validate BEFORE INSERT OR UPDATE ON block_signature FOR EACH ROW EXECUTE FUNCTION validate_block_signature();

-- Compatibility for old fixture/import writers. Never overwrite another scoped grant.
CREATE FUNCTION import_legacy_block_signature() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  IF NEW.signature_id IS NULL THEN RETURN NULL; END IF;
  SELECT legacy_block_signature_round(s.token,s.key,NEW.tenant_id,NEW.territory_id,NEW.block_id) INTO n
    FROM signature s WHERE s.id=NEW.signature_id AND s.tenant_id=NEW.tenant_id;
  IF n IS NOT NULL THEN
    INSERT INTO block_signature(tenant_id,territory_block_id,round_number,signature_id)
      VALUES(NEW.tenant_id,NEW.id,n,NEW.signature_id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER block_signature_legacy_import AFTER INSERT OR UPDATE OF signature_id ON territory_block
FOR EACH ROW EXECUTE FUNCTION import_legacy_block_signature();

CREATE FUNCTION field_block_signature_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE documents jsonb[]; item jsonb; scope record;
BEGIN
  IF TG_OP='INSERT' THEN documents:=ARRAY[to_jsonb(NEW)];
  ELSIF TG_OP='DELETE' THEN documents:=ARRAY[to_jsonb(OLD)];
  ELSE documents:=ARRAY[to_jsonb(OLD),to_jsonb(NEW)]; END IF;
  FOREACH item IN ARRAY documents LOOP
    FOR scope IN
      SELECT bs.tenant_id,tb.territory_id,tb.block_id,bs.round_number
      FROM block_signature bs JOIN territory_block tb ON tb.id=bs.territory_block_id
      WHERE TG_TABLE_NAME='signature' AND bs.signature_id=(item->>'id')::integer
      UNION
      SELECT (item->>'tenant_id')::integer,tb.territory_id,tb.block_id,(item->>'round_number')::integer
      FROM territory_block tb WHERE TG_TABLE_NAME='block_signature' AND tb.id=(item->>'territory_block_id')::integer
      ORDER BY 1,2,3,4
    LOOP
      PERFORM bump_field_revision(scope.tenant_id,scope.territory_id,0,scope.block_id);
      IF scope.round_number>0 THEN PERFORM bump_field_revision(scope.tenant_id,scope.territory_id,scope.round_number,scope.block_id); END IF;
    END LOOP;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER block_signature_revision AFTER INSERT OR UPDATE OR DELETE ON block_signature
FOR EACH ROW EXECUTE FUNCTION field_block_signature_changed();
CREATE TRIGGER scoped_signature_revision AFTER UPDATE ON signature
FOR EACH ROW EXECUTE FUNCTION field_block_signature_changed();

-- Invalidate pre-cutover snapshots in the same transaction.
DO $$ DECLARE scope record; BEGIN
 FOR scope IN SELECT DISTINCT bs.tenant_id,tb.territory_id,tb.block_id FROM block_signature bs JOIN territory_block tb ON tb.id=bs.territory_block_id ORDER BY 1,2,3 LOOP
   PERFORM bump_field_revision(scope.tenant_id,scope.territory_id,0,scope.block_id);
 END LOOP;
END $$;
COMMIT;
