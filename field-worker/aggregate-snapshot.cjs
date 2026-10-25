// Block-only SQL aggregation. No schema mutation, no data cache.
// Values originate from the already-authorized scope. Cursor is read by the
// original poll loop on this SAME RepeatableRead transaction connection.
const jwt = require('jsonwebtoken');
const { housePermissions } = require('../dist/modules/house/house-permissions.js');
const { pairSuggestion } = require('../dist/modules/field/pair-suggestion.js');
const numeric = new Intl.Collator('pt-BR', { numeric: true });
const iso = column => `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const SQL = `WITH links AS MATERIALIZED (
 SELECT l.*,b.name AS block_name,s.key AS signature_key,s.expiration_date,s.token
 FROM territory_block l JOIN block b ON b.id=l.block_id LEFT JOIN signature s ON s.id=l.signature_id
 WHERE l.tenant_id=$1 AND l.territory_id=$2 AND l.block_id=$3 AND l.registration_status<>'rejected'
), mappings AS MATERIALIZED (
 SELECT m.*,a.name,a.zip_code FROM territory_block_address m JOIN address a ON a.id=m.address_id
 JOIN links l ON l.id=m.territory_block_id WHERE m.registration_status<>'rejected'
), requests AS MATERIALIZED (
 SELECT id,entity,action,target_id FROM change_request
 WHERE tenant_id=$1 AND territory_id=$2 AND block_id=$3 AND status='pending'
), houses AS MATERIALIZED (
 SELECT h.*,a.name AS address_name,r.id AS round_id,r.completed,r.completed_date,r.end_date,r.leave_letter
 FROM house h JOIN links l ON l.block_id=h.block_id JOIN address a ON a.id=h.address_id
 LEFT JOIN LATERAL (SELECT id,completed,completed_date,end_date,leave_letter FROM round
   WHERE house_id=h.id AND round_number=$4 ORDER BY id LIMIT 1) r ON TRUE
 WHERE h.tenant_id=$1 AND h.territory_id=$2 AND h.registration_status<>'rejected' AND h.number<>'ghost'
 AND (h.territory_block_address_id IS NULL OR h.territory_block_address_id IN(SELECT id FROM mappings))
), streets AS (
 SELECT address_id AS id,id AS mapping_id,name,zip_code,registration_status::text AS registration_status FROM mappings
 UNION ALL
 SELECT DISTINCT h.address_id,NULL::integer,h.address_name,NULL::text,'approved' FROM houses h
 WHERE NOT EXISTS(SELECT 1 FROM mappings m WHERE m.address_id=h.address_id)
), totals AS (
 SELECT count(*)::int AS catalog,count(*) FILTER(WHERE round_id IS NOT NULL)::int AS total,
 count(*) FILTER(WHERE round_id IS NOT NULL AND completed)::int AS completed,
 max(completed_date) FILTER(WHERE round_id IS NOT NULL) AS last_worked FROM houses
)
SELECT json_build_object(
 'territory',(SELECT json_build_object('id',id,'name',name,'imageUrl',image_url) FROM territory WHERE id=$2 AND tenant_id=$1),
 'tenancy',(SELECT json_build_object('name',name,'city',city,'state',state,'phone',phone) FROM multi_tenancy WHERE id=$1),
 'block',(SELECT json_build_object('id',l.block_id,'name',l.block_name,'registrationStatus',l.registration_status,
   'pendingRequest',(SELECT json_build_object('id',id,'action',action) FROM requests WHERE entity='block' AND target_id=l.block_id ORDER BY id DESC LIMIT 1),
   'total',t.total,'catalogTotal',t.catalog,'withoutRound',t.catalog-t.total,'completed',t.completed,'pending',t.total-t.completed,
   'lastWorkedAt',${iso('t.last_worked')},'_signature',CASE WHEN l.signature_key IS NULL THEN NULL ELSE json_build_object('key',l.signature_key,'expirationDate',${iso('l.expiration_date')},'token',l.token) END
 ) FROM links l CROSS JOIN totals t),
 'streets',coalesce((SELECT json_agg(json_build_object('id',s.id,'mappingId',s.mapping_id,'name',s.name,'zipCode',s.zip_code,'registrationStatus',s.registration_status,
   'completed',g.completed,'pending',g.total-g.completed,'total',g.total,'catalogTotal',g.catalog,'withoutRound',g.catalog-g.total,
   'pendingRequest',(SELECT json_build_object('id',id,'action',action) FROM requests WHERE entity='street' AND target_id IS NOT DISTINCT FROM s.mapping_id ORDER BY id DESC LIMIT 1),
   'houses',g.houses
 )) FROM streets s CROSS JOIN LATERAL (
   SELECT count(*)::int AS catalog,count(*) FILTER(WHERE round_id IS NOT NULL)::int AS total,
   count(*) FILTER(WHERE round_id IS NOT NULL AND completed)::int AS completed,
   coalesce(json_agg(json_build_object('id',h.id,'number',h.number,'legend',h.legend,'dontVisit',h.dont_visit,'complement',h.complement,
     'registrationStatus',h.registration_status,'pendingRequest',(SELECT json_build_object('id',id,'action',action) FROM requests WHERE entity='house' AND target_id=h.id ORDER BY id DESC LIMIT 1),
     'reportType',NULL,'hasRound',h.round_id IS NOT NULL,'status',CASE WHEN h.round_id IS NOT NULL THEN h.completed ELSE false END,
     'leaveLetter',CASE WHEN h.round_id IS NOT NULL THEN h.leave_letter ELSE false END,
     'readOnly',h.round_id IS NULL OR h.end_date IS NOT NULL OR $5,
     '_order',h."order",'_completedDate',${iso('h.completed_date')},'_endDate',${iso('h.end_date')}
   )), '[]'::json) AS houses FROM houses h WHERE h.address_id=s.id
 ) g), '[]'::json),
 '_duplicateRequests',EXISTS(SELECT 1 FROM requests GROUP BY entity,target_id HAVING count(*)>1)
) AS payload`;

async function snapshot(connection,user,scope,info) {
  const data = (await connection.query(SQL,[user.tenantId,user.territoryId,scope.blockId,scope.round??-1,info?.status==='closed'])).rows[0].payload;
  const names=data.streets.map(s=>s.name).sort((a,b)=>a.localeCompare(b,'pt-BR'));
  if (names.some((name,i)=>i>0&&name.localeCompare(names[i-1],'pt-BR')===0)) return undefined;
  if (data._duplicateRequests) return undefined; // Preserve unspecified legacy request ordering via original path.
  delete data._duplicateRequests;
  for (const street of data.streets) {
    street.houses.sort((a,b)=>(a._order??Number.MAX_SAFE_INTEGER)-(b._order??Number.MAX_SAFE_INTEGER)||numeric.compare(a.number,b.number)||a.id-b.id);
    const numbers=street.houses.map(h=>h.number).sort(numeric.compare);
    street.firstNumber=numbers[0]??null; street.lastNumber=numbers.at(-1)??null;
    for (const house of street.houses) {
      Object.assign(house,housePermissions({ completed:house.status,completedDate:house._completedDate?new Date(house._completedDate):null,
        endDate:info?.status==='closed'?info.closedAt??new Date():house._endDate?new Date(house._endDate):null,
        dontVisit:house.dontVisit,reportType:null,hasRound:house.hasRound,published:true },scope.hours));
      delete house._order; delete house._completedDate; delete house._endDate;
    }
  }
  data.streets.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
  if(data.block) {
    const sig=data.block._signature;
    data.block.signature=null;
    if(!user.roles.includes('publisher') && sig?.expirationDate && new Date(sig.expirationDate)>new Date()) {
      const payload=jwt.decode(sig.token);
      if(payload && (payload.round==null?null:+payload.round)===(user.round==null?null:+user.round)) data.block.signature={key:sig.key,expirationDate:sig.expirationDate};
    }
    delete data.block._signature;
    Object.assign(data.block,pairSuggestion(data.block.pending));
  }
  return {territory:data.territory,tenancy:data.tenancy,roundInfo:info??{name:'Cadastro de endereços',theme:'default',colorPrimary:null,colorSecondary:null},
    workRoundNumber:scope.round,capabilities:{canEditStructure:scope.canEditStructure,canReportHouses:true},block:data.block,streets:data.streets};
}
module.exports={SQL,snapshot};
