/* AC.Transport - one small interface between an app and "wherever FujiNet things live".
   An app builds requests ({op, args, body}) and never knows which link carries them.

     t.open()          -> Promise<status>        connect / probe (idempotent)
     t.send(msg)       -> Promise<reply>         msg = {op, args?, body?: Uint8Array}
                                                 reply = {ok, meta, body: Uint8Array|null, error: {name, code, message}|null}
     t.receive(ms?)    -> Promise<event|null>    next unsolicited message (pushed by the far end), null on timeout
     t.close()         -> Promise<void>
     t.status()        -> {kind, state: 'closed'|'open'|'error', caps, error, parts?}
     t.on(evt, fn) / t.off(evt, fn)              evt: 'status' | 'message' | 'error'

   Backends: relay (HTTP to tools/tnfs-bridge), emulator (the emulator page, by BroadcastChannel or a direct call),
   local (File System Access folders, scheme 'pc'), loopback (in memory, for tests), router (picks one by op prefix).
   See docs/TRANSPORT.md. Works in a browser (AC.Transport) and in Node (module.exports). */
(function () {
  const AC = typeof window !== 'undefined' ? (window.AC = window.AC || {}) : {};
  const PROTOCOL = 1;
  // code = protocol error number (docs/ARCH-TRANSPORT.md section 5); native = the backend's own number (relay X-AC-Err, HTTP status) when it has one.
  const ERRORS = { OK: 0, Error: 1, NotFound: 2, Exists: 3, NotAllowed: 4, BadToken: 5, Unreachable: 6, Unsupported: 7, BadFrame: 8, BadChecksum: 9, TooLarge: 10, Timeout: 11, Busy: 12, BadVersion: 13, Aborted: 14, OutOfOrder: 15 };
  const err = (name, message, native) => { const e = { name, message, code: ERRORS[name] == null ? ERRORS.Error : ERRORS[name] }; if (native) e.native = native; return e; };
  const fail = (name, message, native) => ({ ok: false, meta: {}, body: null, error: err(name, message, native) });
  const okr = (meta, body) => ({ ok: true, meta: meta || {}, body: body || null, error: null });
  const bytes = (b) => (b == null ? new Uint8Array(0) : b instanceof Uint8Array ? b : b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b));
  const dec = (u) => new TextDecoder().decode(u);
  const enc = (s) => new TextEncoder().encode(s);

  // Operations that change something. Backends that know the far end is read-only refuse these without sending them.
  const WRITE_OPS = new Set(['fs.write', 'fs.mkdir', 'fs.rmdir', 'fs.unlink', 'fs.rename', 'dosboot.record', 'dosboot.rescan']);
  const isWrite = (m) => WRITE_OPS.has(m.op) || (m.op === 'net.http' && /^(PUT|DELETE|PATCH)$/i.test((m.args && m.args.method) || ''));

  function base(kind) {
    const subs = {}, queue = [], waiters = [];
    const t = {
      kind, state: 'closed', caps: null, error: null,
      on(e, f) { (subs[e] = subs[e] || []).push(f); return t; },
      off(e, f) { subs[e] = (subs[e] || []).filter((x) => x !== f); return t; },
      emit(e, d) { for (const f of subs[e] || []) { try { f(d); } catch (x) { /* a listener must not break the link */ } } },
      push(msg) {
        const w = waiters.shift();
        if (w) { clearTimeout(w.t); w.res(msg); } else { queue.push(msg); if (queue.length > 500) queue.shift(); }
        t.emit('message', msg);
      },
      receive(ms) {
        if (queue.length) return Promise.resolve(queue.shift());
        return new Promise((res) => { const w = { res, t: setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); res(null); }, ms == null ? 30000 : ms) }; waiters.push(w); });
      },
      set(state, error) { const ch = state !== t.state || error !== t.error; t.state = state; t.error = error || null; if (ch) t.emit('status', t.status()); },
      status() { return { kind, state: t.state, caps: t.caps, error: t.error }; },
      async close() { t.set('closed'); },
    };
    return t;
  }

  // ---------------------------------------------------------------- relay (HTTP to tools/tnfs-bridge)
  const RELAY_ERR = { 167: ['NotAllowed', 'refused: the relay is read-only (start it with --allow-write)'], 170: ['NotFound', 'not found'], 201: ['NotFound', 'not found'], 146: ['Unsupported', 'the relay has no such folder (start it with --sd FOLDER)'], 151: ['Exists', 'already exists'] };
  function relay(o) {
    o = o || {};
    const t = base('relay');
    const url = () => String(o.base || '').replace(/\/$/, '');
    const tok = () => (typeof o.token === 'function' ? o.token() : o.token) || '';
    const doFetch = o.fetch || ((...a) => fetch(...a));
    async function rpc(route, args, body, method) {
      let r;
      try { r = await doFetch(url() + route, { method: method || 'POST', headers: { 'X-AC-Token': tok(), 'X-AC-Args': encodeURIComponent(JSON.stringify(args || {})) }, body: body && body.length ? body : undefined }); }
      catch (e) { t.set('error', 'relay not reachable at ' + url()); return fail('Unreachable', 'relay not reachable at ' + url() + ' (start it with start.cmd / ./start.sh)'); }
      if (r.status === 403) { t.set('error', 'token'); return fail('BadToken', 'the relay refused the token (open the page through the relay address, or paste the token)', 403); }
      if (r.status === 404) return fail('Unsupported', 'the relay does not know ' + route, 404);
      if (r.status !== 200) {
        const c = +(r.headers.get('X-AC-Err') || 0), e = RELAY_ERR[c];
        return fail(e ? e[0] : 'Error', e ? e[1] : 'relay error ' + (c || r.status), c || r.status);
      }
      let meta = {};
      try { meta = JSON.parse(decodeURIComponent(r.headers.get('X-AC-Meta') || '%7B%7D')); } catch (e) { /* no meta */ }
      return okr(meta, new Uint8Array(await r.arrayBuffer()));
    }
    const json = (r) => (r.ok ? okr({ value: JSON.parse(dec(r.body)) }) : r);
    const fsArgs = (a) => ({ host: a.host, path: a.path || '/', user: a.user, pass: a.pass, port: a.port });
    const OPS = {
      'fs.list': async (m) => json(await rpc('/net/' + m.args.scheme + '/list', fsArgs(m.args))),
      'fs.read': (m) => rpc('/net/' + m.args.scheme + '/file', fsArgs(m.args)),
      'fs.write': (m) => rpc('/net/' + m.args.scheme + '/put', Object.assign(fsArgs(m.args), { append: !!m.args.append }), bytes(m.body)),
      'fs.mkdir': (m) => rpc('/net/' + m.args.scheme + '/op', Object.assign(fsArgs(m.args), { op: 'mkdir' })),
      'fs.rmdir': (m) => rpc('/net/' + m.args.scheme + '/op', Object.assign(fsArgs(m.args), { op: 'rmdir' })),
      'fs.unlink': (m) => rpc('/net/' + m.args.scheme + '/op', Object.assign(fsArgs(m.args), { op: 'unlink' })),
      'fs.rename': (m) => rpc('/net/' + m.args.scheme + '/op', Object.assign(fsArgs(m.args), { op: 'rename', to: m.args.to })),
      'net.http': (m) => rpc('/net/http', m.args, bytes(m.body)),
      'net.tcp.open': (m) => rpc('/net/tcp/open', m.args), 'net.tcp.read': (m) => rpc('/net/tcp/read', m.args), 'net.tcp.write': (m) => rpc('/net/tcp/write', m.args, bytes(m.body)), 'net.tcp.close': (m) => rpc('/net/tcp/close', m.args),
      'net.udp.open': (m) => rpc('/net/udp/open', m.args), 'net.udp.read': (m) => rpc('/net/udp/read', m.args), 'net.udp.send': (m) => rpc('/net/udp/send', m.args, bytes(m.body)), 'net.udp.close': (m) => rpc('/net/udp/close', m.args),
      'relay.caps': (m) => rpc('/net/caps', {}),
    };
    // dosboot answers only to same-origin pages (no CORS); reads are GET, edits are POST with the token
    const dos = async (method, path, q, body) => {
      let r;
      try { r = await doFetch(url() + '/dosboot/' + path + (q ? '?' + new URLSearchParams(q) : ''), { method, headers: { 'X-AC-Token': tok() }, body: body || undefined }); } catch (e) { return fail('Unreachable', 'relay not reachable'); }
      if (!r.ok) { let m = 'dosboot error ' + r.status; try { m = (await r.json()).error || m; } catch (e) { /* not json */ } return fail(r.status === 403 ? 'BadToken' : r.status === 404 ? 'NotFound' : 'Error', m, r.status); }
      const b = new Uint8Array(await r.arrayBuffer());
      return okr({}, b);
    };
    OPS['dosboot.roots'] = async () => { const r = await dos('GET', 'roots'); return r.ok ? okr({ value: JSON.parse(dec(r.body)) }) : r; };
    OPS['dosboot.media'] = (m) => dos('GET', 'media', m.args);
    OPS['dosboot.rescan'] = (m) => dos('POST', 'rescan', { root: m.args.root });
    OPS['dosboot.record'] = (m) => dos('POST', 'record', { root: m.args.root }, JSON.stringify({ record: m.args.record, delete: m.args.delete }));
    t.open = async () => {
      let r = await rpc('/net/caps', {});
      if (r.ok) { t.caps = Object.assign({ protocol: PROTOCOL }, r.meta && r.meta.caps ? r.meta.caps : JSON.parse(dec(r.body) || '{}')); t.set('open'); return t.status(); }
      if (r.error.name === 'Unsupported') { // an older relay: no caps endpoint, the relay itself still refuses writes
        try { const p = await doFetch(url() + '/ping'); if (/tnfs-bridge/.test(await p.text())) { t.caps = { protocol: 0, allowWrite: null }; t.set('open'); return t.status(); } } catch (e) { /* unreachable */ }
      }
      t.caps = null; t.set('error', r.error.message); return t.status();
    };
    t.send = async (m) => {
      const h = OPS[m.op];
      if (!h) return fail('Unsupported', 'the relay transport has no operation ' + m.op);
      if (isWrite(m) && t.caps && t.caps.allowWrite === false) return fail('NotAllowed', 'refused: the relay is read-only (start it with --allow-write)', 167);
      try { return await h(m); } catch (e) { return fail('Error', String(e && e.message || e)); }
    };
    return t;
  }

  // ---------------------------------------------------------------- emulator (the Ataricraft page)
  // Same-origin tabs talk over a BroadcastChannel; a page that holds the emulator object can pass `target` ({handle(op,args,body)}).
  function emulator(o) {
    o = o || {};
    const t = base('emulator'), pending = new Map();
    let ch = null, nid = 1;
    const name = o.channel || 'fujiexplorer';
    function listen() {
      if (ch || o.target || typeof BroadcastChannel === 'undefined') return;
      ch = new BroadcastChannel(name);
      ch.onmessage = (e) => {
        const d = e.data || {};
        if (d.t === 'fx-res' && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); clearTimeout(p.timer); p.res(d.ok ? okr(d.meta, d.body ? bytes(d.body) : null) : { ok: false, meta: {}, body: null, error: d.error || err('Error', 'failed') }); }
        else if (d.t === 'fx-evt') { if (d.event && d.event.op === 'emu.hello' && t.state !== 'open') t.open(); t.push(d.event); }
      };
    }
    const call = (m) => {
      if (o.target) return Promise.resolve(o.target.handle(m.op, m.args || {}, m.body)).then((r) => r, (e) => fail('Error', String(e && e.message || e)));
      listen();
      if (!ch) return Promise.resolve(fail('Unsupported', 'BroadcastChannel is not available'));
      const id = nid++;
      return new Promise((res) => {
        const timer = setTimeout(() => { pending.delete(id); res(fail('Unreachable', 'no emulator tab answered (open index.html in this browser and boot it)')); }, o.timeout || 2500);
        pending.set(id, { res, timer });
        ch.postMessage({ t: 'fx-req', id, op: m.op, args: m.args || {}, body: m.body || null });
      });
    };
    t.open = async () => {
      listen();
      const r = await call({ op: 'emu.ping' });
      if (r.ok) { t.caps = Object.assign({ protocol: PROTOCOL }, r.meta.value || r.meta); t.set('open'); } else { t.caps = null; t.set('closed', r.error.message); }
      return t.status();
    };
    t.send = (m) => call(m);
    t.close = async () => { if (ch) { ch.close(); ch = null; } t.set('closed'); };
    return t;
  }

  // Emulator-side half: wires a handler table to the channel. handlers[op](args, body) -> value | {meta, body}
  function serve(handlers, o) {
    o = o || {};
    const handle = async (op, args, body) => {
      const h = handlers[op];
      if (!h) return fail('Unsupported', 'unknown operation ' + op);
      try { const v = await h(args || {}, body ? bytes(body) : null); return v && v.__r ? v.r : okr(v && v.meta ? v.meta : { value: v === undefined ? null : v }, v && v.body ? v.body : null); }
      catch (e) { return fail(e && e.name && e.name !== 'Error' ? e.name : 'Error', String(e && e.message || e)); }
    };
    let ch = null;
    if (typeof BroadcastChannel !== 'undefined') {
      ch = new BroadcastChannel(o.channel || 'fujiexplorer');
      ch.onmessage = async (e) => {
        const d = e.data || {};
        if (d.t !== 'fx-req') return;
        const r = await handle(d.op, d.args, d.body);
        ch.postMessage({ t: 'fx-res', id: d.id, ok: r.ok, meta: r.meta, body: r.body, error: r.error });
      };
    }
    return { handle, announce: (event) => { if (ch) ch.postMessage({ t: 'fx-evt', event }); }, close: () => { if (ch) ch.close(); } };
  }

  // ---------------------------------------------------------------- loopback (in memory, for tests and offline demos)
  // Has a small memory file system under scheme 'mem'; extra handlers can be supplied or added with lb.handle(op, fn).
  function loopback(o) {
    o = o || {};
    const t = base('loopback'), log = [], h = Object.assign({}, o.handlers);
    const files = new Map(), dirs = new Set(['/']);
    const norm = (p) => '/' + String(p || '/').split('/').filter(Boolean).join('/');
    const parent = (p) => p.slice(0, p.lastIndexOf('/')) || '/';
    const nf = (p) => fail('NotFound', 'not found: ' + p, 170);
    t.caps = Object.assign({ protocol: PROTOCOL, allowWrite: o.allowWrite !== false, sd: true, loopback: true }, o.caps);
    const mem = {
      'fs.list': (m) => { const p = norm(m.args.path); if (!dirs.has(p)) return nf(p); const out = []; for (const d of dirs) if (d !== '/' && parent(d) === p) out.push({ name: d.split('/').pop(), dir: true, size: 0, mtime: 0 }); for (const [f, v] of files) if (parent(f) === p) out.push({ name: f.split('/').pop(), dir: false, size: v.length, mtime: 0 }); return okr({ value: out }); },
      'fs.read': (m) => { const p = norm(m.args.path); return files.has(p) ? okr({}, files.get(p)) : nf(p); },
      'fs.write': (m) => { const p = norm(m.args.path); if (!dirs.has(parent(p))) return nf(parent(p)); const old = m.args.append && files.get(p) || new Uint8Array(0), b = bytes(m.body), n = new Uint8Array(old.length + b.length); n.set(old); n.set(b, old.length); files.set(p, n); return okr(); },
      'fs.mkdir': (m) => { const p = norm(m.args.path); if (dirs.has(p) || files.has(p)) return fail('Exists', 'already exists', 151); if (!dirs.has(parent(p))) return nf(parent(p)); dirs.add(p); return okr(); },
      'fs.rmdir': (m) => { const p = norm(m.args.path); if (!dirs.has(p)) return nf(p); if ([...dirs].some((d) => d !== p && parent(d) === p) || [...files.keys()].some((f) => parent(f) === p)) return fail('NotAllowed', 'directory not empty', 167); dirs.delete(p); return okr(); },
      'fs.unlink': (m) => { const p = norm(m.args.path); return files.delete(p) ? okr() : nf(p); },
      'fs.rename': (m) => { const a = norm(m.args.path), b = norm(m.args.to); if (files.has(a)) { files.set(b, files.get(a)); files.delete(a); return okr(); } if (dirs.has(a)) { dirs.delete(a); dirs.add(b); return okr(); } return nf(a); },
      'relay.caps': () => okr({ caps: t.caps }, enc(JSON.stringify(t.caps))),
      'echo': (m) => okr(m.args, m.body),
    };
    t.files = files; t.dirs = dirs; t.log = log;
    t.handle = (op, fn) => { h[op] = fn; return t; };
    t.open = async () => { t.set('open'); return t.status(); };
    t.send = async (m) => {
      log.push({ op: m.op, args: m.args, size: m.body ? m.body.length : 0 });
      if (t.state !== 'open') return fail('Closed', 'the transport is not open');
      if (o.latency) await new Promise((r) => setTimeout(r, o.latency));
      if (isWrite(m) && t.caps.allowWrite === false) return fail('NotAllowed', 'refused: read-only', 167);
      const f = h[m.op] || (m.args && m.args.scheme === 'mem' || !String(m.op).startsWith('fs.') ? mem[m.op] : null);
      if (!f) return fail('Unsupported', 'no handler for ' + m.op);
      try { const r = await f(m); return r && typeof r.ok === 'boolean' ? r : okr(r && r.meta, r && r.body); } catch (e) { return fail('Error', String(e && e.message || e)); }
    };
    return t;
  }

  // ---------------------------------------------------------------- local (File System Access folders, scheme 'pc')
  function local(o) {
    o = o || {};
    const t = base('local'), roots = new Map(o.roots || []);
    t.caps = { protocol: PROTOCOL, allowWrite: true, scheme: 'pc' };
    t.addRoot = (name, handle) => { roots.set(name, handle); t.emit('status', t.status()); };
    t.roots = () => [...roots.keys()];
    const parts = (p) => String(p || '/').split('/').filter(Boolean);
    async function dirAt(root, ps, create) { let d = roots.get(root); if (!d) throw Object.assign(new Error('no such folder mount ' + root), { name: 'NotFound' }); for (const p of ps) d = await d.getDirectoryHandle(p, { create: !!create }); return d; }
    const wrap = async (fn) => { try { return await fn(); } catch (e) { const n = e && e.name; return fail(n === 'NotFoundError' || n === 'NotFound' ? 'NotFound' : n === 'NotAllowedError' ? 'NotAllowed' : n === 'InvalidModificationError' ? 'NotAllowed' : 'Error', String(e && e.message || e)); } };
    const OPS = {
      'fs.list': (m) => wrap(async () => { const d = await dirAt(m.args.host, parts(m.args.path)), out = []; for await (const [n, h] of d.entries()) { let size = 0, mtime = 0; if (h.kind === 'file') { const f = await h.getFile(); size = f.size; mtime = f.lastModified; } out.push({ name: n, dir: h.kind === 'directory', size, mtime }); } return okr({ value: out }); }),
      'fs.read': (m) => wrap(async () => { const ps = parts(m.args.path), n = ps.pop(), d = await dirAt(m.args.host, ps); return okr({}, new Uint8Array(await (await (await d.getFileHandle(n)).getFile()).arrayBuffer())); }),
      'fs.write': (m) => wrap(async () => { const ps = parts(m.args.path), n = ps.pop(), d = await dirAt(m.args.host, ps), fh = await d.getFileHandle(n, { create: true }); let old = new Uint8Array(0); if (m.args.append) old = new Uint8Array(await (await fh.getFile()).arrayBuffer()); const w = await fh.createWritable(); await w.write(old.length ? new Blob([old, bytes(m.body)]) : bytes(m.body)); await w.close(); return okr(); }),
      'fs.mkdir': (m) => wrap(async () => { const ps = parts(m.args.path), n = ps.pop(); await (await dirAt(m.args.host, ps)).getDirectoryHandle(n, { create: true }); return okr(); }),
      'fs.rmdir': (m) => wrap(async () => { const ps = parts(m.args.path), n = ps.pop(); await (await dirAt(m.args.host, ps)).removeEntry(n); return okr(); }),
      'fs.unlink': (m) => wrap(async () => { const ps = parts(m.args.path), n = ps.pop(); await (await dirAt(m.args.host, ps)).removeEntry(n); return okr(); }),
      'fs.rename': (m) => wrap(async () => {
        const a = parts(m.args.path), an = a.pop(), b = parts(m.args.to), bn = b.pop(), da = await dirAt(m.args.host, a), db = await dirAt(m.args.host, b, true);
        const fh = await da.getFileHandle(an), data = new Uint8Array(await (await fh.getFile()).arrayBuffer()); // files only; folders are moved by hand
        const w = await (await db.getFileHandle(bn, { create: true })).createWritable(); await w.write(data); await w.close(); await da.removeEntry(an); return okr();
      }),
    };
    t.open = async () => { t.set('open'); return t.status(); };
    t.send = async (m) => { const f = OPS[m.op]; return f ? f(m) : fail('Unsupported', 'the local transport has no operation ' + m.op); };
    return t;
  }

  // ---------------------------------------------------------------- router
  // parts: {relay, emulator, local, fallback}. emu.* -> emulator, fs.* with scheme 'pc' -> local, everything else -> relay (or fallback).
  function router(parts) {
    const t = base('router');
    const pick = (m) => (m.op.startsWith('emu.') ? parts.emulator : m.op.startsWith('fs.') && m.args && m.args.scheme === 'pc' ? parts.local : parts.relay) || parts.fallback;
    const all = () => Object.entries(parts).filter(([, v]) => v && v.send);
    for (const [, p] of all()) { p.on('message', (d) => t.push(d)); p.on('status', () => t.emit('status', t.status())); }
    t.status = () => { const ps = {}; for (const [k, p] of all()) ps[k] = p.status(); const states = Object.values(ps).map((x) => x.state); return { kind: 'router', state: states.includes('open') ? 'open' : states.includes('error') ? 'error' : 'closed', caps: (ps.relay || {}).caps || null, error: null, parts: ps }; };
    t.open = async () => { await Promise.all(all().map(([, p]) => p.open())); t.emit('status', t.status()); return t.status(); };
    t.close = async () => { await Promise.all(all().map(([, p]) => p.close())); };
    t.send = async (m) => { const p = pick(m); return p ? p.send(m) : fail('Unsupported', 'no backend for ' + m.op); };
    t.part = (k) => parts[k];
    return t;
  }

  // Convenience: send and either return the reply or throw an Error whose .name is the error name.
  async function call(t, op, args, body) {
    const r = await t.send({ op, args: args || {}, body: body || null });
    if (!r.ok) { const e = new Error(r.error.message); e.name = r.error.name; e.code = r.error.code; if (r.error.native) e.native = r.error.native; throw e; }
    return r;
  }

  const api = { PROTOCOL, WRITE_OPS, isWrite, relay, emulator, serve, loopback, local, router, call, fail, ok: okr, bytes };
  AC.Transport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
