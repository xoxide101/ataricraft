const assert = require('assert');
const http = require('http');
const net = require('net');
const netapi = require('../tnfs-bridge/netapi.cjs');

(async () => {
  const strict = netapi.create({ token: 'tok' });
  const lan = netapi.create({ token: 'tok', allowLan: true });
  const mk = (api) => new Promise((r) => { const s = http.createServer((q, p) => api.handle(q, p, new URL(q.url, 'http://x').pathname)); s.listen(0, '127.0.0.1', () => r(s)); });
  const call = async (srv, path, args, body, token = 'tok') => {
    const r = await fetch('http://127.0.0.1:' + srv.address().port + path, { method: 'POST', headers: { 'X-AC-Token': token, 'X-AC-Args': encodeURIComponent(JSON.stringify(args || {})) }, body });
    return { status: r.status, err: r.headers.get('x-ac-err'), meta: JSON.parse(decodeURIComponent(r.headers.get('x-ac-meta') || '%7B%7D')), body: Buffer.from(await r.arrayBuffer()) };
  };
  const S = await mk(strict), L = await mk(lan);

  assert.strictEqual((await call(S, '/net/tcp/open', { host: '1.1.1.1', port: 1 }, undefined, 'bad')).status, 403);
  assert.strictEqual((await call(S, '/net/tcp/open', { host: '127.0.0.1', port: 1 })).err, '167');
  assert.strictEqual((await call(S, '/net/http', { url: 'http://192.168.1.1/' })).err, '167');
  assert.strictEqual((await call(S, '/net/http', { url: 'http://[::ffff:10.0.0.1]/' })).err, '167');
  assert.strictEqual((await call(S, '/net/udp/send', { id: 1, host: '169.254.169.254', port: 9 })).err, '144');
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.0.9', '169.254.1.1', '::1', 'fd00::1']) assert.ok(netapi.isPrivate(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1']) assert.ok(!netapi.isPrivate(ip), ip);

  const echo = net.createServer((s) => s.on('data', (d) => s.write(Buffer.concat([Buffer.from('echo:'), d])))).listen(0, '127.0.0.1');
  await new Promise((r) => echo.once('listening', r));
  const o = await call(L, '/net/tcp/open', { host: '127.0.0.1', port: echo.address().port });
  await call(L, '/net/tcp/write', { id: o.meta.id }, Buffer.from('hi'));
  await new Promise((r) => setTimeout(r, 100));
  const rd = await call(L, '/net/tcp/read', { id: o.meta.id, n: 100 });
  assert.strictEqual(rd.body.toString(), 'echo:hi');
  await call(L, '/net/tcp/close', { id: o.meta.id });

  const web = http.createServer((q, p) => { let b = ''; q.on('data', (d) => b += d); q.on('end', () => { p.setHeader('X-T', '1'); p.end(q.method + ':' + b); }); }).listen(0, '127.0.0.1');
  await new Promise((r) => web.once('listening', r));
  const h = await call(L, '/net/http', { method: 'POST', url: 'http://127.0.0.1:' + web.address().port + '/' }, Buffer.from('x=1'));
  assert.strictEqual(h.body.toString(), 'POST:x=1'); assert.strictEqual(h.meta.status, 200);

  const lp = await call(L, '/net/tcp/listen', { port: 0 });
  assert.strictEqual((await call(L, '/net/tcp/accept', { id: lp.meta.id })).err, '209');

  strict.closeAll(); lan.closeAll();
  [S, L, echo, web].forEach((s) => s.close());
  console.log('netapi ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
