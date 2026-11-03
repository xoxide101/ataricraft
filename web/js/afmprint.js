// WebAFM printing: directory listing, disk label card and catalog (all open disks, with an alphabetical file index).
// Pure functions over AfmCore (passed in as C) so they can be tested without a browser.
(function () {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rootName = (r) => (r.kind === 'drive' ? 'D' + r.n + ': ' + (r.m.vol.label || r.name || '') : r.name || '').trim();
  const pad = (s, n) => (String(s).length >= n ? String(s).slice(0, n) : String(s) + ' '.repeat(n - String(s).length));
  const lpad = (s, n) => (String(s).length >= n ? String(s) : ' '.repeat(n - String(s).length) + String(s));

  // Files (and folders) of a disk, depth-first, folders before files.  dir = '' for the root.
  function walk(C, m, dir, recursive, out, depth) {
    for (const e of C.listDir(m, dir || '')) {
      if (e.sidecar) continue;
      out.push({ ...e, depth: depth || 0 });
      if (e.dir && recursive) walk(C, m, e.path, true, out, (depth || 0) + 1);
    }
    return out;
  }
  const kbs = (b) => (b < 1024 ? b + ' B' : (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' KB');

  function header(C, r, dir) {
    const i = C.info(r.m), u = i.usage;
    const l = [];
    l.push(rootName(r) + (dir ? '   Folder: \\' + dir.replace(/\//g, '\\') : ''));
    l.push(r.m.kind === 'folder' ? 'Folder (no sector limit)' : `${i.kind.toUpperCase()} · ${i.density} · ${i.sectors} sectors of ${i.sectorSize} bytes` + (i.label ? ' · label ' + i.label : ''));
    if (r.m.kind !== 'folder') l.push(`Free: ${u.free} sectors (${kbs(u.bytesFree)})  Used: ${u.used} (${u.pct}%)`);
    return l;
  }

  function listing(C, r, o) {
    o = o || {};
    const rows = walk(C, r.m, o.dir || '', !!o.recursive, [], 0), L = header(C, r, o.dir || '');
    L.push('', pad('NAME', 22) + lpad('SECT', 6) + lpad('BYTES', 9) + '  DATE', '-'.repeat(48));
    let nf = 0, nd = 0, bytes = 0, sect = 0;
    for (const e of rows) {
      const ind = '  '.repeat(e.depth);
      if (e.dir) { nd++; L.push(ind + pad(e.name + '/', 22 - ind.length) + lpad('<DIR>', 15)); continue; }
      nf++; bytes += e.size; sect += e.sectors || 0;
      L.push(ind + pad(e.name, 22 - ind.length) + lpad(e.sectors || 0, 6) + lpad(e.size, 9) + '  ' + (e.date || '') + (e.long ? '   ' + e.long : ''));
    }
    L.push('-'.repeat(48), `${nf} file${nf === 1 ? '' : 's'}${nd ? ', ' + nd + ' folder' + (nd === 1 ? '' : 's') : ''}, ${sect} sectors, ${bytes} bytes`);
    return L.join('\n');
  }

  // All disks: one listing each (every folder), then an alphabetical index of file names with the disk they are on.
  function catalog(C, recs, o) {
    o = o || {};
    const parts = [], idx = [];
    for (const r of recs) {
      parts.push(listing(C, r, { recursive: true }));
      for (const e of walk(C, r.m, '', true, [], 0)) if (!e.dir) idx.push({ n: e.name, disk: rootName(r), path: e.path, size: e.size });
    }
    idx.sort((a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : a.disk < b.disk ? -1 : 1));
    const head = ['CATALOG', new Date().toISOString().slice(0, 10) + ' · ' + recs.length + ' disk' + (recs.length === 1 ? '' : 's') + ' · ' + idx.length + ' files'];
    const ix = ['', 'FILE INDEX (A-Z)', pad('NAME', 14) + pad('DISK', 26) + 'FOLDER'];
    for (const x of idx) ix.push(pad(x.n, 14) + pad(x.disk, 26) + (x.path.includes('/') ? x.path.slice(0, x.path.lastIndexOf('/')) : '\\'));
    return head.join('\n') + '\n\n' + parts.join('\n\n' + '='.repeat(48) + '\n\n') + '\n' + ix.join('\n');
  }

  // Printable page around monospaced text.
  function textPage(title, text) {
    return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>@page{margin:14mm}body{margin:0}pre{font:11px/1.25 Consolas,'Courier New',monospace;white-space:pre}</style><pre>${esc(text)}</pre>`;
  }

  // Disk label card: name, kind, free space and the file names in columns (folders shown with a trailing slash).
  function labelPage(C, r, o) {
    const rows = walk(C, r.m, '', !!(o && o.recursive), [], 0).filter((e) => !e.sidecar);
    const i = C.info(r.m), names = rows.map((e) => esc('  '.repeat(e.depth) + (e.long || e.name) + (e.dir ? '/' : '')));
    const cols = names.length > 36 ? 3 : names.length > 16 ? 2 : 1;
    const free = r.m.kind === 'folder' ? '' : ` · ${i.usage.free} sectors free`;
    return `<!doctype html><meta charset="utf-8"><title>Label</title><style>
@page{margin:12mm}body{margin:0;font:12px Arial,sans-serif}
.card{border:2px solid #000;border-radius:4px;width:${cols === 1 ? '90mm' : cols === 2 ? '140mm' : '185mm'};padding:5mm}
h1{margin:0;font-size:20px}.sub{margin:2px 0 6px;font-size:11px;color:#333}
.f{column-count:${cols};column-gap:6mm;font:11px/1.3 Consolas,'Courier New',monospace;white-space:pre;border-top:1px solid #000;padding-top:4px}</style>
<div class="card"><h1>${esc(rootName(r) || 'Disk')}</h1><div class="sub">${esc(i.kind.toUpperCase())} · ${esc(i.density)}${esc(free)} · ${rows.filter((e) => !e.dir).length} files</div><div class="f">${names.join('\n')}</div></div>`;
  }

  const G = typeof window !== 'undefined' ? window : globalThis; (G.AC = G.AC || {}).AfmPrint = { listing, catalog, textPage, labelPage, rootName };
  if (typeof module !== 'undefined') module.exports = { listing, catalog, textPage, labelPage, rootName };
})();
