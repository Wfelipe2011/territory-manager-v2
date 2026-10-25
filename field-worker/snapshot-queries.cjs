// Fixed, parameterized read shapes for the compiled field snapshot only.
// The original WHERE compiler has already applied all tenant/scope predicates.
const roundFields = { completed:'completed', completedDate:'completed_date', endDate:'end_date', leaveLetter:'leave_letter' };
const dates = row => {
  for (const key of ['completedDate','endDate']) if (row[key] !== null && row[key] !== undefined) row[key] = new Date(typeof row[key] === 'string' && !/[zZ]|[+-][0-9]{2}:[0-9]{2}$/.test(row[key]) ? row[key]+'Z' : row[key]);
  return row;
};
async function load(connection, name, args, sql, params, mode) {
  if (name === 'house' && args.select?.address?.select?.name && args.select?.rounds?.take === 1) {
    const config = args.select.rounds;
    if (Object.keys(config.where || {}).join(',') !== 'roundNumber' || Object.keys(config.select).some(k => !roundFields[k])) return;
    const values = [...params, config.where.roundNumber];
    const round = '(SELECT id,completed,completed_date,end_date,leave_letter FROM round WHERE house_id=h.id AND round_number=$' + values.length + ' ORDER BY id LIMIT 1)';
    if (mode === 'joined') {
      const rows = (await connection.query('SELECT h.*, a.name AS "_addressName", r.id AS "_roundId", r.completed AS "_completed", r.completed_date AS "_completedDate", r.end_date AS "_endDate", r.leave_letter AS "_leaveLetter" FROM ('+sql+') h JOIN address a ON a.id=h."addressId" LEFT JOIN LATERAL '+round+' r ON TRUE', values)).rows;
      return rows.map(row => {
        const result = Object.fromEntries(Object.entries(row).filter(([k])=>!k.startsWith('_')));
        result.address = {name: row._addressName};
        result.rounds = row._roundId == null ? [] : [Object.fromEntries(Object.keys(config.select).map(k=>[k,row['_'+k]]))];
        return result;
      });
    }
    const selection = Object.keys(config.select).flatMap(k=>["'"+k+"'", 'r.'+roundFields[k]]).join(',');
    const rows = (await connection.query(`SELECT h.*, json_build_object('name',a.name) AS address, CASE WHEN r.id IS NULL THEN '[]'::json ELSE json_build_array(json_build_object(${selection})) END AS rounds FROM (${sql}) h JOIN address a ON a.id=h."addressId" LEFT JOIN LATERAL ${round} r ON TRUE`,values)).rows;
    return rows.map(row=>({...row, rounds: row.rounds.map(dates)}));
  }
  if (name === 'territory_block' && args.include?.block?.select?.name && args.include?.signature?.select?.token && args.include?.territory_block_address?.include?.address === true) {
    const query = `SELECT h.*,
      json_build_object('id',b.id,'name',b.name) AS block,
      CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object('key',s.key,'expirationDate',s.expiration_date,'token',s.token) END AS signature,
      coalesce((SELECT json_agg(json_build_object('id',m.id,'registrationStatus',m.registration_status,'territoryBlockId',m.territory_block_id,'addressId',m.address_id,'tenantId',m.tenant_id,
        'address',json_build_object('id',a.id,'name',a.name,'tenantId',a.tenant_id,'zipCode',a.zip_code)) ORDER BY m.id)
        FROM territory_block_address m JOIN address a ON a.id=m.address_id WHERE m.territory_block_id=h.id AND m.registration_status<>'rejected'), '[]'::json) AS territory_block_address
      FROM (`+sql+`) h JOIN block b ON b.id=h."blockId" LEFT JOIN signature s ON s.id=h."signatureId"`;
    const rows = (await connection.query(query, params)).rows;
    for (const row of rows) {
      const names=row.territory_block_address.map(m=>m.address.name).sort((a,b)=>a.localeCompare(b,'pt-BR'));
      if(names.some((name,i)=>i>0&&name.localeCompare(names[i-1],'pt-BR')===0)) return undefined;
    }
    return rows.map(row=>{ if(row.signature?.expirationDate) row.signature.expirationDate=new Date(/[zZ]|[+-][0-9]{2}:[0-9]{2}$/.test(row.signature.expirationDate)?row.signature.expirationDate:row.signature.expirationDate+'Z'); return row; });
  }
}
module.exports = { load };
