// Controller diagnostics + profile editor page. All profile text goes through textContent/value only.
(function () {
  const AC = window.AC, Core = AC.CtrlCore, Exp = AC.CtrlExport, $ = (id) => document.getElementById(id);
  const store = Core.createStore(), inp = AC.CtrlInput.create({ win: window, nav: navigator, doc: document, mouseTarget: window });
  let cur = Core.fromPreset('atari-joystick'), recording = null;
  const el = (tag, props, ...kids) => { const e = document.createElement(tag); Object.assign(e, props || {}); kids.forEach((k) => e.append(k)); return e; };
  const srcStr = (a) => (a || []).join(', ');
  const parseSrc = (t) => t.split(/[\s,]+/).filter((x) => Core.SRC_RE.test(x));

  // ---- recording ----
  function record(btn, want, done) {
    if (recording) { inp.cancelLearn(); }
    const old = btn.textContent; btn.textContent = 'press / move...'; btn.classList.add('rec'); recording = btn;
    inp.learn(want).then((r) => { btn.textContent = old; btn.classList.remove('rec'); recording = null; if (r) done(r.id); });
  }

  // ---- devices & live view ----
  function renderDevices() {
    const pads = inp.pads;
    const box = $('pads'); box.textContent = '';
    if (!pads.length) box.textContent = 'None. Press a button on the controller to wake it.';
    pads.forEach((g) => {
      const info = AC.CtrlCore.parsePadId(g.id);
      box.append(el('div', { textContent: `#${g.index} ${info.name} ${info.vendorId === null ? '' : 'VID ' + info.vendorId.toString(16).padStart(4, '0') + ' PID ' + info.productId.toString(16).padStart(4, '0')} | mapping: ${g.mapping || 'raw (non-standard)'} | ${g.buttons.length} buttons, ${g.axes.length} axes` }));
    });
    const h = $('hids'); h.textContent = '';
    const list = inp.hidDevices();
    if (!list.length) h.textContent = 'None connected.';
    list.forEach((d) => h.append(el('div', { textContent: `${d.name} VID ${d.vendorId.toString(16).padStart(4, '0')} PID ${d.productId.toString(16).padStart(4, '0')} ${d.opened ? '(open)' : ''} ${d.error} | ` + d.collections.map((c) => `usagePage 0x${c.usagePage.toString(16)} usage 0x${c.usage.toString(16)} reports [${c.inputReports}]`).join('; ') })));
  }
  let lastHid = '';
  function frame() {
    const pads = inp.poll();
    const sig = pads.map((g) => g.id + g.buttons.length + g.axes.length).join('|') + inp.hidDevices().length;
    if (sig !== lastHid) { lastHid = sig; renderDevices(); }
    const lb = $('lbtn'), la = $('laxes');
    const nb = pads.reduce((n, g) => n + g.buttons.length, 0);
    if (lb.children.length !== nb) { lb.textContent = ''; pads.forEach((g) => g.buttons.forEach((_, i) => lb.append(el('div', { className: 'btn1', textContent: `#${g.index} b${i}` })))); }
    let k = 0; pads.forEach((g) => g.buttons.forEach((v) => { lb.children[k++].classList.toggle('on', v >= 0.5); }));
    const na = pads.reduce((n, g) => n + g.axes.length, 0);
    if (la.children.length !== na) { la.textContent = ''; pads.forEach((g) => g.axes.forEach((_, i) => la.append(el('div', {}, el('span', { className: 'mut' }), el('div', { className: 'bar' }, el('i')))))); }
    k = 0; pads.forEach((g) => g.axes.forEach((v, i) => {
      const row = la.children[k++]; row.firstChild.textContent = `#${g.index} a${i} ${v.toFixed(2)}: ${inp.verdict('gp:a' + i + '@' + g.index)}`;
      const bar = row.lastChild.firstChild; bar.style.left = (50 + Math.min(0, v) * 50) + '%'; bar.style.width = Math.abs(v) * 50 + '%';
    }));
    const m = inp.mouse;
    $('lmouse').textContent = m.seen ? `dx ${m.dx} dy ${m.dy} | total ${m.tx},${m.ty} | wheel ${m.wheel.toFixed(1)} | buttons ${[...inp.mbtn].join(',') || '-'} | ${inp.verdict('ms:dx')}` : 'No mouse events yet (click the capture area and move).';
    $('lkey').textContent = inp.kb.seen ? `last ${inp.kb.last} | held ${[...inp.keys].join(' ') || '-'}` : 'No key events yet.';
    const hl = $('lhid'); hl.textContent = '';
    inp.hidReports().forEach((r) => {
      const line = el('div', { className: 'mut', textContent: `${r.dev} id ${r.reportId} n=${r.count}: ` });
      r.bytes.forEach((b, i) => line.append(el('span', { className: r.prev && r.prev[i] !== b ? 'chg' : '', textContent: b.toString(16).padStart(2, '0') + ' ' })));
      hl.append(line);
    });
    inp.endTick();
    requestAnimationFrame(frame);
  }
  const logBox = $('log');
  inp.onEvent = (e) => { logBox.prepend(el('div', { textContent: `${(e.t / 1000).toFixed(2)} [${e.type}] ${e.text}` })); while (logBox.children.length > 120) logBox.lastChild.remove(); };
  $('hidSupport').textContent = navigator.hid ? '' : 'WebHID not available here (use Chrome/Edge on https or localhost).';
  $('hidBtn').onclick = () => inp.requestHid([]).then(() => { lastHid = ''; }, (e) => { if (e && e.name !== 'NotFoundError') alert(e.message); });
  const cap = $('capture');
  cap.onclick = () => { cap.focus(); inp.lockPointer(cap); };

  // ---- physical controls ----
  function renderPhys() {
    const t = $('phys'); t.textContent = '';
    Core.PHYS.forEach(([key, label, kind]) => {
      const tr = el('tr'), td = el('td', { textContent: label }), cell = el('td', { textContent: srcStr(cur.device.controls[key]) || '-' });
      const rec = el('button', { textContent: 'Record' }), clr = el('button', { textContent: 'Clear' });
      rec.onclick = () => record(rec, kind, (id) => { cur.device.controls[key] = [id]; fillDevice(id); renderAll(); });
      clr.onclick = () => { delete cur.device.controls[key]; renderAll(); };
      tr.append(td, cell, el('td', {}, rec, ' ', clr)); t.append(tr);
    });
  }
  function fillDevice(id) {
    const pad = inp.pads[0];
    if (/^gp:/.test(id) && pad) { const i = Core.parsePadId(pad.id); cur.device.name = cur.device.name || i.name; if (i.vendorId !== null) { cur.device.vendorId = i.vendorId; cur.device.productId = i.productId; } cur.device.mapping = pad.mapping === 'standard' ? 'standard' : ''; }
    const m = /^hid:/.test(id) && inp.hidDevices()[0];
    if (m) { cur.device.name = cur.device.name || m.name; cur.device.vendorId = m.vendorId; cur.device.productId = m.productId; }
  }
  $('applyMap').onclick = () => { cur = Core.applyDeviceMap(cur); renderAll(); };

  // ---- profile editor ----
  const num = (label, obj, key, min, max, step) => { const i = el('input', { type: 'number', value: obj[key], min, max, step, onchange: () => { obj[key] = +i.value; changed(); } }); return el('div', { className: 'row' }, el('label', { textContent: label }), i); };
  const chk = (label, obj, key) => { const i = el('input', { type: 'checkbox', checked: !!obj[key], onchange: () => { obj[key] = i.checked; changed(); } }); return el('div', { className: 'row' }, el('label', { textContent: label }), i); };
  const sel = (label, obj, key, opts) => { const s = el('select', { onchange: () => { obj[key] = isNaN(+s.value) ? s.value : +s.value; changed(); } }); opts.forEach((o) => s.append(el('option', { value: o, textContent: String(o), selected: obj[key] === o }))); return el('div', { className: 'row' }, el('label', { textContent: label }), s); };
  const src = (label, obj, key, kind) => {
    const i = el('input', { className: 'src', value: srcStr(obj[key]), placeholder: 'e.g. gp:b0, kb:Space, ms:dx', onchange: () => { obj[key] = parseSrc(i.value); changed(); } });
    const r = el('button', { textContent: 'Record', title: 'Replace with the next control you press or move' }), add = el('button', { textContent: '+ Record', title: 'Add another source' });
    r.onclick = () => record(r, kind, (id) => { obj[key] = [id]; renderEditor(); changed(); });
    add.onclick = () => record(add, kind, (id) => { obj[key] = [...new Set([...(obj[key] || []), id])]; renderEditor(); changed(); });
    return el('div', { className: 'row' }, el('label', { textContent: label }), i, r, add);
  };
  const group = (title, enabledObj, ...rows) => { const d = el('div', {}, el('h3', { textContent: title })); if (enabledObj) d.append(chk('Enabled', enabledObj, 'enabled')); rows.forEach((r) => d.append(r)); return d; };
  function renderEditor() {
    const e = $('editor'); e.textContent = '';
    const nm = el('input', { value: cur.name, onchange: () => { cur.name = nm.value; } });
    e.append(el('div', { className: 'row' }, el('label', { textContent: 'Name' }), nm), chk('Capture keys (block the emulator keyboard for bound keys)', cur, 'captureKeys'));
    const J = cur.joystick, D = cur.paddle, S = cur.spinner, T = cur.trackball, K = cur.keypad, C = cur.console;
    e.append(group('Joystick (digital d-pad + fire; no analog stick)', J, sel('Port', J, 'port', [1, 2]), src('Up', J, 'up', 'digital'), src('Down', J, 'down', 'digital'), src('Left', J, 'left', 'digital'), src('Right', J, 'right', 'digital'), src('Fire', J, 'fire', 'digital'), src('Fire 2', J, 'fire2', 'digital')));
    e.append(group('Paddle (absolute axis, or relative encoder accumulated into a clamped POT)', D, sel('Port', D, 'port', [1, 2]), sel('Mode', D, 'mode', ['axis', 'encoder']), src('Source', D, 'source', 'analog'), src('Left / right keys', D, 'left', 'digital'), src('', D, 'right', 'digital'), src('Button', D, 'button', 'digital'),
      num('Sensitivity', D, 'sensitivity', 0.05, 20, 0.05), num('Step per count (encoder)', D, 'step', 0.0001, 0.1, 0.001), num('Dead zone (axis)', D, 'deadzone', 0, 0.9, 0.01), chk('Invert', D, 'invert'), num('Auto-recentre after idle ms (0 = off)', D, 'recentreMs', 0, 60000, 100)));
    e.append(group('Driving controller / spinner (free-spinning, relative; 16-step Gray code on the stick up/down lines)', S, sel('Port', S, 'port', [1, 2]), src('Source', S, 'source', 'analog'), src('Fire / thumb buttons', S, 'fire', 'digital'), num('Sensitivity', S, 'sensitivity', 0.05, 20, 0.05), chk('Invert', S, 'invert')));
    e.append(group('Trackball (mouse delta to quadrature)', T, sel('Port', T, 'port', [1, 2]), sel('Protocol', T, 'protocol', ['trak', 'st', 'amiga']), src('X', T, 'x', 'analog'), src('Y', T, 'y', 'analog'), src('Fire', T, 'fire', 'digital'),
      num('Sensitivity', T, 'sensitivity', 0.05, 20, 0.05), chk('Invert X', T, 'invertX'), chk('Invert Y', T, 'invertY'), chk('Swap X/Y', T, 'swapXY'), chk('Lock pointer on emulator click', T, 'lockPointer')));
    const kr = [sel('Target', K, 'target', ['auto', '5200', 'computer'])]; Core.KEYPAD_KEYS.forEach((k) => kr.push(src('Key ' + k, K.keys, k, 'digital')));
    e.append(group('Keypad 0-9 * # (5200 / Jaguar-style)', K, ...kr));
    e.append(group('Console switches', C, ...['start', 'select', 'option', 'reset', 'pause', 'credit'].map((k) => src(k === 'credit' ? 'Coin / credit' : k[0].toUpperCase() + k.slice(1), C, k, 'digital'))));
    const ar = []; cur.aux.forEach((a, i) => { ar.push(src(`Aux ${i + 1}`, a, 'source', 'digital'), sel('Action', a, 'action', Core.AUX_ACTIONS)); });
    e.append(group('Thumb / aux buttons (X/Y/L1/L2/R1/R2...) mapped to emulator functions', null, ...ar));
  }
  function changed() { renderWarns(); renderRt(); renderPhys(); }
  function renderWarns() { const w = $('warns'); w.textContent = ''; Core.validate(cur).forEach((m) => w.append(el('div', { className: 'warn', textContent: m }))); }

  // ---- list / actions ----
  function renderList() {
    const l = $('plist'); l.textContent = ''; l.append(el('option', { value: '', textContent: '(unsaved)' }));
    store.list().forEach((p) => l.append(el('option', { value: p.id, textContent: p.name, selected: p.id === cur.id })));
    $('active').textContent = 'Active in emulator: ' + (store.getActive() ? store.getActive().name : 'none');
  }
  $('plist').onchange = () => { const p = store.get($('plist').value); if (p) { cur = p; renderAll(); } };
  const pp = $('ppre'); Object.entries(Core.PRESETS).forEach(([k, v]) => pp.append(el('option', { value: k, textContent: v.label })));
  $('pNew').onclick = () => { cur = Core.fromPreset(pp.value); renderAll(); };
  $('pSave').onclick = () => { cur = store.save(cur); renderAll(); };
  $('pDel').onclick = () => { if (cur.id) { store.remove(cur.id); cur = Core.fromPreset('atari-joystick'); renderAll(); } };
  $('pUse').onclick = () => { cur = store.save(cur); store.setActive(cur.id); renderAll(); };
  const download = (name, text, mime) => { const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' })), download: name }); document.body.append(a); a.click(); a.remove(); };
  $('pExp').onclick = () => download(Exp.slug(cur.name) + '.json', store.exportJSON(cur), 'application/json');
  $('pExpAll').onclick = () => download('ataricraft-controllers.json', store.exportAll(), 'application/json');
  $('pImp').onchange = (ev) => { const f = ev.target.files[0]; if (!f) return; f.text().then((t) => { try { const r = store.importJSON(t); cur = r[0]; renderAll(); } catch (e) { alert('Import failed: ' + e.message); } }); ev.target.value = ''; };

  function renderRt() {
    const rt = Core.createRuntime(cur), ids = {};
    const out = rt.update(inp.sampler, { model: $('pm').value, dtMs: 16 });
    $('rt').textContent = JSON.stringify(out, null, 1);
  }
  setInterval(() => { if (!recording) renderRt(); }, 100);

  // ---- exports ----
  document.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => {
    const x = b.dataset.x, r = x === 'mame' ? Exp.mame(cur) : x === 'racfg' ? Exp.retroarchCfg(cur) : x === 'rarmap' ? Exp.retroarchRmap(cur) : Exp.sdl(cur);
    $('xout').textContent = r.text; $('xnotes').textContent = 'UNTESTED ON HARDWARE. ' + r.hint + ' ' + r.notes.join(' | ');
    download(r.filename, r.text, r.mime);
  }; });

  function renderAll() { renderList(); renderEditor(); renderPhys(); renderWarns(); renderRt(); }
  inp.start(); renderAll(); requestAnimationFrame(frame);
  window.AC_ctrlPage = { inp, get profile() { return cur; } };
})();
