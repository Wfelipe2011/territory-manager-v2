const base = require('../aggregate-snapshot.cjs');
const needle = `LEFT JOIN LATERAL (SELECT id,completed,completed_date,end_date,leave_letter FROM round
   WHERE house_id=h.id AND round_number=$4 ORDER BY id LIMIT 1) r ON TRUE`;
const rounds = `SELECT DISTINCT ON (house_id) house_id,id,completed,completed_date,end_date,leave_letter
    FROM round WHERE round_number=$4 AND house_id IN (
      SELECT hx.id FROM house hx WHERE hx.tenant_id=$1 AND hx.territory_id=$2 AND hx.block_id=$3)
    ORDER BY house_id,id`;
const houses = '), houses AS MATERIALIZED (';
const promoted = base.SQL.includes('chosen_rounds AS MATERIALIZED');
if (!promoted && (!base.SQL.includes(needle) || !base.SQL.includes(houses))) throw Error('Snapshot SQL changed; review experimental rewrite');
// Force selection once: an inline DISTINCT subquery was rescanned 150 times
// in preflight EXPLAIN and was rejected before the capacity campaign.
const SQL = promoted ? base.SQL : base.SQL.replace(houses, `), chosen_rounds AS MATERIALIZED (${rounds}\n${houses}`)
  .replace(needle, 'LEFT JOIN chosen_rounds r ON r.house_id=h.id');
module.exports = { SQL, originalSQL: base.SQL };
