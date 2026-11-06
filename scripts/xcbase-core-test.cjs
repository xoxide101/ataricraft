// Tests for tools/dbcore.cjs (xCBase engine). node scripts/xcbase-core-test.cjs
const D = require('../tools/dbcore.cjs');
let pass = 0, failN = 0;
const ok = (c, m) => { if (c) pass++; else { failN++; console.log('FAIL ' + m); } };
const same = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + '  got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
const throws = (fn, code, m) => { try { fn(); ok(false, m + ' (no error)'); } catch (e) { ok(e.code === code, m + ' (code ' + e.code + ': ' + e.message + ')'); } };

function sample() {
  const db = new D.Database('shop');
  const c = db.createTable('customers', [{ name: 'id', type: 'int' }, { name: 'name', type: 'text', len: 20 }, { name: 'city', type: 'text', len: 12 }, { name: 'since', type: 'date' }, { name: 'vip', type: 'bool' }, { name: 'notes', type: 'memo' }]);
  c.insert({ id: 1, name: 'Ada Lovelace', city: 'London', since: '1999-05-01', vip: true, notes: 'first\nsecond' });
  c.insert({ id: 2, name: 'bob stone', city: 'Paris', since: '2001-02-28', vip: false });
  c.insert({ id: 3, name: 'Carol King', city: 'London', since: null, vip: null });
  c.insert({ id: 4, name: 'Dan O\'Neil', city: 'Rome', since: '2010-12-31', vip: true });
  const o = db.createTable('orders', [{ name: 'oid', type: 'int' }, { name: 'cust', type: 'int' }, { name: 'amount', type: 'num' }, { name: 'item', type: 'text', len: 10 }]);
  [[10, 1, 12.5, 'pen'], [11, 1, 7.25, 'ink'], [12, 2, 100, 'desk'], [13, 4, 0.1, 'clip'], [14, 9, 5, 'ghost']].forEach((r) => o.insert(r));
  return db;
}

// ---- types and coercion
{
  const f = (type, len) => D.normField({ name: 'x', type, len });
  same(D.coerce(f('int'), '42'), 42, 'int from string');
  throws(() => D.coerce(f('int'), 1.5), 'bad-value', 'int rejects fraction');
  throws(() => D.coerce(f('int'), 2 ** 31), 'out-of-range', 'int 32-bit limit');
  same(D.coerce(f('int'), -(2 ** 31)), -(2 ** 31), 'int min');
  same(D.coerce(f('num'), 1 / 3), 0.3333333333, 'num keeps 10 digits (BCD-6)');
  same(D.coerce(f('num'), '1,234.5'), 1234.5, 'num comma');
  throws(() => D.coerce(f('num'), 1e99), 'out-of-range', 'num range');
  same(D.coerce(f('num'), 1e-120), 0, 'num underflow is 0');
  same(D.coerce(f('date'), '20240229'), '2024-02-29', 'date yyyymmdd and leap day');
  throws(() => D.coerce(f('date'), '2023-02-29'), 'bad-value', 'not a leap year');
  throws(() => D.coerce(f('date'), '2023-13-01'), 'bad-value', 'bad month');
  same(D.coerce(f('bool'), 'Yes'), true, 'bool yes'); same(D.coerce(f('bool'), 'n'), false, 'bool n');
  throws(() => D.coerce(f('bool'), 'maybe'), 'bad-value', 'bool bad');
  throws(() => D.coerce(f('text', 3), 'abcd'), 'too-long', 'text too long');
  same(D.coerce(f('text', 3), 'abcd', { truncate: true }), 'abc', 'text truncate');
  same(D.coerce(f('text', 5), 'a\0b'), 'ab', 'NUL removed');
  same(D.coerce(f('int'), ''), null, 'empty int is null');
  throws(() => D.normField({ name: '1bad', type: 'int' }), 'bad-name', 'field name');
  throws(() => D.normField({ name: 'waytoolongname', type: 'int' }), 'bad-name', 'field name length');
  throws(() => D.normField({ name: 'a', type: 'text', len: 300 }), 'bad-length', 'text length 255 max');
  throws(() => D.normField({ name: 'a', type: 'float' }), 'bad-type', 'unknown type');
  ok(D.recordBytes([{ type: 'text', len: 10 }, { type: 'int' }, { type: 'num' }, { type: 'date' }, { type: 'bool' }, { type: 'memo' }]) === 1 + 1 + 10 + 4 + 6 + 4 + 1 + 2, 'record size');
}

// ---- table operations, undo-style restore
{
  const db = sample(), t = db.table('customers');
  ok(t.length === 4, 'rows');
  const i = t.insert({ id: 5, name: 'Eve', city: 'Oslo' });
  ok(i === 4 && t.get(4).vip === null, 'insert default null');
  const old = t.update(4, { city: 'Bergen' }); ok(old[2] === 'Oslo' && t.get(4).city === 'Bergen', 'update returns old row');
  throws(() => t.update(4, { nope: 1 }), 'no-field', 'unknown field');
  throws(() => t.update(99, { id: 1 }), 'no-record', 'no record');
  const del = t.delete(4); ok(t.length === 4, 'delete'); t.insertAt(4, del); ok(t.get(4).name === 'Eve', 'insertAt restores');
  t.addField({ name: 'age', type: 'int' }, 7); ok(t.get(0).age === 7, 'addField fill');
  t.dropField('age'); ok(!t.hasCol('age'), 'dropField');
  throws(() => t.addField({ name: 'ID', type: 'int' }), 'bad-schema', 'duplicate field case-insensitive');
  throws(() => D.Database.prototype.table.call(db, 'zzz'), 'no-table', 'no table');
}

// ---- indexes, find, sort
{
  const db = sample(), t = db.table('customers');
  t.createIndex({ name: 'by_name', fields: ['name'] });
  t.createIndex({ name: 'by_id', fields: ['id'], unique: true });
  t.createIndex({ name: 'cityname', fields: ['city', 'name'], desc: [false, true] });
  same(t.perm('by_name').map((i) => t.rows[i][1]), ['Ada Lovelace', 'bob stone', 'Carol King', 'Dan O\'Neil'], 'index is case-insensitive sorted');
  same(t.seek('by_name', ['BOB STONE']), [1], 'seek case-insensitive');
  same(t.find('id', 3), [2], 'find via index'); same(t.find('city', 'london'), [0, 2], 'find non-indexed field');
  same(t.seek('cityname', ['London']).map((i) => t.rows[i][1]), ['Carol King', 'Ada Lovelace'], 'composite with desc second key');
  throws(() => t.insert({ id: 3, name: 'dup' }), 'duplicate-key', 'unique index');
  ok(t.length === 4, 'failed insert leaves no record');
  throws(() => t.update(0, { id: 2 }), 'duplicate-key', 'unique on update');
  t.insert({ id: 9, name: 'Aaron' }); same(t.perm('by_name').map((i) => t.rows[i][1])[0], 'Aaron', 'index rebuilt after insert');
  same(t.sort(['name DESC']).map((i) => t.rows[i][0]), [4, 3, 2, 1, 9], 'sort by name desc');
  throws(() => t.createIndex({ name: 'by_id', fields: ['id'] }), 'bad-schema', 'duplicate index');
  throws(() => t.createIndex({ name: 'bad', fields: ['nope'] }), 'no-field', 'index unknown field');
  const t2 = sample().table('customers'); t2.insert({ id: 1, name: 'again' });
  throws(() => t2.createIndex({ name: 'u', fields: ['id'], unique: true }), 'duplicate-key', 'unique index on repeated data');
  same(t.filter((r) => r.vip === true).length, 2, 'filter');
  t.dropField('id'); ok(!t.indexes.some((x) => x.name === 'by_id'), 'dropField drops its indexes');
}

// ---- query language
{
  const db = sample(); db.table('customers').createIndex({ name: 'c_id', fields: ['id'] });
  const q = (s, p) => db.query(s, p);
  let r = q('SELECT * FROM customers');
  ok(r.rows.length === 4 && r.columns.length === 6 && r.columns[3].type === 'date', 'select star');
  r = q("SELECT name FROM customers WHERE city = 'London' ORDER BY name DESC"); same(r.rows, [['Carol King'], ['Ada Lovelace']], 'where and order');
  r = q('SELECT name FROM customers WHERE id = ?', [2]); same(r.rows, [['bob stone']], 'param'); ok(r.plan === 'index:c_id', 'index used for id = ? (plan ' + r.plan + ')');
  r = q('SELECT name FROM customers WHERE id = :i', { i: 4 }); same(r.rows, [["Dan O'Neil"]], 'named param');
  throws(() => q('SELECT name FROM customers WHERE id = ?', []), 'param', 'missing param');
  r = q("SELECT name FROM customers WHERE name LIKE 'a%' OR name LIKE '%KING'"); same(r.rows.map((x) => x[0]), ['Ada Lovelace', 'Carol King'], 'like is case-insensitive');
  r = q("SELECT name FROM customers WHERE city IN ('Rome','Paris') ORDER BY 1"); same(r.rows.length, 2, 'in list');
  r = q("SELECT name FROM customers WHERE since BETWEEN '2000-01-01' AND '2005-01-01'"); same(r.rows, [['bob stone']], 'between dates');
  r = q('SELECT name FROM customers WHERE since IS NULL'); same(r.rows, [['Carol King']], 'is null');
  r = q('SELECT name FROM customers WHERE vip = TRUE'); same(r.rows.length, 2, 'bool compare; null vip not matched');
  r = q('SELECT name FROM customers WHERE NOT vip = TRUE'); same(r.rows.length, 1, 'three-valued NOT: null stays out');
  r = q('SELECT name FROM customers WHERE vip IS NOT NULL AND (city = ? OR city = ?)', ['Paris', 'Rome']); same(r.rows.length, 2, 'parens and params');
  r = q('SELECT id, id * 2 + 1 AS x, UPPER(city) c, LENGTH(name) FROM customers ORDER BY x DESC LIMIT 2 OFFSET 1'); same(r.rows.map((x) => x.slice(0, 3)), [[3, 7, 'LONDON'], [2, 5, 'PARIS']], 'expressions, alias order, limit offset');
  same(r.columns.map((c) => c.name), ['id', 'x', 'c', 'expr4'], 'column names');
  r = q("SELECT name || '!' FROM customers WHERE id = 1"); same(r.rows, [['Ada Lovelace!']], 'concat');
  r = q('SELECT DISTINCT city FROM customers ORDER BY city'); same(r.rows, [['London'], ['Paris'], ['Rome']], 'distinct');
  r = q('SELECT COUNT(*), SUM(amount), AVG(amount), MIN(amount), MAX(item) FROM orders'); same(r.rows, [[5, 124.85, 24.97, 0.1, 'pen']], 'aggregates');
  r = q('SELECT COUNT(*), SUM(amount) FROM orders WHERE oid > 100'); same(r.rows, [[0, null]], 'aggregate over nothing');
  r = q('SELECT cust, COUNT(*) n, SUM(amount) s FROM orders GROUP BY cust HAVING COUNT(*) > 1 ORDER BY s DESC'); same(r.rows, [[1, 2, 19.75]], 'group by having');
  r = q('SELECT cust, SUM(amount) FROM orders GROUP BY cust ORDER BY SUM(amount) DESC'); same(r.rows.map((x) => x[0]), [2, 1, 9, 4], 'order by aggregate');
  r = q('SELECT COUNT(DISTINCT city) FROM customers'); same(r.rows, [[3]], 'count distinct');
  r = q('SELECT c.name, o.item, o.amount FROM customers c JOIN orders o ON o.cust = c.id WHERE o.amount > 5 ORDER BY o.amount'); same(r.rows, [['Ada Lovelace', 'ink', 7.25], ['Ada Lovelace', 'pen', 12.5], ['bob stone', 'desk', 100]], 'inner join');
  r = q('SELECT c.name, o.item FROM customers c LEFT JOIN orders o ON o.cust = c.id ORDER BY c.id, o.oid'); same(r.rows.map((x) => x.join('/')), ['Ada Lovelace/pen', 'Ada Lovelace/ink', 'bob stone/desk', 'Carol King/', "Dan O'Neil/clip"], 'left join');
  r = q('SELECT c.name, COUNT(o.oid) FROM customers c LEFT JOIN orders o ON o.cust = c.id GROUP BY c.name ORDER BY c.name'); same(r.rows.map((x) => x[1]), [2, 1, 0, 1], 'left join count');
  r = q('SELECT c.* FROM customers c WHERE c.id = 1'); ok(r.columns.length === 6 && r.columns[0].name === 'c.id', 'alias star');
  r = q("SELECT YEAR(since), MONTH(since), COALESCE(city, 'x'), SUBSTR(name, 1, 3), ROUND(2.5), ABS(-3) FROM customers WHERE id = 2"); same(r.rows, [[2001, 2, 'Paris', 'bob', 3, 3]], 'functions');
}
{
  const db = sample(), q = (s, p) => db.query(s, p);
  throws(() => q('SELECT 1'), 'syntax', 'FROM required');
  throws(() => q('SELECT name FROM nope'), 'no-table', 'unknown table');
  throws(() => q('SELECT zip FROM customers'), 'no-field', 'unknown field');
  throws(() => q('SELECT id FROM customers c JOIN orders o ON o.cust = c.id WHERE oid = 1 AND id = 1 AND cust = 1 ORDER BY name FROM'), 'syntax', 'trailing junk');
  throws(() => q('SELECT oid, cust FROM customers JOIN customers ON 1 = 1'), 'syntax', 'duplicate alias');
  throws(() => q("SELECT name FROM customers; DROP TABLE customers"), 'syntax', 'second statement is a syntax error');
  throws(() => q('DELETE FROM customers'), 'syntax', 'only SELECT');
  throws(() => q("SELECT name FROM customers WHERE name = 'x"), 'syntax', 'unterminated string');
  throws(() => q('SELECT * , COUNT(*) FROM customers'), 'syntax', 'star with aggregate');
  throws(() => q('SELECT name FROM customers WHERE COUNT(*) > 1'), 'syntax', 'aggregate in where');
  throws(() => q('SELECT id FROM customers c JOIN orders o ON o.cust = c.id WHERE cust = 1 AND id = 1 AND nope = 1'), 'no-field', 'field in join');
  same(q("SELECT name FROM customers WHERE name = ?", ["x' OR '1'='1"]).rows, [], 'quotes in a parameter are data');
  same(db.table('customers').rows.length, 4, 'engine never modifies data');
}

// ---- forms, reports, merge
{
  const db = sample(), c = db.table('customers');
  const f = D.defaultForm(c); same(D.checkForm(db, f), [], 'default form is valid'); db.forms.push(f);
  ok(D.checkForm(db, { name: 'f', table: 'customers', fields: [{ field: 'zzz', row: 1, col: 1, width: 5 }, { field: 'name', row: 30, col: 1, width: 5 }, { field: 'name', row: 1, col: 60, width: 9 }] }).length === 3, 'form errors');
  const rep = { name: 'sales', table: 'orders', title: 'Sales by customer', columns: [{ field: 'cust', label: 'Cust' }, { field: 'item', label: 'Item' }, { field: 'amount', label: 'Amount', decimals: 2, sum: true }], groupBy: 'cust', orderBy: ['oid'] };
  db.reports.push(rep);
  const r = D.runReport(db, rep);
  ok(r.groups.length === 4 && r.totals[2] === 124.85 && r.groups[0].totals[2] === 19.75, 'report groups and totals');
  const html = D.reportHTML(r); ok(/<h1>Sales by customer<\/h1>/.test(html) && /19\.75/.test(html) && /124\.85/.test(html), 'report html');
  ok(D.reportHTML(D.runReport(db, { name: 'x', table: 'customers', title: '<b>&', columns: [{ field: 'name' }] })).includes('&lt;b&gt;&amp;'), 'report html escapes');
  const t = D.reportText(r, 60); ok(/Sales by customer/.test(t) && /124\.85/.test(t) && t.split('\n').every((l) => l.length <= 60), 'report text');
  const q = D.runReport(db, { name: 'q', table: 'orders', query: 'SELECT cust, SUM(amount) tot FROM orders GROUP BY cust ORDER BY cust', columns: [{ field: 'cust' }, { field: 'tot', sum: true }] });
  ok(q.count === 4 && q.totals[1] === 124.85, 'query-based report');
  throws(() => D.runReport(db, { name: 'bad', table: 'orders', columns: [{ field: 'nope' }] }), 'bad-report', 'report with unknown field');
  same(D.mergeFields('Dear <<Name>>, <<name>> from << City >> <<x_1>>'), ['Name', 'City', 'x_1'], 'merge fields');
  same(D.mergeText('Dear <<name>> of <<CITY>>; vip <<vip>>; <<missing>>', c.get(0)), 'Dear Ada Lovelace of London; vip Yes; ', 'merge text');
  const a = D.atariCheck(db, 1000); ok(a.ok, 'atari ok'); const big = new D.Database('b'); big.createTable('t', Array.from({ length: 33 }, (_, i) => ({ name: 'f' + i, type: 'text', len: 10 })));
  ok(!D.atariCheck(big).ok && D.atariCheck(big).items.length === 2, 'atari limits (33 fields and 330-byte record)');
}

// ---- JSON twin
{
  const db = sample(); db.table('customers').createIndex({ name: 'by_name', fields: ['name'], unique: true }); db.forms.push(D.defaultForm(db.table('customers')));
  const j = D.toJSON(db), db2 = D.fromJSON(JSON.stringify(j));
  same(D.toJSON(db2), j, 'JSON round trip');
  ok(db2.table('customers').indexes[0].unique && db2.query('SELECT COUNT(*) FROM orders').rows[0][0] === 5, 'JSON keeps indexes and data');
  throws(() => D.fromJSON('{"format":"nope"}'), 'bad-json', 'wrong format'); throws(() => D.fromJSON('nonsense'), 'bad-json', 'not json');
  const bad = JSON.parse(JSON.stringify(j)); bad.tables[0].records[0][3] = '2020-99-99';
  throws(() => D.fromJSON(bad), 'bad-value', 'invalid value in JSON');
}

// ---- performance sanity
{
  const db = new D.Database('big'), t = db.createTable('t', [{ name: 'k', type: 'int' }, { name: 'v', type: 'text', len: 8 }]);
  const t0 = Date.now();
  for (let i = 0; i < 20000; i++) t.rows.push([(i * 7919) % 20011, 'v' + i]);
  t.createIndex({ name: 'k', fields: ['k'] }); t._dirty();
  const r = db.query('SELECT v FROM t WHERE k = 5'); ok(r.plan === 'index:k' && r.rows.length === 1, '20000-row index lookup');
  ok(db.query('SELECT COUNT(*) FROM t WHERE k > 100').rows[0][0] > 19000, '20000-row scan');
  ok(Date.now() - t0 < 3000, 'performance ' + (Date.now() - t0) + ' ms');
}

console.log(`xcbase-core-test: ${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
