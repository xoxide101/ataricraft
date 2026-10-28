/* WebAFM editor window: one window with switchable modes over the same bytes.
   Built-in modes: Text (ATASCII-aware) and Hex. Other modes register themselves in AC.WEdit.modes.
   AC.WEdit.open({parent, title, data, readOnly, mode, onSave(bytes)}) -> Promise (resolves when closed). */
(function () {
  'use strict';
  const WT = () => AC.WTools;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hx2 = (b) => b.toString(16).toUpperCase().padStart(2, '0');
  const modes = {};

  const CSS = `
  .wed{position:absolute;inset:0;background:#14161a;z-index:6;display:flex;flex-direction:column;outline:none}
  .wed button,.wed select,.wed input{background:#2a2f39;color:#d8dce4;border:1px solid #2c313b;border-radius:5px;padding:3px 8px;font:inherit}
  .wed button{cursor:pointer}.wed button:hover{background:#343a47}.wed button:disabled{opacity:.35;cursor:not-allowed}
  .wed .eh{display:flex;gap:6px;align-items:center;padding:8px;background:#1e2128;border-bottom:1px solid #2c313b;flex-wrap:wrap}
  .wed .eh h3{margin:0 8px 0 0;font-size:14px;color:#e8a33d;max-width:40ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .wed .tabs button{border-radius:5px 5px 0 0}  .wed .tabs button.on{background:#e8a33d!important;color:#14161a!important;border-color:#e8a33d!important}
  .wed .tl{display:flex;gap:6px;align-items:center;padding:6px 8px;background:#191c22;border-bottom:1px solid #2c313b;flex-wrap:wrap;font-size:12px}
  .wed .eb{flex:1;min-height:0;display:flex;position:relative}
  .wed .es{padding:4px 10px;background:#1e2128;border-top:1px solid #2c313b;font-size:12px;color:#9aa1ad;display:flex;gap:16px}
  .wed .sp{flex:1}.wed .dim{color:#9aa1ad}.wed .bad{color:#ff7b72}.wed .ok{color:#6fcf8a}.wed .warn{color:#e8a33d}
  .wed textarea.etx{flex:1;resize:none;background:#101216;color:#d8dce4;border:0;padding:8px;font:13px/1.45 Consolas,monospace;white-space:pre;outline:none;tab-size:8}
  .wed textarea.etx.wrap{white-space:pre-wrap}
  .wed .hv{flex:1;overflow:auto;position:relative;background:#101216;outline:none;font:13px Consolas,monospace}
  .wed .hr{position:absolute;left:0;height:18px;line-height:18px;white-space:pre;padding-left:8px}
  .wed .ha{color:#6d7480}.wed .hb,.wed .hc{cursor:text}.wed .hb.on,.wed .hc.on{background:#2f4f7a}.wed .hb.cur{background:#e8a33d;color:#14161a}.wed .hc.cur{background:#e8a33d;color:#14161a}
  .wed .hb.fd,.wed .hc.fd{background:#6a3d8f}.wed .hb.md,.wed .hc.md{color:#ff9d57}.wed .hv.ascf .hb.cur{background:#5a5f6a}.wed .hv:not(.ascf) .hc.cur{background:#5a5f6a}
  .wed .insp{width:230px;border-left:1px solid #2c313b;background:#191c22;padding:8px;font-size:12px;overflow:auto}
  .wed .insp table{width:100%;border-collapse:collapse}.wed .insp td{padding:2px 0}.wed .insp td:first-child{color:#9aa1ad;width:80px}
  .wed .em{position:absolute;inset:0;background:#000a;display:flex;align-items:center;justify-content:center;z-index:3}
  .wed .em>div{background:#1e2128;border:1px solid #3a404c;border-radius:8px;padding:14px;min-width:300px;box-shadow:0 8px 30px #000a}
  `;
  function css() { if (document.getElementById('wedcss')) return; const s = document.createElement('style'); s.id = 'wedcss'; s.textContent = CSS; document.head.append(s); }

  function open(o) {
    css();
    return new Promise((resolve) => {
      const S = { data: new Uint8Array(o.data || []), orig: new Uint8Array(o.data || []), ro: !!o.readOnly, dirty: false, mode: null, cur: null, o, saving: false };
      const root = document.createElement('div'); root.className = 'wed'; root.tabIndex = -1;
      root.innerHTML = `<div class="eh"><h3></h3><span class="tabs"></span><span class="sp"></span><button class="sv">Save</button><button class="rv">Revert</button><button class="cl">Close</button></div><div class="tl"></div><div class="eb"></div><div class="es"><span class="s1"></span><span class="s2"></span><span class="sp"></span><span class="s3"></span></div>`;
      (o.parent || document.body).append(root);
      const q = (s) => root.querySelector(s), body = q('.eb'), tl = q('.tl'), tabs = q('.tabs');
      const st = (a, b, c) => { if (a != null) q('.s1').textContent = a; if (b != null) q('.s2').textContent = b; if (c != null) q('.s3').textContent = c; };
      const api = { S, root, q, body, tl, esc, st, setDirty, refreshTitle, prompt: modal, changed, focus: () => { const m = S.cur; m && m.focus ? m.focus() : root.focus(); } };

      function refreshTitle() { q('h3').textContent = (S.dirty ? '● ' : '') + (o.title || 'file') + (S.ro ? '  (read-only)' : ''); q('.sv').disabled = S.ro || !S.dirty; q('.rv').disabled = !S.dirty; }
      function setDirty(d) { S.dirty = d; refreshTitle(); }
      function changed() { setDirty(true); }
      function modal(html, buttons) {
        return new Promise((res) => {
          const m = document.createElement('div'); m.className = 'em'; m.innerHTML = `<div>${html}<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end"></div></div>`;
          const bt = m.lastChild.lastChild;
          const done = (v) => { m.remove(); root.removeEventListener('keydown', onk, true); res(v); api.focus(); };
          const onk = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { const p = bt.querySelector('.pri'); if (p) { e.preventDefault(); e.stopPropagation(); p.click(); } } e.stopPropagation(); };
          for (const b of buttons) { const k = document.createElement('button'); k.textContent = b.label; if (b.pri) k.className = 'pri'; k.onclick = () => done(typeof b.value === 'function' ? b.value(m) : b.value); bt.append(k); }
          root.addEventListener('keydown', onk, true); root.append(m);
          const f = m.querySelector('input,select') || bt.querySelector('.pri') || bt.firstChild; f && f.focus(); f && f.select && f.select();
        });
      }

      function leave() { if (S.cur && S.cur.leave) S.cur.leave(); }
      function show(name) {
        const def = modes[name]; if (!def) return;
        if (S.cur && S.cur.name === name) return;
        leave();
        body.textContent = ''; tl.textContent = '';
        S.cur = def.build(api); S.cur.name = name; S.mode = name;
        for (const b of tabs.children) b.classList.toggle('on', b.dataset.m === name);
        if (S.cur.enter) S.cur.enter(); refreshTitle(); api.focus();
      }
      api.show = show;
      const order = ['text', 'hex', ...Object.keys(modes).filter((k) => k !== 'text' && k !== 'hex')];
      for (const k of order) { const b = document.createElement('button'); b.textContent = modes[k].label; b.dataset.m = k; b.onclick = () => show(k); tabs.append(b); }

      async function save() {
        if (S.ro) return; leave(); if (S.cur && S.cur.enter) { /* state is already in S.data */ }
        if (S.saving) return; S.saving = true;
        try { await o.onSave(new Uint8Array(S.data)); S.orig = new Uint8Array(S.data); setDirty(false); st(null, 'Saved ' + S.data.length + ' bytes'); } catch (e) { st(null, 'Save failed: ' + (e.message || e)); } finally { S.saving = false; }
        if (S.cur && S.cur.enter) S.cur.enter();
      }
      async function close() {
        leave();
        if (S.dirty) {
          const v = await modal(`<b>Save changes to ${esc(o.title || 'file')}?</b>`, [{ label: 'Cancel', value: null }, { label: 'Discard', value: 'no' }, { label: 'Save', value: 'yes', pri: true }]);
          if (v == null) return; if (v === 'yes') { await save(); if (S.dirty) return; }
        }
        root.remove(); if (o.onClose) o.onClose(); resolve(S.dirty ? null : S.data);
      }
      api.close = close; api.save = save;
      q('.sv').onclick = save; q('.cl').onclick = close;
      q('.rv').onclick = async () => { if (await modal('<b>Discard all changes?</b>', [{ label: 'Cancel', value: false }, { label: 'Revert', value: true, pri: true }])) { S.data = new Uint8Array(S.orig); setDirty(false); const m = S.mode; S.cur = null; leaveReset(m); } };
      function leaveReset(m) { body.textContent = ''; tl.textContent = ''; const def = modes[m]; S.cur = def.build(api); S.cur.name = m; if (S.cur.enter) S.cur.enter(); refreshTitle(); }
      root.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); e.stopPropagation(); save(); }
        else if (e.key === 'Escape' && !root.querySelector('.em')) { e.preventDefault(); e.stopPropagation(); close(); }
        else if (e.altKey && /^[1-9]$/.test(e.key)) { const m = order[+e.key - 1]; if (m) { e.preventDefault(); show(m); } }
      });
      api.order = order; api.onkey = (e) => root.focus();
      if (o.onReady) o.onReady(api);
      const sn = WT().sniff(S.data);
      show(modes[o.mode] ? o.mode : (sn.text || !S.data.length ? 'text' : 'hex'));
    });
  }

  // ====================== TEXT MODE ======================
  modes.text = {
    label: 'Text',
    build(A) {
      const { S, tl, body, esc } = A, WTl = AC.WTools;
      const sn = WTl.sniff(S.data);
      A.textMode = A.textMode || sn.mode;
      tl.innerHTML = `<label>Line ends <select class="enc"><option value="atascii">ATASCII ($9B)</option><option value="lf">PC LF</option><option value="crlf">PC CRLF</option></select></label>
        <label><input type="checkbox" class="wr"> Wrap</label><span class="dim">|</span>
        <input class="fi" placeholder="Find" size="14"><input class="ri" placeholder="Replace" size="12"><label><input type="checkbox" class="cs"> Aa</label>
        <button class="fn">Next</button><button class="fp">Prev</button><button class="rp">Replace</button><button class="ra">Replace all</button><span class="dim">|</span>
        <button class="gl" title="Ctrl+G">Go to line</button><button class="hb7" title="Turn inverse-video text ({$C1}) into normal text">Clear high bit</button><button class="up">UPPERCASE</button><button class="tr">Trim spaces</button>`;
      body.innerHTML = '<textarea class="etx" spellcheck="false"></textarea>';
      const ta = body.firstChild, enc = tl.querySelector('.enc'), fi = tl.querySelector('.fi'), ri = tl.querySelector('.ri'), cs = tl.querySelector('.cs');
      enc.value = A.textMode; ta.readOnly = S.ro;
      let textDirty = false;
      const load = () => { ta.value = WTl.decodeText(S.data, A.textMode); };
      const pos = () => { const v = ta.value, p = ta.selectionStart, ln = v.slice(0, p).split('\n'); A.st('Ln ' + ln.length + ', Col ' + (ln[ln.length - 1].length + 1), `${v.length} chars · ${WTl.encodeText(v, A.textMode).length} bytes`, S.ro ? 'read-only' : A.textMode === 'atascii' ? 'ATASCII: {$XX} = any non-text byte' : 'PC text'); };
      const sync = () => { if (textDirty) { S.data = WTl.encodeText(ta.value, A.textMode); textDirty = false; } };
      const edit = () => { textDirty = true; A.changed(); pos(); };
      ta.addEventListener('input', edit); ['keyup', 'click', 'select'].forEach((ev) => ta.addEventListener(ev, pos));
      enc.onchange = () => { sync(); const old = S.data; A.textMode = enc.value; if (!textDirty) { const v = ta.value; S.data = WTl.encodeText(v, A.textMode); if (!same(old, S.data)) A.changed(); } pos(); };
      tl.querySelector('.wr').onchange = (e) => ta.classList.toggle('wrap', e.target.checked);
      const find = (dir) => {
        const needle = fi.value; if (!needle) return; const v = cs.checked ? ta.value : ta.value.toLowerCase(), n = cs.checked ? needle : needle.toLowerCase();
        let i = dir > 0 ? v.indexOf(n, ta.selectionEnd) : v.lastIndexOf(n, Math.max(0, ta.selectionStart - 1));
        if (i < 0) i = dir > 0 ? v.indexOf(n) : v.lastIndexOf(n);
        if (i < 0) return A.st(null, 'Not found');
        ta.focus(); ta.setSelectionRange(i, i + needle.length); pos();
        const lines = ta.value.slice(0, i).split('\n').length; ta.scrollTop = Math.max(0, (lines - 5) * 19);
      };
      const replaceOne = () => { if (S.ro) return; const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd); if (sel && (cs.checked ? sel === fi.value : sel.toLowerCase() === fi.value.toLowerCase())) { ta.setRangeText(ri.value, ta.selectionStart, ta.selectionEnd, 'end'); edit(); } find(1); };
      tl.querySelector('.fn').onclick = () => find(1); tl.querySelector('.fp').onclick = () => find(-1); tl.querySelector('.rp').onclick = replaceOne;
      tl.querySelector('.ra').onclick = () => {
        if (S.ro || !fi.value) return; const re = new RegExp(fi.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), cs.checked ? 'g' : 'gi'); let n = 0;
        ta.value = ta.value.replace(re, () => { n++; return ri.value; }); if (n) edit(); A.st(null, n + ' replaced');
      };
      const xform = (label, fn) => { if (S.ro) return; const v = ta.value, r = fn(v); if (r !== v) { ta.value = r; edit(); A.st(null, label); } else A.st(null, 'Nothing to change'); };
      tl.querySelector('.hb7').onclick = () => xform('High bits cleared', (v) => v.replace(/\{\$([89A-Fa-f][0-9A-Fa-f])\}/g, (m, h) => { const b = parseInt(h, 16) & 0x7f; return b >= 32 && b < 127 && b !== 123 ? String.fromCharCode(b) : m; }));
      tl.querySelector('.up').onclick = () => xform('Upper-cased', (v) => v.replace(/\{\$[0-9A-Fa-f]{2}\}|[a-z]/g, (m) => (m.length > 1 ? m : m.toUpperCase())));
      tl.querySelector('.tr').onclick = () => xform('Trailing spaces trimmed', (v) => v.replace(/[ \t]+$/gm, ''));
      const gotoLine = async () => {
        const v = await A.prompt('<b>Go to line</b><br><input class="gi" type="number" min="1" style="margin-top:8px;width:120px">', [{ label: 'Cancel', value: null }, { label: 'Go', value: (m) => +m.querySelector('.gi').value, pri: true }]);
        if (!v) return; const lines = ta.value.split('\n'); let o = 0; for (let i = 0; i < Math.min(v, lines.length) - 1; i++) o += lines[i].length + 1;
        ta.focus(); ta.setSelectionRange(o, o); ta.scrollTop = Math.max(0, (v - 6) * 19); pos();
      };
      tl.querySelector('.gl').onclick = gotoLine;
      ta.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && k === 'g') { e.preventDefault(); gotoLine(); }
        else if ((e.ctrlKey || e.metaKey) && k === 'f') { e.preventDefault(); fi.focus(); fi.select(); }
        else if (e.key === 'F3') { e.preventDefault(); find(e.shiftKey ? -1 : 1); }
      });
      fi.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); find(e.shiftKey ? -1 : 1); } });
      load(); pos();
      return { focus: () => ta.focus(), leave: sync };
    },
  };
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // ====================== HEX MODE ======================
  modes.hex = {
    label: 'Hex',
    build(A) {
      const { S, tl, body, esc } = A, WTl = AC.WTools, LH = 18, COLS = 16;
      tl.innerHTML = `<input class="fi" placeholder="Find" size="22"><select class="ft"><option value="hex">hex bytes</option><option value="txt">text</option></select>
        <button class="fn">Next</button><button class="fp">Prev</button><span class="dim">|</span><button class="gt" title="Ctrl+G">Go to…</button>
        <button class="ins" title="Insert a $00 byte at the cursor">Insert</button><button class="del" title="Delete the selected bytes">Delete</button>
        <button class="un">Undo</button><button class="re">Redo</button><span class="dim">|</span><button class="cp">Copy hex</button><span class="dim">Tab: hex ⇄ text · type hex digits to overwrite</span>`;
      body.innerHTML = '<div class="hv" tabindex="0"><div class="hi"></div></div><div class="insp"></div>';
      const hv = body.querySelector('.hv'), hi = hv.firstChild, insp = body.querySelector('.insp');
      const H = { cur: 0, anc: 0, nib: 0, asc: false, undo: [], redo: [], find: null };
      const rows = () => Math.max(1, Math.ceil((S.data.length + 1) / COLS));
      const inView = () => Math.ceil(hv.clientHeight / LH) + 1;
      const snap = () => { H.undo.push({ d: new Uint8Array(S.data), cur: H.cur }); if (H.undo.length > 60) H.undo.shift(); H.redo = []; };
      const lo = () => Math.min(H.cur, H.anc), hi_ = () => Math.max(H.cur, H.anc);
      const edited = () => { A.changed(); };
      function draw() {
        hi.style.height = rows() * LH + 'px';
        const first = Math.floor(hv.scrollTop / LH), n = inView() + 1, d = S.data, a = lo(), b = hi_(), f = H.find;
        const same_ = S.orig.length === d.length; let h = '';
        for (let r = first; r < Math.min(rows(), first + n); r++) {
          const o = r * COLS; let hb = '', ac = '';
          for (let i = 0; i < COLS; i++) {
            const p = o + i, v = d[p];
            if (p > d.length) break;
            const cl = (x) => (p === H.cur ? ' cur' : '') + (p >= a && p <= b && a !== b ? ' on' : '') + (f && p >= f.at && p < f.at + f.len ? ' fd' : '') + (same_ && v !== S.orig[p] && p < d.length ? ' md' : '');
            if (p < d.length) { hb += `<span class="hb${cl()}" data-o="${p}">${hx2(v)}</span> `; ac += `<span class="hc${cl()}" data-o="${p}">${v >= 32 && v < 127 ? esc(String.fromCharCode(v)) : '·'}</span>`; } else { hb += `<span class="hb${cl()}" data-o="${p}">  </span> `; }
          }
          h += `<div class="hr" style="top:${r * LH}px"><span class="ha">${o.toString(16).toUpperCase().padStart(6, '0')}</span>  ${hb} ${ac}</div>`;
        }
        hi.innerHTML = h; hv.classList.toggle('ascf', H.asc); inspect();
      }
      function inspect() {
        const d = S.data, p = H.cur, v = d[p], sel = hi_() - lo() + 1, has = p < d.length;
        const u16 = has && p + 1 < d.length ? d[p] | (d[p + 1] << 8) : null, b16 = has && p + 1 < d.length ? (d[p] << 8) | d[p + 1] : null;
        const row = (k, x) => `<tr><td>${k}</td><td>${x}</td></tr>`;
        const tot = lo() !== hi_() ? d.subarray(lo(), hi_() + 1) : d;
        insp.innerHTML = `<table>${row('Offset', `$${p.toString(16).toUpperCase()} (${p})`)}${row('Of', `$${d.length.toString(16).toUpperCase()} (${d.length})`)}${has ? row('Byte', `$${hx2(v)} = ${v}`) + row('Signed', v > 127 ? v - 256 : v) + row('Binary', v.toString(2).padStart(8, '0')) + row('ATASCII', v >= 32 && v < 127 ? esc(String.fromCharCode(v)) : v === 0x9b ? 'EOL' : '·') + row('Word LE', u16 == null ? '' : `$${u16.toString(16).toUpperCase().padStart(4, '0')} = ${u16}`) + row('Word BE', b16 == null ? '' : `$${b16.toString(16).toUpperCase().padStart(4, '0')} = ${b16}`) : ''}${sel > 1 ? row('Selected', sel + ' bytes') : ''}${row(sel > 1 ? 'CRC32 sel' : 'CRC32', '$' + WTl.crc32(tot).toString(16).toUpperCase().padStart(8, '0'))}${row('Sum16', '$' + WTl.sum16(tot).toString(16).toUpperCase().padStart(4, '0'))}</table>`;
        A.st(`$${p.toString(16).toUpperCase().padStart(6, '0')}`, S.ro ? 'read-only' : H.asc ? 'text pane' : 'hex pane', `${S.data.length} bytes`);
      }
      function reveal() { const r = Math.floor(H.cur / COLS), top = r * LH; if (top < hv.scrollTop) hv.scrollTop = top; else if (top + LH > hv.scrollTop + hv.clientHeight) hv.scrollTop = top + LH - hv.clientHeight; }
      function go(p, ext) { p = Math.max(0, Math.min(S.data.length, p)); H.cur = p; if (!ext) H.anc = p; H.nib = 0; reveal(); draw(); }
      function setByte(p, v) { if (p >= S.data.length) { const n = new Uint8Array(S.data.length + 1); n.set(S.data); S.data = n; } S.data[p] = v; }
      function typeHex(dg) {
        if (S.ro) return; if (H.nib === 0) snap();
        const p = H.cur, old = p < S.data.length ? S.data[p] : 0;
        setByte(p, H.nib === 0 ? (dg << 4) | (old & 15) : (old & 0xf0) | dg);
        edited(); if (H.nib === 0) { H.nib = 1; draw(); } else { H.nib = 0; H.cur = p + 1; H.anc = H.cur; reveal(); draw(); }
      }
      function typeChar(c) { if (S.ro) return; snap(); setByte(H.cur, c.charCodeAt(0) & 255); edited(); H.cur++; H.anc = H.cur; reveal(); draw(); }
      function insertBytes(p, bytes) { snap(); const n = new Uint8Array(S.data.length + bytes.length); n.set(S.data.subarray(0, p)); n.set(bytes, p); n.set(S.data.subarray(p), p + bytes.length); S.data = n; edited(); H.cur = p + bytes.length; H.anc = H.cur; reveal(); draw(); }
      function delRange(a, b) { if (S.ro || a >= S.data.length) return; snap(); b = Math.min(b, S.data.length - 1); const n = new Uint8Array(S.data.length - (b - a + 1)); n.set(S.data.subarray(0, a)); n.set(S.data.subarray(b + 1), a); S.data = n; edited(); H.cur = Math.min(a, n.length); H.anc = H.cur; reveal(); draw(); }
      function undo() { const u = H.undo.pop(); if (!u) return; H.redo.push({ d: new Uint8Array(S.data), cur: H.cur }); S.data = u.d; H.cur = H.anc = Math.min(u.cur, S.data.length); A.changed(); reveal(); draw(); }
      function redo() { const u = H.redo.pop(); if (!u) return; H.undo.push({ d: new Uint8Array(S.data), cur: H.cur }); S.data = u.d; H.cur = H.anc = Math.min(u.cur, S.data.length); A.changed(); reveal(); draw(); }
      function doFind(dir) {
        const t = tl.querySelector('.ft').value, s = tl.querySelector('.fi').value; if (!s) return;
        const needle = t === 'hex' ? WTl.parseHex(s) : WTl.encodeText(s, 'atascii');
        if (!needle || !needle.length) return A.st(null, 'Enter hex bytes like A9 00 8D');
        let at = WTl.findBytes(S.data, needle, dir > 0 ? H.cur + 1 : H.cur - 1, dir);
        if (at < 0) at = WTl.findBytes(S.data, needle, dir > 0 ? 0 : S.data.length, dir);
        if (at < 0) { H.find = null; draw(); return A.st(null, 'Not found'); }
        H.find = { at, len: needle.length }; H.cur = at; H.anc = at; reveal(); draw(); A.st(null, 'Found at $' + at.toString(16).toUpperCase());
      }
      const hexText = () => [...S.data.subarray(lo(), hi_() + 1)].map(hx2).join(' ');
      function copy() { const t = hexText(); if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).catch(() => {}); else { const x = document.createElement('textarea'); x.value = t; document.body.append(x); x.select(); try { document.execCommand('copy'); } catch (e) { /* ignore */ } x.remove(); } A.st(null, 'Copied ' + (hi_() - lo() + 1) + ' bytes'); hv.focus(); }
      async function gotoDlg() {
        const v = await A.prompt('<b>Go to offset</b><div class="dim">hex, e.g. 1F0 or $1F0; prefix # for decimal</div><input class="gi" style="margin-top:8px;width:160px">', [{ label: 'Cancel', value: null }, { label: 'Go', value: (m) => m.querySelector('.gi').value.trim(), pri: true }]);
        if (!v) return; const n = v[0] === '#' ? parseInt(v.slice(1), 10) : parseInt(v.replace(/^\$|^0x/i, ''), 16); if (isNaN(n)) return A.st(null, 'Not a number'); go(n);
      }
      hv.addEventListener('scroll', draw);
      hv.addEventListener('mousedown', (e) => { const t = e.target.closest('[data-o]'); if (!t) return; H.asc = t.classList.contains('hc'); const p = +t.dataset.o; H.cur = p; if (!e.shiftKey) H.anc = p; H.nib = 0; H.drag = true; draw(); hv.focus(); e.preventDefault(); });
      hv.addEventListener('mouseover', (e) => { if (!H.drag) return; const t = e.target.closest('[data-o]'); if (t && +t.dataset.o !== H.cur) { H.cur = +t.dataset.o; draw(); } });
      window.addEventListener('mouseup', () => { H.drag = false; });
      hv.addEventListener('paste', (e) => {
        if (S.ro) return; e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text'); if (!t) return;
        const b = WTl.parseHex(t) || WTl.encodeText(t, 'atascii'); if (b.length) { snap(); const a = lo(), z = hi_(); let d = S.data; if (a !== z) { const n = new Uint8Array(d.length - (z - a + 1)); n.set(d.subarray(0, a)); n.set(d.subarray(z + 1), a); S.data = n; H.cur = H.anc = a; } insertBytes(a, b); }
      });
      hv.addEventListener('keydown', (e) => {
        const k = e.key, ctl = e.ctrlKey || e.metaKey, lk = k.toLowerCase(), ext = e.shiftKey, vis = Math.max(1, inView() - 2);
        let used = true;
        if (k === 'ArrowRight') go(H.cur + 1, ext); else if (k === 'ArrowLeft') go(H.cur - 1, ext);
        else if (k === 'ArrowDown') go(H.cur + COLS, ext); else if (k === 'ArrowUp') go(H.cur - COLS, ext);
        else if (k === 'PageDown') go(H.cur + vis * COLS, ext); else if (k === 'PageUp') go(H.cur - vis * COLS, ext);
        else if (k === 'Home') go(ctl ? 0 : H.cur - (H.cur % COLS), ext); else if (k === 'End') go(ctl ? S.data.length : H.cur - (H.cur % COLS) + COLS - 1, ext);
        else if (k === 'Tab') { H.asc = !H.asc; H.nib = 0; draw(); }
        else if (ctl && lk === 'z') { e.shiftKey ? redo() : undo(); } else if (ctl && lk === 'y') redo();
        else if (ctl && lk === 'g') gotoDlg(); else if (ctl && lk === 'f') { tl.querySelector('.fi').focus(); }
        else if (ctl && lk === 'c') copy(); else if (ctl && lk === 'a') { H.anc = 0; H.cur = Math.max(0, S.data.length - 1); draw(); }
        else if (k === 'F3') doFind(e.shiftKey ? -1 : 1);
        else if (k === 'Delete') delRange(lo(), hi_()); else if (k === 'Backspace') { if (lo() !== hi_()) delRange(lo(), hi_()); else if (H.cur > 0) delRange(H.cur - 1, H.cur - 1); }
        else if (k === 'Insert') { if (!S.ro) insertBytes(H.cur, new Uint8Array(1)); }
        else if (!ctl && !e.altKey && k.length === 1) { if (H.asc) typeChar(k); else if (/[0-9a-f]/i.test(k)) typeHex(parseInt(k, 16)); else used = false; }
        else used = false;
        if (used) { e.preventDefault(); e.stopPropagation(); }
      });
      tl.querySelector('.fn').onclick = () => doFind(1); tl.querySelector('.fp').onclick = () => doFind(-1);
      tl.querySelector('.fi').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); doFind(e.shiftKey ? -1 : 1); } });
      tl.querySelector('.gt').onclick = gotoDlg; tl.querySelector('.ins').onclick = () => { if (!S.ro) insertBytes(H.cur, new Uint8Array(1)); hv.focus(); };
      tl.querySelector('.del').onclick = () => { delRange(lo(), hi_()); hv.focus(); }; tl.querySelector('.un').onclick = () => { undo(); hv.focus(); }; tl.querySelector('.re').onclick = () => { redo(); hv.focus(); };
      tl.querySelector('.cp').onclick = copy;
      if (S.ro) for (const c of ['ins', 'del', 'un', 're']) tl.querySelector('.' + c).disabled = true;
      if (A.hexAt != null) { H.cur = H.anc = A.hexAt; A.hexAt = null; }
      return { focus: () => hv.focus(), enter: () => { setTimeout(() => { draw(); reveal(); draw(); }, 0); } };
    },
  };

  window.AC = window.AC || {};
  AC.WEdit = { open, modes };
})();
