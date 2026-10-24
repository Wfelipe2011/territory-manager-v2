BEGIN;
-- Revisions are changed by the database in the SAME transaction as domain data.
CREATE TABLE field_revision (
  tenant_id integer NOT NULL,
  territory_id integer NOT NULL,
  round_number integer NOT NULL,
  block_id integer NOT NULL DEFAULT 0,
  revision bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, territory_id, round_number, block_id)
);

CREATE TABLE field_session (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL,
  territory_id integer NOT NULL,
  round_number integer NOT NULL,
  block_id integer,
  address_id integer,
  client_id text NOT NULL,
  tab_id text NOT NULL,
  signature_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz
);
CREATE UNIQUE INDEX field_session_open_idx ON field_session (tenant_id, client_id, tab_id) WHERE disconnected_at IS NULL;
CREATE INDEX field_session_presence_idx ON field_session (tenant_id, territory_id, round_number, last_seen_at);
CREATE INDEX field_session_history_idx ON field_session (created_at);

CREATE FUNCTION bump_field_revision(t integer, territory integer, n integer, b integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO field_revision (tenant_id, territory_id, round_number, block_id)
  VALUES (t, territory, n, 0)
  ON CONFLICT (tenant_id, territory_id, round_number, block_id)
  DO UPDATE SET revision = field_revision.revision + 1;
  IF b > 0 THEN
    INSERT INTO field_revision (tenant_id, territory_id, round_number, block_id)
    VALUES (t, territory, n, b)
    ON CONFLICT (tenant_id, territory_id, round_number, block_id)
    DO UPDATE SET revision = field_revision.revision + 1;
  END IF;
END $$;

-- Transition tables aggregate bulk round imports into one bump per scope.
CREATE FUNCTION field_round_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s record; statement text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    statement := 'SELECT DISTINCT tenant_id, territory_id, round_number, block_id FROM new_rounds';
  ELSIF TG_OP = 'DELETE' THEN
    statement := 'SELECT DISTINCT tenant_id, territory_id, round_number, block_id FROM old_rounds';
  ELSE
    statement := 'SELECT tenant_id, territory_id, round_number, block_id FROM new_rounds UNION SELECT tenant_id, territory_id, round_number, block_id FROM old_rounds';
  END IF;
  FOR s IN EXECUTE statement || ' ORDER BY tenant_id, territory_id, round_number, block_id' LOOP
    PERFORM bump_field_revision(s.tenant_id, s.territory_id, s.round_number, s.block_id);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER field_round_insert AFTER INSERT ON round REFERENCING NEW TABLE AS new_rounds FOR EACH STATEMENT EXECUTE FUNCTION field_round_changed();
CREATE TRIGGER field_round_update AFTER UPDATE ON round REFERENCING OLD TABLE AS old_rounds NEW TABLE AS new_rounds FOR EACH STATEMENT EXECUTE FUNCTION field_round_changed();
CREATE TRIGGER field_round_delete AFTER DELETE ON round REFERENCING OLD TABLE AS old_rounds FOR EACH STATEMENT EXECUTE FUNCTION field_round_changed();

CREATE FUNCTION field_metadata_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d jsonb; documents jsonb[]; s record; t integer; territory integer; entity integer;
BEGIN
  IF TG_OP = 'INSERT' THEN documents := ARRAY[to_jsonb(NEW)];
  ELSIF TG_OP = 'DELETE' THEN documents := ARRAY[to_jsonb(OLD)];
  ELSE documents := ARRAY[to_jsonb(OLD), to_jsonb(NEW)]; END IF;
  FOREACH d IN ARRAY documents LOOP
    t := (d->>'tenant_id')::integer;
    entity := (d->>'id')::integer;
    territory := CASE WHEN TG_TABLE_NAME = 'territory' THEN entity ELSE (d->>'territory_id')::integer END;
    FOR s IN
      SELECT DISTINCT r.tenant_id, r.territory_id, r.round_number, r.block_id
      FROM round r JOIN house h ON h.id = r.house_id
      WHERE r.tenant_id = t AND (
        (TG_TABLE_NAME IN ('territory', 'territory_overseer', 'territory_block') AND r.territory_id = territory)
        OR (TG_TABLE_NAME = 'house' AND h.id = entity)
        OR (TG_TABLE_NAME = 'address' AND h.address_id = entity)
        OR (TG_TABLE_NAME = 'block' AND r.block_id = entity)
        OR (TG_TABLE_NAME = 'round_info' AND r.round_number = (d->>'round_number')::integer)
      ) ORDER BY r.tenant_id, r.territory_id, r.round_number, r.block_id
    LOOP
      PERFORM bump_field_revision(s.tenant_id, s.territory_id, s.round_number, s.block_id);
    END LOOP;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER field_house_changed AFTER INSERT OR UPDATE OR DELETE ON house FOR EACH ROW EXECUTE FUNCTION field_metadata_changed();
CREATE TRIGGER field_address_changed AFTER UPDATE ON address FOR EACH ROW EXECUTE FUNCTION field_metadata_changed();
CREATE TRIGGER field_block_changed AFTER UPDATE ON block FOR EACH ROW EXECUTE FUNCTION field_metadata_changed();
CREATE TRIGGER field_territory_changed AFTER UPDATE ON territory FOR EACH ROW EXECUTE FUNCTION field_metadata_changed();
CREATE TRIGGER field_round_info_changed AFTER UPDATE ON round_info FOR EACH ROW EXECUTE FUNCTION field_metadata_changed();
CREATE TRIGGER field_overseer_changed AFTER INSERT OR UPDATE OR DELETE ON territory_overseer FOR EACH ROW EXECUTE FUNCTION field_metadata_changed();
CREATE TRIGGER field_block_signature_changed AFTER UPDATE ON territory_block FOR EACH ROW EXECUTE FUNCTION field_metadata_changed();

-- Preserve the old session history. Open legacy sessions end at cutover.
UPDATE socket SET disconnected_at = now() WHERE disconnected_at IS NULL;
CREATE VIEW field_session_history AS
SELECT id::bigint, "socketId" AS socket_id, room, created_at, disconnected_at, tenant_id FROM socket
UNION ALL
SELECT -id::bigint, client_id AS socket_id,
       territory_id || '-' || COALESCE(block_id, 0) || '-' || COALESCE(address_id, 0) || '-' || round_number AS room,
       created_at,
       CASE WHEN last_seen_at <= now() - interval '60 seconds'
            THEN COALESCE(disconnected_at, last_seen_at + interval '60 seconds')
            ELSE disconnected_at END,
       tenant_id FROM field_session;

COMMIT;
