// EBC.ocr - optional offline OCR add-on (tesseract.js, Apache-2.0). Nothing is loaded from a CDN.
// The engine is NOT in git (about 7 MB): run `node scripts/ebookcraft-install-ocr.cjs` once. It installs into
//   tools/ebookcraft/ocr/            (node_modules for the CLI)
//   web/js/ebookcraft/ocr/           (tesseract.min.js, worker.min.js, core/*, lang/eng.traineddata.gz for the browser; deploy copies it with web\)
// available() tells honestly whether the engine is present; recognize() throws a clear message when it is not.
(function (G) {
  'use strict';
  const EBC = (G.EBC = G.EBC || {});
  const B = EBC.base, I = EBC.image;
  const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node) && typeof window === 'undefined';
  const BASE = !isNode && typeof document !== 'undefined' && document.currentScript ? document.currentScript.src.replace(/[^/]*$/, '') : '';
  let T = null, worker = null, workerKey = '', nodeDir = null;

  function nodeRoot() {
    const path = require('path'), fs = require('fs');
    const c = [path.join(__dirname, '..', '..', '..', 'tools', 'ebookcraft', 'ocr'), path.join(__dirname, 'ocr')];
    return c.find((d) => fs.existsSync(path.join(d, 'node_modules', 'tesseract.js'))) || null;
  }

  async function available() {
    if (isNode) return !!nodeRoot();
    try { const r = await fetch(BASE + 'ocr/lang/eng.traineddata.gz', { method: 'HEAD' }); return r.ok; } catch (e) { return false; }
  }

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('cannot load ' + src)); document.head.appendChild(s); });
  }

  async function engine(lang) {
    const key = lang || 'eng';
    if (worker && workerKey === key) return worker;
    if (worker) { await worker.terminate(); worker = null; }
    if (isNode) {
      nodeDir = nodeRoot();
      if (!nodeDir) throw new Error('OCR add-on not installed: run  node scripts/ebookcraft-install-ocr.cjs');
      const path = require('path');
      T = require(path.join(nodeDir, 'node_modules', 'tesseract.js'));
      const lp = path.join(nodeDir, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int');
      worker = await T.createWorker(key, 1, { langPath: lp, gzip: true, cacheMethod: 'none' });
    } else {
      if (!(await available())) throw new Error('OCR add-on not installed: run  node scripts/ebookcraft-install-ocr.cjs  (then reload)');
      if (!G.Tesseract) await loadScript(BASE + 'ocr/tesseract.min.js');
      T = G.Tesseract;
      worker = await T.createWorker(key, 1, { workerPath: BASE + 'ocr/worker.min.js', corePath: BASE + 'ocr/core/', langPath: BASE + 'ocr/lang/', gzip: true, cacheMethod: 'none' });
    }
    workerKey = key;
    return worker;
  }

  // Page preparation for OCR: flatten uneven lighting, optional deskew, scale to about 300 dpi for a letter page (1800+ px wide).
  function prepare(img, opt = {}) {
    let g = { w: img.w, h: img.h, g: I.flatten(img) };
    if (opt.deskew !== false) g = I.deskew(g).img;
    const minW = opt.minWidth || 1800;
    if (g.w < minW) g = I.resize(g, minW, Math.round((g.h * minW) / g.w));
    return I.adjust(g, { auto: true });
  }

  // -> { text, confidence (0..100), words:[{text,confidence,bbox}], ms }
  async function recognize(img, opt = {}) {
    const w = await engine(opt.lang);
    const t0 = Date.now(), p = opt.raw ? img : prepare(img, opt);
    const png = await B.pngEncodeGray(p.w, p.h, p.g, 8);
    const input = isNode ? Buffer.from(png) : new Blob([png], { type: 'image/png' });
    const { data } = await w.recognize(input);
    const words = (data.words || (data.blocks || []).flatMap((b) => (b.paragraphs || []).flatMap((q) => (q.lines || []).flatMap((l) => l.words || [])))).map((x) => ({ text: x.text, confidence: x.confidence, bbox: x.bbox }));
    return { text: (data.text || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim(), confidence: data.confidence, words, ms: Date.now() - t0 };
  }

  // OCR gives hard-wrapped lines. Re-join them into paragraphs: a line clearly shorter than the typical line ends its paragraph.
  function reflow(text) {
    const lines = text.split('\n').map((l) => l.trim());
    const lens = lines.filter(Boolean).map((l) => l.length).sort((a, b) => a - b), med = lens.length ? lens[lens.length >> 1] : 0;
    const out = []; let cur = '';
    for (const l of lines) {
      if (!l) { if (cur) out.push(cur); cur = ''; continue; }
      cur = cur ? (/-$/.test(cur) && /^[a-z]/.test(l) ? cur.slice(0, -1) + l : cur + ' ' + l) : l;
      if (l.length < med * 0.72) { out.push(cur); cur = ''; }
    }
    if (cur) out.push(cur);
    return out.join('\n\n');
  }

  async function terminate() { if (worker) { await worker.terminate(); worker = null; } }

  EBC.ocr = { available, recognize, prepare, reflow, terminate };
  if (typeof module !== 'undefined') module.exports = EBC;
})(typeof window !== 'undefined' ? window : globalThis);
