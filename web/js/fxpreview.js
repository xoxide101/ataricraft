/* Previews for FujiNet Explorer: text, Atari/TrueType fonts, pictures, disks (via AfmCore), XEX segments, documents, hex.
   AC.FxPreview.kind(name, bytes) -> string; AC.FxPreview.render(host, name, bytes, ctx) fills the host element. */
(function () {
  const AC = (window.AC = window.AC || {});
  const ext = (n) => ((String(n).match(/\.([^.\\/]+)$/) || [])[1] || '').toLowerCase();
  const EXT = {
    text: 'txt text md lst bas asm inc s json csv log ini cfg xml yaml yml c h js css bat cmd cwd1 nfo doc1 seq',
    html: 'html htm xhtml',
    rtf: 'rtf',
    font: 'fnt fon ttf otf woff woff2 acf bdf pcf',
    image: 'png jpg jpeg gif bmp webp svg',
    gr8: 'gr8 mic pic gr9 gr15',
    disk: 'atr xfd atx dcm pro dsk',
    xex: 'xex com obx exe bin',
    pdf: 'pdf',
    ebook: 'epub fb2 mobi azw azw3 prc ebookcraft',
    doc: 'cwd docx odt',
    zip: 'zip',
  };
  const K = {}; for (const [k, v] of Object.entries(EXT)) for (const e of v.split(' ')) K[e] = k;

  const isAtascii = (b) => { let eol = 0, lf = 0, bad = 0; const n = Math.min(b.length, 4096); for (let i = 0; i < n; i++) { const c = b[i]; if (c === 0x9b) eol++; else if (c === 0x0a) lf++; const l = c & 0x7f; if (l < 32 && c !== 0x9b && c !== 0x09 && c !== 0x0d && c !== 0x0a) bad++; } return eol > 0 && lf === 0 && bad < n * 0.02; };
  const isText = (b) => { const n = Math.min(b.length, 4096); if (!n) return true; let bad = 0; for (let i = 0; i < n; i++) { const c = b[i]; if (c < 9 || (c > 13 && c < 32) || c === 0x7f) bad++; } return bad < n * 0.01; };
  const atasciiText = (b) => { let s = ''; for (const x of b) { const c = x & 0x7f; s += x === 0x9b ? '\n' : c >= 32 && c < 127 ? String.fromCharCode(c) : c === 9 ? '\t' : '.'; } return s; };

  function kind(name, b) {
    const e = ext(name);
    if (K[e] === 'text' || K[e] === 'html' || K[e] === 'rtf') return K[e];
    if (b.length > 4 && b[0] === 0x96 && b[1] === 0x02) return 'disk';
    if (b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image';
    if (K[e]) { if (K[e] === 'font' && (e === 'fnt' || e === 'fon') && !(b.length === 1024 || b.length === 2048)) return 'hex'; return K[e]; }
    if (b.length === 7680) return 'gr8';
    if (b.length === 1024) return 'font';
    if (b.length > 2 && b[0] === 0xff && b[1] === 0xff) return 'xex';
    if (isText(b)) return 'text';
    if (isAtascii(b)) return 'atascii';
    return 'hex';
  }

  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  function hexdump(b, max) {
    const n = Math.min(b.length, max || 2048), out = [];
    for (let i = 0; i < n; i += 16) {
      const row = b.subarray(i, Math.min(n, i + 16));
      out.push(i.toString(16).padStart(6, '0') + '  ' + [...row].map((x) => x.toString(16).padStart(2, '0')).join(' ').padEnd(48) + ' ' + [...row].map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '.')).join(''));
    }
    return out.join('\n') + (b.length > n ? '\n... ' + (b.length - n) + ' more bytes' : '');
  }

  function xexSegments(b) {
    const segs = []; let p = 0;
    if (!(b.length > 5 && b[0] === 0xff && b[1] === 0xff)) return null;
    while (p + 4 <= b.length) {
      if (b[p] === 0xff && b[p + 1] === 0xff) p += 2;
      if (p + 4 > b.length) break;
      const s = b[p] | (b[p + 1] << 8), e = b[p + 2] | (b[p + 3] << 8);
      if (e < s) { segs.push({ bad: true, at: p }); break; }
      segs.push({ start: s, end: e, len: e - s + 1, at: p + 4 }); p += 4 + (e - s + 1);
      if (segs.length > 400) break;
    }
    return segs;
  }

  function atariFont(host, b) {
    const sets = b.length >= 2048 ? 2 : 1, cv = el('canvas'), S = 3;
    cv.width = 16 * 8 * S; cv.height = 8 * 8 * S * sets;
    const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = '#e8e8e8';
    for (let s = 0; s < sets; s++) for (let c = 0; c < 128; c++) for (let y = 0; y < 8; y++) { const v = b[s * 1024 + c * 8 + y]; for (let x = 0; x < 8; x++) if (v & (0x80 >> x)) g.fillRect(((c & 15) * 8 + x) * S, (s * 64 + (c >> 4) * 8 + y) * S, S, S); }
    cv.className = 'pix'; host.append(el('div', 'note', 'Atari character set, ' + sets + ' x 128 glyphs (internal order)'), cv);
  }

  function render(host, name, b, ctx) {
    ctx = ctx || {};
    host.textContent = '';
    const k = kind(name, b);
    host.dataset.kind = k;
    const head = el('div', 'note', k.toUpperCase() + ' - ' + b.length + ' bytes');
    host.append(head);
    if (k === 'text' || k === 'html' || k === 'rtf') {
      let t = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 60000));
      if (k === 'html') t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n');
      if (k === 'rtf') t = t.replace(/\\par[d]?/g, '\n').replace(/\\'[0-9a-f]{2}/gi, '?').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
      host.append(el('pre', 'txt', t));
    } else if (k === 'atascii') host.append(el('pre', 'txt', atasciiText(b.subarray(0, 60000))));
    else if (k === 'font') {
      const e = ext(name);
      if (e === 'ttf' || e === 'otf' || e === 'woff' || e === 'woff2') {
        const fam = 'fxp' + Math.random().toString(36).slice(2);
        const ff = new FontFace(fam, b.slice().buffer);
        const box = el('div', 'fontsample');
        ff.load().then((f) => { document.fonts.add(f); box.style.fontFamily = fam; box.innerHTML = '<div style="font-size:34px">Aa Bb Cc 0123</div><div style="font-size:18px">The quick brown fox jumps over the lazy dog</div><div style="font-size:12px">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz</div>'; }, (x) => { box.textContent = 'cannot load font: ' + x.message; });
        host.append(box);
      } else if (b.length === 1024 || b.length === 2048) atariFont(host, b);
      else host.append(el('pre', 'txt', hexdump(b)));
    } else if (k === 'image') {
      const u = URL.createObjectURL(new Blob([b])), im = el('img', 'pic'); im.src = u; im.onload = () => head.textContent = 'IMAGE - ' + im.naturalWidth + 'x' + im.naturalHeight + ' - ' + b.length + ' bytes'; host.append(im);
    } else if (k === 'gr8') {
      const cv = el('canvas', 'pix'); cv.width = 320; cv.height = 192; const g = cv.getContext('2d'), d = g.createImageData(320, 192);
      for (let i = 0; i < 7680; i++) for (let x = 0; x < 8; x++) { const v = b[i] & (0x80 >> x) ? 235 : 20, o = (i * 8 + x) * 4; d.data[o] = d.data[o + 1] = d.data[o + 2] = v; d.data[o + 3] = 255; }
      g.putImageData(d, 0, 0); host.append(el('div', 'note', 'GR.8 / ANTIC F 320x192, 1 bit per pixel'), cv);
    } else if (k === 'xex') {
      const segs = xexSegments(b);
      if (!segs) host.append(el('pre', 'txt', hexdump(b)));
      else {
        const t = el('table', 'segs'); t.innerHTML = '<tr><th>#</th><th>Start</th><th>End</th><th>Bytes</th></tr>';
        segs.forEach((s, i) => { const r = el('tr'); r.innerHTML = s.bad ? '<td>' + (i + 1) + '</td><td colspan=3>bad segment header at ' + s.at + '</td>' : '<td>' + (i + 1) + '</td><td>$' + s.start.toString(16).toUpperCase().padStart(4, '0') + '</td><td>$' + s.end.toString(16).toUpperCase().padStart(4, '0') + '</td><td>' + s.len + '</td>'; t.append(r); });
        const run = segs.find((s) => !s.bad && s.start === 0x2e0 && s.len === 2), ini = segs.find((s) => !s.bad && s.start === 0x2e2 && s.len === 2);
        host.append(el('div', 'note', segs.length + ' load segment(s)' + (run ? ', RUN at $' + (b[run.at] | (b[run.at + 1] << 8)).toString(16).toUpperCase() : '') + (ini ? ', INIT present' : '')), t);
      }
    } else if (k === 'disk') {
      const m = AC.AfmCore && AC.AfmCore.mount(b, name);
      if (!m) host.append(el('div', 'note', 'Not a readable disk image (or a format the viewer cannot open): hex of the start'), el('pre', 'txt', hexdump(b, 512)));
      else if (ctx.browseDisk) {
        const i = AC.AfmCore.info(m);
        host.append(el('div', 'note', i.kind.toUpperCase() + ' - ' + i.sectors + ' sectors x ' + i.sectorSize + ' bytes' + (i.label ? ' - label ' + i.label : '')));
        const bt = el('button', null, 'Browse inside'); bt.onclick = () => ctx.browseDisk(m, name); host.append(bt);
      }
    } else if (k === 'pdf' || k === 'ebook' || k === 'doc' || k === 'zip') host.append(el('div', 'note', k === 'pdf' ? 'PDF: use "Open in PDF viewer".' : k === 'ebook' ? 'Book: use "Open in EBookCraft".' : k === 'doc' ? 'Document: use "Open in xCWriter".' : 'Archive.'), el('pre', 'txt', hexdump(b, 256)));
    else host.append(el('pre', 'txt', hexdump(b)));
    return k;
  }

  AC.FxPreview = { kind, render, ext, hexdump, atasciiText, xexSegments, isText };
})();
