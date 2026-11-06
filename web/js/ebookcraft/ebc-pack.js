// EBC.pack - the EBookCraft production pipeline. One function, convert(), used by the web UI, the CLI (scripts/ebookcraft.cjs) and the tests.
//
//   const r = await EBC.pack.convert([{name, bytes}], opt, log)  ->  { files:[{path, bytes}], manifest, report:[string], book }
//
// Input: a book (EPUB/TXT/HTML/FB2/MOBI/CWD/...), a PDF (text layer and/or scanned page images) or one or more images (PNG/JPEG/BMP/PNM).
// Everything returns files in memory; the caller decides where they go (zip download, folder, library, server layout).
// Options (defaults in brackets):
//   text [true]      write text/book.txt (+ text/pNNN.txt for scanned pages), text/book.xcw (Craft Word, 64 columns)
//   ocr  [false]     recognise text on page images that have no text layer (needs the OCR add-on; 'force' = also when a text layer exists)
//   bw [true]        1-bit pages; gray [[]] e.g. [4,16,256] more levels; dither ['atkinson'] threshold|bayer4|bayer8|floyd|atkinson
//   contrast brightness gamma auto deskew crop      page clean-up (EBC.image.adjust / deskew / autocrop)
//   atari [true]     Atari-size pages (320x192, 160x192 for 4 gray, 80x192 for 16 gray)    print [true]  high-res pages (printWidth [1700])
//   tiles [0]        scanned pages are cut into N screens across (text is unreadable when a whole page is squeezed into 320x192)
//   mode ['gr8']     Atari screen mode of the ATR/XEX: gr8 (1-bit) | gr15 (4 gray) | gr9 (16 gray)
//   atr xex [true]   boot-ATR page viewer (no DOS) / DOS .XEX viewer (3 pages)     textdisk [true]  DOS 2.x disk with BOOK.TXT
//   cols [64]        text wrap for the Atari text pages / CWD; txtCols [80] for BOOK.TXT
//   bundle [true]    <slug>.ebookcraft.zip with everything + manifest.json
(function (G) {
  'use strict';
  const EBC = (G.EBC = G.EBC || {});
  const B = EBC.base, I = EBC.image, A = EBC.atari;
  const pad = (n, w = 3) => String(n).padStart(w, '0');
  const slugify = (s) => String(s || 'book').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'book';
  const imgKind = (a) => {
    a = B.u8(a);
    if (a[0] === 0x89 && a[1] === 0x50 && a[2] === 0x4e) return 'png';
    if (a[0] === 0xff && a[1] === 0xd8) return 'jpeg';
    if (a[0] === 0x42 && a[1] === 0x4d) return 'bmp';
    if (a[0] === 0x50 && a[1] >= 0x31 && a[1] <= 0x36) return 'pnm';
    return null;
  };
  const isPdf = (a) => B.u8(a)[0] === 0x25 && B.u8(a)[1] === 0x50 && B.u8(a)[2] === 0x44 && B.u8(a)[3] === 0x46;
  const LEVEL = { bw: { L: 2, bits: 1 }, gray4: { L: 4, bits: 2 }, gray16: { L: 16, bits: 4 }, gray256: { L: 256, bits: 8 } };
  const ATARI_W = { 2: 320, 4: 160, 16: 80, 256: 320 };

  function toGrayPng(q) { // quantize() result -> PNG bytes at its own bit depth
    const L = q.levels, bits = L === 2 ? 1 : L === 4 ? 2 : L === 16 ? 4 : 8, g = new Uint8Array(q.lv.length);
    for (let i = 0; i < g.length; i++) g[i] = Math.round((q.lv[i] * 255) / (L - 1));
    return B.pngEncodeGray(q.w, q.h, g, bits);
  }

  function paragraphsOf(book) { // Book -> xCWriter paragraphs (headings bold + centred)
    const X = G.XCW, out = [];
    const para = (t, o = {}) => ({ align: o.align || 'l', bullet: !!o.bullet, runs: [{ t, ...(o.b ? { b: 1 } : {}), ...(o.i ? { i: 1 } : {}) }] });
    for (const c of book.chapters) for (const b of c.blocks) {
      if (b.t === 'img' || b.t === 'hr') continue;
      const t = A.asciify ? A.asciify(b.text) : EBC.book.asciify(b.text);
      if (b.t === 'h') { out.push(para('')); out.push(para(t, { b: 1, align: 'c' })); }
      else out.push(para(t, { bullet: b.t === 'li', i: b.t === 'quote' }));
    }
    return X && out.length ? out : null;
  }

  async function loadInputs(inputs, opt, log, rep) {
    const pages = []; let book = null, meta = {};
    const addImage = async (name, bytes) => {
      const img = await I.decode(bytes, name);
      pages.push({ src: img, text: null, from: name });
    };
    for (const inp of inputs) {
      const bytes = B.u8(inp.bytes);
      if (imgKind(bytes)) { await addImage(inp.name, bytes); meta.format = meta.format || 'images'; meta.title = meta.title || inp.name.replace(/\.[^.]*$/, ''); continue; }
      if (isPdf(bytes)) {
        log('reading PDF ' + inp.name);
        book = await EBC.book.open(bytes, inp.name).catch((e) => { rep.push('PDF text layer: ' + e.message); return null; });
        const ex = await EBC.pdf.extractText(bytes).catch(() => null);
        if (ex) rep.push(...(ex.warnings || []));
        const textual = ex && ex.pages.some((p) => p.paras.join('').trim());
        let n = ex ? ex.pages.length : 0, got = 0;
        const imgs = await EBC.pdf.pageImages(bytes).catch((e) => { rep.push('PDF images: ' + e.message); return []; });
        const byPage = {};
        for (const im of imgs) if (!byPage[im.page] || im.w * im.h > byPage[im.page].w * byPage[im.page].h) byPage[im.page] = im;
        const eng = EBC.pdf.engine;
        for (let p = 1; p <= Math.max(n, ...Object.keys(byPage).map(Number), 0); p++) {
          let src = null;
          try {
            if (eng && eng.renderPage) { const r = await eng.renderPage(bytes, p, opt.dpi || 150); src = I.fromRgba(r.w, r.h, r.rgba); }
            else if (byPage[p]) { const d = await EBC.pdf.decodeImage(byPage[p]); src = I.fromRgba(d.w, d.h, d.rgba); }
          } catch (e) { rep.push('page ' + p + ' image: ' + e.message); }
          if (src) got++;
          pages.push({ src, text: ex && ex.pages[p - 1] ? ex.pages[p - 1].paras.join('\n\n') : null, from: inp.name + '#' + p });
        }
        rep.push('PDF: ' + n + ' page(s), text layer ' + (textual ? 'yes' : 'no') + ', ' + got + ' page image(s)');
        if (!textual) book = null;
        meta = { ...meta, format: 'pdf', title: (ex && ex.title) || inp.name.replace(/\.[^.]*$/, ''), author: (ex && ex.author) || '' };
        continue;
      }
      log('reading book ' + inp.name);
      book = await EBC.book.open(bytes, inp.name);
      meta = { ...meta, format: book.format, title: book.title, author: book.author };
      rep.push(...(book.warnings || []));
    }
    return { pages, book, meta };
  }

  async function convert(inputs, opt = {}, log = () => {}) {
    opt = { text: true, ocr: false, bw: true, gray: [], dither: 'atkinson', atari: true, print: true, printWidth: 1700, tiles: 0, mode: 'gr8', atr: true, xex: true, textdisk: true, cols: 64, txtCols: 80, bundle: true, ...opt };
    if (!Array.isArray(inputs)) inputs = [inputs];
    const rep = [], files = [], put = (path, bytes) => files.push({ path, bytes: typeof bytes === 'string' ? B.enc(bytes) : bytes });
    const { pages, book: bk0, meta } = await loadInputs(inputs, opt, log, rep);
    let book = bk0;
    const slug = opt.slug || slugify(meta.title || inputs[0].name);
    const ocrInfo = { requested: !!opt.ocr, ran: false, pages: 0, meanConfidence: null, engine: null };

    // ---- OCR ----
    if (opt.ocr) {
      if (!EBC.ocr || !(await EBC.ocr.available())) rep.push('OCR requested but the OCR add-on is not installed (node scripts/ebookcraft-install-ocr.cjs): no OCR text produced');
      else {
        let sum = 0, n = 0;
        for (let i = 0; i < pages.length; i++) {
          const p = pages[i];
          if (!p.src || (p.text && p.text.trim() && opt.ocr !== 'force')) continue;
          log('OCR page ' + (i + 1) + '/' + pages.length);
          const r = await EBC.ocr.recognize(p.src, { deskew: opt.deskew });
          p.text = r.text; p.confidence = r.confidence; sum += r.confidence; n++;
        }
        ocrInfo.ran = n > 0; ocrInfo.pages = n; ocrInfo.meanConfidence = n ? Math.round((sum / n) * 10) / 10 : null; ocrInfo.engine = 'tesseract.js (eng, LSTM)';
      }
    }

    // ---- text ----
    const pageTexts = pages.map((p) => p.text).filter((t) => t && t.trim());
    if (!book && pageTexts.length) {
      book = EBC.book.fromText(pages.map((p) => (p.confidence !== undefined ? EBC.ocr.reflow(p.text || '') : (p.text || '')).trim()).filter(Boolean).join('\n\n'), meta.title || slug);
      book.title = meta.title || book.title; book.author = meta.author || book.author; book.format = meta.format || 'text';
    }
    let fullText = '';
    if (book) {
      fullText = EBC.book.toLines(book, { cols: opt.txtCols, chapterBreak: false }).map((l) => (l.text === '\f' ? '' : l.text)).join('\n');
      if (opt.text) {
        put('text/book.txt', fullText + '\n');
        pages.forEach((p, i) => { if (p.text && p.text.trim() && p.src) put('text/p' + pad(i + 1) + '.txt', p.text + '\n'); });
        if (G.XCW) {
          const paras = paragraphsOf(book);
          if (paras) { const c = G.XCW.toCwd(paras, { cols: opt.cols }); put('text/book.xcw', c.file || c.bytes); if (c.truncated) rep.push('CWD export truncated to the Craft Word document limit (' + c.dropped + ' paragraph(s) dropped); book.txt has the full text'); }
        } else rep.push('xCWriter core not loaded: no .xcw written');
      }
    } else if (opt.text) rep.push('no text available (no text layer; run with OCR)');

    // ---- page images ----
    const sets = [];
    if (opt.bw) sets.push('bw');
    for (const n of opt.gray || []) { const k = 'gray' + n; if (!LEVEL[k]) rep.push('gray level ' + n + ' not supported (use 4, 16, 256)'); else sets.push(k); }
    const screens = { gr8: [], gr15: [], gr9: [] }; // Atari screen bytes per mode, in order
    const pageRecords = [];
    const wantImages = sets.length && (opt.atari || opt.print);
    const srcPages = pages.filter((p) => p.src);
    // Text-only books/PDFs get Atari text pages (4x7 font), so every input yields viewable pages.
    let textPages = null;
    if (!srcPages.length && book) {
      const lines = EBC.book.toLines(book, { cols: opt.cols });
      textPages = EBC.book.paginateLines(lines, 23).map((p, i, all) => A.textPage(p.lines, { header: (book.title || '').slice(0, 52).padEnd(52) + (' ' + (i + 1) + '/' + all.length).slice(-12) }));
      rep.push('text book: ' + textPages.length + ' Atari text page(s) at 64x23 characters (4x7 font)');
    }
    const prep = (img) => {
      let g = img;
      if (opt.flatten !== false) g = { w: g.w, h: g.h, g: I.flatten(g) };
      if (opt.crop) g = I.autocrop(g, 8);
      if (opt.deskew) g = I.deskew(g).img;
      return I.adjust(g, { contrast: opt.contrast, brightness: opt.brightness, gamma: opt.gamma, auto: opt.auto });
    };
    const list = srcPages.length ? srcPages.map((p) => ({ img: p.src, scan: true })) : (textPages || []).map((t) => ({ img: t, scan: false }));
    if (wantImages) {
      for (let i = 0; i < list.length; i++) {
        const it = list[i], g = it.scan ? prep(it.img) : it.img, rec = { n: i + 1, files: {} };
        for (const s of sets) {
          const L = LEVEL[s].L, method = opt.dither;
          if (opt.atari) {
            const W = ATARI_W[L], T = it.scan ? opt.tiles | 0 : 0;
            if (T > 1) {
              const scaled = I.resize(g, W * T, Math.max(1, Math.round((g.h * W * T) / g.w)));
              const ts = I.tiles(scaled, W, A.H).tiles;
              for (let k = 0; k < ts.length; k++) {
                const q = I.quantize(ts[k], { levels: L, method });
                const f = 'pages/atari-' + s + '/p' + pad(i + 1) + '-t' + pad(k + 1, 2) + '.png';
                put(f, await toGrayPng(q)); (rec.files[s + '-atari'] = rec.files[s + '-atari'] || []).push(f);
                const m = L === 2 ? 'gr8' : L === 4 ? 'gr15' : L === 16 ? 'gr9' : null;
                if (m) screens[m].push(A.pack(q, m));
              }
            } else {
              const f2 = I.fit(g, W, A.H, { mode: 'contain', bg: 255 });
              const q = I.quantize(it.scan ? f2 : (W === 320 ? g : I.resize(g, W, A.H)), { levels: L, method: it.scan ? method : (L === 2 ? 'threshold' : method) });
              const f = 'pages/atari-' + s + '/p' + pad(i + 1) + '.png';
              put(f, await toGrayPng(q)); rec.files[s + '-atari'] = f;
              const m = L === 2 ? 'gr8' : L === 4 ? 'gr15' : L === 16 ? 'gr9' : null;
              if (m) screens[m].push(A.pack(q, m));
            }
          }
          if (opt.print) {
            let pg = g;
            if (it.scan) { if (g.w > opt.printWidth) pg = I.resize(g, opt.printWidth, Math.round((g.h * opt.printWidth) / g.w)); }
            else pg = { w: g.w * 4, h: g.h * 4, g: (() => { const o = new Uint8Array(g.w * 4 * g.h * 4); for (let y = 0; y < g.h * 4; y++) for (let x = 0; x < g.w * 4; x++) o[y * g.w * 4 + x] = g.g[(y >> 2) * g.w + (x >> 2)]; return o; })() };
            const q = I.quantize(pg, { levels: L, method: it.scan ? method : 'threshold' });
            const f = 'pages/print-' + s + '/p' + pad(i + 1) + '.png';
            put(f, await toGrayPng(q)); rec.files[s + '-print'] = f;
          }
        }
        pageRecords.push(rec);
        log('page ' + (i + 1) + '/' + list.length);
      }
    }

    // ---- Atari native outputs ----
    const atariOut = [];
    const sc = screens[opt.mode] || [];
    if (sc.length && opt.atr) {
      const atr = A.bootAtr(sc, { mode: opt.mode }); put('atari/' + slug + '-view.atr', atr); atariOut.push({ file: 'atari/' + slug + '-view.atr', kind: 'boot ATR viewer', mode: opt.mode, screens: sc.length, bytes: atr.length });
    } else if (opt.atr) rep.push('no ' + opt.mode + ' screens for the ATR (enable the matching image set: bw for gr8, gray 4 for gr15, gray 16 for gr9)');
    if (sc.length && opt.xex) {
      const x = A.xex(sc, { mode: opt.mode }); put('atari/' + slug + '-view.xex', x); atariOut.push({ file: 'atari/' + slug + '-view.xex', kind: 'XEX viewer', mode: opt.mode, screens: Math.min(3, sc.length), bytes: x.length });
      if (sc.length > 3) rep.push('XEX holds the first 3 screens only; the ATR has all ' + sc.length);
    }
    if (fullText && opt.textdisk) {
      try {
        const files2 = { 'BOOK.TXT': fullText };
        const d = A.textDisk(files2, { sectors: Math.max(720, 0) });
        if (d.skipped.length) {
          const big = A.textDisk(files2, { sectors: 1040 });
          if (big.skipped.length) rep.push('BOOK.TXT does not fit a 130K DOS 2 disk (' + big.skipped[0] + '); only the first part is on the disk');
          else { put('atari/' + slug + '-text.atr', big.bytes); atariOut.push({ file: 'atari/' + slug + '-text.atr', kind: 'DOS 2 text disk (BOOK.TXT)', bytes: big.bytes.length }); }
        } else { put('atari/' + slug + '-text.atr', d.bytes); atariOut.push({ file: 'atari/' + slug + '-text.atr', kind: 'DOS 2 text disk (BOOK.TXT)', bytes: d.bytes.length }); }
      } catch (e) { rep.push('text disk: ' + e.message); }
    }

    // ---- manifest + bundle ----
    const manifest = {
      format: 'ebookcraft-book', version: 1, id: book ? book.id : slug, slug, title: meta.title || slug, author: meta.author || '', lang: book ? book.lang : '', source: { files: inputs.map((i) => i.name), format: meta.format },
      created: new Date().toISOString(), options: { ...opt, gray: opt.gray, ocr: !!opt.ocr }, ocr: ocrInfo, text: fullText ? 'text/book.txt' : null,
      pages: pageRecords.length ? pageRecords : undefined, atari: atariOut, toc: book ? book.toc.map((t) => ({ title: t.title, ch: t.ch, bi: t.bi, lvl: t.lvl })) : [], report: rep,
      counts: { pages: pages.length || (textPages ? textPages.length : 0), screens: sc.length, chars: fullText.length },
    };
    delete manifest.options.bundle;
    put('manifest.json', JSON.stringify(manifest, null, 1));
    if (opt.bundle) files.push({ path: slug + '.ebookcraft.zip', bytes: await B.zipWrite(files.map((f) => ({ name: f.path, data: f.bytes })), { deflate: true }) });
    return { files, manifest, report: rep, book, slug };
  }

  // Reader <- bundle: a .ebookcraft.zip becomes a Book (text only) so the reader and the converter round-trip.
  async function openBundle(bytes) {
    const z = await B.zipRead(bytes), mf = z.find('manifest.json');
    if (!mf) throw new Error('not an EBookCraft bundle (no manifest.json)');
    const m = JSON.parse(B.decodeText(await z.get('manifest.json')));
    const txt = z.find('text/book.txt') ? B.decodeText(await z.get('text/book.txt')) : '';
    const bk = EBC.book.fromText(txt, m.title);
    bk.title = m.title || bk.title; bk.author = m.author || ''; bk.format = 'ebookcraft'; bk.meta = { manifest: m };
    bk.resource = async (p) => (z.find(p) ? z.get(p) : null);
    return bk;
  }
  const isBundle = async (bytes) => { try { const z = await B.zipRead(bytes); return !!z.find('manifest.json'); } catch (e) { return false; } };

  // Server layout (docs/DEPLOY.md): web\library\craftapps\EBookCraft\<slug>\...  plus a shelf index the reader lists.
  const LIB_ROOT = 'library/craftapps/EBookCraft';
  function deployFiles(result) {
    const out = result.files.filter((f) => !f.path.endsWith('.ebookcraft.zip')).map((f) => ({ path: LIB_ROOT + '/' + result.slug + '/' + f.path, bytes: f.bytes }));
    const zip = result.files.find((f) => f.path.endsWith('.ebookcraft.zip'));
    if (zip) out.push({ path: LIB_ROOT + '/' + result.slug + '/' + zip.path, bytes: zip.bytes });
    return out;
  }
  function shelfEntry(result) {
    const m = result.manifest;
    return { slug: result.slug, title: m.title, author: m.author, pages: m.counts.pages, screens: m.counts.screens, ocr: m.ocr.ran, bundle: result.slug + '/' + result.slug + '.ebookcraft.zip', created: m.created };
  }
  const shelfMerge = (old, entry) => [...(old || []).filter((e) => e.slug !== entry.slug), entry].sort((a, b) => a.title.localeCompare(b.title));

  EBC.pack = { convert, openBundle, isBundle, deployFiles, shelfEntry, shelfMerge, slugify, imgKind, isPdf, LIB_ROOT, LEVEL };
  if (typeof module !== 'undefined') module.exports = EBC;
})(typeof window !== 'undefined' ? window : globalThis);
