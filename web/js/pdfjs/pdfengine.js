// Reusable offline PDF rendering module (wraps the vendored pdf.js in this folder). No DOM beyond a scratch canvas.
// Load pdf.min.js, pdf.worker.min.js, then this file; works from file:// (the worker script runs on the main thread).
//   PDFENGINE.renderPage(bytes, pageNo, dpi) -> Promise<{ w, h, rgba }>   (pageNo is 1-based; 72 PDF points = 1 inch)
//   PDFENGINE.pageCount(bytes)               -> Promise<number>
//   PDFENGINE.pageText(bytes, pageNo)        -> Promise<string>
// EBookCraft: EBC.pdf.engine = PDFENGINE;   (its contract is renderPage(bytes, pageNo, dpi))
(function (root) {
  const pdfjs = root.pdfjsLib;
  if (!pdfjs) throw new Error('load js/pdfjs/pdf.min.js before pdfengine.js');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = 'js/pdfjs/pdf.worker.min.js';
  let cacheKey = null, cacheDoc = null;
  async function doc(bytes) {
    if (cacheKey === bytes && cacheDoc) return cacheDoc;
    if (cacheDoc) cacheDoc.destroy();
    cacheKey = bytes;
    cacheDoc = await pdfjs.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
    return cacheDoc;
  }
  async function renderPage(bytes, pageNo, dpi) {
    const page = await (await doc(bytes)).getPage(pageNo), vp = page.getViewport({ scale: (dpi || 150) / 72 });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    return { w: c.width, h: c.height, rgba: g.getImageData(0, 0, c.width, c.height).data };
  }
  async function pageCount(bytes) { return (await doc(bytes)).numPages; }
  async function pageText(bytes, pageNo) {
    const tc = await (await (await doc(bytes)).getPage(pageNo)).getTextContent();
    return tc.items.map((i) => i.str + (i.hasEOL ? '\n' : '')).join('');
  }
  root.PDFENGINE = { renderPage, pageCount, pageText };
})(window);
