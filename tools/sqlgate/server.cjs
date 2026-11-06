// Local HTTP relay for the SQL gateway. Same conventions as tools/tnfs-bridge: 127.0.0.1 only, X-AC-Token, X-AC-Args (URI-encoded JSON),
// reply body + X-AC-Meta / X-AC-Err headers. Run: node tools/sqlgate/server.cjs [config.json] [port]
'use strict';
const http = require('http');
const crypto = require('crypto');
const { createGate, loadConfig, GateError } = require('./core.cjs');

function startServer(gate, opt) {
  opt = opt || {};
  const token = opt.token || process.env.AC_TOKEN || crypto.randomBytes(16).toString('hex');
  const tb = Buffer.from(token);
  const okTok = (t) => { const b = Buffer.from(String(t || '')); return b.length === tb.length && crypto.timingSafeEqual(b, tb); };
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Allow-Headers': 'X-AC-Token, X-AC-Args, Content-Type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Expose-Headers': 'X-AC-Meta, X-AC-Err' };
  const send = (res, status, body, meta, err) => {
    const h = Object.assign({ 'Content-Type': 'application/json' }, CORS);
    if (meta !== undefined) h['X-AC-Meta'] = encodeURIComponent(JSON.stringify(meta));
    if (err) h['X-AC-Err'] = encodeURIComponent(err);
    res.writeHead(status, h); res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const routes = {
    '/sql/caps': async () => gate.caps(),
    '/sql/tables': async (a) => gate.tables(a.db),
    '/sql/schema': async (a) => gate.schema(a.db, a.table),
    '/sql/query': async (a) => gate.query(a.db, a.sql, a.params, { maxRows: a.maxRows }),
    '/sql/exec': async (a) => gate.exec(a.db, a.sql, a.params),
  };
  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    const url = (req.url || '').split('?')[0], fn = routes[url];
    if (!okTok(req.headers['x-ac-token'])) return send(res, 403, { error: 'bad-token' }, undefined, 'bad-token');
    if (!fn) return send(res, 404, { error: 'no-route' }, undefined, 'no-route');
    let args = {};
    try { args = JSON.parse(decodeURIComponent(req.headers['x-ac-args'] || '{}')); if (!args || typeof args !== 'object' || Array.isArray(args)) throw 0; } catch (e) { return send(res, 400, { error: 'bad-args' }, undefined, 'bad-args'); }
    req.resume();
    fn(args).then((r) => send(res, 200, r, { ok: true }), (e) => {
      const code = e instanceof GateError ? e.code : 'internal';
      send(res, code === 'internal' ? 500 : 400, { error: code, message: e instanceof GateError ? e.message : 'internal error' }, { ok: false, code }, code);
    });
  });
  return new Promise((resolve) => server.listen(opt.port || 0, '127.0.0.1', () => resolve({ server, token, port: server.address().port, close: () => new Promise((r) => server.close(r)) })));
}

if (require.main === module) {
  const cfgFile = process.argv[2] || process.env.XCSQLGATE_CONFIG;
  if (!cfgFile) { console.error('usage: node tools/sqlgate/server.cjs <config.json> [port]   (or set XCSQLGATE_CONFIG)'); process.exit(2); }
  startServer(createGate(loadConfig(cfgFile)), { port: +process.argv[3] || 8766 }).then((s) => {
    console.log(`xcsqlgate on http://127.0.0.1:${s.port}`);
    console.log(process.env.AC_TOKEN ? 'token: from AC_TOKEN' : 'token: ' + s.token);
  });
}

module.exports = { startServer };
