// Tests for .xcd binary, JSON twin, DBF/CSV/SQLite import-export and the container adapter. node scripts/xcbase-format-test.cjs
const D = require('../tools/dbcore.cjs'), F = require('../tools/xcdformat.cjs'), IO = require('../tools/xcdio.cjs'), SQ = require('../tools/xcdsqlite.cjs');
const A = require('../tools/craftcore/adapters.cjs');
let pass = 0, failN = 0;
const ok = (c, m) => { if (c) pass++; else { failN++; console.log('FAIL ' + m); } };
const same = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + '  got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
const throws = (fn, re, m) => { try { fn(); ok(false, m + ' (no error)'); } catch (e) { ok(re.test(e.code || e.message), m + ' (' + e.code + ': ' + e.message + ')'); } };

function sample() {
  const db = new D.Database('shop');
  const c = db.createTable('customers', [{ name: 'id', type: 'int' }, { name: 'name', type: 'text', len: 20 }, { name: 'since', type: 'date' }, { name: 'vip', type: 'bool' }, { name: 'bal', type: 'num' }, { name: 'notes', type: 'memo' }]);
  c.insert({ id: 1, name: 'Ada Lovelace', since: '1999-05-01', vip: true, bal: 12.5, notes: 'first\nsecond' });
  c.insert({ id: 2, name: 'bob', since: '2001-02-28', vip: false, bal: -0.001 });
  c.insert({ id: 3, name: 'Carol', since: null, vip: null, bal: null });
  c.createIndex({ name: 'byname', fields: ['name'] });
  return db;
}
const rows = (db, i) => db.tables[i || 0].rows;

// binary
{
  const db = sample(), r = F.toBinary(db), b = r.bytes;
  ok(b.length > 16 && String.fromCharCode(...b.subarray(0, 4)) === 'CRFT' && b[5] === 0x44, 'header magic/type');
  const back = F.fromBinary(b);
  same(rows(back.db), rows(db), 'binary rows round trip');
  same(D.toJSON(back.db), D.toJSON(db), 'binary json round trip');
  ok(Buffer.compare(Buffer.from(F.toBinary(back.db).bytes), Buffer.from(b)) === 0, 'binary byte-identical re-encode');
  const tw = D.fromJSON(JSON.stringify(D.toJSON(db)));
  ok(Buffer.compare(Buffer.from(F.toBinary(tw).bytes), Buffer.from(b)) === 0, 'JSON twin -> same binary');
  const cases = [
    ['truncated', (x) => x.subarray(0, 10), /xcd-truncated/],
    ['truncated payload', (x) => x.subarray(0, x.length - 5), /xcd-truncated/],
    ['bad magic', (x) => { const y = Uint8Array.from(x); y[0] = 0x58; return y; }, /xcd-bad-magic/],
    ['bad version', (x) => { const y = Uint8Array.from(x); y[4] = 99; return y; }, /xcd-bad-version/],
    ['bad type', (x) => { const y = Uint8Array.from(x); y[5] = 0x53; return y; }, /xcd-bad-type/],
    ['flipped payload byte', (x) => { const y = Uint8Array.from(x); y[30] ^= 0x55; return y; }, /xcd-(checksum|crc|corrupt)/],
    ['empty', () => new Uint8Array(0), /xcd-truncated/],
  ];
  for (const [n, f, re] of cases) throws(() => F.fromBinary(f(b)), re, 'corrupt: ' + n);
  for (let i = 0; i < 200; i++) { const y = Uint8Array.from(b); y[16 + ((i * 7) % (y.length - 16))] ^= 1 << (i % 8); try { F.fromBinary(y); } catch (e) { ok(e instanceof D.DBError, 'fuzz only DBError ' + e.message); continue; } ok(false, 'fuzz bit flip undetected at ' + i); }
  const big = new D.Database('big'), t = big.createTable('t', [{ name: 'a', type: 'text', len: 255 }]);
  for (let i = 0; i < 400; i++) t.insert(['x'.repeat(200)]);
  throws(() => F.toBinary(big), /xcd-too-big/, 'too big');
}

// DBF
{
  const db = sample(), t = db.tables[0], r = IO.exportDBF(t), back = IO.importDBF(r.dbf, { memo: r.dbt });
  const bt = back.db.tables[0];
  same(bt.rows.map((x) => [x[0], x[1], x[2], x[3]]), t.rows.map((x) => [x[0], x[1], x[2], x[3]]), 'dbf rows');
  same(bt.rows[0][5], 'first\nsecond', 'dbf memo');
  same(bt.rows[2][2], null, 'dbf null date');
  throws(() => IO.importDBF(new Uint8Array(10)), /dbf-/, 'dbf short');
  throws(() => IO.importDBF(Uint8Array.from([0x99, ...new Array(40).fill(0)])), /dbf-/, 'dbf bad header');
  const tr = IO.importDBF(r.dbf.subarray(0, r.dbf.length - 20));
  ok(tr.loss.length > 0, 'dbf truncated is reported');
}

// CSV / TSV
{
  const db = sample(), t = db.tables[0];
  for (const delim of [',', '\t', ';']) {
    const e = IO.exportDelimited(t, { delimiter: delim }), b = IO.importDelimited(e.text, { delimiter: delim });
    same(b.db.tables[0].rows.map((x) => x.slice(0, 5)), t.rows.map((x) => x.slice(0, 5)), 'delimited round trip ' + JSON.stringify(delim));
  }
  const q = IO.importDelimited('a,b\n"x, ""y""","line\nbreak"\n');
  same(rows(q.db)[0], ['x, "y"', 'line\nbreak'], 'csv quotes/newline');
  const z = IO.importDelimited('zip,n\n00123,5\n99999999999,6\n');
  same(z.db.tables[0].fields.map((f) => f.type), ['text', 'int'], 'leading zeros / long numbers stay text');
  throws(() => IO.importDelimited('a,b\n"open,1\n'), /./, 'unterminated quote');
}

// SQLite
{
  const db = sample(), e = SQ.exportSqlite(db), back = SQ.importSqlite(e.bytes);
  const bt = back.db.tables[0];
  same(bt.rows.map((x) => x.slice(0, 5)), db.tables[0].rows.map((x) => x.slice(0, 5)), 'sqlite round trip');
  same(bt.rows[0][5], 'first\nsecond', 'sqlite memo');
  ok(bt.indexes.length === 1, 'sqlite index kept');
  throws(() => SQ.importSqlite(new Uint8Array(100)), /sqlite-bad-file/, 'sqlite garbage');
}

// adapter
{
  const bytes = F.toBinary(sample()).bytes, a = A.detect(bytes, 'x.xcd');
  ok(a.name === 'xcd', 'adapter detect');
  const c = a.import(bytes, { name: 'x.xcd' });
  ok(Buffer.compare(Buffer.from(a.export(c)), Buffer.from(bytes)) === 0, 'adapter byte-identical');
  ok(A.EXTENSIONS.xcd.status === 'implemented', 'extension implemented');
}

console.log(`xcbase-format: ${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
