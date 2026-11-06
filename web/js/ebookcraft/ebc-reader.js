/* EBookCraft reader engine (browser only).
 * Paginates one chapter at a time with CSS columns; a position is {ch, bi} = chapter + block index, so it survives
 * font/size/window changes (page numbers are only derived from it). The Atari view renders the same book through
 * EBC.book.toLines/paginateLines + EBC.atari.textPage (64x23 screen in the 4x7 Craft font).
 *
 *   const R = EBC.reader.create({ flow, view, onChange });
 *   R.load(book);  R.next(); R.prev(); R.goto({ch,bi}); R.setCols(2); R.highlight(text);
 *   R.pos() -> {ch,bi,page,pages}; R.mode('hq'|'atari')
 */
(function (G) {
  const EBC = G.EBC = G.EBC || {};
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function create(o) {
    const flow = o.flow, view = o.view, onChange = o.onChange || (() => {});
    let book = null, ch = 0, page = 0, pages = 1, cols = 1, hl = '', cur = { ch: 0, bi: 0 }, step = 1;
    let atari = null, apage = 0, mode = 'hq';

    function blockHtml(b, i) {
      const a = ' data-bi="' + i + '"';
      const t = esc(b.text || '');
      switch (b.t) {
        case 'h': return '<h' + Math.min(4, Math.max(1, b.lvl || 2)) + a + '>' + t + '</h' + Math.min(4, Math.max(1, b.lvl || 2)) + '>';
        case 'li': return '<p class="li"' + a + '>' + t + '</p>';
        case 'quote': return '<p class="quote"' + a + '>' + t + '</p>';
        case 'pre': return '<pre' + a + '>' + t + '</pre>';
        case 'hr': return '<hr' + a + '>';
        case 'img': return '<p class="img"' + a + '>[image' + (b.alt ? ': ' + esc(b.alt) : '') + ']</p>';
        default: return '<p' + a + '>' + t + '</p>';
      }
    }
    function markHits(html) {
      if (!hl) return html;
      const re = new RegExp(hl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      return html.replace(/>([^<]+)</g, (m, s) => '>' + s.replace(re, (x) => '<span class="hit">' + x + '</span>') + '<');
    }
    function layout() {
      const w = view.clientWidth, h = view.clientHeight, gap = 56;
      flow.style.width = w + 'px'; flow.style.height = h + 'px';
      flow.style.columnCount = cols; flow.style.columnGap = gap + 'px'; flow.style.columnFill = 'auto';
      step = w + gap;
      pages = Math.max(1, Math.ceil((flow.scrollWidth - 2) / step));
    }
    function renderChapter() {
      const c = book.chapters[ch];
      flow.innerHTML = markHits(c.blocks.map(blockHtml).join(''));
      layout();
    }
    function pageOfBlock(bi) {
      const el = flow.querySelector('[data-bi="' + bi + '"]');
      if (!el) return 0;
      return Math.min(pages - 1, Math.max(0, Math.floor((el.offsetLeft + 2) / step)));
    }
    function blockOfPage(p) {
      const els = flow.querySelectorAll('[data-bi]');
      for (const el of els) if (el.offsetLeft + el.offsetWidth > p * step + 2) return +el.dataset.bi;
      return 0;
    }
    function show() {
      flow.style.transform = 'translateX(' + (-page * step) + 'px)';
      cur = { ch, bi: blockOfPage(page) };
      onChange(pos());
    }
    function pos() {
      if (mode === 'atari' && atari) return { ch: atari.pages[apage].ch, bi: atari.pages[apage].bi, page: apage, pages: atari.pages.length, atari: true, overall: atari.pages.length > 1 ? apage / (atari.pages.length - 1) : 0 };
      let before = 0, total = 0;
      if (book) book.chapters.forEach((c, i) => { const n = c.blocks.reduce((m, b) => m + (b.text || '').length, 0); total += n; if (i < ch) before += n; });
      const n = book ? book.chapters[ch].blocks.reduce((m, b) => m + (b.text || '').length, 0) : 0;
      return { ch, bi: cur.bi, page, pages, overall: total ? (before + n * (pages > 1 ? page / pages : 0)) / total : 0 };
    }

    // ---- Atari view
    function buildAtari() {
      const lines = EBC.book.toLines(book, { cols: 64 });
      atari = { pages: EBC.book.paginateLines(lines, 23) };
    }
    function drawAtari(canvas) {
      if (!atari) buildAtari();
      apage = Math.max(0, Math.min(atari.pages.length - 1, apage));
      const p = atari.pages[apage];
      const img = EBC.atari.textPage(p.lines.map((l) => (typeof l === 'string' ? l : l.text)), { header: (book.title || '').slice(0, 52) + ' ' + (apage + 1) + '/' + atari.pages.length });
      const cx = canvas.getContext('2d'), id = cx.createImageData(img.w, img.h);
      for (let i = 0; i < img.g.length; i++) { const v = img.g[i]; id.data[i * 4] = v; id.data[i * 4 + 1] = v; id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
      cx.putImageData(id, 0, 0);
    }

    const api = {
      load(b, at) {
        book = b; atari = null; apage = 0; hl = '';
        ch = 0; page = 0;
        api.goto(at && at.ch < b.chapters.length ? at : { ch: 0, bi: 0 });
      },
      goto(p) {
        if (!book) return;
        ch = Math.max(0, Math.min(book.chapters.length - 1, p.ch | 0));
        renderChapter();
        page = pageOfBlock(p.bi | 0);
        if (mode === 'atari') api.syncAtari(p);
        show();
      },
      syncAtari(p) {
        if (!atari) buildAtari();
        let best = 0;
        atari.pages.forEach((pg, i) => { if (pg.ch < p.ch || (pg.ch === p.ch && pg.bi <= p.bi)) best = i; });
        apage = best;
      },
      next() {
        if (mode === 'atari') { if (atari && apage < atari.pages.length - 1) { apage++; onChange(pos()); } return; }
        if (page < pages - 1) { page++; show(); } else if (ch < book.chapters.length - 1) { ch++; renderChapter(); page = 0; show(); }
      },
      prev() {
        if (mode === 'atari') { if (apage > 0) { apage--; onChange(pos()); } return; }
        if (page > 0) { page--; show(); } else if (ch > 0) { ch--; renderChapter(); page = pages - 1; show(); }
      },
      goFraction(f) {
        if (mode === 'atari') { apage = Math.round(f * (atari.pages.length - 1)); onChange(pos()); return; }
        const tot = book.chapters.map((c) => c.blocks.reduce((m, b) => m + (b.text || '').length, 0)), all = tot.reduce((a, b) => a + b, 0);
        let want = f * all, i = 0;
        while (i < tot.length - 1 && want > tot[i]) { want -= tot[i]; i++; }
        ch = i; renderChapter(); page = Math.min(pages - 1, Math.round((tot[i] ? want / tot[i] : 0) * pages)); show();
      },
      relayout() { if (!book) return; const bi = cur.bi; renderChapter(); page = pageOfBlock(bi); show(); },
      setCols(n) { cols = n; api.relayout(); },
      highlight(t) { hl = t || ''; if (book) api.relayout(); },
      mode(m) { if (m === undefined) return mode; mode = m; if (m === 'atari' && book) api.syncAtari(cur); return mode; },
      drawAtari,
      pos, current: () => ({ ...cur }),
      book: () => book,
    };
    return api;
  }

  EBC.reader = { create };
})(typeof window !== 'undefined' ? window : globalThis);
