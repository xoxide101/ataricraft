// Relay folders for WebAFM: the relay's SD: folder (--sd) or a TNFS server, presented as a FileSystemDirectoryHandle so
// FolderFs and WebAFM treat it exactly like a PC folder. Writes need the relay to run with --allow-write.
(function () {
  const AC = (window.AC = window.AC || {});
  const base = () => ((window.FujiNet && FujiNet.bridge) || localStorage.getItem('ac.tnfsbridge') || location.origin).replace(/\/$/, '');
  const token = () => localStorage.getItem('ac.nettoken') || '';
  const fail = (name, message) => { const e = new Error(message); e.name = name; return e; };

  async function call(route, args, body) {
    let r;
    try { r = await fetch(base() + route, { method: 'POST', headers: { 'X-AC-Token': token(), 'X-AC-Args': encodeURIComponent(JSON.stringify(args)) }, body: body || undefined }); }
    catch (e) { throw fail('NetworkError', 'relay not reachable at ' + base() + ' (start it with start.cmd / ./start.sh)'); }
    if (r.status === 403) throw fail('NotAllowedError', 'relay token missing or wrong (open the page through the relay address)');
    if (r.status !== 200) {
      const c = +(r.headers.get('X-AC-Err') || 0);
      if (c === 170) throw fail('NotFoundError', 'not found');
      if (c === 167) throw fail('NotAllowedError', 'refused by the relay (start it with --allow-write to change files)');
      if (c === 146) throw fail('NotSupportedError', 'the relay has no folder to serve (start it with --sd FOLDER)');
      throw fail('Error', 'relay error ' + (c || r.status));
    }
    return new Uint8Array(await r.arrayBuffer());
  }

  // opts: { scheme: 'sd' | 'tnfs', host, root }  (root is the folder inside the share, '' for the top)
  function make(opts, path, name) {
    const route = (x) => '/net/' + opts.scheme + '/' + x;
    const args = (a) => Object.assign(opts.scheme === 'tnfs' ? { host: opts.host } : {}, a);
    const join = (n) => (path.endsWith('/') ? path : path + '/') + n;
    const listing = async () => JSON.parse(new TextDecoder().decode(await call(route('list'), args({ path }))));
    const fileHandle = (p, n, meta) => ({
      kind: 'file', name: n, relay: true,
      async getFile() {
        const data = await call(route('file'), args({ path: p }));
        return { size: data.length, lastModified: (meta && meta.mtime) || Date.now(), arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.length) };
      },
      async createWritable() {
        const parts = [];
        return { write: async (d) => { parts.push(d instanceof Uint8Array ? d : new Uint8Array(d)); }, close: async () => { await call(route('put'), args({ path: p, append: false }), new Blob(parts)); } };
      },
    });
    return {
      kind: 'directory', name: name || (opts.scheme === 'sd' ? 'SD' : opts.host), relay: true, scheme: opts.scheme, host: opts.host,
      async *entries() {
        for (const e of await listing()) {
          if (e.name === '.' || e.name === '..') continue;
          yield [e.name, e.dir ? make(opts, join(e.name), e.name) : fileHandle(join(e.name), e.name, e)];
        }
      },
      async getFileHandle(n, o) {
        const hit = (await listing()).find((e) => e.name === n && !e.dir);
        if (!hit && !(o && o.create)) throw fail('NotFoundError', n + ' not found');
        return fileHandle(join(n), n, hit);
      },
      async getDirectoryHandle(n, o) {
        const hit = (await listing()).find((e) => e.name === n && e.dir);
        if (!hit) {
          if (!(o && o.create)) throw fail('NotFoundError', n + ' not found');
          await call(route('op'), args({ op: 'mkdir', path: join(n) }));
        }
        return make(opts, join(n), n);
      },
      async removeEntry(n, o) {
        const hit = (await listing()).find((e) => e.name === n);
        if (!hit) throw fail('NotFoundError', n + ' not found');
        if (!hit.dir) { await call(route('op'), args({ op: 'unlink', path: join(n) })); return; }
        const sub = make(opts, join(n), n);
        if (o && o.recursive) for (const [k] of await (async () => { const a = []; for await (const x of sub.entries()) a.push(x); return a; })()) await sub.removeEntry(k, { recursive: true });
        await call(route('op'), args({ op: 'rmdir', path: join(n) }));
      },
    };
  }

  AC.RelayFs = {
    sd: (name) => make({ scheme: 'sd' }, '/', name || 'SD'),
    tnfs: (host, path) => make({ scheme: 'tnfs', host }, path || '/', host),
    // Quick check that the relay is up, the token fits and an SD folder is being served.
    async probe() {
      const out = { relay: false, token: false, sd: false };
      try { out.relay = /tnfs-bridge/.test(await (await fetch(base() + '/ping')).text()); } catch (e) { return out; }
      if (!out.relay) return out;
      try { await call('/net/sd/list', { path: '/' }); out.token = out.sd = true; } catch (e) { out.token = e.name !== 'NotAllowedError'; }
      return out;
    },
  };
})();
