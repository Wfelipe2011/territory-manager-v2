// Source transforms are laboratory-only and fail closed if the reviewed source changes.
function replace(source, from, to) {
  if (source.split(from).length !== 2) throw Error('Candidate source changed: '+from.slice(0,70));
  return source.replace(from,to);
}
function transform(name, source, variant) {
  if (variant === 'copies' && name === 'read-model.cjs') {
    source=replace(source,'const saved=structuredClone(payload);','const saved={...payload,block:payload.block?{...payload.block}:payload.block};');
    // pg returns privately owned JSON per query. No completed payload is cached in JS.
    // Store is serialized before snapshot mutates the owned object; followers still clone.
    source=replace(source,'payload=structuredClone(payload);','// Payload is exclusively owned by this builder.');
  }
  if (variant === 'roundtrips' && name === 'read-model.cjs') {
    source=replace(source,"'SELECT payload FROM field_read_model WHERE tenant_id=$1 AND territory_id=$2 AND block_id=$3 AND round_number=$4 AND revision=$5'", "`SELECT (SELECT payload FROM field_read_model WHERE tenant_id=$1 AND territory_id=$2 AND block_id=$3 AND round_number=$4 AND revision=$5) AS payload, (SELECT json_build_object('key',s.key,'expirationDate',to_char(s.expiration_date,'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),'token',s.token) FROM territory_block l JOIN block_signature bs ON bs.territory_block_id=l.id AND bs.tenant_id=l.tenant_id AND bs.round_number=coalesce($6::integer,0) JOIN signature s ON s.id=bs.signature_id WHERE l.tenant_id=$1 AND l.territory_id=$2 AND l.block_id=$3 AND l.registration_status<>'rejected' LIMIT 1) AS signature`");
    source=replace(source,"AS signature`,key);","AS signature`,[...key,user.round==null?0:+user.round]);");
    source=replace(source,'const signature=await connection.query(`SELECT s.key,s.expiration_date AS "expirationDate",s.token FROM territory_block l JOIN block_signature bs ON bs.territory_block_id=l.id AND bs.tenant_id=l.tenant_id AND bs.round_number=$4 JOIN signature s ON s.id=bs.signature_id WHERE l.tenant_id=$1 AND l.territory_id=$2 AND l.block_id=$3 AND l.registration_status<>\'rejected\' LIMIT 1`,[...key.slice(0,3),user.round==null?0:+user.round]);','const signature={rows:cached.rows[0]?.signature?[cached.rows[0].signature]:[]};');
  }
  if (variant === 'native' && name === 'pg-adapter.cjs') {
    source=replace(source,"const { Pool, types } = require('pg');", "const { Pool } = require('./experiments/native-pool.cjs'); const types={setTypeParser(){}};");
  }
  return source;
}
module.exports={transform};
