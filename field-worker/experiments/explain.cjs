// Executes SELECT plans only, exclusively on the isolated synthetic DB.
const { Client } = require('pg');
const { SQL, originalSQL } = require('./sql-snapshot.cjs');
(async () => {
  const url = new URL(process.env.DATABASE_URL);
  if (url.hostname !== 'db' || url.pathname !== '/territory_manager_peak_load') throw Error('Synthetic database required');
  url.search = '';
  const client = new Client({ connectionString: url.toString() }); await client.connect();
  try {
    const { rows } = await client.query(`SELECT tenant_id,territory_id,block_id FROM house WHERE number<>'ghost' AND registration_status<>'rejected' ORDER BY id LIMIT 1`);
    const row = rows[0], params = [row.tenant_id, row.territory_id, row.block_id, 8, false];
    const output = {};
    for (const [name, text] of [['original', originalSQL], ['setBasedRounds', SQL]]) {
      output[name] = (await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + text, params)).rows[0]['QUERY PLAN'];
    }
    console.log(JSON.stringify(output));
  } finally { await client.end(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
