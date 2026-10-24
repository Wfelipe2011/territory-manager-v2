BEGIN;
-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('open', 'closed', 'uninitialized');

-- CreateEnum
CREATE TYPE "ChangeEntity" AS ENUM ('house', 'street', 'block');

-- CreateEnum
CREATE TYPE "ChangeAction" AS ENUM ('create', 'update', 'delete');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "house" ADD COLUMN     "registration_status" "RegistrationStatus" NOT NULL DEFAULT 'approved';

-- AlterTable
ALTER TABLE "multi_tenancy" ADD COLUMN     "requests_revision" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "territory_block" ADD COLUMN     "registration_status" "RegistrationStatus" NOT NULL DEFAULT 'approved';

-- AlterTable
ALTER TABLE "territory_block_address" ADD COLUMN     "registration_status" "RegistrationStatus" NOT NULL DEFAULT 'approved';

-- AlterTable
ALTER TABLE "territory_overseer" ALTER COLUMN "round_number" DROP NOT NULL;

-- AlterTable
ALTER TABLE "round_info" ADD COLUMN     "closed_at" TIMESTAMP(3),
ADD COLUMN     "started_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "status" "RoundStatus" NOT NULL DEFAULT 'open',
ADD COLUMN     "type_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "signature" ADD COLUMN     "can_edit_structure" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "change_request" (
    "id" SERIAL NOT NULL,
    "tenant_id" INTEGER NOT NULL,
    "entity" "ChangeEntity" NOT NULL,
    "action" "ChangeAction" NOT NULL,
    "status" "ChangeStatus" NOT NULL DEFAULT 'pending',
    "territory_id" INTEGER NOT NULL,
    "block_id" INTEGER,
    "address_id" INTEGER,
    "target_id" INTEGER,
    "parent_request_id" INTEGER,
    "before_data" JSONB,
    "proposed_data" JSONB NOT NULL,
    "observations" TEXT NOT NULL,
    "requested_by_user_id" INTEGER,
    "requested_by_name" TEXT,
    "source_signature_key" TEXT,
    "requested_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewed_at" TIMESTAMP(3),
    "reviewer_id" INTEGER,
    "review_reason" TEXT,
    "is_legacy" BOOLEAN NOT NULL DEFAULT false,
    "legacy_house_id" INTEGER,
    "imported_at" TIMESTAMP(3),
    "history" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "change_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "change_request_legacy_house_id_key" ON "change_request"("legacy_house_id");

-- CreateIndex
CREATE INDEX "change_request_tenant_id_status_updated_at_idx" ON "change_request"("tenant_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "change_request_tenant_id_territory_id_block_id_idx" ON "change_request"("tenant_id", "territory_id", "block_id");

-- CreateIndex
CREATE INDEX "change_request_tenant_id_entity_target_id_idx" ON "change_request"("tenant_id", "entity", "target_id");

-- CreateIndex
CREATE INDEX "change_request_parent_request_id_idx" ON "change_request"("parent_request_id");

-- AddForeignKey
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "multi_tenancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_parent_request_id_fkey" FOREIGN KEY ("parent_request_id") REFERENCES "change_request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserve the actual lifecycle/types before houses can be removed independently.
UPDATE round_info ri SET
 status = CASE WHEN EXISTS (SELECT 1 FROM round r WHERE r.tenant_id=ri.tenant_id AND r.round_number=ri.round_number AND r.end_date IS NULL) THEN 'open'::"RoundStatus"
 WHEN EXISTS (SELECT 1 FROM round r WHERE r.tenant_id=ri.tenant_id AND r.round_number=ri.round_number) THEN 'closed'::"RoundStatus" ELSE 'uninitialized'::"RoundStatus" END,
 started_at = (SELECT min(start_date) FROM round r WHERE r.tenant_id=ri.tenant_id AND r.round_number=ri.round_number),
 closed_at = CASE WHEN NOT EXISTS (SELECT 1 FROM round r WHERE r.tenant_id=ri.tenant_id AND r.round_number=ri.round_number AND r.end_date IS NULL)
 THEN (SELECT max(end_date) FROM round r WHERE r.tenant_id=ri.tenant_id AND r.round_number=ri.round_number) ELSE NULL END,
 type_ids = ARRAY(SELECT DISTINCT t.type_id FROM round r JOIN territory t ON t.id=r.territory_id WHERE r.tenant_id=ri.tenant_id AND r.round_number=ri.round_number ORDER BY t.type_id);
UPDATE round_info ri SET type_ids=ARRAY(SELECT t.id FROM type t WHERE t.tenant_id=ri.tenant_id AND t.name=ri.type ORDER BY t.id) WHERE cardinality(type_ids)=0;

-- Import exact legacy state. No rollback or deletion of houses/rounds during migration.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM house WHERE report_type IN ('update','remove') AND jsonb_typeof(backup_data) IS DISTINCT FROM 'object') THEN
  RAISE EXCEPTION 'Legacy report without valid backup; inspect before migration';
 END IF;
END $$;
INSERT INTO change_request (tenant_id,entity,action,status,territory_id,block_id,address_id,target_id,before_data,proposed_data,observations,requested_at,updated_at,is_legacy,legacy_house_id,imported_at,history)
SELECT h.tenant_id,'house'::"ChangeEntity",CASE h.report_type WHEN 'add' THEN 'create'::"ChangeAction" WHEN 'remove' THEN 'delete'::"ChangeAction" ELSE 'update'::"ChangeAction" END,
'pending'::"ChangeStatus",h.territory_id,h.block_id,h.address_id,h.id,h.backup_data,
jsonb_build_object('number',h.number,'legend',h.legend,'dontVisit',h.dont_visit,'complement',h.complement,'phone',h.phone,'order',h."order",'_context',jsonb_build_object('territory',t.name,'block',b.name,'street',a.name)),
coalesce(h.observations,'Importado do fluxo anterior'),NULL,now(),true,h.id,now(),jsonb_build_array(jsonb_build_object('event','legacy_import','at',now()))
FROM house h JOIN territory t ON t.id=h.territory_id JOIN block b ON b.id=h.block_id JOIN address a ON a.id=h.address_id WHERE h.report_type IS NOT NULL;
CREATE UNIQUE INDEX change_request_one_pending_target ON change_request(tenant_id,entity,target_id) WHERE status='pending' AND target_id IS NOT NULL;
ALTER TABLE change_request ADD CONSTRAINT change_request_version_positive CHECK (version > 0);

-- Catalogue revisions always use round zero: they work before any round exists.
CREATE FUNCTION field_catalog_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE documents jsonb[]; s record;
BEGIN
 IF TG_OP='INSERT' THEN documents:=ARRAY[to_jsonb(NEW)]; ELSIF TG_OP='DELETE' THEN documents:=ARRAY[to_jsonb(OLD)]; ELSE documents:=ARRAY[to_jsonb(OLD),to_jsonb(NEW)]; END IF;
 FOR s IN WITH affected AS (
 SELECT (d->>'tenant_id')::int tenant_id,(d->>'territory_id')::int territory_id,coalesce((d->>'block_id')::int,0) block_id
 FROM unnest(documents) x(d) WHERE TG_TABLE_NAME IN ('house','territory_block','territory_overseer','change_request')
 UNION
 SELECT tb.tenant_id,tb.territory_id,tb.block_id FROM territory_block tb CROSS JOIN unnest(documents) x(d)
 WHERE (TG_TABLE_NAME='territory_block_address' AND tb.id=(d->>'territory_block_id')::int)
 OR (TG_TABLE_NAME='block' AND tb.block_id=(d->>'id')::int)
 OR (TG_TABLE_NAME='address' AND EXISTS(SELECT 1 FROM territory_block_address tba WHERE tba.territory_block_id=tb.id AND tba.address_id=(d->>'id')::int))
 OR (TG_TABLE_NAME='signature' AND tb.signature_id=(d->>'id')::int)
 UNION
 SELECT t.tenant_id,t.id,0 FROM territory t CROSS JOIN unnest(documents) x(d)
 WHERE (TG_TABLE_NAME='territory' AND t.id=(d->>'id')::int)
 OR (TG_TABLE_NAME IN ('round_info','parameter') AND t.tenant_id=(d->>'tenant_id')::int)
 OR (TG_TABLE_NAME='multi_tenancy' AND t.tenant_id=(d->>'id')::int)
 OR (TG_TABLE_NAME='signature' AND EXISTS(SELECT 1 FROM territory_overseer o WHERE o.territory_id=t.id AND o.signature_id=(d->>'id')::int))
 UNION
 SELECT tb.tenant_id,tb.territory_id,tb.block_id FROM territory_block tb CROSS JOIN unnest(documents) x(d)
 WHERE TG_TABLE_NAME IN ('round_info','parameter') AND tb.tenant_id=(d->>'tenant_id')::int
 ) SELECT DISTINCT * FROM affected WHERE tenant_id IS NOT NULL AND territory_id IS NOT NULL ORDER BY tenant_id,territory_id,block_id
 LOOP PERFORM bump_field_revision(s.tenant_id,s.territory_id,0,s.block_id); END LOOP;
 RETURN NULL;
END $$;
CREATE TRIGGER catalog_house AFTER INSERT OR UPDATE OR DELETE ON house FOR EACH ROW EXECUTE FUNCTION field_catalog_changed();
CREATE TRIGGER catalog_tb AFTER INSERT OR UPDATE OR DELETE ON territory_block FOR EACH ROW EXECUTE FUNCTION field_catalog_changed();
CREATE TRIGGER catalog_tba AFTER INSERT OR UPDATE OR DELETE ON territory_block_address FOR EACH ROW EXECUTE FUNCTION field_catalog_changed();
CREATE TRIGGER catalog_territory AFTER INSERT OR UPDATE OR DELETE ON territory FOR EACH ROW EXECUTE FUNCTION field_catalog_changed();
CREATE TRIGGER catalog_block AFTER UPDATE OR DELETE ON block FOR EACH ROW EXECUTE FUNCTION field_catalog_changed();
CREATE TRIGGER catalog_address AFTER UPDATE OR DELETE ON address FOR EACH ROW EXECUTE FUNCTION field_catalog_changed();
CREATE TRIGGER catalog_round_info AFTER INSERT OR UPDATE OR DELETE ON round_info FOR EACH ROW EXECUTE FUNCTION field_catalog_changed();
CREATE TRIGGER catalog_signature AFTER UPDATE ON signature FOR EACH ROW EXECUTE FUNCTION field_catalog_changed();
CREATE TRIGGER catalog_overseer AFTER INSERT OR UPDATE OR DELETE ON territory_overseer FOR EACH ROW EXECUTE FUNCTION field_catalog_changed();
CREATE TRIGGER catalog_parameter AFTER INSERT OR UPDATE OR DELETE ON parameter FOR EACH ROW EXECUTE FUNCTION field_catalog_changed();
CREATE TRIGGER catalog_request AFTER INSERT OR UPDATE ON change_request FOR EACH ROW EXECUTE FUNCTION field_catalog_changed();
CREATE FUNCTION bump_requests_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE multi_tenancy SET requests_revision=requests_revision+1 WHERE id=NEW.tenant_id; RETURN NULL; END $$;
CREATE TRIGGER requests_revision AFTER INSERT OR UPDATE ON change_request FOR EACH ROW EXECUTE FUNCTION bump_requests_revision();
DROP TRIGGER field_tenant_changed ON multi_tenancy;
CREATE TRIGGER field_tenant_changed AFTER UPDATE ON multi_tenancy FOR EACH ROW WHEN ((OLD.name,OLD.city,OLD.state,OLD.phone) IS DISTINCT FROM (NEW.name,NEW.city,NEW.state,NEW.phone)) EXECUTE FUNCTION field_metadata_changed();
CREATE TRIGGER catalog_tenant AFTER UPDATE ON multi_tenancy FOR EACH ROW WHEN ((OLD.name,OLD.city,OLD.state,OLD.phone) IS DISTINCT FROM (NEW.name,NEW.city,NEW.state,NEW.phone)) EXECUTE FUNCTION field_catalog_changed();
COMMIT;
