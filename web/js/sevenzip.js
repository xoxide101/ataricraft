// 7z/rar/etc. reader using 7-Zip compiled to WASM (web/js/7z, LGPL + unRAR restriction). Loaded lazily on first use; works from file://.
(function () {
  let inst = null, loading = null, outBuf = [], seq = 0, chain = Promise.resolve();

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('cannot load ' + src));
      document.head.append(s);
    });
  }

  function init() {
    if (inst) return Promise.resolve(inst);
    if (!loading) loading = (async () => {
      const base = AC.SevenZip.base;
      await loadScript(base + '7zz-wasm.js');
      await loadScript(base + '7zz.umd.js');
      const bin = Uint8Array.from(atob(window.AC_7Z_WASM), (c) => c.charCodeAt(0));
      window.AC_7Z_WASM = null;
      inst = await window.SevenZip({ wasmBinary: bin, print: (t) => outBuf.push(t), printErr: (t) => outBuf.push(t) });
      return inst;
    })();
    return loading;
  }

  function run(sz, args) {
    outBuf = [];
    try { sz.callMain(args); } catch (e) { if (!(e && (e.name === 'ExitStatus' || 'status' in e))) throw e; }
    return outBuf;
  }

  // Serialise operations: the module is a single synchronous instance.
  function exclusive(fn) {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  }

  // WORKERFS only works inside a worker, so the archive is copied into the in-memory FS (the last one is kept for repeated extractions).
  let cached = null;
  async function withMount(file, fn) {
    const sz = await init();
    if (!cached || cached.file !== file) {
      if (cached) { try { sz.FS.unlink(cached.path); } catch (e) { /* ignore */ } cached = null; }
      const path = '/a' + (++seq) + '.7z';
      const data = AC.Progress ? await AC.Progress.read(file, 'Reading archive ' + (file.name || '')) : new Uint8Array(await file.arrayBuffer());
      const st = sz.FS.open(path, 'w+');
      sz.FS.write(st, data, 0, data.length);
      sz.FS.close(st);
      cached = { file, path };
    }
    return fn(sz, cached.path);
  }

  function list(file) {
    return exclusive(() => withMount(file, (sz, path) => {
      const lines = run(sz, ['l', '-slt', '-spd', path]);
      const out = [];
      let started = false, cur = null;
      const flush = () => { if (cur && cur.Path && cur.Folder !== '+' && !/^D/.test(cur.Attributes || '')) out.push({ name: cur.Path.replace(/\\/g, '/'), size: +cur.Size || 0 }); cur = null; };
      for (const l of lines) {
        if (!started) { if (l.startsWith('----------')) started = true; continue; }
        if (l === '') { flush(); continue; }
        const i = l.indexOf(' = ');
        if (i < 0) continue;
        const k = l.slice(0, i);
        if (k === 'Path') { flush(); cur = {}; }
        if (cur) cur[k] = l.slice(i + 3);
      }
      flush();
      if (!out.length) throw new Error('7z: nothing listed: ' + lines.slice(-3).join(' | '));
      return out;
    }));
  }

  function extract(file, ent) {
    return exclusive(async () => {
      const p = AC.Progress ? AC.Progress.begin('Extracting ' + ent.name.split('/').pop() + (ent.size ? ' (' + AC.Progress.fmtMB(ent.size) + ')' : '')) : null;
      try {
        if (p) await AC.Progress.yieldUI();
        return await withMount(file, (sz, path) => {
          const od = '/o' + (++seq);
          sz.FS.mkdir(od);
          try {
            const lines = run(sz, ['x', path, '-o' + od, '-y', '-spd', ent.name]);
            let data;
            try { data = sz.FS.readFile(od + '/' + ent.name); }
            catch (e) { throw new Error('7z extract failed: ' + lines.slice(-3).join(' | ')); }
            const copy = new Uint8Array(data);
            try { sz.FS.unlink(od + '/' + ent.name); } catch (e) { /* ignore */ }
            return copy.buffer;
          } finally { cleanup(sz, od); }
        });
      } finally { if (p) p.end(); }
    });
  }

  function cleanup(sz, dir) {
    try {
      for (const n of sz.FS.readdir(dir)) {
        if (n === '.' || n === '..') continue;
        const p = dir + '/' + n;
        if (sz.FS.isDir(sz.FS.stat(p).mode)) cleanup(sz, p); else sz.FS.unlink(p);
      }
      sz.FS.rmdir(dir);
    } catch (e) { /* ignore */ }
  }

  window.AC = window.AC || {};
  AC.SevenZip = { list, extract, base: (document.currentScript && document.currentScript.src.replace(/[^/]*$/, '') || 'js/') + '7z/' };
})();
