// /ctl/* endpoints: lets scripts outside the browser drive the emulator page.
//   page   -> POST /ctl/poll    long-poll; returns the next queued command ({id, method, args}) or 204 after ~20 s
//   page   -> POST /ctl/result  {id, ok, result|error}
//   caller -> POST /ctl/call    {method, args:[...]} -> waits for the page's answer (30 s) and returns {ok, result|error}
//   either -> POST /ctl/info    this PC's IPv4 interfaces (for the page's "Use this PC's address")
// All need the X-AC-Token header (same token as /net/*). The page decides what is allowed (see AC.Remote in web/js/inspect.js).
const os = require('os');
const crypto = require('crypto');

function create(token) {
  const queue = [], waiters = [], pending = new Map();
  let lastPoll = 0, nextId = 1;
  const okTok = (rq) => { const g = Buffer.from(String(rq.headers['x-ac-token'] || '')), w = Buffer.from(token); return g.length === w.length && crypto.timingSafeEqual(g, w); };
  const body = (rq) => new Promise((res) => { const c = []; let n = 0; rq.on('data', (d) => { n += d.length; if (n > 64 << 20) rq.destroy(); else c.push(d); }); rq.on('end', () => res(Buffer.concat(c).toString('utf8'))); rq.on('error', () => res('')); });
  const json = (rs, code, o) => { rs.writeHead(code, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(o)); };
  function dispatch(c) { const w = waiters.shift(); if (w) { clearTimeout(w.t); json(w.rs, 200, c); } else queue.push(c); }
  function interfaces() {
    const out = [];
    for (const [name, as] of Object.entries(os.networkInterfaces())) for (const a of as) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address, netmask: a.netmask, mac: a.mac });
    return out;
  }
  async function handle(rq, rs, pathname) {
    if (rq.method !== 'POST' || !okTok(rq)) { rs.writeHead(403); rs.end('token'); return; }
    const t = await body(rq);
    if (pathname === '/ctl/info') return json(rs, 200, { interfaces: interfaces(), page: Date.now() - lastPoll < 30000 });
    if (pathname === '/ctl/poll') {
      lastPoll = Date.now();
      if (queue.length) return json(rs, 200, queue.shift());
      const w = { rs, t: setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); rs.writeHead(204); rs.end(); }, 20000) };
      rq.on('close', () => { const i = waiters.indexOf(w); if (i >= 0) { clearTimeout(w.t); waiters.splice(i, 1); } });
      waiters.push(w); return;
    }
    if (pathname === '/ctl/result') {
      let r; try { r = JSON.parse(t); } catch (e) { rs.writeHead(400); rs.end(); return; }
      const p = pending.get(r.id); if (p) { clearTimeout(p.t); pending.delete(r.id); json(p.rs, 200, r); }
      rs.writeHead(204); rs.end(); return;
    }
    if (pathname === '/ctl/call') {
      let c; try { c = JSON.parse(t); } catch (e) { return json(rs, 400, { ok: false, error: 'bad json' }); }
      if (typeof c.method !== 'string') return json(rs, 400, { ok: false, error: 'method required' });
      if (Date.now() - lastPoll > 30000) return json(rs, 503, { ok: false, error: 'no emulator page connected (open the relay address in a browser)' });
      const id = nextId++;
      pending.set(id, { rs, t: setTimeout(() => { pending.delete(id); json(rs, 504, { ok: false, error: 'timeout' }); }, 30000) });
      dispatch({ id, method: c.method, args: Array.isArray(c.args) ? c.args : [] }); return;
    }
    rs.writeHead(404); rs.end();
  }
  return { handle };
}
module.exports = { create };
