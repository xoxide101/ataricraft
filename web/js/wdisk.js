// WDisk - raw sector editor for Atari disk images (ATR/XFD). Works on any image, whatever the file system.
// AC.WDisk.open({ parent, title, bytes, entries, kind, onSave(bytes), onReady(api), onClose() })
(function () {
  const hx = (b, n = 2) => b.toString(16).toUpperCase().padStart(n, '0');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CSS = `
  .wdk{position:absolute;inset:0;background:#14161a;z-index:6;display:flex;flex-direction:column;outline:none;color:#d8dce4;font:13px system-ui,sans-serif}
  .wdk button,.wdk select,.wdk input{background:#2a2f39;color:#d8dce4;border:1px solid #2c313b;border-radius:5px;padding:3px 8px;font:inherit}
  .wdk button{cursor:pointer}.wdk button:hover{background:#343a47}.wdk button:disabled{opacity:.35;cursor:not-allowed}
  .wdk .eh,.wdk .tl{display:flex;gap:6px;align-items:center;padding:8px;background:#1e2128;border-bottom:1px solid #2c313b;flex-wrap:wrap}
  .wdk .tl{background:#191c22;font-size:12px;padding:6px 8px}
  .wdk h3{margin:0 8px 0 0;font-size:14px;color:#e8a33d;max-width:40ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .wdk .sp{flex:1}.wdk .dim{color:#9aa1ad}.wdk .bad{color:#ff7b72}.wdk .ok{color:#6fcf8a}.wdk .warn{color:#e8a33d}
  .wdk .main{flex:1;min-height:0;display:flex}
  .wdk .hv{flex:1;overflow:auto;background:#101216;font:13px Consolas,monospace;padding:6px 0;outline:none}
  .wdk .hr{height:18px;line-height:18px;white-space:pre;padding-left:8px}
  .wdk .ha{color:#6d7480}.wdk .hb,.wdk .hc{cursor:text}
  .wdk .md{color:#ff9d57}.wdk .iv{color:#7fb6ff}.wdk .fd{background:#6a3d8f}
  .wdk .cur{background:#e8a33d;color:#14161a}.wdk .ofp .cur{background:#5a5f6a;color:#d8dce4}
  .wdk .insp{width:260px;border-left:1px solid #2c313b;background:#191c22;padding:10px;font-size:12px;overflow:auto}
  .wdk .insp table{width:100%;border-collapse:collapse}.wdk .insp td{padding:2px 0;vertical-align:top}.wdk .insp td:first-child{color:#9aa1ad;width:78px}
  .wdk .es{padding:4px 10px;background:#1e2128;border-top:1px solid #2c313b;font-size:12px;color:#9aa1ad;display:flex;gap:16px}
  .wdk .em{position:absolute;inset:0;background:#000a;display:flex;align-items:center;justify-content:center;z-index:3}
  .wdk .em>div{background:#1e2128;border:1px solid #3a404c;border-radius:8px;padding:14px;min-width:300px}
  `;
  function css() { if (document.getElementById('wdkcss')) return; const s = document.createElement('style'); s.id = 'wdkcss'; s.textContent = CSS; document.head.append(s); }

  // Follow DOS 2 / MyDOS sector links for each file so a sector can name its owner.
  function ownerMap(lay, entries) {
    const own = new Map();
    for (const e of entries || []) {
      if (!e.start) continue;
      let s = e.start, i = 0;
      while (s >= 1 && s <= lay.nsec && !own.has(s) && i < 65536) {
        own.set(s, { path: e.path, i }); i++;
        const d = lay.sec(s), l = d.length;
        s = ((d[l - 3] & 3) << 8) | d[l - 2];
      }
    }
    return own;
  }

  function open(o) {
    css();
    const work = o.bytes.slice(), origLay = AC.DosFs.layout(o.bytes), lay = AC.DosFs.layout(work);
    const ss = lay.ss, nsec = lay.nsec, rows = Math.ceil(ss / 16);
    const dos2 = o.kind === 'dos2' || o.kind === 'mydos';
    const owners = dos2 ? ownerMap(lay, o.entries) : new Map();
    const mod = new Set();
    const S = { n: 1, off: 0, asc: false, nib: 0, found: null };
    const root = document.createElement('div'); root.className = 'wdk'; root.tabIndex = -1;
    root.innerHTML = `<div class="eh"><h3></h3><span class="sp"></span><button class="sv">Save</button><button class="rv" title="Undo all edits in this sector">Revert sector</button><button class="cl">Close</button></div>
      <div class="tl"><button class="pv" title="PageUp">◀</button><label>Sector <input class="sn" type="number" min="1" max="${nsec}" style="width:80px"></label><button class="nx" title="PageDown">▶</button>
        <span class="dim">of ${nsec} · ${ss} bytes</span>
        <button class="j1" title="Boot sector">Boot</button><button class="j360" title="VTOC (sector 360)">VTOC</button><button class="j361" title="Directory (sector 361)">Dir</button>
        <span class="sp"></span><select class="fm"><option value="hex">Find hex</option><option value="txt">Find text</option></select><input class="fi" placeholder="A9 00  /  text" style="width:150px"><button class="fn">Find next</button>
        <input class="fv" value="00" maxlength="2" style="width:34px" title="Fill byte (hex)"><button class="ff">Fill sector</button><button class="ex">Export sector</button></div>
      <div class="main"><div class="hv" tabindex="0"></div><div class="insp"></div></div>
      <div class="es"><span class="s1"></span><span class="sp"></span><span class="s3">Click a byte, type hex digits (or characters in the right pane). PageUp/PageDown change sector.</span></div>`;
    (o.parent || document.body).append(root);
    const q = (s) => root.querySelector(s), hv = q('.hv'), insp = q('.insp');
    const secOf = (n) => lay.sec(n), origOf = (n) => origLay.sec(n);
    const changedN = (n) => { const a = secOf(n), b = origOf(n); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true; return false; };
    const title = () => { q('h3').textContent = (mod.size ? '● ' : '') + (o.title || 'Disk') + ' — sector editor'; q('.sv').disabled = !mod.size; q('.rv').disabled = !mod.has(S.n); };

    function info() {
      const d = secOf(S.n), l = d.length, rowsI = [];
      const own = owners.get(S.n);
      let kind = 'data';
      if (S.n <= 3) kind = 'boot'; else if (S.n === 360) kind = dos2 ? 'VTOC / bitmap' : 'volume bitmap?'; else if (S.n >= 361 && S.n <= 368 && dos2) kind = 'directory';
      rowsI.push(['Sector', `${S.n} ($${hx(S.n, 4)})`], ['Role', kind]);
      if (own) rowsI.push(['Owner', esc(own.path)], ['Block', '#' + (own.i + 1)]);
      if (dos2 && own) {
        const nx = ((d[l - 3] & 3) << 8) | d[l - 2];
        rowsI.push(['File no.', d[l - 3] >> 2], ['Next', nx || 'end'], ['Bytes', d[l - 1] & 0x7f]);
      }
      const sel = d[S.off];
      rowsI.push(['Byte', `$${hx(S.off, 3)} = $${hx(sel)} (${sel})`]);
      if (S.off + 1 < l) rowsI.push(['Word', `$${hx(d[S.off] | (d[S.off + 1] << 8), 4)} (${d[S.off] | (d[S.off + 1] << 8)})`]);
      rowsI.push(['Changed', mod.has(S.n) ? '<b class="warn">yes</b>' : 'no'], ['Pending', mod.size + ' sector(s)']);
      insp.innerHTML = '<table>' + rowsI.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('') + '</table>' + (dos2 ? '' : '<div class="dim" style="margin-top:10px">File ownership is shown for DOS 2 / MyDOS disks.</div>');
    }
    function paint() {
      const d = secOf(S.n), od = origOf(S.n), out = [];
      for (let r = 0; r < rows; r++) {
        let h = '', a = '';
        for (let c = 0; c < 16; c++) {
          const i = r * 16 + c; if (i >= d.length) { h += '   '; continue; }
          const cl = (i === S.off ? ' cur' : '') + (d[i] !== od[i] ? ' md' : '') + (S.found === i ? ' fd' : '');
          h += `<span class="hb${cl}" data-i="${i}">${hx(d[i])}</span> `;
          const b = d[i] & 127, ch = b >= 32 && b < 127 ? esc(String.fromCharCode(b)) : '·';
          a += `<span class="hc${cl}${d[i] >= 128 ? ' iv' : ''}" data-i="${i}">${ch}</span>`;
        }
        out.push(`<div class="hr"><span class="ha">${hx(r * 16, 3)}</span>  ${h} ${a}</div>`);
      }
      hv.innerHTML = out.join(''); hv.classList.toggle('ofp', S.asc);
      q('.sn').value = S.n; q('.s1').textContent = `Sector ${S.n}/${nsec}  offset $${hx(S.off, 3)}`; title(); info();
    }
    function go(n) { n = Math.max(1, Math.min(nsec, n | 0)); S.n = n; S.off = 0; S.nib = 0; S.found = null; paint(); }
    function setByte(v) {
      const d = secOf(S.n); d[S.off] = v;
      if (changedN(S.n)) mod.add(S.n); else mod.delete(S.n);
    }
    function move(i) { S.off = Math.max(0, Math.min(ss - 1, i)); S.nib = 0; S.found = null; paint(); }

    hv.addEventListener('mousedown', (e) => {
      const t = e.target.closest('[data-i]'); if (!t) return;
      S.asc = t.classList.contains('hc'); S.off = +t.dataset.i; S.nib = 0; S.found = null; paint(); hv.focus(); e.preventDefault();
    });
    root.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') { if (e.key === 'Enter' && e.target.classList.contains('sn')) go(+e.target.value); else if (e.key === 'Enter' && e.target.classList.contains('fi')) find(); else if (e.key === 'Escape') e.target.blur(); e.stopPropagation(); return; }
      const k = e.key;
      if (k === 'Escape') { e.preventDefault(); close(); return; }
      if (k === 'PageDown') { e.preventDefault(); go(S.n + 1); return; }
      if (k === 'PageUp') { e.preventDefault(); go(S.n - 1); return; }
      if (k === 'ArrowRight') { e.preventDefault(); move(S.off + 1); return; }
      if (k === 'ArrowLeft') { e.preventDefault(); move(S.off - 1); return; }
      if (k === 'ArrowDown') { e.preventDefault(); move(S.off + 16); return; }
      if (k === 'ArrowUp') { e.preventDefault(); move(S.off - 16); return; }
      if (k === 'Home') { e.preventDefault(); move(S.off & ~15); return; }
      if (k === 'End') { e.preventDefault(); move((S.off & ~15) + 15); return; }
      if (k === 'Tab') { e.preventDefault(); S.asc = !S.asc; S.nib = 0; paint(); return; }
      if (k === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || k.length !== 1) return;
      e.preventDefault();
      if (S.asc) { setByte(k.charCodeAt(0) & 255); S.off = Math.min(ss - 1, S.off + 1); S.nib = 0; paint(); return; }
      if (!/[0-9a-f]/i.test(k)) return;
      const v = parseInt(k, 16), cur = secOf(S.n)[S.off];
      if (S.nib === 0) { setByte((v << 4) | (cur & 15)); S.nib = 1; paint(); }
      else { setByte((cur & 0xf0) | v); S.nib = 0; S.off = Math.min(ss - 1, S.off + 1); paint(); }
    });

    function parsePat() {
      const t = q('.fi').value;
      if (q('.fm').value === 'txt') return t ? [...t].map((c) => c.charCodeAt(0) & 255) : null;
      const h = t.replace(/[\s,$]|0x/gi, ''); if (!h || h.length % 2 || /[^0-9a-f]/i.test(h)) return null;
      return h.match(/../g).map((x) => parseInt(x, 16));
    }
    function find() {
      const pat = parsePat(); if (!pat) { q('.s3').textContent = 'Enter hex bytes like A9 00, or switch to text.'; return; }
      const at = (d, i) => { for (let k = 0; k < pat.length; k++) if (d[i + k] !== pat[k]) return false; return true; };
      for (let step = 0; step <= nsec; step++) {
        const n = ((S.n - 1 + step) % nsec) + 1, d = secOf(n), from = step === 0 ? S.off + 1 : 0;
        for (let i = from; i + pat.length <= d.length; i++) if (at(d, i)) { S.n = n; S.off = i; S.nib = 0; S.found = i; paint(); q('.s3').textContent = `Found at sector ${n}, offset $${hx(i, 3)}.`; return; }
      }
      q('.s3').textContent = 'Not found.';
    }
    function fill() {
      const v = parseInt(q('.fv').value, 16); if (isNaN(v) || v < 0 || v > 255) { q('.s3').textContent = 'Fill byte must be hex 00-FF.'; return; }
      secOf(S.n).fill(v); if (changedN(S.n)) mod.add(S.n); else mod.delete(S.n); paint();
    }
    function revert() { secOf(S.n).set(origOf(S.n)); mod.delete(S.n); paint(); }
    function exportSec() {
      const b = new Blob([secOf(S.n)], { type: 'application/octet-stream' }), a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = `sector${S.n}.bin`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    async function save() {
      if (!mod.size) return;
      try { await o.onSave(work, [...mod]); } catch (e) { q('.s3').textContent = 'Save failed: ' + e.message; return; }
      mod.clear(); paint(); q('.s3').textContent = 'Saved.';
    }
    function ask(html, buttons) {
      return new Promise((res) => {
        const m = document.createElement('div'); m.className = 'em'; m.innerHTML = `<div>${html}<div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end"></div></div>`;
        for (const b of buttons) { const k = document.createElement('button'); k.textContent = b.label; k.onclick = () => { m.remove(); res(b.value); }; m.lastChild.lastChild.append(k); }
        root.append(m);
      });
    }
    async function close() {
      if (mod.size) {
        const v = await ask(`<b>Save changes to ${mod.size} sector(s)?</b>`, [{ label: 'Cancel', value: null }, { label: 'Discard', value: 'no' }, { label: 'Save', value: 'yes' }]);
        if (v === null) return; if (v === 'yes') { await save(); if (mod.size) return; }
      }
      root.remove(); o.onClose && o.onClose();
    }
    q('.pv').onclick = () => go(S.n - 1); q('.nx').onclick = () => go(S.n + 1);
    q('.j1').onclick = () => go(1); q('.j360').onclick = () => go(360); q('.j361').onclick = () => go(361);
    q('.fn').onclick = find; q('.ff').onclick = fill; q('.ex').onclick = exportSec;
    q('.sv').onclick = save; q('.rv').onclick = revert; q('.cl').onclick = close;
    const api = { root, go, close, save, work, mod, S, focus: () => hv.focus() };
    go(o.sector || 1); hv.focus(); o.onReady && o.onReady(api);
    return api;
  }
  AC.WDisk = { open };
})();
