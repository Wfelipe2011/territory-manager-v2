// Laboratory-only adapter for the actual Field/FieldAccess/CatalogRound READ flow.
// No Prisma client/engine; schema names come from DMMF and values are parameters.
// Unsupported operations fail closed. Writes are limited to the original presence SQL.
const { Pool, types } = require('pg');
const specialized = require('./snapshot-queries.cjs');
types.setTypeParser(1114, value => new Date(value.replace(' ', 'T') + 'Z'));
const quote = value => '"' + value.replace(/"/g, '""') + '"';
// pg normally encodes Date in process-local timezone. PostgreSQL timestamp
// WITHOUT timezone ignores that offset; Prisma sends UTC calendar components.
// Normalize parameters as well as result parsing, or expiration checks can drift.
const parameter = value => value instanceof Date ? value.toISOString() : value;

module.exports = function createAdapter(connectionString, models) {
  const mode = process.env.LAB_SNAPSHOT_MODE || 'baseline';
  if (!['baseline','joined','aggregate'].includes(mode)) throw Error('Unknown snapshot mode');
  const counters = { queries: 0, queryMs: 0, acquisitions: 0, acquireMs: 0, transactions: 0, transactionMs: 0 };
  const modelMap = new Map(models.map(model => [model.name, model]));
  const url = new URL(connectionString);
  const max = Number(url.searchParams.get('connection_limit') || 10);
  if (!Number.isInteger(max) || max < 1 || max > 64) throw Error('Invalid pool size');
  url.search = '';
  const pool = new Pool({ connectionString: url.toString(), max, connectionTimeoutMillis: 2000 });
  pool.on('error', error => console.error('Idle pg connection error:', error.message));

  function relationKeys(model, relation) {
    const target = modelMap.get(relation.type);
    if (relation.relationFromFields?.length === 1) {
      return { target, parent: relation.relationFromFields[0], child: relation.relationToFields[0] };
    }
    const opposite = target.fields.find(field => field.kind === 'object' &&
      field.relationName === relation.relationName && field.relationFromFields?.length === 1);
    if (!opposite) throw Error('Unsupported composite/missing relation');
    return { target, parent: opposite.relationToFields[0], child: opposite.relationFromFields[0] };
  }

  // Delayed operations are essential: heartbeat's array transaction must not run
  // either statement on the pool before BEGIN, as eager promises would do.
  function operation(run) {
    let pending;
    return { run, then(resolve, reject) { pending ||= run(observed(pool)); return pending.then(resolve, reject); } };
  }

  function raw(strings, values) {
    const parameters = [];
    function append(parts, args) {
      let sql = parts[0];
      for (let i = 0; i < args.length; i++) {
        const value = args[i];
        if (value && Array.isArray(value.strings) && Array.isArray(value.values)) {
          sql += append(value.strings, value.values);
        } else {
          parameters.push(parameter(value));
          sql += '$' + parameters.length;
        }
        sql += parts[i + 1];
      }
      return sql;
    }
    if (!Array.isArray(strings)) throw Error('Only parameterized raw tags are supported');
    return { text: append(strings, values), values: parameters };
  }

  function observed(connection) {
    return { async query(...args) {
      const begin = performance.now();
      try { return await connection.query(...args); }
      finally { counters.queries++; counters.queryMs += performance.now()-begin; }
    }};
  }
  function adapter(client, transactional = false) {
    async function load(name, args = {}, connection = client) {
      for (const key of Object.keys(args)) {
        if (!['where', 'select', 'include', 'orderBy', 'take'].includes(key)) throw Error('Unsupported query option: ' + key);
      }
      const model = modelMap.get(name);
      const fields = new Map(model.fields.map(field => [field.name, field]));
      const params = [];
      let alias = 0;
      const bind = value => { params.push(parameter(value)); return '$' + params.length; };
      const column = (owner, key, prefix) => {
        const field = owner.fields.find(field => field.name === key && field.kind !== 'object');
        if (!field) throw Error('Unsupported field: ' + key);
        return (prefix ? quote(prefix) + '.' : '') + quote(field.dbName || field.name);
      };
      function where(owner, input, prefix) {
        return Object.entries(input || {}).map(([key, value]) => {
          if (value === undefined) return '';
          if (key === 'AND' || key === 'OR') {
            const terms = (Array.isArray(value) ? value : [value]).map(term => where(owner, term, prefix));
            return terms.length ? '(' + terms.join(key === 'AND' ? ' AND ' : ' OR ') + ')' : key === 'AND' ? 'TRUE' : 'FALSE';
          }
          const field = owner.fields.find(field => field.name === key);
          if (!field) {
            const unique = owner.uniqueIndexes.some(index => index.fields.join('_') === key || index.name === key);
            if (unique) return where(owner, value, prefix);
            throw Error('Unsupported where field: ' + key);
          }
          if (field.kind === 'object') {
            if (field.isList || value === null) throw Error('Unsupported relation predicate');
            const { target, parent, child } = relationKeys(owner, field);
            const nested = 'r' + ++alias;
            return 'EXISTS (SELECT 1 FROM ' + quote(target.dbName || target.name) + ' AS ' + quote(nested) +
              ' WHERE ' + column(target, child, nested) + '=' + column(owner, parent, prefix) +
              ' AND ' + where(target, value, nested) + ')';
          }
          const col = column(owner, key, prefix);
          if (value === null) return col + ' IS NULL';
          if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
            return Object.entries(value).map(([op, operand]) => {
              if (op === 'in') return operand.length ? col + ' IN (' + operand.map(bind).join(',') + ')' : 'FALSE';
              if (op === 'not') return operand === null ? col + ' IS NOT NULL' : col + ' <> ' + bind(operand);
              if (op === 'equals') return operand === null ? col + ' IS NULL' : col + ' = ' + bind(operand);
              if (op === 'has') return bind(operand) + '=ANY(' + col + ')';
              if (op === 'isEmpty') return 'cardinality(' + col + ')' + (operand ? '=0' : '>0');
              const comparison = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[op];
              if (comparison) return col + comparison + bind(operand);
              throw Error('Unsupported operator: ' + op);
            }).join(' AND ');
          }
          return col + '=' + bind(value);
        }).filter(Boolean).join(' AND ') || 'TRUE';
      }

      const relations = Object.entries(args.include || args.select || {}).filter(([key, value]) => value && fields.get(key)?.kind === 'object');
      const selected = args.select ? Object.keys(args.select).filter(key => args.select[key] && fields.get(key)?.kind !== 'object') :
        model.fields.filter(field => field.kind !== 'object').map(field => field.name);
      const needed = new Set([...selected, ...model.fields.filter(field => field.isId).map(field => field.name)]);
      for (const [key] of relations) needed.add(relationKeys(model, fields.get(key)).parent);

      let sql = 'SELECT ' + [...needed].map(key => column(model, key, 't') + ' AS ' + quote(key)).join(',') +
        ' FROM ' + quote(model.dbName || model.name) + ' AS "t" WHERE ' + where(model, args.where, 't');
      if (args.orderBy) {
        const order = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
        const terms = order.flatMap(spec => Object.entries(spec).map(([key, direction]) => {
          let expression = column.bind(null, model, key, 't');
          if (typeof direction === 'object') {
            const relation = fields.get(key);
            const { target, parent, child } = relationKeys(model, relation);
            const entries = Object.entries(direction);
            if (entries.length !== 1) throw Error('Unsupported nested ordering');
            const [childKey, childDirection] = entries[0];
            direction = childDirection;
            expression = () => '(SELECT ' + column(target, childKey, 'o') + ' FROM ' + quote(target.dbName || target.name) +
              ' AS "o" WHERE ' + column(target, child, 'o') + '=' + column(model, parent, 't') + ')';
          }
          if (!['asc', 'desc'].includes(direction)) throw Error('Unsupported ordering');
          return expression() + ' ' + direction.toUpperCase();
        }));
        sql += ' ORDER BY ' + terms.join(',');
      }
      if (args.take !== undefined) {
        if (!Number.isInteger(args.take) || args.take < 0) throw Error('Unsupported take');
        sql += ' LIMIT ' + bind(args.take);
      }
      if (mode !== 'baseline') {
        const direct = await specialized.load(connection, name, args, sql, params, mode);
        if (direct !== undefined) return direct;
      }
      const rows = (await connection.query(sql, params)).rows;
      const result = rows.map(row => Object.fromEntries(selected.map(key => [key, row[key]])));
      for (const [key, configuration] of relations) {
        const relation = fields.get(key);
        const { parent, child } = relationKeys(model, relation);
        const config = configuration === true ? {} : configuration;
        const ids = [...new Set(rows.map(row => row[parent]).filter(id => id !== null && id !== undefined))];
        const internal = config.select ? { ...config.select, [child]: true, ...(config.take !== undefined ? { id: true } : {}) } : undefined;
        const childArgs = { ...config, select: internal, where: { AND: [config.where || {}, { [child]: { in: ids } }] } };
        delete childArgs.take;
        // Prisma's implicit order for an included take is primary-key ascending.
        if (config.take !== undefined && !childArgs.orderBy) childArgs.orderBy = { id: 'asc' };
        const children = ids.length ? await load(relation.type, childArgs, connection) : [];
        for (let i = 0; i < rows.length; i++) {
          let found = children.filter(row => row[child] === rows[i][parent]);
          if (config.take !== undefined) found = found.slice(0, config.take);
          found = found.map(row => {
            const out = { ...row };
            if (config.select && !config.select[child]) delete out[child];
            if (config.select && !config.select.id) delete out.id;
            return out;
          });
          result[i][key] = relation.isList ? found : found[0] || null;
        }
      }
      return result;
    }

    const result = {};
    if (mode === 'aggregate' && transactional) result.$blockSnapshot = (user,scope,info) => require('./aggregate-snapshot.cjs').snapshot(client,user,scope,info);
    for (const model of models) {
      result[model.name] = {};
      for (const method of ['findMany', 'findFirst', 'findUnique', 'findFirstOrThrow', 'findUniqueOrThrow']) {
        result[model.name][method] = args => {
          const run = async connection => {
            const data = await load(model.name,
              method === 'findMany' ? args : { ...args, take: 1 }, connection);
            if (method === 'findMany') return data;
            if (!data.length && method.endsWith('OrThrow')) throw Error('Missing ' + model.name);
            return data[0] || null;
          };
          return transactional ? run(client) : operation(run);
        };
      }
    }
    for (const method of ['$queryRaw', '$executeRaw']) {
      result[method] = (strings, ...values) => {
        const statement = raw(strings, values);
        const allowed = method === '$queryRaw' ? /^SELECT\s/i : /^(UPDATE\s+field_session\s|INSERT\s+INTO\s+field_session\s*\()/i;
        if (!allowed.test(statement.text.trim())) throw Error('Unsupported raw operation');
        const run = async connection => {
          const query = await connection.query(statement);
          return method === '$queryRaw' ? query.rows : query.rowCount;
        };
        return transactional ? run(client) : operation(run);
      };
    }
    return result;
  }

  const root = adapter(observed(pool));
  if (mode === 'aggregate') root.$presenceSummary = async (user,scope) => {
    const rows=await observed(pool).query(`WITH active AS MATERIALIZED (SELECT DISTINCT fs.client_id,fs.block_id,fs.address_id FROM field_session fs JOIN signature s ON s.key=fs.signature_key AND s.tenant_id=fs.tenant_id WHERE fs.tenant_id=$1 AND fs.territory_id=$2 AND fs.round_number=$3 AND fs.last_seen_at>now()-interval '60 seconds' AND fs.disconnected_at IS NULL AND s.expiration_date>now() AND ($4::integer IS NULL OR fs.block_id=$4)), b AS (SELECT block_id,count(DISTINCT client_id)::int AS n FROM active WHERE block_id IS NOT NULL AND block_id<>0 GROUP BY block_id), a AS (SELECT block_id,address_id,count(DISTINCT client_id)::int AS n FROM active WHERE address_id IS NOT NULL AND address_id<>0 GROUP BY block_id,address_id) SELECT (SELECT count(DISTINCT client_id)::int FROM active) AS total, coalesce((SELECT json_object_agg(block_id,n) FROM b),'{}'::json) AS blocks,coalesce((SELECT json_object_agg(coalesce(block_id::text,'null')||':'||address_id::text,n) FROM a),'{}'::json) AS streets`,[user.tenantId,user.territoryId,scope.round??0,user.roles.includes('publisher')?user.blockId:null]);
    return rows.rows[0];
  };
  root.$stats = () => ({ ...counters, poolTotal: pool.totalCount, poolIdle: pool.idleCount, poolWaiting: pool.waitingCount });
  root.$transaction = async (work, options = {}) => {
    const isolation = options.isolationLevel || 'ReadCommitted';
    if (!['ReadCommitted', 'RepeatableRead'].includes(isolation)) throw Error('Unsupported isolation');
    const began = performance.now();
    const client = await pool.connect();
    counters.acquisitions++; counters.acquireMs += performance.now() - began;
    const transactionBegan = performance.now();
    let discard = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL ' + (isolation === 'RepeatableRead' ? 'REPEATABLE READ' : 'READ COMMITTED'));
      const value = Array.isArray(work) ? [] : await work(adapter(observed(client), true));
      if (Array.isArray(work)) {
        for (const item of work) {
          if (typeof item.run !== 'function') throw Error('Only lazy adapter operations may enter an array transaction');
          value.push(await item.run(observed(client)));
        }
      }
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    } finally { counters.transactions++; counters.transactionMs += performance.now() - transactionBegan; client.release(discard); }
  };
  root.$connect = () => pool.query('SELECT 1');
  root.$disconnect = () => pool.end();
  return root;
};
