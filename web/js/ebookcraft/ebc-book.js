// EBookCraft book model + readers.
//   EBC.book.open(bytes, filename, opts) -> Book  (async)
//   Book = { id, title, author, lang, format, chapters:[{ title, blocks:[Block] }], toc:[{ title, ch, bi, lvl }],
//            resource(path) -> Promise<Uint8Array|null>, warnings:[string], meta:{} }
//   Block = { t:'p'|'h'|'li'|'pre'|'quote'|'hr'|'img', text, lvl?, src?, ids? }  - text only (inline bold/italic is dropped on purpose)
// Formats: EPUB 2/3, plain text, HTML/XHTML, FB2, MOBI/AZW/PRC (MOBI6 + PalmDOC compression), CWD, DOCX/RTF/Markdown (through xCWriter core), PDF text (ebc-pdf.js).
// Not supported: DRM, MOBI Huffman/CDIC compression, KF8-only AZW3, EPUB fixed-layout rendering, DJVU, CBZ pages (use Convert for image books).
(function (G) {
  'use strict';
  const EBC = (G.EBC = G.EBC || {});
  const B = EBC.base;

  const ext = (n) => ((n || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  const dirOf = (p) => (p.lastIndexOf('/') >= 0 ? p.slice(0, p.lastIndexOf('/') + 1) : '');
  function resolvePath(base, href) {
    href = decodeURIComponent(href.split('#')[0]);
    const parts = (href.startsWith('/') ? href.slice(1) : dirOf(base) + href).split('/'), out = [];
    for (const s of parts) { if (s === '..') out.pop(); else if (s !== '.' && s !== '') out.push(s); }
    return out.join('/');
  }
  const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).padStart(8, '0'); };

  // ---- HTML / XHTML -> blocks ----
  const BLOCKS = new Set(['p', 'div', 'section', 'article', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'table', 'pre', 'hr', 'body', 'aside', 'figure', 'figcaption', 'dd', 'dt', 'dl', 'header', 'footer', 'nav', 'caption', 'center']);
  const SKIP = new Set(['script', 'style', 'head', 'title', 'svg', 'math']);
  function htmlBlocks(html, opt = {}) {
    const blocks = [], ids = {};
    let cur = '', skip = 0, pre = 0, kind = 'p', lvl = 0, quote = 0;
    const flush = () => {
      let t = pre ? cur.replace(/^\n+|\n+$/g, '') : cur.replace(/[ \t\r\f\u00a0]*\n[ \t\r\f\u00a0]*/g, '\n').replace(/[ \t\r\f]+/g, ' ').replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, '');
      cur = '';
      if (!t) return;
      const b = { t: kind === 'h' ? 'h' : kind, text: t };
      if (kind === 'h') b.lvl = lvl; else if (!pre && quote && kind === 'p') b.t = 'quote';
      blocks.push(b); kind = pre ? 'pre' : 'p'; lvl = 0;
    };
    for (const tk of B.tokens(html)) {
      if (tk.text !== undefined) { if (!skip) cur += pre ? B.entities(tk.text) : B.entities(tk.text).replace(/\n/g, ' '); continue; }
      const tag = tk.tag;
      if (SKIP.has(tag)) { skip = Math.max(0, skip + (tk.close ? -1 : tk.self ? 0 : 1)); continue; }
      if (skip) continue;
      if (tk.attrs.id && !tk.close) ids[tk.attrs.id] = blocks.length;
      if (tk.attrs.name && tag === 'a' && !tk.close) ids[tk.attrs.name] = blocks.length;
      if (tag === 'br') { cur += '\n'; continue; }
      if (tag === 'img' || tag === 'image') {
        const src = tk.attrs.src || tk.attrs['xlink:href'] || tk.attrs.href;
        if (src && !tk.close) { flush(); blocks.push({ t: 'img', src, text: tk.attrs.alt || '' }); }
        continue;
      }
      if (BLOCKS.has(tag)) {
        flush();
        if (tag === 'hr') { blocks.push({ t: 'hr', text: '' }); continue; }
        if (tag === 'pre') pre = tk.close ? 0 : 1;
        if (tag === 'blockquote') quote = Math.max(0, quote + (tk.close ? -1 : 1));
        if (/^h[1-6]$/.test(tag)) { if (!tk.close) { kind = 'h'; lvl = +tag[1]; } else kind = 'p'; }
        else if (tag === 'li' && !tk.close) kind = 'li';
        else if (pre) kind = 'pre'; else kind = 'p';
      }
    }
    flush();
    return { blocks, ids };
  }

  function mkBook(fmt, title, author) {
    return { id: '', title: title || '', author: author || '', lang: '', format: fmt, chapters: [], toc: [], resource: async () => null, warnings: [], meta: {} };
  }
  function finish(book) {
    book.chapters = book.chapters.filter((c) => c.blocks.length);
    if (!book.chapters.length) throw new Error('No readable text found in this ' + book.format + ' file');
    if (!book.toc.length) {
      book.chapters.forEach((c, i) => book.toc.push({ title: c.title || 'Section ' + (i + 1), ch: i, bi: 0, lvl: 1 }));
    } else book.toc = book.toc.filter((t) => t.ch < book.chapters.length);
    const len = book.chapters.reduce((n, c) => n + c.blocks.reduce((m, b) => m + b.text.length, 0), 0);
    book.meta.chars = len; book.meta.words = book.chapters.reduce((n, c) => n + c.blocks.reduce((m, b) => m + (b.text.match(/\S+/g) || []).length, 0), 0);
    if (!book.title) book.title = 'Untitled';
    book.id = fnv(book.title + '|' + book.author + '|' + len);
    return book;
  }
  // split one long block list into chapters at headings of the shallowest level that occurs at least twice
  function splitAtHeadings(blocks, firstTitle) {
    const count = {}; for (const b of blocks) if (b.t === 'h') count[b.lvl] = (count[b.lvl] || 0) + 1;
    const level = [1, 2, 3].find((l) => count[l] >= 2) || [1, 2, 3].find((l) => count[l] >= 1);
    const chs = []; let cur = { title: firstTitle || '', blocks: [] };
    for (const b of blocks) {
      if (b.t === 'h' && b.lvl === level && count[level] > 1 || (b.t === 'h' && b.lvl === level && cur.blocks.length && cur.blocks.every((x) => x.t === 'h'))) {
        if (cur.blocks.length) chs.push(cur);
        cur = { title: b.text.replace(/\n/g, ' '), blocks: [] };
      }
      cur.blocks.push(b);
    }
    if (cur.blocks.length) chs.push(cur);
    return chs;
  }
  const headingTitle = (blocks) => { const h = blocks.find((b) => b.t === 'h'); return h ? h.text.replace(/\s*\n\s*/g, ' ').slice(0, 80) : ''; };

  // ---- plain text ----
  function fromText(str, name) {
    const book = mkBook('text', (name || '').replace(/\.[^.]*$/, ''), '');
    str = str.replace(/\r\n?/g, '\n').replace(/\u001a/g, '');
    const lines = str.split('\n'), nonEmpty = lines.filter((l) => l.trim());
    const long = nonEmpty.filter((l) => l.length > 100).length;
    const wrapped = long < nonEmpty.length * 0.1 && nonEmpty.length > 3; // hard-wrapped text (Gutenberg style): join lines inside a paragraph
    const m1 = str.match(/^\s*Title:\s*(.+)$/im), m2 = str.match(/^\s*Author:\s*(.+)$/im);
    if (m1) book.title = m1[1].trim(); if (m2) book.author = m2[1].trim();
    const head = /^\s*((chapter|book|part|section|canto|act|volume)\s+[\divxlcdm]+\b.*|prologue|epilogue|preface|introduction|contents|appendix\b.*)\s*$/i;
    const blocks = []; let para = [];
    const flush = () => {
      if (para.length) {
        const text = wrapped ? para.map((s) => s.trim()).join(' ').replace(/\s+/g, ' ') : para.join('\n');
        blocks.push({ t: 'p', text });
      }
      para = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim()) { flush(); continue; }
      const prevBlank = i === 0 || !lines[i - 1].trim(), nextBlank = i + 1 >= lines.length || !lines[i + 1].trim();
      if (prevBlank && nextBlank && l.trim().length < 70 && (head.test(l) || (/^[A-Z0-9 .,'!?:;-]{4,}$/.test(l.trim()) && /[A-Z]{3}/.test(l)))) { flush(); blocks.push({ t: 'h', lvl: 2, text: l.trim() }); continue; }
      if (!wrapped) { para.push(l); continue; }
      if (/^\s{2,}\S/.test(l) && para.length) flush(); // indented line starts a new paragraph
      para.push(l);
    }
    flush();
    book.chapters = splitAtHeadings(blocks, book.title);
    if (!book.chapters.length) book.chapters = [{ title: book.title, blocks }];
    return finish(book);
  }

  // ---- HTML ----
  function fromHtml(str, name) {
    const t = (str.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    const au = (str.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']*)/i) || [])[1];
    const book = mkBook('html', t ? B.entities(t).trim() : (name || '').replace(/\.[^.]*$/, ''), au || '');
    const { blocks, ids } = htmlBlocks(str);
    book.chapters = splitAtHeadings(blocks, book.title);
    book.meta.ids = ids;
    return finish(book);
  }

  // ---- EPUB ----
  async function fromEpub(bytes, name) {
    const z = await B.zipRead(bytes);
    const text = async (p) => B.decodeText(await z.get(z.find(p) || p));
    let opfPath;
    try {
      const c = B.tokens(await text('META-INF/container.xml')).find((t) => t.tag === 'rootfile');
      opfPath = c.attrs['full-path'];
    } catch (e) { opfPath = z.names.find((n) => /\.opf$/i.test(n)); }
    if (!opfPath) throw new Error('EPUB: no OPF package file');
    const toks = B.tokens(await text(opfPath));
    const book = mkBook('epub', '', '');
    const manifest = {}, spine = []; let tocId = null, inMeta = false, cur = null;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.text !== undefined) { if (cur) cur.text += t.text; continue; }
      if (t.tag === 'metadata') inMeta = !t.close;
      if (inMeta && !t.close && !t.self && /^dc:(title|creator|language)$/.test(t.tag)) cur = { tag: t.tag, text: '' };
      else if (cur && t.close && t.tag === cur.tag) {
        const v = B.entities(cur.text).trim();
        if (cur.tag === 'dc:title' && !book.title) book.title = v; else if (cur.tag === 'dc:creator') book.author = book.author ? book.author + ', ' + v : v; else if (cur.tag === 'dc:language') book.lang = v;
        cur = null;
      }
      if (t.tag === 'item' && !t.close) manifest[t.attrs.id] = { href: t.attrs.href, type: t.attrs['media-type'] || '', props: t.attrs.properties || '' };
      if (t.tag === 'spine' && !t.close) tocId = t.attrs.toc || null;
      if (t.tag === 'itemref' && !t.close && t.attrs.linear !== 'no') spine.push(t.attrs.idref);
    }
    const files = spine.map((id) => manifest[id]).filter((m) => m && m.href && /html|xml/i.test(m.type + m.href));
    const chapterOf = {}; // zip path -> { index, ids }
    for (const m of files) {
      const path = resolvePath(opfPath, m.href);
      let html; try { html = await text(path); } catch (e) { book.warnings.push('missing spine item ' + path); continue; }
      const r = htmlBlocks(html);
      for (const b of r.blocks) if (b.t === 'img') b.src = resolvePath(path, b.src);
      const ch = { title: headingTitle(r.blocks), blocks: r.blocks, href: path };
      chapterOf[path] = { index: book.chapters.length, ids: r.ids };
      book.chapters.push(ch);
    }
    // table of contents: EPUB 3 nav, else NCX
    const add = (title, href, lvl, base) => {
      const [p, frag] = href.split('#'), path = p ? resolvePath(base, p) : base, c = chapterOf[path];
      if (!c) return;
      const bi = frag && c.ids[frag] !== undefined ? c.ids[frag] : 0;
      book.toc.push({ title: title.replace(/\s+/g, ' ').trim(), ch: c.index, bi, lvl });
    };
    const navItem = Object.values(manifest).find((m) => /\bnav\b/.test(m.props));
    const ncxItem = (tocId && manifest[tocId]) || Object.values(manifest).find((m) => /ncx/.test(m.type));
    try {
      if (navItem) {
        const np = resolvePath(opfPath, navItem.href), nt = B.tokens(await text(np));
        let depth = 0, a = null, inNav = false;
        for (const t of nt) {
          if (t.tag === 'nav') { inNav = !t.close && /toc/.test((t.attrs['epub:type'] || '') + (t.attrs.role || '') + ' toc'); if (t.close) inNav = false; }
          if (!inNav) continue;
          if (t.tag === 'ol') depth += t.close ? -1 : 1;
          if (t.tag === 'a') { if (!t.close) a = { href: t.attrs.href || '', text: '', depth }; else if (a) { if (a.href) add(a.text, a.href, a.depth, np); a = null; } }
          if (t.text !== undefined && a) a.text += B.entities(t.text);
        }
      } else if (ncxItem) {
        const np = resolvePath(opfPath, ncxItem.href), nt = B.tokens(await text(np));
        let depth = 0, label = '', inLabel = false;
        for (const t of nt) {
          if (t.tag === 'navpoint') depth += t.close ? -1 : 1;
          if (t.tag === 'navlabel') inLabel = !t.close;
          if (t.text !== undefined && inLabel) label += B.entities(t.text);
          if (t.tag === 'content' && !t.close) { add(label, t.attrs.src || '', depth, np); label = ''; }
        }
      }
    } catch (e) { book.warnings.push('table of contents unreadable: ' + e.message); }
    for (const c of book.chapters) { const t = book.toc.find((x) => book.chapters[x.ch] === c && x.bi === 0); if (t) c.title = t.title; }
    book.resource = async (p) => { const k = z.find(p); return k ? z.get(k) : null; };
    if (!book.title) book.title = (name || '').replace(/\.[^.]*$/, '');
    return finish(book);
  }

  // ---- FB2 ----
  async function fromFb2(bytes, name) {
    let str = B.decodeText(bytes);
    const enc = (str.match(/^<\?xml[^>]*encoding=["']([^"']+)/i) || [])[1];
    if (enc && !/utf-?8/i.test(enc)) str = B.decodeText(bytes, enc);
    const book = mkBook('fb2', '', '');
    const toks = B.tokens(str), bins = {};
    let section = 0, bodyNo = 0, inBody = false, inTitle = 0, cur = '', desc = true, who = null, names = {}, blocks = [], chTitle = '', buf = null;
    const chapters = [];
    const flush = (t, lvl) => {
      const x = cur.replace(/\s+/g, ' ').trim(); cur = '';
      if (x) blocks.push(t === 'h' ? { t: 'h', lvl, text: x } : { t, text: x });
    };
    const closeCh = () => { if (blocks.length) chapters.push({ title: chTitle || headingTitle(blocks), blocks }); blocks = []; chTitle = ''; };
    for (const t of toks) {
      if (buf) { if (t.text !== undefined) buf.data += t.text; else if (t.tag === 'binary' && t.close) { bins[buf.id] = buf; buf = null; } continue; }
      if (t.text !== undefined) { if (desc) { if (who) names[who] = (names[who] || '') + t.text; } else cur += B.entities(t.text); continue; }
      const g = t.tag;
      if (g === 'binary' && !t.close) { buf = { id: t.attrs.id, type: t.attrs['content-type'], data: '' }; continue; }
      if (desc) {
        if (g === 'description') { if (t.close) desc = false; }
        else if (/^(book-title|first-name|last-name)$/.test(g)) who = t.close ? null : g;
        continue;
      }
      if (g === 'body') { inBody = !t.close; if (!t.close) bodyNo++; if (t.close) closeCh(); continue; }
      if (!inBody || bodyNo > 1) continue; // second body = notes
      if (g === 'section') { flush('p'); if (!t.close) { section++; if (section === 1) closeCh(); } else section--; continue; }
      if (g === 'title') { flush('p'); inTitle += t.close ? -1 : 1; if (t.close) { const hb = blocks[blocks.length - 1]; if (hb && hb.t === 'h' && !chTitle && section <= 1) chTitle = hb.text; } continue; }
      if (g === 'p' || g === 'v' || g === 'text-author' || g === 'subtitle') { if (t.close) flush(inTitle ? 'h' : g === 'subtitle' ? 'h' : 'p', inTitle ? Math.min(3, section || 1) : 3); continue; }
      if (g === 'stanza' || g === 'poem' || g === 'cite' || g === 'epigraph') { flush('p'); continue; }
      if (g === 'image' && !t.close) { const h = (t.attrs['l:href'] || t.attrs['xlink:href'] || t.attrs.href || '').replace(/^#/, ''); flush('p'); if (h) blocks.push({ t: 'img', src: h, text: '' }); }
    }
    closeCh();
    book.chapters = chapters;
    book.title = (names['book-title'] || '').trim(); book.author = [names['first-name'], names['last-name']].filter(Boolean).join(' ').trim();
    if (!book.title) book.title = (name || '').replace(/\.[^.]*$/, '');
    book.resource = async (id) => (bins[id] ? B.unb64(bins[id].data.replace(/\s+/g, '')) : null);
    return finish(book);
  }

  // ---- MOBI / AZW / PRC (PalmDOC records) ----
  function palmInflate(src) {
    const out = []; let i = 0;
    while (i < src.length) {
      const c = src[i++];
      if (c === 0 || (c >= 9 && c <= 0x7f)) out.push(c);
      else if (c <= 8) { for (let k = 0; k < c && i < src.length; k++) out.push(src[i++]); }
      else if (c >= 0xc0) out.push(0x20, c ^ 0x80);
      else {
        const n = (c << 8) | src[i++], dist = (n >> 3) & 0x7ff, len = (n & 7) + 3;
        for (let k = 0; k < len; k++) out.push(out[out.length - dist]);
      }
    }
    return Uint8Array.from(out);
  }
  function trailingSize(rec, flags) {
    let n = 0, f = flags >> 1;
    while (f) {
      if (f & 1) { let size = 0, shift = 0, p = rec.length - n - 1; for (; p >= 0; p--) { size |= (rec[p] & 0x7f) << shift; shift += 7; if (rec[p] & 0x80) break; } n += size; }
      f >>= 1;
    }
    if (flags & 1) n += (rec[rec.length - n - 1] & 3) + 1;
    return n;
  }
  async function fromMobi(bytes, name) {
    const a = B.u8(bytes), nrec = B.be16(a, 76), off = [];
    const type = String.fromCharCode(...a.subarray(60, 68));
    if (!/BOOKMOBI|TEXtREAd/.test(type)) throw new Error('Not a MOBI/PalmDOC file (type ' + JSON.stringify(type) + ')');
    for (let i = 0; i < nrec; i++) off.push(B.be32(a, 78 + i * 8));
    off.push(a.length);
    const rec = (i) => a.subarray(off[i], off[i + 1]), r0 = rec(0);
    const comp = B.be16(r0, 0), count = B.be16(r0, 8), crypt = B.be16(r0, 12);
    if (crypt) throw new Error('This MOBI/AZW file is DRM-encrypted and cannot be read');
    if (comp !== 1 && comp !== 2) throw new Error('MOBI compression ' + comp + ' (Huffman/CDIC) is not supported; convert the book to EPUB first');
    let encoding = 1252, title = '', flags = 0, author = '';
    const isMobi = String.fromCharCode(...r0.subarray(16, 20)) === 'MOBI';
    if (isMobi) {
      const hl = B.be32(r0, 20); encoding = B.be32(r0, 28);
      const no = B.be32(r0, 84), nl = B.be32(r0, 88); title = new TextDecoder('utf-8').decode(r0.subarray(no, no + nl));
      if (hl >= 228) flags = B.be16(r0, 242);
      const ver = B.be32(r0, 36); if (ver >= 8 && !(B.be32(r0, 0xe4) === 0xffffffff)) { /* KF8 in a combined file keeps its MOBI6 half first */ }
      const exth = B.be32(r0, 128) & 0x40;
      if (exth) {
        let p = 16 + hl; if (String.fromCharCode(...r0.subarray(p, p + 4)) === 'EXTH') { const n = B.be32(r0, p + 8); p += 12; for (let k = 0; k < n; k++) { const t = B.be32(r0, p), l = B.be32(r0, p + 4); if (t === 100) author = new TextDecoder('utf-8').decode(r0.subarray(p + 8, p + l)); p += l; } }
      }
    }
    const parts = [];
    for (let i = 1; i <= count && i < nrec; i++) {
      let r = rec(i); if (flags) r = r.subarray(0, r.length - trailingSize(r, flags));
      parts.push(comp === 2 ? palmInflate(r) : r);
    }
    const text = B.decodeText(B.concat(parts), encoding === 65001 ? 'utf-8' : 'windows-1252');
    if (!isMobi && !/<(p|div|br|h\d)\b/i.test(text)) { const bk = fromText(text, name); bk.format = 'palmdoc'; return bk; }
    const book = mkBook('mobi', title || (name || '').replace(/\.[^.]*$/, ''), author);
    const pages = text.split(/<mbp:pagebreak\s*\/?>/i);
    for (const pg of pages) { const r = htmlBlocks(pg.replace(/<a\s+id="[^"]*"\s*\/>/gi, '')); if (r.blocks.length) book.chapters.push({ title: headingTitle(r.blocks), blocks: r.blocks }); }
    if (book.chapters.length === 1) book.chapters = splitAtHeadings(book.chapters[0].blocks, book.title);
    return finish(book);
  }

  // ---- via the xCWriter core (CWD, DOCX, RTF, Markdown, ...) ----
  function xcw() { return G.XCW || null; }
  async function fromXcw(bytes, name, fmt) {
    const X = xcw();
    if (!X) throw new Error('The xCWriter core (xcw-core.js) is needed to read ' + fmt.toUpperCase() + ' files');
    const r = X.openDoc(bytes, name, {});
    const book = mkBook(fmt, (name || '').replace(/\.[^.]*$/, ''), '');
    const blocks = [];
    for (const p of r.paras) { const t = X.ptext(p).replace(/\s+$/, ''); if (t.trim()) blocks.push({ t: p.bullet ? 'li' : 'p', text: t }); }
    book.chapters = splitAtHeadings(blocks, book.title);
    if (!book.chapters.length) book.chapters = [{ title: book.title, blocks }];
    if (r.page) book.meta.page = r.page;
    for (const n of r.notes || []) book.warnings.push(n);
    return finish(book);
  }

  // ---- PDF text ----
  async function fromPdf(bytes, name) {
    if (!EBC.pdf) throw new Error('PDF reader (ebc-pdf.js) not loaded');
    const r = await EBC.pdf.extractText(bytes);
    const book = mkBook('pdf', r.title || (name || '').replace(/\.[^.]*$/, ''), r.author || '');
    const per = 10;
    for (let s = 0; s < r.pages.length; s += per) {
      const blocks = [];
      for (let k = s; k < Math.min(r.pages.length, s + per); k++) for (const para of r.pages[k].paras) blocks.push({ t: 'p', text: para, pg: k + 1 });
      book.chapters.push({ title: 'Pages ' + (s + 1) + '-' + Math.min(r.pages.length, s + per), blocks });
    }
    book.meta.pages = r.pages.length; book.meta.emptyPages = r.pages.filter((p) => !p.paras.length).length;
    if (book.meta.emptyPages) book.warnings.push(book.meta.emptyPages + ' of ' + r.pages.length + ' PDF pages have no text layer (scanned?). Use Convert > OCR for those.');
    for (const w of r.warnings || []) book.warnings.push(w);
    return finish(book);
  }

  function detect(bytes, name) {
    const a = B.u8(bytes), e = ext(name);
    const s4 = String.fromCharCode(...a.subarray(0, 4));
    if (s4 === 'PK\x03\x04') {
      if (e === 'docx') return 'docx';
      return 'epub';
    }
    if (s4 === '%PDF') return 'pdf';
    if (a.length > 68 && /BOOKMOBI|TEXtREAd/.test(String.fromCharCode(...a.subarray(60, 68)))) return 'mobi';
    if (['mobi', 'azw', 'azw3', 'prc'].includes(e)) return 'mobi';
    if (e === 'fb2' || (/^\s*(<\?xml[^>]*>\s*)?<FictionBook/i.test(String.fromCharCode(...a.subarray(0, 200))))) return 'fb2';
    if (['cwd', 'cw'].includes(e)) return 'cwd';
    if (['rtf', 'md', 'markdown', 'docx'].includes(e)) return e === 'markdown' ? 'md' : e;
    if (['html', 'htm', 'xhtml'].includes(e) || /^\s*(<!doctype html|<html)/i.test(String.fromCharCode(...a.subarray(0, 100)))) return 'html';
    if (e === 'epub') return 'epub';
    if (e === 'pdf') return 'pdf';
    if (e === 'zip') return 'epub';
    if (a.subarray(0, 8).every((x) => x === 0xd0 || x === 0xcf || x === 0x11)) return 'doc';
    return 'text';
  }

  async function open(bytes, name, opts = {}) {
    const fmt = opts.format || detect(bytes, name);
    switch (fmt) {
      case 'epub': return fromEpub(bytes, name);
      case 'text': return fromText(B.decodeText(bytes), name);
      case 'html': return fromHtml(B.decodeText(bytes), name);
      case 'fb2': return fromFb2(bytes, name);
      case 'mobi': return fromMobi(bytes, name);
      case 'pdf': return fromPdf(bytes, name);
      case 'cwd': case 'docx': case 'rtf': case 'md': return fromXcw(bytes, name, fmt);
      default: throw new Error('Unsupported format: ' + fmt);
    }
  }

  // ---- text helpers shared by the reader, the Atari view and the converter ----
  const ASCII = { '\u2018': "'", '\u2019': "'", '\u201a': ',', '\u201c': '"', '\u201d': '"', '\u201e': '"', '\u2013': '-', '\u2014': '--', '\u2015': '--', '\u2026': '...', '\u2022': '*', '\u00b7': '*', '\u00a0': ' ', '\u2009': ' ', '\u2002': ' ', '\u2003': ' ', '\u00ab': '<<', '\u00bb': '>>', '\u00e6': 'ae', '\u00c6': 'AE', '\u0153': 'oe', '\u0152': 'OE', '\u00df': 'ss', '\u00f8': 'o', '\u00d8': 'O', '\u00f0': 'd', '\u00fe': 'th', '\u00a9': '(c)', '\u00ae': '(R)', '\u2122': '(TM)', '\u00b0': 'o', '\u00d7': 'x', '\u00bd': '1/2', '\u00bc': '1/4', '\u00be': '3/4', '\u2212': '-', '\u00ad': '', '\u200b': '' };
  function asciify(s) {
    let o = '';
    for (const ch of s.normalize('NFC')) {
      const c = ch.codePointAt(0);
      if (c < 127 && (c >= 32 || c === 10)) { o += ch; continue; }
      if (ASCII[ch] !== undefined) { o += ASCII[ch]; continue; }
      const d = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      o += d && d.charCodeAt(0) < 127 && d.charCodeAt(0) >= 32 ? d : c === 9 ? '    ' : '?';
    }
    return o;
  }
  function wrap(text, cols) {
    const out = [];
    for (const raw of text.split('\n')) {
      let line = '';
      for (const w0 of raw.split(' ')) {
        let w = w0;
        while (w.length > cols) { // overlong word: split with a hyphen
          if (line) { out.push(line); line = ''; }
          out.push(w.slice(0, cols - 1) + '-'); w = w.slice(cols - 1);
        }
        if (!line) line = w; else if (line.length + 1 + w.length <= cols) line += ' ' + w; else { out.push(line); line = w; }
      }
      out.push(line);
    }
    return out;
  }
  // Atari text lines for the whole book: [{ text, ch, bi, kind }]; blank lines separate paragraphs unless opt.indent
  function toLines(book, opt = {}) {
    const cols = opt.cols || 64, lines = [], indent = opt.indent ? '  ' : '';
    book.chapters.forEach((c, ci) => {
      if (opt.chapterBreak !== false && lines.length) lines.push({ text: '\f', ch: ci, bi: 0, kind: 'break' });
      c.blocks.forEach((b, bi) => {
        if (b.t === 'img') { lines.push({ text: '[image]', ch: ci, bi, kind: 'img' }); return; }
        if (b.t === 'hr') { lines.push({ text: '-'.repeat(Math.min(cols, 20)), ch: ci, bi, kind: 'hr' }); return; }
        const t = asciify(b.text);
        let ls;
        if (b.t === 'h') { ls = wrap(t.toUpperCase().replace(/\n/g, ' '), cols).map((l) => ' '.repeat(Math.max(0, Math.floor((cols - l.length) / 2))) + l); if (lines.length && lines[lines.length - 1].text !== '' && lines[lines.length - 1].text !== '\f') lines.push({ text: '', ch: ci, bi, kind: 'blank' }); }
        else if (b.t === 'li') ls = wrap(t, cols - 2).map((l, i) => (i ? '  ' : '* ') + l);
        else if (b.t === 'quote') ls = wrap(t, cols - 4).map((l) => '  ' + l);
        else if (b.t === 'pre') ls = t.split('\n').map((l) => l.slice(0, cols));
        else ls = wrap(indent + t, cols);
        for (const l of ls) lines.push({ text: l, ch: ci, bi, kind: b.t });
        if (!opt.indent || b.t === 'h') lines.push({ text: '', ch: ci, bi, kind: 'blank' });
      });
    });
    while (lines.length && lines[lines.length - 1].text === '') lines.pop();
    return lines;
  }
  // group lines into screens of `rows` lines (a '\f' line starts a new page); returns [{ lines:[string], ch, bi }]
  function paginateLines(lines, rows) {
    const pages = []; let cur = [], first = null;
    const push = () => { if (cur.length) { while (cur.length && cur[cur.length - 1] === '') cur.pop(); if (cur.length) pages.push({ lines: cur, ch: first.ch, bi: first.bi }); } cur = []; first = null; };
    for (const l of lines) {
      if (l.text === '\f') { push(); continue; }
      if (!cur.length && l.text === '') continue;
      if (!first) first = l;
      cur.push(l.text);
      if (cur.length >= rows) push();
    }
    push();
    return pages;
  }
  const plainText = (book, opt = {}) => toLines(book, { cols: opt.cols || 80, indent: opt.indent, chapterBreak: false }).map((l) => (l.text === '\f' ? '' : l.text)).join('\n') + '\n';

  function search(book, q, opt = {}) {
    const out = [], cs = !!opt.matchCase, needle = cs ? q : q.toLowerCase(), max = opt.max || 500;
    if (!needle) return out;
    for (let ci = 0; ci < book.chapters.length; ci++) {
      const bl = book.chapters[ci].blocks;
      for (let bi = 0; bi < bl.length; bi++) {
        const t = bl[bi].text, h = cs ? t : t.toLowerCase();
        let at = h.indexOf(needle);
        while (at >= 0) {
          out.push({ ch: ci, bi, pos: at, snippet: (at > 30 ? '...' : '') + t.slice(Math.max(0, at - 30), at + q.length + 40).replace(/\s+/g, ' ') });
          if (out.length >= max) return out;
          at = h.indexOf(needle, at + needle.length);
        }
      }
    }
    return out;
  }

  EBC.book = { open, detect, fromText, fromHtml, htmlBlocks, palmInflate, asciify, wrap, toLines, paginateLines, plainText, search, resolvePath, ext, fnv };
  if (typeof module !== 'undefined' && module.exports) module.exports = EBC;
})(typeof window !== 'undefined' ? window : globalThis);
