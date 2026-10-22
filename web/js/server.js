// Library builder for server mode (web/server.html). Scans the server's library folder and writes catalog.sqlite + library.json into it.
(function () {
  const $ = (id) => document.getElementById(id);
  const out = $('out');
  const say = (m) => { out.textContent += m + '\n'; out.scrollTop = out.scrollHeight; };
  const MEDIA_EXT = { disk: ['atr', 'xfd', 'atx', 'dcm', 'pro', 'gz', 'dsk'], cart: ['car', 'rom', 'bin', 'cart'], tape: ['cas'], exe: ['xex', 'com', 'exe', 'bas', 'lst', 'obj'] };
  const extOf = (n) => (n.split('.').pop() || '').toLowerCase();
  const kindOf = (n) => Object.keys(MEDIA_EXT).find((k) => MEDIA_EXT[k].includes(extOf(n))) || null;
  const BIOS_DIRS = /^(bios|basic)$/i;
  const SKIP = /^(\$recycle\.bin|system volume information|@eadir|\.@__thumb|\.git|node_modules)$/i;

  // Same title / grouping rules as the main app (app.js tosecTitle, groupKey, titleFor).
  const tosecTitle = (rel) => {
    const base = rel.split('/').pop().replace(/\.[^.]+$/, '');
    const m = /^(.+?)\s*\((\d{4}|19xx|20xx|19\d\?|19\d\d-\d\d(?:-\d\d)?)[^)]*\)\s*\(([^)]*)\)/.exec(base);
    if (!m) return '';
    const yr = /x|\?/.test(m[2]) ? '' : m[2].slice(0, 4);
    const pub = /^-$|unknown/i.test(m[3]) ? '' : m[3];
    return m[1] + (yr || pub ? ` (${[yr, pub].filter(Boolean).join(', ')})` : '');
  };
  const setKey = (rel) => {
    const parts = rel.split('/');
    const last = parts[parts.length - 1].replace(/\.[^.]+$/, '');
    const zip = parts.length > 1 && /\.(zip|7z)$/i.test(parts[parts.length - 2]) ? parts[parts.length - 2].replace(/\.(zip|7z)$/i, '') : null;
    return [zip, last].filter(Boolean).map((s) => s.toLowerCase());
  };
  const titleFor = (rel) => { for (const k of setKey(rel)) if ((AC.TITLES_BUILTIN || {})[k]) return AC.TITLES_BUILTIN[k]; return tosecTitle(rel); };
  const groupKey = (name, title) => {
    const base = (title || name.split('/').pop()).replace(/\.[^.]+$/, '').toLowerCase();
    return base
      .replace(/\s*\((\d{4}|19xx|20xx)[^)]*\)\s*$/, '')
      .replace(/\s+v\d+(\.\d+)*[a-z]?\b/g, ' ')
      .replace(/\([^)]*(dis[ck]|side|part|\d\s*of\s*\d)[^)]*\)/g, ' ')
      .replace(/[\s._-]*\b(dis[ck]|side|part)[\s._-]*[0-9a-z]\b/g, ' ')
      .replace(/[\s._-]+(d|s)?[0-9ab]$/g, ' ')
      .replace(/\s+/g, ' ').trim();
  };

  let root = null, stop = false;
  const secure = window.isSecureContext && window.showDirectoryPicker;
  if (!secure) {
    $('warn').style.display = '';
    $('pick').disabled = true;
  }

  async function dirs(h) {
    const a = [];
    for await (const [name, e] of h.entries()) if (e.kind === 'directory' && !SKIP.test(name) && !name.startsWith('.')) a.push(name);
    return a.sort((x, y) => x.localeCompare(y));
  }

  $('pick').onclick = async () => {
    try { root = await showDirectoryPicker({ id: 'ataricraft-server', mode: 'readwrite' }); } catch (e) { return; }
    $('rootname').textContent = root.name;
    const box = $('folders');
    box.innerHTML = '';
    const names = await dirs(root);
    if (!names.length) say('No sub-folders found. Expected software/, roms/, dos/, bios/, basic/ inside the folder you pick.');
    for (const n of names) {
      const l = document.createElement('label');
      l.style.cssText = 'display:block;padding:2px 0';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !/^(js|ref|sql|tools|out|library)$/i.test(n); cb.dataset.n = n;
      l.append(cb, ' ' + n + (BIOS_DIRS.test(n) ? '  (BIOS / BASIC ROMs: listed in library.json, not in the catalog)' : ''));
      box.append(l);
    }
    $('build').disabled = !names.length;
    say(`Picked "${root.name}" with ${names.length} sub-folders.`);
  };

  async function walk(h, path, rows, bios, isBios, st) {
    for await (const [name, e] of h.entries()) {
      if (stop) return;
      if (e.kind === 'directory') {
        if (SKIP.test(name) || name.startsWith('.')) continue;
        await walk(e, path + name + '/', rows, bios, isBios, st);
        continue;
      }
      st.seen++;
      if (st.seen % 500 === 0) { $('status').textContent = `${st.seen} files checked, ${rows.length} entries…`; await new Promise((r) => setTimeout(r)); }
      if (isBios) { if (/\.(rom|bin|zip|7z)$/i.test(name)) bios.push(path + name); continue; }
      const ext = extOf(name);
      if (ext === 'zip' || ext === '7z') {
        try {
          const f = await e.getFile();
          const ents = await (ext === 'zip' ? AC.Zip : AC.SevenZip).list(f);
          for (const en of ents) {
            const k = kindOf(en.name);
            if (!k) continue;
            const full = path + name + '/' + en.name;
            rows.push(row(full, k, en.size, f.lastModified, path + name));
          }
        } catch (err) { st.errs++; say(`skipped archive ${path + name}: ${err.message}`); }
        continue;
      }
      const k = kindOf(name);
      if (!k) continue;
      try { const f = await e.getFile(); rows.push(row(path + name, k, f.size, f.lastModified, '')); } catch (err) { st.errs++; }
    }
  }

  function row(path, kind, size, modified, container) {
    const title = titleFor(path);
    return { path, name: path.split('/').pop(), ext: extOf(path), kind, size: size || 0, modified, container, title, grp: groupKey(path, title) };
  }

  async function writeFile(name, data) {
    const fh = await root.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
  }

  $('stop').onclick = () => { stop = true; };
  $('build').onclick = async () => {
    if (!root) return;
    const picked = [...document.querySelectorAll('#folders input:checked')].map((c) => c.dataset.n);
    stop = false; out.textContent = '';
    $('build').disabled = true; $('stop').style.display = '';
    const rows = [], bios = [], st = { seen: 0, errs: 0 };
    const t0 = Date.now();
    try {
      for (const n of picked) {
        say('scanning ' + n + '…');
        await walk(await root.getDirectoryHandle(n), n + '/', rows, bios, BIOS_DIRS.test(n), st);
        if (stop) break;
      }
      if (stop) { say('stopped; nothing written.'); return; }
      await AC.Catalog.open();
      await AC.Catalog.rebuild(rows, { root: picked.filter((n) => !BIOS_DIRS.test(n)).join(', '), scanned: new Date().toISOString(), count: rows.length, built_by: 'server.html' });
      await writeFile('catalog.sqlite', await AC.Catalog.exportBytes());
      await writeFile('library.json', JSON.stringify({ catalog: 'catalog.sqlite', bios }, null, 1));
      const kc = {};
      rows.forEach((r) => { kc[r.kind] = (kc[r.kind] || 0) + 1; });
      say(`Done in ${Math.round((Date.now() - t0) / 1000)} s: ${rows.length} entries (${Object.entries(kc).map(([k, n]) => n + ' ' + k).join(', ') || 'none'}), ${bios.length} BIOS/BASIC ROMs, ${st.errs} skipped.`);
      say('Wrote catalog.sqlite and library.json into "' + root.name + '". Reload the app from the server.');
    } catch (e) {
      say('FAILED: ' + e.message);
    } finally {
      $('build').disabled = false; $('stop').style.display = 'none'; $('status').textContent = '';
    }
  };
})();
