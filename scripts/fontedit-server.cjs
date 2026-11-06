// Local server for the font editor with write-back: node scripts/fontedit-server.cjs [port]   then open http://localhost:8765/fontedit.html
// Serves web/ and lets the editor save the ACWriter faces to their real sources (tools/acwfaces.cjs). 127.0.0.1 only.
const http = require('http'), fs = require('fs'), path = require('path');
const A = require('../tools/acwfaces.cjs');
const WEB = path.join(__dirname, '..', 'web');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.acf': 'application/octet-stream' };

function create() {
  return http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split('?')[0]);
    const send = (code, body, type) => { r.writeHead(code, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' }); r.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
    const m = /^\/__acwface\/(\w+)$/.exec(u);
    if (u === '/__acwface' && q.method === 'GET') return send(200, A.FACES.map((f) => ({ id: f.id, adv: f.adv, override: A.hasOverride(f.id) })));
    if (m && !A.byId(m[1])) return send(404, { ok: false, msg: 'unknown face' });
    if (m && q.method === 'POST') {
      const chunks = []; q.on('data', (c) => chunks.push(c));
      return q.on('end', () => {
        try { const where = A.save(m[1], Buffer.concat(chunks)); A.writeWeb(); send(200, { ok: true, where }); } catch (e) { send(400, { ok: false, msg: e.message }); }
      });
    }
    if (m && q.method === 'DELETE') { try { A.reset(m[1]); A.writeWeb(); return send(200, { ok: true }); } catch (e) { return send(400, { ok: false, msg: e.message }); } }
    const p = path.normalize(path.join(WEB, u === '/' ? 'index.html' : u));
    if (!p.startsWith(WEB) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return send(404, 'not found', 'text/plain');
    send(200, fs.readFileSync(p), MIME[path.extname(p).toLowerCase()] || 'application/octet-stream');
  });
}
module.exports = { create };
if (require.main === module) {
  const port = +process.argv[2] || 8765;
  create().listen(port, '127.0.0.1', () => console.log('font editor: http://localhost:' + port + '/fontedit.html'));
}
