// Local relay API for DOS boot records: serves the folders registered by scripts/dosboot-scan.cjs (or --dos DIR) to the emulator.
// Same-origin only (no CORS headers, local Host header required); writes need the relay token.
const fs = require('fs'), path = require('path'), os = require('os');
const DB = require('../../web/js/dosboot.js');
const { scan, readMedia } = require('./scan.cjs');

function create(o) {
  const regFile = path.join(os.homedir(), '.ataricraft-dosboot.json');
  const rootsList = () => {
    const out = [];
    const add = (root, file) => { const r = path.resolve(root); if (!out.some((x) => x.root === r)) out.push({ root: r, file: file ? path.resolve(file) : path.join(r, 'dosboot.json') }); };
    try { for (const r of JSON.parse(fs.readFileSync(regFile, 'utf8')).roots || []) add(r.root, r.file); } catch (e) { /* no registry yet */ }
    for (const r of o.extraRoots || []) add(r);
    return out.filter((r) => fs.existsSync(r.root));
  };
  const load = (r) => { try { return DB.parse(fs.readFileSync(r.file, 'utf8')); } catch (e) { return { format: DB.FORMAT, version: DB.VERSION, root: r.root, records: [] }; } };
  const save = (r, doc) => { doc.root = r.root; fs.writeFileSync(r.file, JSON.stringify(doc, null, 2) + '\n'); };
  const send = (rs, code, body, type) => { rs.writeHead(code, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' }); rs.end(body); };
  const fail = (rs, code, msg) => send(rs, code, JSON.stringify({ error: msg }));
  const readBody = (rq) => new Promise((res, rej) => { const c = []; let n = 0; rq.on('data', (d) => { n += d.length; if (n > 1e6) { rq.destroy(); rej(new Error('too big')); } else c.push(d); }); rq.on('end', () => res(Buffer.concat(c))); rq.on('error', rej); });

  async function handle(rq, rs, u) {
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(rq.headers.host || '')) return fail(rs, 403, 'bad host');
    const sub = u.pathname.slice('/dosboot'.length);
    const list = rootsList();
    const pick = () => list[+u.searchParams.get('root')];
    try {
      if (rq.method === 'GET' && sub === '/roots') {
        return send(rs, 200, JSON.stringify({ writable: true, roots: list.map((r, i) => ({ i, root: r.root, file: r.file, exists: fs.existsSync(r.file), doc: load(r) })) }));
      }
      if (rq.method === 'GET' && sub === '/media') {
        const r = pick(); if (!r) return fail(rs, 404, 'no such root');
        const b = readMedia(r.root, { path: u.searchParams.get('path'), member: u.searchParams.get('member') || undefined });
        return send(rs, 200, b, 'application/octet-stream');
      }
      if (rq.method === 'POST') {
        if (rq.headers['x-ac-token'] !== o.token) return fail(rs, 403, 'token required');
        const r = pick(); if (!r) return fail(rs, 404, 'no such root');
        if (sub === '/rescan') {
          const found = scan(r.root, {});
          const doc = load(r);
          doc.records = DB.merge(doc, found.records);
          save(r, doc);
          return send(rs, 200, JSON.stringify({ records: doc.records.length, skipped: found.skipped.length }));
        }
        if (sub === '/record') {
          const body = JSON.parse((await readBody(rq)).toString('utf8'));
          const doc = load(r);
          if (body.delete) doc.records = doc.records.filter((x) => x.id !== body.delete);
          else {
            const errs = DB.validateRecord(body.record);
            if (errs.length) return fail(rs, 400, errs.join('; '));
            const rec = Object.assign({}, body.record, { userEdited: true });
            const i = doc.records.findIndex((x) => x.id === rec.id);
            if (i >= 0) doc.records[i] = rec; else doc.records.push(rec);
          }
          save(r, doc);
          return send(rs, 200, JSON.stringify({ ok: true, records: doc.records.length }));
        }
      }
      return fail(rs, 404, 'unknown dosboot call');
    } catch (e) { return fail(rs, 500, String(e.message || e)); }
  }
  return { handle };
}

module.exports = { create };
