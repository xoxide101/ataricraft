// FTP support in the relay: ftp.cjs against tools/tests/mockftp.cjs, plus the /net/ftp/* routes (token, write gating, LAN blocking).
const assert = require('assert'), fs = require('fs'), path = require('path'), http = require('http');
const { start } = require('./mockftp.cjs');
const ftp = require('../tnfs-bridge/ftp.cjs');
const netapi = require('../tnfs-bridge/netapi.cjs');
const api = { resolve: async (h) => h };
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.message)); } };
const post = (port, route, args, body, token) => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port, path: route, method: 'POST', headers: { 'X-AC-Token': token, 'X-AC-Args': encodeURIComponent(JSON.stringify(args)) } }, (rs) => { const a = []; rs.on('data', (d) => a.push(d)); rs.on('end', () => res({ status: rs.statusCode, err: rs.headers['x-ac-err'], body: Buffer.concat(a) })); });
  r.on('error', rej); r.end(body);
});
(async () => {
  const root = path.join(__dirname, '..', '..', 'out', 'ftp-test-' + process.pid); // scratch dir under out/, removed at the end
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'hello.txt'), 'hello from ftp\n'); fs.mkdirSync(path.join(root, 'sub')); fs.writeFileSync(path.join(root, 'sub', 'b.bin'), Buffer.from([0, 1, 2, 255]));
  const s = await start(root, { user: 'atari', pass: 'secret' });
  const A = { host: '127.0.0.1', port: s.port, user: 'atari', pass: 'secret' };
  await t('LIST parses files and folders', async () => { const l = await ftp.ops.list(api, { ...A, path: '/' }); assert.deepStrictEqual(l.map((e) => e.name + (e.dir ? '/' : '')).sort(), ['hello.txt', 'sub/']); assert.strictEqual(l.find((e) => e.name === 'hello.txt').size, 15); });
  await t('RETR returns exact bytes (binary)', async () => { assert.deepStrictEqual([...await ftp.ops.file(api, { ...A, path: '/sub/b.bin' }, 1e6)], [0, 1, 2, 255]); });
  await t('RETR of a missing file maps to NOT_FOUND (170)', async () => { await assert.rejects(ftp.ops.file(api, { ...A, path: '/nope' }, 1e6), (e) => e.code === 170); });
  await t('wrong password maps to DENIED (167)', async () => { await assert.rejects(ftp.ops.list(api, { ...A, pass: 'bad', path: '/' }), (e) => e.code === 167); });
  await t('STOR then APPE', async () => { await ftp.ops.put(api, { ...A, path: '/up.txt' }, Buffer.from('one\n')); await ftp.ops.put(api, { ...A, path: '/up.txt', append: true }, Buffer.from('two\n')); assert.strictEqual(fs.readFileSync(path.join(root, 'up.txt'), 'utf8'), 'one\ntwo\n'); });
  await t('MKD, RNFR/RNTO, DELE, RMD', async () => {
    await ftp.ops.op(api, { ...A, op: 'mkdir', path: '/d' }); assert.ok(fs.existsSync(path.join(root, 'd')));
    await ftp.ops.op(api, { ...A, op: 'rename', path: '/up.txt', to: '/d/moved.txt' }); assert.ok(fs.existsSync(path.join(root, 'd', 'moved.txt')));
    await ftp.ops.op(api, { ...A, op: 'unlink', path: '/d/moved.txt' }); await ftp.ops.op(api, { ...A, op: 'rmdir', path: '/d' }); assert.ok(!fs.existsSync(path.join(root, 'd')));
  });
  await t('CR/LF in a path is refused (command injection)', async () => { await assert.rejects(ftp.ops.file(api, { ...A, path: '/hello.txt\r\nDELE hello.txt' }, 1e6), /control character/); assert.ok(fs.existsSync(path.join(root, 'hello.txt'))); });
  await t('server never sees a DELE from the injection attempt', async () => { assert.ok(!s.log.some((l) => /^DELE hello/.test(l))); });
  // through the relay routes
  const anon = await start(root, {});
  for (const allowWrite of [false, true]) {
    const n = netapi.create({ token: 'tok', allowLan: true, allowWrite }), srv = http.createServer((q, r) => n.handle(q, r, q.url)).listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r));
    const p = srv.address().port, B = { host: '127.0.0.1', port: anon.port };
    await t('relay /net/ftp/file works (anonymous), allowWrite=' + allowWrite, async () => { const r = await post(p, '/net/ftp/file', { ...B, path: '/hello.txt' }, null, 'tok'); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.toString(), 'hello from ftp\n'); });
    await t('relay rejects a bad token, allowWrite=' + allowWrite, async () => { assert.strictEqual((await post(p, '/net/ftp/file', { ...B, path: '/hello.txt' }, null, 'xxx')).status, 403); });
    await t('relay /net/ftp/put is ' + (allowWrite ? 'allowed' : 'refused (167)'), async () => { const r = await post(p, '/net/ftp/put', { ...B, path: '/w.txt' }, Buffer.from('w'), 'tok'); if (allowWrite) { assert.strictEqual(r.status, 200); assert.ok(fs.existsSync(path.join(root, 'w.txt'))); fs.unlinkSync(path.join(root, 'w.txt')); } else { assert.strictEqual(r.err, '167'); assert.ok(!fs.existsSync(path.join(root, 'w.txt'))); } });
    srv.close();
  }
  await t('relay blocks loopback FTP unless --allow-lan', async () => { const n = netapi.create({ token: 'tok', allowLan: false }), srv = http.createServer((q, r) => n.handle(q, r, q.url)).listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r)); const r = await post(srv.address().port, '/net/ftp/list', { host: '127.0.0.1', port: anon.port, path: '/' }, null, 'tok'); srv.close(); assert.strictEqual(r.err, '167'); });
  s.close(); anon.close(); fs.rmSync(root, { recursive: true, force: true });
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
