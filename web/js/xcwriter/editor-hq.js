// High quality editor: a contenteditable page. The document model (XCW paragraphs/runs) stays the source of truth:
// every input event reads the DOM back into the model, every command edits the model and re-renders.
(function () {
  const hq = document.getElementById('hq');
  const TAGS = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', SUP: 'sup', SUB: 'sub' };
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let onChange = () => {};

  function styleOf(node) {
    const s = { b: 0, i: 0, u: 0, sup: 0, sub: 0 };
    for (let n = node; n && n !== hq; n = n.parentNode) {
      const k = TAGS[n.nodeName]; if (k) s[k] = 1;
      const st = n.style; if (!st) continue;
      if (st.fontWeight === 'bold' || +st.fontWeight >= 600) s.b = 1;
      if (st.fontStyle === 'italic') s.i = 1;
      if ((st.textDecorationLine || st.textDecoration || '').includes('underline')) s.u = 1;
      if (st.verticalAlign === 'super') s.sup = 1; else if (st.verticalAlign === 'sub') s.sub = 1;
    }
    return s;
  }
  function readPara(el) {
    const p = { align: ({ c: 'c', r: 'r', j: 'j' })[el.dataset.a] || 'l', bullet: el.classList.contains('bul') || el.nodeName === 'LI', runs: [] };
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const t = n.nodeValue.replace(/[\r\n\u200b]/g, '');
      if (t) p.runs.push({ t, ...styleOf(n.parentNode) });
    }
    return p;
  }
  function toModel() {
    const paras = []; let cur = null;
    for (const n of hq.childNodes) {
      if (n.nodeType === 1 && /^(P|DIV|LI|H\d|BLOCKQUOTE)$/.test(n.nodeName)) { paras.push(readPara(n)); cur = null; } else {
        if (!cur) { cur = { align: 'l', bullet: false, runs: [] }; paras.push(cur); }
        if (n.nodeType === 3) { const t = n.nodeValue.replace(/[\r\n]/g, ''); if (t) cur.runs.push({ t, ...styleOf(n.parentNode) }); } else if (n.nodeType === 1 && n.nodeName !== 'BR') cur.runs.push({ t: n.textContent, ...styleOf(n) });
      }
    }
    return XCW.normalize(paras);
  }
  function render(doc) {
    hq.innerHTML = doc.map((p) => {
      let h = '';
      for (const r of p.runs) {
        let s = esc(r.t);
        if (r.sub) s = '<sub>' + s + '</sub>'; if (r.sup) s = '<sup>' + s + '</sup>';
        if (r.u) s = '<u>' + s + '</u>'; if (r.i) s = '<i>' + s + '</i>'; if (r.b) s = '<b>' + s + '</b>';
        h += s;
      }
      return '<p' + (p.align !== 'l' ? ' data-a="' + p.align + '"' : '') + (p.bullet ? ' class="bul"' : '') + '>' + (h || '<br>') + '</p>';
    }).join('');
  }

  function posOf(node, off) {
    if (node === hq) { const k = hq.children; return off >= k.length ? endPos() : { p: off, o: 0 }; }
    let el = node.nodeType === 1 ? node : node.parentNode;
    while (el && el.parentNode !== hq) el = el.parentNode;
    if (!el) return { p: 0, o: 0 };
    const r = document.createRange(); r.selectNodeContents(el); r.setEnd(node, off);
    return { p: [...hq.children].indexOf(el), o: r.toString().replace(/[\r\n]/g, '').length };
  }
  function endPos() { const k = hq.children, last = k[k.length - 1]; return { p: Math.max(0, k.length - 1), o: last ? last.textContent.length : 0 }; }
  function domPoint(pos) {
    const el = hq.children[Math.min(pos.p, hq.children.length - 1)];
    if (!el) return [hq, 0];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let acc = 0;
    for (let n; (n = w.nextNode());) { const l = n.nodeValue.length; if (pos.o <= acc + l) return [n, pos.o - acc]; acc += l; }
    return [el, el.childNodes.length && el.lastChild.nodeName !== 'BR' ? el.childNodes.length : 0];
  }
  function getSel() {
    const s = getSelection();
    if (!s.rangeCount || !hq.contains(s.anchorNode)) return null;
    return { a: posOf(s.anchorNode, s.anchorOffset), f: posOf(s.focusNode, s.focusOffset) };
  }
  function setSel(a, f) {
    const s = getSelection(), x = domPoint(a), y = domPoint(f || a);
    s.setBaseAndExtent(x[0], x[1], y[0], y[1]);
  }
  function rangeOf(a, b) { const r = document.createRange(), x = domPoint(a), y = domPoint(b); r.setStart(x[0], x[1]); r.setEnd(y[0], y[1]); return r; }
  function mark(name, spans) {
    if (!window.CSS || !CSS.highlights) return;
    if (!spans.length) { CSS.highlights.delete(name); return; }
    CSS.highlights.set(name, new Highlight(...spans.map((m) => rangeOf({ p: m.p, o: m.start }, { p: m.p, o: m.end }))));
  }
  function wordAt(x, y) {
    const r = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
    return r && hq.contains(r.startContainer) ? posOf(r.startContainer, r.startOffset) : null;
  }

  hq.addEventListener('beforeinput', (e) => { if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { e.preventDefault(); return; } if (e.inputType === 'insertLineBreak') { e.preventDefault(); document.execCommand('insertParagraph'); return; } XW.beforeEdit(); });
  hq.addEventListener('input', () => { XW.doc = toModel(); if (!hq.children.length) { XW.doc = XCW.newDoc(); render(XW.doc); } onChange(); });
  hq.addEventListener('paste', (e) => {
    e.preventDefault();
    XW.pasteData(e.clipboardData);
  });
  hq.addEventListener('keydown', (e) => XW.key(e));
  hq.addEventListener('contextmenu', (e) => XW.contextMenu(e, wordAt(e.clientX, e.clientY)));
  document.addEventListener('selectionchange', () => { if (document.activeElement === hq) XW.selChanged(); });
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* ignore */ }

  window.HQ = {
    el: hq, render, toModel, getSel, setSel, mark,
    onChange(f) { onChange = f; },
    load(doc, sel) { render(doc); if (sel) setSel(sel.a, sel.f); },
    focus() { hq.focus(); },
    setFont(f, size, lh) { hq.style.fontFamily = f; hq.style.fontSize = size + 'pt'; hq.style.lineHeight = lh; },
  };
})();
