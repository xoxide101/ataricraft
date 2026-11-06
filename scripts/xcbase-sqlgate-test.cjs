// Tests for tools/sqlgate (core + HTTP server), including injection attempts. node scripts/xcbase-sqlgate-test.cjs
const fs = require('fs'), path = require('path'), http = require('http');
const { DatabaseSync } = require('node:sqlite');
const { createGate } = require('../tools/sqlgate/core.cjs');
const { startServer } = require('../tools/sqlgate/server.cjs');
let pass = 0, failN = 0;
const ok = (c, m) => { if (c) pass++; else { failN++; console.log('FAIL ' + m); } };
const rejects = async (p, code, m) => { try { await p(); ok(false, m + ' (no error)'); } catch (e) { ok(e.code === code, m + ' (got ' + e.code + ': ' + e.message + ')'); } };

(async () => {
  const OUT = path.join(__dirname, '..', 'out', 'sqlgate-test'); fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'shop.sqlite'); fs.rmSync(file, { force: true });
  const s = new DatabaseSync(file);
  s.exec("CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE orders(id INTEGER, cust INTEGER, amt REAL); CREATE TABLE secrets(k TEXT, v TEXT); INSERT INTO secrets VALUES('pw','hunter2'); CREATE VIEW sv AS SELECT * FROM secrets;");
  const ins = s.prepare('INSERT INTO customers(name) VALUES (?)');
  for (let i = 0; i < 50; i++) ins.run('c' + i);
  s.exec('INSERT INTO orders VALUES (1,1,5.5),(2,2,7)');
  s.close();
  const auditFile = path.join(OUT, 'audit.log'); fs.rmSync(auditFile, { force: true });
  const gate = createGate({ limits: { maxRows: 10, timeoutMs: 1500 }, audit: auditFile, databases: { shop: { path: file, tables: ['customers', 'orders'] }, rw: { path: file, tables: ['customers'], readOnly: false } } });
  const q = (sql, p, db) => gate.query(db || 'shop', sql, p);

  // basics
  ok((await gate.tables('shop')).tables.join() === 'customers,orders', 'tables lists only allow-listed');
  ok((await gate.schema('shop', 'customers')).columns[0].name === 'id', 'schema');
  await rejects(() => gate.schema('shop', 'secrets'), 'denied', 'schema of non-allowed table');
  let r = await q('SELECT name FROM customers WHERE id = ?', [3]);
  ok(r.rows.length === 1 && r.rows[0][0] === 'c2', 'parameterised query');
  r = await q('SELECT c.name, o.amt FROM customers c JOIN orders o ON o.cust = c.id ORDER BY o.id');
  ok(r.rows.length === 2, 'join of allowed tables');
  r = await q('SELECT count(*) FROM customers'); ok(r.rows[0][0] === 50, 'aggregate function');
  // limits
  r = await q('SELECT * FROM customers'); ok(r.rows.length === 10 && r.more === true, 'row limit with more flag');
  r = await gate.query('shop', 'SELECT * FROM customers', [], { maxRows: 3 }); ok(r.rows.length === 3, 'client may lower maxRows');
  r = await gate.query('shop', 'SELECT * FROM customers', [], { maxRows: 99999 }); ok(r.rows.length === 10, 'client cannot raise maxRows');
  await rejects(() => q('SELECT ' + 'a,'.repeat(3000) + '1'), 'too-long', 'sql length cap');
  await rejects(() => q('WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM r) SELECT count(*) FROM r'), 'timeout', 'runaway query times out');

  // injection and abuse
  const bad = [
    ['SELECT 1; DROP TABLE customers', 'multi'],
    ['SELECT 1; SELECT 2', 'multi'],
    ["SELECT * FROM customers WHERE name = '' OR '1'='1'", 'literal'],
    ['SELECT * FROM customers -- x', 'bad-sql'],
    ['SELECT /* x */ 1', 'bad-sql'],
    ['SELECT * FROM customers WHERE id = :id', 'bad-sql'],
    ['SELECT * FROM customers WHERE id = ?1', 'bad-sql'],
    ['DELETE FROM customers', 'not-select'],
    ['INSERT INTO customers(name) VALUES (?)', 'not-select'],
    ['PRAGMA table_info(customers)', 'not-select'],
    ['ATTACH DATABASE ? AS x', 'not-select'],
    ['SELECT * FROM secrets', 'denied'],
    ['SELECT * FROM "secrets"', 'denied'],
    ['SELECT * FROM [secrets]', 'denied'],
    ['SELECT * FROM SECRETS', 'denied'],
    ['SELECT * FROM sv', 'denied'],
    ['SELECT * FROM sqlite_master', 'denied'],
    ['SELECT * FROM main.sqlite_master', 'denied'],
    ['SELECT * FROM customers WHERE id IN (SELECT rowid FROM secrets)', 'denied'],
    ['SELECT (SELECT v FROM secrets LIMIT 1)', 'denied'],
    ['WITH x AS (SELECT v FROM secrets) SELECT * FROM x', 'denied'],
    ['SELECT name FROM customers UNION SELECT v FROM secrets', 'denied'],
    ['SELECT load_extension(?)', 'sql-error'],
    ['SELECT readfile(?)', 'sql-error'],
    ['SELECT * FROM pragma_table_info(?)', 'denied'],
    ['SELECT * FROM pragma_database_list', 'denied'],
    ['WITH t AS (DELETE FROM customers RETURNING *) SELECT * FROM t', 'sql-error'],
    ['SELECT * FROM customers\u0000; DROP TABLE x', 'bad-sql'],
    ['SELECT `name` FROM customers', 'literal'],
  ];
  for (const [sql, code] of bad) {
    try { await q(sql, sql.includes('?') ? ['x'] : []); ok(false, 'should reject: ' + sql); }
    catch (e) { ok(code === 'sql-error' ? ['sql-error', 'denied'].includes(e.code) : e.code === code, `reject ${sql} -> ${e.code} (want ${code})`); }
  }
  // hostile parameter values are data, not SQL
  r = await q('SELECT count(*) FROM customers WHERE name = ?', ["x'; DROP TABLE customers; --"]); ok(r.rows[0][0] === 0, 'hostile param is just a string');
  ok((await q('SELECT count(*) FROM customers')).rows[0][0] === 50, 'table survived');
  await rejects(() => q('SELECT ?', [{ a: 1 }]), 'bad-params', 'object param rejected');
  await rejects(() => q('SELECT ?', [[1]]), 'bad-params', 'array param rejected');
  await rejects(() => q('SELECT ?', [NaN]), 'bad-params', 'NaN param rejected');
  await rejects(() => q('SELECT ?', ['x'.repeat(20000)]), 'bad-params', 'huge param rejected');
  await rejects(() => q('SELECT 1', 'x'), 'bad-params', 'params must be array');
  await rejects(() => q('SELECT 1', [], 'nope'), 'no-database', 'unknown alias');
  await rejects(() => q('SELECT 1', [], '../shop'), 'no-database', 'path-like alias');

  // writes
  await rejects(() => gate.exec('shop', 'DELETE FROM customers WHERE id = ?', [1]), 'read-only', 'exec on read-only db');
  await rejects(() => gate.exec('rw', 'INSERT INTO orders VALUES (?,?,?)', [9, 9, 9]), 'denied', 'write to non-allowed table on rw db');
  await rejects(() => gate.exec('rw', 'DELETE FROM customers WHERE id IN (SELECT id FROM orders)', []), 'denied', 'write reading a non-allowed table');
  await rejects(() => gate.exec('rw', 'DROP TABLE customers', []), 'not-write', 'DDL refused');
  await rejects(() => gate.exec('rw', "INSERT INTO customers(name) VALUES ('x')", []), 'literal', 'exec literals refused');
  r = await gate.exec('rw', 'INSERT INTO customers(name) VALUES (?)', ['new']); ok(r.changes === 1, 'allowed write works on rw db');
  r = await gate.exec('rw', 'UPDATE customers SET name = ? WHERE name = ?', ['renamed', 'new']); ok(r.changes === 1, 'update');
  await rejects(() => gate.query('rw', 'SELECT * FROM orders'), 'denied', 'rw allow-list applies to reads');
  await rejects(() => createGate({ databases: { x: { path: file, tables: ['a'], engine: 'mysql' } } }), 'bad-config', 'unknown engine refused').catch(() => {});
  try { createGate({ databases: { x: { path: file, tables: ['a'], engine: 'mysql' } } }); ok(false, 'engine'); } catch (e) { ok(e.code === 'bad-config', 'unimplemented engine refused'); }
  try { createGate({ databases: { x: { path: file } } }); ok(false, 'allow'); } catch (e) { ok(e.code === 'bad-config', 'allow-list required'); }

  // audit log has no param values or sql text
  const log = fs.readFileSync(auditFile, 'utf8');
  ok(log.length > 0 && !/hunter2|DROP TABLE|renamed/.test(log), 'audit log written without values');

  // HTTP
  const srv = await startServer(gate, { token: 'tok123' });
  const call = (route, args, tok) => new Promise((resolve, reject) => {
    const h = { 'X-AC-Args': encodeURIComponent(JSON.stringify(args || {})) }; if (tok !== null) h['X-AC-Token'] = tok === undefined ? 'tok123' : tok;
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: route, method: 'POST', headers: h }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : null, headers: res.headers })); });
    req.on('error', reject); req.end();
  });
  ok((await call('/sql/caps', {}, null)).status === 401, 'http: token required');
  ok((await call('/sql/caps', {}, 'wrong')).status === 401, 'http: wrong token');
  const caps = await call('/sql/caps'); ok(caps.status === 200 && caps.body.databases.length === 2 && !JSON.stringify(caps.body).includes(file), 'http: caps hides paths');
  const hq = await call('/sql/query', { db: 'shop', sql: 'SELECT name FROM customers WHERE id = ?', params: [2] }); ok(hq.body.rows[0][0] === 'c1', 'http: query');
  const hb = await call('/sql/query', { db: 'shop', sql: 'SELECT * FROM secrets' }); ok(hb.status === 400 && hb.body.error === 'denied' && hb.headers['x-ac-err'] === 'denied', 'http: denied -> 400 + X-AC-Err');
  ok((await call('/sql/nope')).status === 404, 'http: unknown route');
  ok(caps.headers['access-control-allow-origin'] === '*' && caps.headers['access-control-allow-private-network'] === 'true', 'http: CORS headers');
  ok(srv.server.address().address === '127.0.0.1', 'http: bound to loopback');
  await srv.close();
  fs.rmSync(file, { force: true });
  console.log(`xcbase-sqlgate: ${pass} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
