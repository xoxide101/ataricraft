// In-memory buffer registry + event bus shared by the Craft tools (same origin, across tabs).
// A tool publishes unsaved data under a virtual path ("assets/font.fnt"); others resolve it by that path (e.g. the ASM panel's .INCLUDE).
//   AC.Buffers.set(path, bytesOrString, {source})   AC.Buffers.get(path) -> {path, data, meta, rev} | null
//   AC.Buffers.resolve(path) -> data | null (exact path, then same file name)    AC.Buffers.list()    AC.Buffers.remove(path)
//   AC.Buffers.on(fn) / off(fn)  fn({type:'set'|'remove', path, ...})
// Events are also dispatched on window as the DOM event 'craft:buffer' (detail = the same object) and synced between tabs over
// the BroadcastChannel 'ataricraft-buffers'. Nothing is written to disk.
(function (root, factory) {
  const B = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = B;
  else { root.AC = root.AC || {}; root.AC.Buffers = B; }
})(typeof self !== 'undefined' ? self : this, function (root) {
  const store = new Map(), subs = new Set();
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/{2,}/g, '/').toLowerCase();
  const base = (p) => p.slice(p.lastIndexOf('/') + 1);
  let ch = null;
  try { if (typeof BroadcastChannel !== 'undefined') ch = new BroadcastChannel('ataricraft-buffers'); } catch (e) { ch = null; }
  const emit = (ev) => {
    for (const f of [...subs]) { try { f(ev); } catch (e) { /* a bad subscriber must not stop the others */ } }
    try { if (root.dispatchEvent && typeof CustomEvent !== 'undefined') root.dispatchEvent(new CustomEvent('craft:buffer', { detail: ev })); } catch (e) { /* no DOM */ }
  };
  const put = (path, data, meta, rev, remote) => {
    const k = norm(path), old = store.get(k);
    if (old && remote && old.rev >= rev) return null;
    const e = { path: k, data: typeof data === 'string' ? data : Uint8Array.from(data), meta: meta || {}, rev: rev || ((old ? old.rev : 0) + 1) };
    store.set(k, e);
    return e;
  };
  const B = {
    set(path, data, meta) {
      const e = put(path, data, meta);
      emit({ type: 'set', path: e.path, rev: e.rev, meta: e.meta, size: e.data.length });
      if (ch) ch.postMessage({ t: 'set', path: e.path, data: e.data, meta: e.meta, rev: e.rev });
      return e;
    },
    get(path) { return store.get(norm(path)) || null; },
    has(path) { return store.has(norm(path)); },
    resolve(path) {
      const k = norm(path), e = store.get(k); if (e) return e.data;
      const b = base(k); let hit = null;
      for (const [p, v] of store) if (base(p) === b && (!hit || v.rev > hit.rev)) hit = v;
      return hit ? hit.data : null;
    },
    list() { return [...store.values()].map((e) => ({ path: e.path, size: e.data.length, rev: e.rev, source: e.meta.source || '' })); },
    remove(path) {
      const k = norm(path); if (!store.delete(k)) return false;
      emit({ type: 'remove', path: k }); if (ch) ch.postMessage({ t: 'remove', path: k }); return true;
    },
    on(f) { subs.add(f); return () => subs.delete(f); },
    off(f) { subs.delete(f); },
    _norm: norm,
  };
  if (ch) {
    ch.onmessage = (m) => {
      const d = m.data || {};
      if (d.t === 'set') { const e = put(d.path, d.data, d.meta, d.rev, true); if (e) emit({ type: 'set', path: e.path, rev: e.rev, meta: e.meta, size: e.data.length, remote: true }); }
      else if (d.t === 'remove') { if (store.delete(d.path)) emit({ type: 'remove', path: d.path, remote: true }); }
      else if (d.t === 'hello') { for (const e of store.values()) ch.postMessage({ t: 'set', path: e.path, data: e.data, meta: e.meta, rev: e.rev }); }
    };
    ch.postMessage({ t: 'hello' });
  }
  return B;
});
