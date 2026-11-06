// Loopback transport over the real framing: client <-> wire (with optional faults) <-> server, in one process.
// Same interface as web/js/transport.js (open/send/receive/close/status/on/off, replies {ok,meta,body,error}), so apps and tests
// can run against it, and the framing, chunking, checksums and retries get exercised for real.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    let T = null; try { T = require('../../web/js/transport.js'); } catch (e) { /* write-op list falls back to the built-in copy */ }
    module.exports = factory(require('./util.cjs'), require('./framing.cjs'), T);
  } else { const C = (root.AC = root.AC || {}).CraftCore; C.loopback = factory(C.util, C.framing, root.AC.Transport); }
})(typeof self !== 'undefined' ? self : this, function (U, F, T) {
  'use strict';

  const WRITE_OPS = T ? T.WRITE_OPS : new Set(['fs.write', 'fs.mkdir', 'fs.rmdir', 'fs.unlink', 'fs.rename', 'sql.exec', 'container.put', 'disk.write']);
  const isWrite = (m) => (T ? T.isWrite(m) : WRITE_OPS.has(m.op)) || m.op === 'sql.exec' || m.op === 'container.put' || m.op === 'disk.write';
  const fail = (name, message) => ({ ok: false, meta: {}, body: null, error: { name, code: F.errorCode(name), message } });

  // Two connected byte pipes. faults: {seed, drop, corrupt, dup, fragment} are probabilities per write; corrupt flips 1-3 bits (CRC-16 always catches that).
  function wirePair(faults) {
    faults = faults || {}; const rnd = U.prng(faults.seed == null ? 1 : faults.seed), stats = { writes: 0, dropped: 0, corrupted: 0, duplicated: 0 };
    const ends = [{ onBytes: null }, { onBytes: null }];
    const deliver = (to, bytes) => {
      const parts = []; let p = 0;
      if (faults.fragment && rnd() < faults.fragment) { while (p < bytes.length) { const n = 1 + Math.floor(rnd() * 7); parts.push(bytes.slice(p, p + n)); p += n; } } else parts.push(bytes);
      for (const part of parts) setImmediate(() => to.onBytes && to.onBytes(part));
    };
    const mk = (from, to) => ({
      write(bytes) {
        stats.writes++; bytes = U.u8(bytes).slice();
        if (faults.drop && rnd() < faults.drop) { stats.dropped++; return; }
        if (faults.corrupt && rnd() < faults.corrupt) { stats.corrupted++; const k = 1 + Math.floor(rnd() * 3); for (let i = 0; i < k; i++) bytes[Math.floor(rnd() * bytes.length)] ^= 1 << Math.floor(rnd() * 8); }
        deliver(to, bytes);
        if (faults.dup && rnd() < faults.dup) { stats.duplicated++; deliver(to, bytes); }
      },
    });
    const a = ends[0], b = ends[1]; Object.assign(a, mk(a, b)); Object.assign(b, mk(b, a));
    return { a, b, stats };
  }

  // o: {maxChunk, crc32, faults, ackTimeoutMs, retries, replyTimeoutMs, caps:{allowWrite}, handlers:{op: (args, body, ctx) => reply|{meta,body}}}
  function loopback(o) {
    o = o || {};
    const caps = Object.assign({ protocol: F.PROTOCOL, allowWrite: true, maxChunk: o.maxChunk || 128 }, o.caps);
    const scaps = Object.assign({}, caps), wire = wirePair(o.faults), handlers = Object.assign({}, o.handlers), pendingReplies = new Map(), subs = {}, queue = [], waiters = [];
    let nextId = 1, nextEvt = 1, state = 'closed', error = null;
    const emit = (e, d) => { for (const f of subs[e] || []) { try { f(d); } catch (x) { /* a listener must not break the link */ } } };
    const set = (s, e) => { if (s !== state || e !== error) { state = s; error = e || null; emit('status', t.status()); } };
    const epOpts = { maxChunk: caps.maxChunk, crc32: !!o.crc32, ackTimeoutMs: o.ackTimeoutMs || 20, retries: o.retries };

    const client = new F.Endpoint(Object.assign({}, epOpts, {
      write: (b) => wire.a.write(b),
      onMessage: (m) => {
        if (m.type === F.TYPE.EVT) { try { push(F.decodeRequest(m.payload)); } catch (e) { /* ignore a damaged event */ } return; }
        const p = pendingReplies.get(m.msgId); if (!p) return;
        pendingReplies.delete(m.msgId); clearTimeout(p.timer);
        try { p.res(F.decodeReply(m.type, m.payload)); } catch (e) { p.res(fail(e.errorName || 'BadFrame', e.message)); }
      },
    }));
    const server = new F.Endpoint(Object.assign({}, epOpts, {
      write: (b) => wire.b.write(b),
      onMessage: async (m) => {
        if (m.type !== F.TYPE.REQ) return;
        let reply;
        try {
          const req = F.decodeRequest(m.payload);
          if (!scaps.allowWrite && isWrite(req)) reply = fail('NotAllowed', 'refused: the far end is read-only');
          else if (req.op === 'sys.hello') reply = { ok: true, meta: { protocol: F.PROTOCOL, caps: scaps }, body: null };
          else if (req.op === 'sys.ping' || req.op === 'sys.echo') reply = { ok: true, meta: req.args, body: req.body };
          else if (!handlers[req.op]) reply = fail('Unsupported', 'no handler for ' + req.op);
          else { const r = await handlers[req.op](req.args, req.body, { caps: scaps }); reply = r && 'ok' in r ? r : { ok: true, meta: (r && r.meta) || {}, body: (r && r.body) || null }; }
        } catch (e) { reply = fail(e.errorName || (F.ERRORS[e.name] != null ? e.name : 'Error'), String(e.message || e)); }
        const enc = F.encodeReply(reply);
        try { await server.send(enc.type, m.msgId, enc.payload); } catch (e) { /* the client's reply timeout reports it */ }
      },
    }));
    wire.a.onBytes = (b) => client.receive(b); wire.b.onBytes = (b) => server.receive(b);

    function push(msg) {
      const w = waiters.shift();
      if (w) { clearTimeout(w.t); w.res(msg); } else { queue.push(msg); if (queue.length > 500) queue.shift(); }
      emit('message', msg);
    }
    const t = {
      kind: 'craftcore-loopback', client, server, wire, caps,
      on(e, f) { (subs[e] = subs[e] || []).push(f); return t; },
      off(e, f) { subs[e] = (subs[e] || []).filter((x) => x !== f); return t; },
      status() { return { kind: t.kind, state, caps, error }; },
      async open() {
        set('open'); const r = await t.send({ op: 'sys.hello' });
        if (!r.ok) { set('error', r.error.message); return t.status(); }
        Object.assign(caps, r.meta.caps); set('open'); return t.status();
      },
      async close() { for (const [, p] of pendingReplies) { clearTimeout(p.timer); p.res(fail('Aborted', 'link closed')); } pendingReplies.clear(); set('closed'); },
      // never throws: failures come back as {ok:false, error}
      async send(m) {
        if (state === 'closed' && m.op !== 'sys.hello') return fail('Unreachable', 'transport is closed');
        if (!caps.allowWrite && isWrite(m)) return fail('NotAllowed', 'refused: the far end is read-only');
        let payload; try { payload = F.encodeRequest(m); } catch (e) { return fail(e.errorName || 'BadFrame', e.message); }
        const id = nextId; nextId = (nextId % 0xffff) + 1;
        const reply = new Promise((res) => { pendingReplies.set(id, { res, timer: setTimeout(() => { pendingReplies.delete(id); res(fail('Timeout', 'no reply for ' + m.op)); }, o.replyTimeoutMs || 5000) }); });
        try { await client.send(F.TYPE.REQ, id, payload); } catch (e) { const p = pendingReplies.get(id); if (p) { clearTimeout(p.timer); pendingReplies.delete(id); } return fail(e.errorName || 'Error', e.message); }
        return reply;
      },
      receive(ms) {
        if (queue.length) return Promise.resolve(queue.shift());
        return new Promise((res) => { const w = { res, t: setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); res(null); }, ms == null ? 30000 : ms) }; waiters.push(w); });
      },
      // test helpers (the far end)
      handle(op, fn) { handlers[op] = fn; return t; },
      async pushEvent(op, args, body) { await server.send(F.TYPE.EVT, nextEvt, F.encodeRequest({ op, args, body })); nextEvt = (nextEvt % 0xffff) + 1; },
    };
    return t;
  }
  return { loopback, wirePair, isWrite };
});
