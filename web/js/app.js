// ataricraft app: UI + agent API (window.ataricraft). Humans and agents drive the same machine.
(function () {
  const $ = (id) => document.getElementById(id);
  const S = { emu: null, dirty: {}, pend: {}, io: {}, roms: { os800: null, osxl: null, basic: null }, running: false, speed: 1, acc: 0, last: 0, typeQ: [], typeWait: 0, joyMode: false, joy: 0, fire: false };
  const pal = new Uint32Array(256);
  const cv = $('screen');
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(AC.SCREEN.w, AC.SCREEN.h);
  const img32 = new Uint32Array(img.data.buffer);
  cv.width = AC.SCREEN.w; cv.height = AC.SCREEN.h;

  const hdr = document.querySelector('header');
  const setHh = () => document.documentElement.style.setProperty('--hh', hdr.offsetHeight + 1 + 'px');
  new ResizeObserver(setHh).observe(hdr);
  setHh();
  let toastT = 0;
  // Diagnostics log: kept in localStorage so it survives reloads; "Save log" writes it to a file.
  const DIAG_MAX = 500;
  let DIAG = [];
  try { DIAG = JSON.parse(localStorage.getItem('ac.diag') || '[]'); } catch (e) { DIAG = []; }
  const diag = (m, lvl) => {
    DIAG.push(`${new Date().toISOString()} ${lvl || 'info'} ${m}`);
    if (DIAG.length > DIAG_MAX) DIAG = DIAG.slice(-DIAG_MAX);
    try { localStorage.setItem('ac.diag', JSON.stringify(DIAG)); } catch (e) { /* storage full */ }
  };
  window.addEventListener('error', (e) => diag(`ERROR ${e.message} @${(e.filename || '').split('/').pop()}:${e.lineno}`, 'error'));
  window.addEventListener('unhandledrejection', (e) => diag('REJECTION ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason), 'error'));
  diag('page loaded ' + (document.querySelector('h1 small') || {}).textContent + ' | ' + navigator.userAgent);
  const log = (m) => {
    diag(m);
    $('status').textContent = m;
    const t = $('toast');
    t.textContent = m;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 4500);
  };

  function classify(name, bytes) {
    const id = (AC.OS_DB || {})[crc32(bytes)];
    if (id) return /BASIC/i.test(id[0]) ? 'basic' : bytes.length === 10240 ? 'os800' : bytes.length === 16384 ? 'osxl' : null;
    if ((AC.CART_DB || {})[crc32(bytes)]) return null;
    // An OS ROM carries the DISKIV/DSKINV/CIOV/SIOV JMP table at $E450; MIO, Black Box, Speedy and DOS cart images do not.
    const hasJumpTable = (o) => [0, 3, 6, 9].every((i) => bytes[o + i] === 0x4c);
    if (bytes.length === 10240) return hasJumpTable(0x0c50) ? 'os800' : null;
    if (bytes.length === 16384) return hasJumpTable(0x2450) ? 'osxl' : null;
    if (bytes.length === 8192) return 'basic';
    return null;
  }

  // ROM library: every scanned/picked file classified by size; the dropdowns choose which to use.
  S.lib = { os800: [], osxl: [], basic: [] };

  // Persist found ROMs in IndexedDB so they survive reloads.
  const romDb = new Promise((res) => {
    try {
      const rq = indexedDB.open('ataricraft', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('roms', { keyPath: 'name' });
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
  async function saveRom(kind, name, bytes) {
    const db = await romDb;
    if (db) db.transaction('roms', 'readwrite').objectStore('roms').put({ name, kind, bytes });
  }
  async function loadSavedRoms() {
    const db = await romDb;
    if (!db) return;
    const all = await new Promise((res) => { const r = db.transaction('roms').objectStore('roms').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => res([]); });
    for (const e of all) if (S.lib[e.kind] && !S.lib[e.kind].some((x) => x.name === e.name)) S.lib[e.kind].push({ name: e.name, bytes: e.bytes });
    if (all.length) { fillRomSelects(); log(`restored ${all.length} saved ROMs`); }
  }
  // Reset ROMs puts the selection back to defaults and keeps every scanned ROM listed; Shift-click also forgets the stored ROMs.
  $('romforget').onclick = async (ev) => {
    localStorage.removeItem('ac.romsel');
    S.basicTouched = false;
    if (ev && ev.shiftKey) {
      const db = await romDb;
      if (db) db.transaction('roms', 'readwrite').objectStore('roms').clear();
      S.lib = { os800: [], osxl: [], basic: [] };
      log('saved ROMs cleared');
    } else log('ROM selection reset; all ROMs stay listed (Shift-click to forget stored ROMs)');
    fillRomSelects();
  };

  // MAME-style .zip files are expanded into virtual files (extracted only when used).
  // Archive listings are cached in the catalog by path + size + modified time, so a rescan only opens new or changed archives.
  const ARC = new Map();
  let arcLoaded = false;
  async function loadArcCache() {
    if (arcLoaded) return;
    try {
      for (const r of await AC.Catalog.rows('SELECT path, size, modified, ents FROM arc')) ARC.set(r.path, r);
      arcLoaded = true;
    } catch (e) { diag('archive cache not loaded: ' + e.message, 'warn'); }
  }
  async function expandZips(files) {
    files = Array.from(files);
    const out = [];
    let zips = 0, cached = 0, fresh = [];
    const nz = files.filter((f) => /\.(zip|7z)$/i.test(f.name)).length;
    const prog = nz ? AC.Progress.begin('Reading archives', nz) : null;
    if (nz) await loadArcCache();
    for (const f of files) {
      if (!/\.(zip|7z)$/i.test(f.name)) { out.push(f); continue; }
      const base = f.webkitRelativePath || f.name;
      if (prog) { prog.text('Reading archive ' + f.name); prog.set(zips); prog.note(`${cached} cached, ${fresh.length} new`); }
      try {
        const Z = /\.7z$/i.test(f.name) ? AC.SevenZip : AC.Zip;
        const hit = ARC.get(base);
        let ents;
        if (hit && hit.size === f.size && hit.modified === (f.lastModified || 0)) { ents = JSON.parse(hit.ents); cached++; }
        else {
          ents = await Z.list(f);
          const rec = { path: base, size: f.size, modified: f.lastModified || 0, ents: JSON.stringify(ents) };
          ARC.set(base, rec); fresh.push(rec);
          if (fresh.length >= 25) { await AC.Catalog.putArcs(fresh); fresh = []; await idbSet('catalogDb', await AC.Catalog.exportBytes()); }
        }
        for (const ent of ents) {
          out.push({ name: ent.name.split('/').pop(), webkitRelativePath: base + '/' + ent.name, size: ent.size, arrayBuffer: () => Z.extract(f, ent) });
        }
      } catch (e) { out.push(f); }
      zips++;
      if (prog) await AC.Progress.yieldUI();
    }
    if (fresh.length) { try { await AC.Catalog.putArcs(fresh); await idbSet('catalogDb', await AC.Catalog.exportBytes()); } catch (e) { diag('archive cache save failed: ' + e.message, 'warn'); } }
    if (prog) prog.end();
    if (zips) log(`read ${zips} archive${zips > 1 ? 's' : ''} (${cached} from cache)`);
    return out;
  }

  async function addRoms(files) {
    files = await expandZips(files);
    for (const f of files) {
      if (![8192, 10240, 16384].includes(f.size)) continue;
      const bytes = new Uint8Array(await f.arrayBuffer());
      const k = classify(f.name, bytes);
      const name = f.webkitRelativePath || f.name;
      if (k && !S.lib[k].some((e) => e.name === name)) { S.lib[k].push({ name, bytes }); saveRom(k, name, bytes); }
    }
    fillRomSelects();
  }

  function fillRam() {
    const m = AC.MODELS[$('model').value];
    const sel = $('ram');
    const prev = sel.value;
    sel.innerHTML = '';
    m.ram.forEach((r) => sel.append(new Option(r.label, r.v)));
    sel.value = m.ram.some((r) => r.v === prev) ? prev : m.def;
  }

  // Open-licence Altirra firmware shipped with the app; always listed after any ROMs the user supplies.
  const BUILTIN = [['os800', 'os800', 'Altirra OS 3.44 (800, built-in)'], ['osxl', 'osxl', 'Altirra OS 3.44 (XL/XE, built-in)'], ['basic', 'basic', 'Altirra BASIC 1.59 (built-in)'],
    ['os800', 'os800b', 'Altirra OS AltirraSDL (800, built-in)'], ['osxl', 'osxlb', 'Altirra OS AltirraSDL (XL/XE, built-in)']];
  function ensureBuiltinRoms() {
    for (const [lib, key, label] of BUILTIN) {
      let e = S.lib[lib].find((x) => x.builtin && x.key === key);
      if (e) S.lib[lib].splice(S.lib[lib].indexOf(e), 1);
      else e = { name: label, key, builtin: true, label, bytes: Uint8Array.from(atob(AC.ALTIRRA[key]), (c) => c.charCodeAt(0)) };
      S.lib[lib].push(e);
    }
  }

  // "Atari BASIC REV. C (1984) - file.rom" when the CRC is in the WUDSN database, else the file name.
  function romLabel(e) {
    const file = e.name.replace(/^.*[\\/]/, '');
    if (e.label === undefined) {
      const d = (AC.OS_DB || {})[crc32(e.bytes)];
      e.label = d ? [d[0], d[2], d[3] ? '(' + d[3] + ')' : '', '[' + d[1].replace(/^SYSROM_/, '') + ']'].filter(Boolean).join(' ') : '';
    }
    return e.builtin ? e.label : e.label ? `${e.label} - ${file}` : file;
  }

  function fillRomSelects() {
    ensureBuiltinRoms();
    fillRam();
    const kind = $('model').value === '800' ? 'os800' : 'osxl';
    const sel_ = JSON.parse(localStorage.getItem('ac.romsel') || '{}');
    const fill = (sel, list, none, key) => {
      const prev = sel.value;
      sel.innerHTML = '';
      if (none) sel.append(new Option('(none)', ''));
      // The built-in Altirra ROMs are listed first so they are never buried under a long scanned list; the values stay indexes into the list.
      const order = list.map((e, i) => i).sort((a, b) => !!list[b].builtin - !!list[a].builtin);
      order.forEach((i) => sel.append(new Option(romLabel(list[i]), String(i))));
      const si = key in sel_ ? (sel_[key] === '' ? '' : String(list.findIndex((e) => e.name === sel_[key]))) : null;
      if (si !== null && si !== '-1' && [...sel.options].some((o) => o.value === si)) { sel.value = si; if (key === 'basic') S.basicTouched = true; }
      else if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
      else { const f = order.find((i) => !list[i].builtin); sel.value = f !== undefined ? String(f) : String(order[0]); }
      const q = $('romfilter').value.trim().toLowerCase();
      if (q) [...sel.options].forEach((o) => { if (o.value !== '' && o.value !== sel.value && !o.text.toLowerCase().includes(q)) o.remove(); });
    };
    fill($('osrom'), S.lib[kind], false, kind);
    const bas = [...S.lib.basic].sort((a, b) => /bas/i.test(b.name) - /bas/i.test(a.name));
    S.basicList = bas;
    fill($('basicrom'), bas, true, 'basic');
    if (bas.length && $('basicrom').value === '' && !S.basicTouched) $('basicrom').value = '0';
    S.roms.os800 = S.lib.os800[0] ? S.lib.os800[0].bytes : null;
    S.roms.osxl = S.lib.osxl[0] ? S.lib.osxl[0].bytes : null;
    S.roms.basic = bas[0] ? bas[0].bytes : null;
    $('romstate').textContent = `OS800 ${S.lib.os800.length} · XL/XE ${S.lib.osxl.length} · BASIC ${S.lib.basic.length}`;
    updateCharset();
  }

  const chosenOs = () => { const l = S.lib[$('model').value === '800' ? 'os800' : 'osxl']; const e = l[+$('osrom').value]; return e ? e.bytes : null; };
  const chosenBasic = () => { const e = $('basicrom').value === '' ? null : S.basicList[+$('basicrom').value]; return e ? e.bytes : null; };

  function updateCharset() {
    const m = $('model').value;
    const os = chosenOs();
    if (os) AC.keyboard.setCharset(os.subarray(m === '800' ? 0x0800 : 0x2000, (m === '800' ? 0x0800 : 0x2000) + 1024));
  }

  // ---- sound: libatari800 delivers 16-bit mono 44.1 kHz per frame; queue each frame as a scheduled buffer ----
  const SND = { ctx: null, gain: null, next: 0, on: localStorage.getItem('ac.sound') !== '0', vol: +(localStorage.getItem('ac.vol') || 0.6) };
  function sndCtx() {
    if (!SND.ctx) {
      const AC_ = window.AudioContext || window.webkitAudioContext;
      if (!AC_) return null;
      SND.ctx = new AC_({ sampleRate: 44100 });
      SND.gain = SND.ctx.createGain();
      SND.gain.connect(SND.ctx.destination);
    }
    if (SND.ctx.state !== 'running') SND.ctx.resume().catch(() => {});
    SND.gain.gain.value = SND.on ? SND.vol * 3 : 0;
    return SND.ctx;
  }
  // Mobile browsers keep the context suspended until a user gesture; (re)create/resume it on every early touch/click/key.
  const unlockAudio = () => {
    const c = sndCtx();
    if (c && c.state === 'running') {
      ['touchstart', 'touchend', 'pointerdown', 'click', 'keydown'].forEach((e) => window.removeEventListener(e, unlockAudio, true));
    }
  };
  ['touchstart', 'touchend', 'pointerdown', 'click', 'keydown'].forEach((e) => window.addEventListener(e, unlockAudio, true));
  function pushAudio(s16) {
    const c = SND.ctx;
    if (!c || !SND.on || !S.running || Math.abs(S.speed - 1) > 0.01) return;
    const t = c.currentTime;
    if (SND.next < t) SND.next = t + 0.06;
    if (SND.next > t + 0.3) return;
    const buf = c.createBuffer(1, s16.length, 44100);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < s16.length; i++) ch[i] = s16[i] / 32768;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(SND.gain);
    src.start(SND.next);
    SND.next += buf.duration;
  }
  const hookAudio = () => { if (S.emu) S.emu.onAudio = pushAudio; };
  const syncSndUi = () => { $('sndbtn').innerHTML = '<span class="emo">' + (SND.on ? '🔊' : '🔇') + '</span>'; $('sndbtn').classList.toggle('on', SND.on); $('vol').value = SND.vol; };

  const handle = {
    down: (id, f) => S.emu && S.emu.down(id, f),
    up: (id) => S.emu && S.emu.up(id),
  };

  $('basic').checked = localStorage.getItem('ac.basicOn') !== '0';
  $('basic').onchange = () => {
    localStorage.setItem('ac.basicOn', $('basic').checked ? '1' : '0');
    if (S.running) boot();
  };

  $('fastsio').checked = localStorage.getItem('ac.fastSio') !== '0';
  $('fastsio').onchange = () => {
    localStorage.setItem('ac.fastSio', $('fastsio').checked ? '1' : '0');
    if (S.running) boot();
  };

  S.carts = {};
  S.disks = {};
  $('core').value = localStorage.getItem('ac.core') === 'altirra' ? 'altirra' : 'atari800';
  $('core').onchange = () => {
    localStorage.setItem('ac.core', $('core').value);
    $('core').blur();
    if (S.running) boot();
  };
  async function boot() {
    const model = $('model').value;
    const alt = $('core').value === 'altirra';
    const os = chosenOs();
    if (!os) { log('Need an OS ROM for ' + model + ' (scan a ROM folder first)'); return false; }
    log('booting…');
    if (S.emu) { syncDisks(true); S.host = Object.assign(S.host || {}, S.emu.hostFiles()); }
    try {
      S.emu = await (alt ? AC.AltEmu : AC.Emu).boot({ model, os, ram: $('ram').value, basic: chosenBasic(), basicOn: $('basic').checked, xep80: $('xep80').checked, fastSio: $('fastsio').checked,     tv: $('tv').value, host: S.host });
    } catch (e) { log('core failed: ' + e.message); return false; }
    FujiNet.attach(S.emu);
    hookDevices();
    applyPad();
    for (const [n, d] of Object.entries(S.disks)) S.emu.mountDisk(+n, d.name, d.bytes);
    for (const [slot, c] of Object.entries(S.carts)) {
      const r = S.emu.insertCart(+slot, c.name, c.bytes);
      if (r.ok && r.kb && c.type != null) S.emu.setCartType(+slot, c.type);
    }
    // FujiNet selected and nothing else to boot from: power on straight into the FujiNet CONFIG menu.
    if (FujiNet.enabled && !S.disks[1] && !Object.keys(S.carts).length && !S.pending) {
      FujiNet.mountConfig();
      if (alt) S.emu.coldStart();
      $('d1').textContent = 'FujiNet CONFIG';
      log('FujiNet: booting the CONFIG menu (mount a disk on D1 or insert a cartridge to boot something else)');
    }
    if (S.tape && S.emu.tapeInsert(S.tape.name, S.tape.bytes)) $('tn').textContent = S.tape.name;
    FujiNet.log = log;
    S.emu.run(120);
    hookAudio();
    sndCtx();
    S.running = true;
    S.off = false;
    syncPower();
    draw();
    renderHost();
    log('running ' + AC.MODELS[model].label);
    return true;
  }

  // ---- H: host drive: LIST "H:PROG.LST" writes a text file here; ENTER "H:PROG.LST" reads it back ----
  const toText = (b) => { let s = ''; for (const c of b) s += c === 0x9b ? '\n' : c === 0x0a ? '\n' : c === 0x0d ? '' : c >= 32 && c < 127 ? String.fromCharCode(c) : ''; return s; };
  const toAtari = (t) => { const o = []; for (const ch of t.replace(/\r\n?/g, '\n')) { const c = ch.charCodeAt(0); if (ch === '\n') o.push(0x9b); else if (c >= 32 && c < 127) o.push(c); } return Uint8Array.from(o); };
  const hostName = (n) => n.toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 12);
  let hostSig = '';
  function renderHost(force) {
    if (!S.emu) return;
    const files = S.emu.hostFiles();
    const sig = Object.entries(files).map(([n, b]) => n + ':' + b.length).join('|');
    if (sig === hostSig && !force) return;
    hostSig = sig;
    const box = $('hostlist');
    box.innerHTML = '';
    const names = Object.keys(files).sort();
    $('hostcount').textContent = names.length ? names.length + ' file(s)' : 'empty';
    names.forEach((n) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis" title="${n}">${n}</span><span class="dim">${files[n].length}</span>`;
      const mk = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; row.append(b); };
      mk('Copy', () => navigator.clipboard.writeText(toText(S.emu.hostFiles()[n])).then(() => log('copied ' + n)).catch((e) => log('clipboard: ' + e.message)));
      mk('Save', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([S.emu.hostFiles()[n]])); a.download = n; a.click(); });
      mk('Del', () => { S.emu.hostDelete(n); S.host && delete S.host[n]; renderHost(true); });
      box.append(row);
    });
  }
  setInterval(() => renderHost(), 1000);
  $('hostpaste').onclick = () => navigator.clipboard.readText().then((t) => {
    if (!S.emu) { log('boot first'); return; }
    const n = hostName($('hostname').value) || 'PASTE.LST';
    S.emu.hostWrite(n, toAtari(t));
    renderHost(true);
    log('wrote H:' + n + ' - in BASIC: ENTER "H:' + n + '"');
  }).catch((e) => log('clipboard: ' + e.message));
  $('hostimport').onchange = async (e) => {
    if (!S.emu) { log('boot first'); return; }
    for (const f of e.target.files) S.emu.hostWrite(hostName(f.name) || 'FILE', await AC.Progress.read(f, 'Importing ' + f.name));
    e.target.value = '';
    renderHost(true);
  };

  function draw() {
    if (!S.emu) return;
    let xh = S.emu.xepHeight();
    if (xh) {
      if (!xepBuf || xepCv.height !== xh) { xepCv.height = xh; xepImg = new ImageData(560, xh); xepBuf = new Uint32Array(xepImg.data.buffer); }
      S.emu.xepRender(xepBuf, pal, (S.emu.frames >> 5) & 1);
      xepCv.getContext('2d').putImageData(xepImg, 0, 0);
      // Stay on the Atari screen until a handler actually draws something on the XEP80.
      if (S.xepSeen !== S.emu) {
        let lit = 0;
        for (let i = 0; i < xepBuf.length && lit < 150; i += 7) if ((xepBuf[i] & 0xffffff) !== (xepBuf[0] & 0xffffff)) lit++;
        if (lit >= 20) S.xepSeen = S.emu;
      }
      if (S.xepSeen !== S.emu) xh = 0;
    }
    if (!!xh !== S.xepShown) { S.xepShown = !!xh; applyScale(); }
    if (!xh) { S.emu.render(img32, pal); sctx.putImageData(img, 0, 0); }
    pollTape();
    present();
  }
  const xepCv = Object.assign(document.createElement('canvas'), { width: 560, height: 250 });
  let xepImg = null, xepBuf = null;

  // ---- display scaling: the emulator frame is kept in `src`, `cv` is the on-screen canvas ----
  const src = document.createElement('canvas');
  src.width = AC.SCREEN.w; src.height = AC.SCREEN.h;
  const sctx = src.getContext('2d');
  const stage = document.createElement('canvas');
  const stx = stage.getContext('2d');
  let scaleMode = localStorage.getItem('ac.scale') || 'sharp';
  let scanOn = localStorage.getItem('ac.scan') === '1';
  if (scaleMode === 'crt') { scaleMode = 'sharpbi'; scanOn = true; }
  // Scale2x/EPX: edge-directed 2x that smooths diagonals without inventing new colours
  const epxBufs = {};
  function epx(inp, w, h, level) {
    const ow = w * 2, oh = h * 2;
    let b = epxBufs[level];
    if (!b || b.w !== ow) { const out = new Uint32Array(ow * oh); b = epxBufs[level] = { w: ow, h: oh, out, id: new ImageData(new Uint8ClampedArray(out.buffer), ow, oh) }; }
    const out = b.out;
    for (let y = 0; y < h; y++) {
      const r = y * w, up = (y > 0 ? y - 1 : y) * w, dn = (y < h - 1 ? y + 1 : y) * w, o = y * 2 * ow;
      for (let x = 0; x < w; x++) {
        const E = inp[r + x], B = inp[up + x], H = inp[dn + x], D = inp[r + (x > 0 ? x - 1 : x)], F = inp[r + (x < w - 1 ? x + 1 : x)];
        const i = o + x * 2;
        if (B !== H && D !== F) {
          out[i] = D === B ? D : E; out[i + 1] = B === F ? F : E;
          out[i + ow] = D === H ? D : E; out[i + ow + 1] = H === F ? F : E;
        } else { out[i] = out[i + 1] = out[i + ow] = out[i + ow + 1] = E; }
      }
    }
    return b;
  }
  function applyScale() {
    const native = (scaleMode === 'sharp' || scaleMode === 'smooth') && !scanOn && !S.xepShown;
    const dpr = window.devicePixelRatio || 1;
    const w = native ? AC.SCREEN.w : Math.max(AC.SCREEN.w, Math.round(cv.clientWidth * dpr));
    const h = native ? AC.SCREEN.h : Math.max(AC.SCREEN.h, Math.round(cv.clientHeight * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    cv.style.imageRendering = scaleMode === 'sharp' ? 'pixelated' : 'auto';
    present();
  }
  function present() {
    const W = cv.width, H = cv.height;
    if (S.xepShown) { ctx.imageSmoothingEnabled = scaleMode !== 'sharp'; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(xepCv, 0, 0, W, H); return; }
    const native = W === src.width && H === src.height;
    ctx.imageSmoothingQuality = 'high';
    if (scaleMode === 'sharp') { ctx.imageSmoothingEnabled = false; ctx.drawImage(src, 0, 0, W, H); }
    else if (scaleMode === 'smooth') { ctx.imageSmoothingEnabled = true; ctx.drawImage(src, 0, 0, W, H); }
    else if (scaleMode === 'epx') {
      let b = epx(img32, src.width, src.height, 1);
      if (W / src.width > 2) b = epx(b.out, b.w, b.h, 2);
      if (stage.width !== b.w || stage.height !== b.h) { stage.width = b.w; stage.height = b.h; }
      stx.putImageData(b.id, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(stage, 0, 0, W, H);
    } else {
      // integer nearest-neighbour prescale, then a smooth resample: crisp pixel edges without shimmering
      const k = Math.max(1, Math.ceil(W / src.width));
      if (stage.width !== src.width * k || stage.height !== src.height * k) { stage.width = src.width * k; stage.height = src.height * k; }
      stx.imageSmoothingEnabled = false;
      stx.drawImage(src, 0, 0, stage.width, stage.height);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(stage, 0, 0, W, H);
    }
    if (scanOn && !native) {
      const line = H / 240;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (let i = 0; i < 240; i++) ctx.fillRect(0, i * line + line * 0.6, W, line * 0.4);
    }
  }
  // Palette: per TV standard, a preset plus adjustable parameters (see palette.js); only the parameters persist.
  const PALSL = [['hue1Angle', 'Tint', 0, 360, 1, 0], ['hueStep', 'Hue step', 0, 35, 0.1, 1], ['saturation', 'Saturation', 0, 0.5, 0.005, 2], ['brightness', 'Brightness', -0.5, 0.5, 0.005, 2], ['contrast', 'Contrast', 0.5, 1.5, 0.01, 2], ['gamma', 'Gamma', 0.5, 2, 0.01, 2]];
  let palSaved = {}; try { palSaved = JSON.parse(localStorage.getItem('ac.pal2') || '{}'); } catch (e) { /* defaults */ }
  const palTv = () => ($('tv').value === 'pal' ? 'pal' : 'ntsc');
  const palCur = () => palSaved[palTv()] || (palSaved[palTv()] = { ...AC.PALETTE_PRESETS[palTv()][0][2] });
  function palApply() { AC.buildPalette(palTv(), palCur(), pal); }
  function palUI() {
    const tv = palTv(), cur = palCur(), ps = $('palstyle');
    ps.innerHTML = '';
    let hit = '';
    for (const [id, name, p] of AC.PALETTE_PRESETS[tv]) { ps.append(new Option(name, id)); if (Object.keys(p).every((k) => Math.abs(p[k] - cur[k]) < 1e-6 || p[k] === cur[k])) hit = id; }
    if (!hit) ps.append(new Option('Custom', 'custom')); ps.value = hit || 'custom';
    $('palgamut').value = cur.primaries;
    PALSL.forEach(([k, , , , , d], i) => { const r = $('palsl').children[i]; r.querySelector('input').value = cur[k]; r.querySelector('b').textContent = (+cur[k]).toFixed(d); });
  }
  const palChange = (patch) => { Object.assign(palCur(), patch); localStorage.setItem('ac.pal2', JSON.stringify(palSaved)); palApply(); palUI(); };
  for (const [v, n] of AC.PALETTE_PRIMARIES) $('palgamut').append(new Option(n, v));
  PALSL.forEach(([k, label, mn, mx, st]) => {
    const r = document.createElement('div'); r.className = 'row';
    r.innerHTML = `<span class="dim" style="width:70px">${label}</span><input type="range" min="${mn}" max="${mx}" step="${st}" style="flex:1"><b style="width:44px;text-align:right;font-weight:400"></b>`;
    r.querySelector('input').oninput = (e) => palChange({ [k]: +e.target.value });
    $('palsl').append(r);
  });
  $('palstyle').onchange = (e) => { const p = AC.PALETTE_PRESETS[palTv()].find((x) => x[0] === e.target.value); if (p) palChange({ ...p[2] }); e.target.blur(); };
  $('palgamut').onchange = (e) => { palChange({ primaries: e.target.value }); e.target.blur(); };
  $('tv').addEventListener('change', () => { palApply(); palUI(); });
  palApply(); palUI();  $('scalemode').value = scaleMode;
  $('scalemode').onchange = (e) => { scaleMode = e.target.value; localStorage.setItem('ac.scale', scaleMode); e.target.blur(); applyScale(); };
  $('scanlines').checked = scanOn;
  $('scanlines').onchange = (e) => { scanOn = e.target.checked; localStorage.setItem('ac.scan', scanOn ? '1' : '0'); e.target.blur(); applyScale(); };
  new ResizeObserver(() => applyScale()).observe(cv);
  window.addEventListener('resize', applyScale);

  // After Return the Atari may be busy (ENTER, RUN, disk I/O) and drops keys, so wait for the screen to go still.
  function stepFrames(n) {
    for (let i = 0; i < n; i++) {
      if (S.typeQ.length && --S.typeWait <= 0) {
        if (S.settle > 0) {
          S.settle--;
          const h = S.emu.screenHash();
          S.still = h === S.lastHash ? S.still + 1 : 0;
          S.lastHash = h;
          if (S.still < 12 && S.settle > 0) { S.emu.frame(); continue; }
          S.settle = 0;
        }
        const k = S.typeQ.shift();
        S.emu.tap(k, 3);
        S.typeWait = 6;
        if (k.keychar === 10) { S.typeWait = 30; S.settle = 400; S.still = 0; }
      }
      S.emu.frame();
    }
  }

  const fpsStat = { t: 0, draws: 0, f0: 0 };
  function loop(t) {
    requestAnimationFrame(loop);
    if (S.emu && S.running) {
      const fps = $('tv').value === 'pal' ? 50 : 60;
      S.acc += Math.min(100, t - S.last) * S.speed * fps / 1000;
      const n = Math.min(Math.floor(S.acc), 600);
      S.acc -= n;
      if (n) { stepFrames(n); draw(); fpsStat.draws++; $('fc').textContent = S.emu.frames; }
    }
    S.last = t;
    if (t - fpsStat.t >= 1000) {
      const dt = (t - fpsStat.t) / 1000;
      const fr = S.emu ? S.emu.frames : 0;
      $('fps').textContent = (fpsStat.draws / dt).toFixed(0);
      $('efps').textContent = ((fr - fpsStat.f0) / dt).toFixed(0);
      $('clk').textContent = (((fr - fpsStat.f0) / dt) * ($('tv').value === 'pal' ? 35568 : 29868) / 1e6).toFixed(2);
      fpsStat.t = t; fpsStat.draws = 0; fpsStat.f0 = fr;
    }
  }

  function sendJoy() {
    if (!S.emu) return;
    players.forEach((p, i) => { if (i === 0 || JSH.two) p.send(); });
  }

  // ---- physical keyboard ----
  // Profiles: "mame" maps by physical position exactly like MAME's a800/a800xl driver (keyed on KeyboardEvent.code);
  // "natural" types by the character you press. Overrides from the remap table win over either profile.
  const MAME_MAP = {
    Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9', Digit0: '0',
    Minus: 'lt', Equal: 'gt', Backspace: 'break', IntlBackslash: 'bksp',
    Backslash: '*', Quote: '+', BracketLeft: '-', BracketRight: '=', Semicolon: ';', Comma: ',', Period: '.', Slash: '/',
    Enter: 'return', Tab: 'tab', Escape: 'esc', Space: 'space', CapsLock: 'caps', ControlRight: 'inv',
    F1: 'start', F2: 'select', F3: 'option', F8: 'help', F5: 'reset', F6: 'power', Pause: 'break',
  };
  for (const c of 'abcdefghijklmnopqrstuvwxyz') MAME_MAP['Key' + c.toUpperCase()] = c;
  const NATURAL_MAP = { F1: 'start', F2: 'select', F3: 'option', F4: 'start', F5: 'reset', F6: 'power', F8: 'help', Pause: 'break', Delete: 'bksp', Home: 'lt', Insert: 'gt', AltRight: 'inv', CapsLock: 'caps' };
  const JOY_MAP = { ArrowUp: 'joyU', ArrowDown: 'joyD', ArrowLeft: 'joyL', ArrowRight: 'joyR', Space: 'fire', KeyW: 'joyU', KeyS: 'joyD', KeyA: 'joyL', KeyD: 'joyR' };
  const JOYBIT = { joyU: 1, joyD: 2, joyL: 4, joyR: 8 };
  const ACTIONS = [['start', 'Start'], ['select', 'Select'], ['option', 'Option'], ['help', 'Help'], ['reset', 'Reset'], ['power', 'Cold start / Power'], ['break', 'Break'], ['inv', 'Atari / Inverse'], ['caps', 'Caps'], ['joyU', 'Joystick up'], ['joyD', 'Joystick down'], ['joyL', 'Joystick left'], ['joyR', 'Joystick right'], ['fire', 'Joystick fire']];
  const CURSOR = { ArrowUp: 0x8e, ArrowDown: 0x8f, ArrowLeft: 0x86, ArrowRight: 0x87 };
  const NAT_SPECIAL = { Enter: { keychar: 10 }, Backspace: { keychar: 8 }, Tab: { keychar: 9 }, Escape: { keychar: 27 }, ' ': { keychar: 32 } };
  S.profile = localStorage.getItem('ac.profile') || 'mame';
  try { S.overrides = JSON.parse(localStorage.getItem('ac.keymap') || '{}'); } catch (e) { S.overrides = {}; }
  S.rctrl = false;

  const effMap = () => Object.assign({}, S.profile === 'mame' ? MAME_MAP : NATURAL_MAP, S.joyMode ? JOY_MAP : {}, S.overrides);
  const codeFor = (id) => { const m = Object.assign({}, S.profile === 'mame' ? MAME_MAP : NATURAL_MAP, JOY_MAP, S.overrides); return Object.keys(m).find((c) => S.overrides[c] === id) || Object.keys(m).find((c) => m[c] === id) || ''; };

  function joyApply(id, on) {
    if (id === 'fire') S.fire = on;
    else S.joy = on ? S.joy | JOYBIT[id] : S.joy & ~JOYBIT[id];
    sendJoy();
  }

  const lit = {};
  const SPECIAL_KEYS = { Enter: 'return', Backspace: 'bksp', Tab: 'tab', Escape: 'esc', Space: 'space', ShiftLeft: 'shift', ShiftRight: 'shift2', ControlLeft: 'control', ControlRight: 'control', CapsLock: 'caps' };
  function litOn(e) {
    if (lit[e.code]) return;
    let id = effMap()[e.code] || SPECIAL_KEYS[e.code];
    if (!id && e.key && e.key.length === 1) id = AC.keyboard.keyForChar(e.key);
    const el = id && document.querySelector('#kbd .key[data-id="' + id + '"]');
    const ARR = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'ret', Escape: 'esc', Space: 'space', Backspace: 'bksp', Tab: 'tab', Pause: 'brk' };
    const aid = ARR[e.code] || ({ start: 'start', select: 'select', option: 'option', reset: 'reset', help: 'help', break: 'brk' })[id];
    const ae = aid && document.querySelector('#karrows .a-' + aid + ', #kmini .a-' + aid);
    const els = [el, ae].filter(Boolean);
    if (els.length) { els.forEach((x) => x.classList.add('down')); lit[e.code] = els; }
  }
  function litOff(code) {
    if (lit[code]) { lit[code].forEach((x) => x.classList.remove('down')); delete lit[code]; }
  }
  window.addEventListener('blur', () => Object.keys(lit).forEach(litOff));

  function syncMods(e) {
    const K = AC.keyboard, s = e.shiftKey, c = e.ctrlKey;
    if (K.phys.shift !== s || K.phys.ctrl !== c) { K.phys.shift = s; K.phys.ctrl = c; K.refresh && K.refresh(); }
  }
  window.addEventListener('keydown', syncMods, true);
  window.addEventListener('keyup', syncMods, true);
  window.addEventListener('pointerdown', syncMods, true);
  window.addEventListener('blur', () => { AC.keyboard.phys.shift = AC.keyboard.phys.ctrl = false; AC.keyboard.refresh && AC.keyboard.refresh(); });

  // Ctrl+L in the library toggles short (8.3) + long names; the emulator keeps Ctrl+L otherwise.
  let medHover = false;
  $('medlist').addEventListener('mouseenter', () => (medHover = true));
  $('medlist').addEventListener('mouseleave', () => (medHover = false));
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyL' && (medHover || e.target === $('medfilter'))) {
      e.preventDefault(); e.stopPropagation();
      MED.showShort = !MED.showShort; localStorage.setItem('ac.showShort', MED.showShort ? '1' : '0'); renderMed();
    }
  }, true);
  window.addEventListener('keydown', (e) => {
    if (!S.capture && e.target.tagName !== 'SELECT' && e.target.tagName !== 'INPUT' && !$('mapdlg').open) litOn(e);
    if (S.capture) { e.preventDefault(); const id = S.capture; S.capture = null; for (const c of Object.keys(S.overrides)) if (S.overrides[c] === id) delete S.overrides[c]; S.overrides[e.code] = id; localStorage.setItem('ac.keymap', JSON.stringify(S.overrides)); renderMap(); return; }
    if (!S.emu || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    if (e.code === 'ControlRight') S.rctrl = true;
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.code === 'KeyV' || (e.code === 'KeyC' && !String(getSelection())))) {
      if (e.code === 'KeyC') { e.preventDefault(); $('copytxt').click(); }
      return;
    }
    if (e.repeat) { e.preventDefault(); return; }
    const map = effMap();
    const id = map[e.code];
    if (id && (id.startsWith('joy') || id === 'fire')) {
      if (S.joyMode) { e.preventDefault(); joyApply(id, true); return; }
    }
    let f = null;
    if (id && !id.startsWith('joy') && id !== 'fire') {
      const k = AC.keyboard.keyById(id);
      const ctrl = (e.ctrlKey && !S.rctrl) || AC.keyboard.latch.ctrl;
      if (k && k.send) f = k.send(e.shiftKey || AC.keyboard.latch.shift, ctrl);
    } else if (CURSOR[e.code] && !S.joyMode) f = { keycode: CURSOR[e.code] };
    else if (S.profile === 'natural') {
      if (e.ctrlKey && e.key.length === 1 && /[a-z]/i.test(e.key)) f = { keychar: e.key.toLowerCase().charCodeAt(0) - 96 };
      else if (NAT_SPECIAL[e.key]) f = NAT_SPECIAL[e.key];
      else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) f = { keychar: e.key.charCodeAt(0) };
    }
    if (f) {
      e.preventDefault(); S.emu.down('phys:' + e.code, f);
      if (AC.keyboard.latch.shift || AC.keyboard.latch.ctrl) { AC.keyboard.latch.shift = AC.keyboard.latch.ctrl = false; AC.keyboard.refresh(); }
    }
  });
  window.addEventListener('keyup', (e) => {
    litOff(e.code);
    if (e.code === 'ControlRight') S.rctrl = false;
    if (!S.emu) return;
    const id = effMap()[e.code];
    if (id && (id.startsWith('joy') || id === 'fire') && S.joyMode) joyApply(id, false);
    S.emu.up('phys:' + e.code);
  });

  function renderMap() {
    const box = $('mapbox');
    box.innerHTML = '';
    ACTIONS.forEach(([id, label]) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span class="dim" style="flex:1">${label}</span>`;
      const b = document.createElement('button');
      b.textContent = S.capture === id ? 'press a key…' : (codeFor(id) || '—');
      b.onclick = () => { S.capture = id; renderMap(); };
      row.append(b);
      box.append(row);
    });
  }

  // ---- media ----
  const MEDIA_EXT = {
    disk: ['atr', 'xfd', 'atx', 'dcm', 'pro', 'gz', 'dsk'],
    cart: ['car', 'rom', 'bin', 'cart'],
    tape: ['cas'],
    exe: ['xex', 'com', 'exe', 'axe', 'obx', 'bas', 'lst', 'obj'],
  };
  // The file explorer dialogs only offer what each slot can use (plus archives, which are opened for you).
  const acceptOf = (k) => MEDIA_EXT[k].concat(['zip', '7z']).map((e) => '.' + e).join(',');
  for (let n = 1; n <= 8; n++) if ($('f' + n)) $('f' + n).accept = acceptOf('disk');
  for (const n of [1, 2]) if ($('c' + n)) $('c' + n).accept = acceptOf('cart');
  if ($('tape')) $('tape').accept = acceptOf('tape');
  // File types by extension, from Atadim's config; for labelling files on a mounted disk.
  const FILE_TYPES = {
    run: 'exe com xex axe', obj: 'run ini obj bin dat raw obx hyp', font: 'fnt chr sxs', sys: 'sys bat',
    text: 'txt asc ata doc cap tch twr man lis', source: 'lm c cpp h pas lst lb lba lbs lt ltb asm a65 asx',
    basic: 'mac m65 bas tba qa lib',
    picture: 'pic gr3 gr4 gr5 gr6 gr7 gr8 gr9 g10 g11 g12 g13 g14 g15 apc cin ged hip int mic pi1 pi3 rip inp gif jpg bmp tif png g2f mcp plm pzm ilc scr ist tip',
    disk: 'atr atx pro xfd dcm dsk', archive: 'arc', rom: 'rom a52 car',
    music: 'mus cmc tmc tm4 tm8 mpt mod mid rmt sap',
  };
  const fileType = (name) => { const e = (name.split('.').pop() || '').toLowerCase(); return Object.keys(FILE_TYPES).find((k) => FILE_TYPES[k].split(' ').includes(e)) || null; };
  const extKind = (name) => {
    const e = (name.split('.').pop() || '').toLowerCase();
    return Object.keys(MEDIA_EXT).find((k) => MEDIA_EXT[k].includes(e)) || null;
  };
  const typeKind = (t) => ([1, 2, 3, 4, 5, 15, 16].includes(t) ? 'disk' : [6, 7, 8].includes(t) ? 'exe' : [9, 10].includes(t) ? 'cart' : [11, 12].includes(t) ? 'tape' : null);

  // Detects the format from the file contents (extensions are only a hint), then routes it to the right device.
  async function loadAny(file, alt, hint, noBoot) {
    try { await loadAny0(file, alt, hint, noBoot); } catch (e) {
      diag('LOAD FAILED ' + file.name + ': ' + (e && e.stack || e), 'error');
      log('Could not load ' + file.name + ': ' + (e && e.message || e));
    }
  }
  async function loadAny0(file, alt, hint, noBoot) {
    if (!S.emu) {
      // Floppies can be inserted with the computer off (Boot mounts them); cartridges too, since they are only changed while off.
      const kk = hint === 'disk' ? 'disk' : (extKind(file.name) || hint);
      if (kk === 'disk' || kk === 'cart' || kk === 'tape') {
        const bytes = await AC.Progress.read(file, 'Loading ' + file.name);
        if (kk === 'tape') {
          S.tape = { name: file.name, bytes };
          $('tn').textContent = file.name;
          log(`Tape: ${file.name} inserted (power is off; it is read when you press Boot)`);
        } else if (kk === 'disk') {
          const n = typeof alt === 'number' ? alt : alt ? 2 : 1;
          S.disks[n] = { name: file.name, bytes }; S.dirty[n] = false;
          $('d' + n).textContent = file.name;
          log(`D${n}: ${file.name} inserted (power is off; it is read when you press Boot)`);
        } else {
          const slot = typeof alt === 'number' ? 1 : alt ? 2 : 1;
          S.carts[slot] = { name: file.name, bytes, type: null };
          $('cn' + slot).textContent = (slot === 1 ? '1 (main, right): ' : '2 (left): ') + file.name;
          log(`Cart ${slot}: ${file.name} inserted (power is off; it is read when you press Boot)`);
        }
        return;
      }
      S.pending = { file, alt, hint, noBoot };
      log(`${file.name} is queued; it loads when you press Boot`);
      return;
    }
    log('loading ' + file.name + '…');
    const bytes = await AC.Progress.read(file, 'Loading ' + file.name);
    const t = S.emu.detect(file.name, bytes);
    let k = typeKind(t) || hint || extKind(file.name);
    // Cart images can start with 0xFA/0xF9, which the detector mistakes for a DCM disk header.
    if (t === 5 && !/\.dcm$/i.test(file.name) && extKind(file.name) === 'cart') k = 'cart';
    diag(`load "${file.name}" ${bytes.length} bytes, detect=${t}, kind=${k}, first bytes=${[...bytes.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
    if (k !== 'tape' && S.emu.tapeInfo().status) {
      S.emu.tapeEject(); S.tape = null; $('tn').textContent = 'empty'; $('tape').value = ''; $('tpos').textContent = '';
    }
    S.lastExe = null;
    if (k === 'disk') {
      const n = typeof alt === 'number' ? alt : alt ? 2 : 1;
      if (!S.emu.mountDisk(n, file.name, bytes)) { log('could not mount ' + file.name); return; }
      S.disks[n] = { name: file.name, bytes }; S.dirty[n] = false;
      $('d' + n).textContent = file.name;
      if (S.dirty) S.dirty[n] = false;
      log(`D${n}: ${file.name} inserted. Power on or press Cold start to boot from it.`);
      if (AC.DISK_DB) {
        const body = bytes.length > 16 && bytes[0] === 0x96 && bytes[1] === 0x02 ? bytes.subarray(16) : bytes;
        const nm = AC.DISK_DB[crc32(body)];
        if (nm) log('disk recognised: ' + nm);
      }
    } else if (k === 'exe') {
      S.emu.bootFile(file.name, bytes); S.lastExe = { name: file.name, bytes };
      log('running ' + file.name);
    } else if (k === 'cart') {
      await insertCart(typeof alt === 'number' ? 1 : alt ? 2 : 1, file, bytes);
    } else if (k === 'tape') {
      if (!S.emu.tapeInsert(file.name, bytes)) { log('could not read tape ' + file.name); return; }
      $('tn').textContent = file.name; S.tape = { name: file.name, bytes };
      S.emu.tapeBoot();
      log('tape: ' + file.name + ' (booting with Start held; for BASIC tapes reset and use CLOAD)');
    } else log(`${file.name}: unrecognised format${t === 13 || t === 14 ? ' (saved states are not supported)' : ''}`);
  }
  async function loadMedia(files, drive) {
    for (const f of files) await loadAny(f, drive >= 2 ? (drive === 2 ? true : drive) : false, drive ? 'disk' : null);
  }

  // ---- pick menu: right-click or long-press on a file chooses where it goes; a plain click uses #1 ----
  const PM = { el: null, openedAt: 0, suppressClickUntil: 0 };
  function closePick() { if (PM.el) { PM.el.remove(); PM.el = null; } }
  function openPick(x, y, title, items) {
    closePick();
    const m = document.createElement('div');
    m.className = 'pickmenu';
    m.style.cssText = 'position:fixed;z-index:9999;background:#1b1e24;border:1px solid #4a5160;border-radius:8px;box-shadow:0 6px 24px #000a;min-width:200px;max-width:min(92vw,360px);max-height:70vh;overflow:auto;font-size:14px;visibility:hidden';
    const h = document.createElement('div');
    h.textContent = title; h.className = 'dim';
    h.style.cssText = 'padding:6px 10px;font-size:11px;border-bottom:1px solid #2c313b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    m.append(h);
    items.forEach((it) => {
      const r = document.createElement('div');
      r.textContent = it.label;
      r.style.cssText = 'padding:11px 12px;cursor:pointer;border-bottom:1px solid #262a32;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      r.onmouseenter = () => (r.style.background = '#2a2f39');
      r.onmouseleave = () => (r.style.background = '');
      r.onclick = (e) => { e.stopPropagation(); closePick(); it.run(); };
      m.append(r);
    });
    document.body.append(m);
    const w = m.offsetWidth, hh = m.offsetHeight;
    m.style.left = Math.max(4, Math.min(x, innerWidth - w - 4)) + 'px';
    m.style.top = Math.max(4, Math.min(y, innerHeight - hh - 4)) + 'px';
    m.style.visibility = 'visible';
    PM.el = m; PM.openedAt = Date.now();
  }
  ['pointerdown', 'wheel'].forEach((ev) => window.addEventListener(ev, (e) => { if (PM.el && !PM.el.contains(e.target)) closePick(); }, true));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePick(); }, true);
  const driveItems = (pick) => { const out = []; for (let n = 1; n <= 8; n++) out.push({ label: `D${n}: ${(S.disks[n] && S.disks[n].name) || 'empty'}`, run: () => pick(n) }); return out; };
  const targetItems = (kind, getFile, after) => {
    const go = async (fn) => { const fl = await getFile(); if (fl) { await fn(fl); after && after(); } };
    if (kind === 'disk') return [...driveItems((n) => go((fl) => loadAny(fl, n, 'disk'))),
      { label: 'Open in WebAFM (left pane)', run: () => go((fl) => AC.WebAfm.openFile(0, fl)) },
      { label: 'Open in WebAFM (right pane)', run: () => go((fl) => AC.WebAfm.openFile(1, fl)) }];
    if (kind === 'cart') return [1, 2].map((n) => ({ label: `Cart ${n}${n === 1 ? ' (main, right)' : ' (left)'}: ${(S.carts[n] && S.carts[n].name) || 'empty'}`, run: () => go((fl) => insertCart(n, fl)) }));
    if (kind === 'tape') return [{ label: 'Cassette', run: () => go((fl) => loadAny(fl, false, 'tape')) }];
    return [{ label: 'Run program', run: () => go((fl) => loadAny(fl, false, kind)) }];
  };
  // Properties for a media file: name, size and the date it was written/updated (from the scan; files inside an archive show the archive's date).
  function mediaProps(f) {
    const parts = f.name.split('/'), base = parts[parts.length - 1];
    const ci = parts.findIndex((s, i) => i < parts.length - 1 && /\.(zip|7z)$/i.test(s));
    const size = f.size || (f.file && f.file.size) || 0, mod = f.modified || (f.file && f.file.lastModified) || 0;
    const fmtDate = (t) => { const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
    const sz = size >= 1048576 ? ` (${(size / 1048576).toFixed(2)} MB)` : size >= 1024 ? ` (${(size / 1024).toFixed(1)} KB)` : '';
    const rows = [['File name', base], ['Title', f.title || ''], ['Type', f.kind || ''], ['Size', size.toLocaleString() + ' bytes' + sz],
      ['Written / updated', mod ? fmtDate(mod) + (ci >= 0 ? ' (archive date)' : '') : 'unknown — rescan the library to record dates'], ['Location', parts.slice(0, -1).join('/') || '(root)']];
    if (ci >= 0) rows.push(['Inside archive', parts[ci]]);
    closePick();
    const bk = document.createElement('div');
    bk.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#0008;display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:#1b1e24;border:1px solid #4a5160;border-radius:10px;padding:14px 16px;min-width:300px;max-width:min(92vw,560px);box-shadow:0 8px 32px #000b;font-size:13px';
    const h = document.createElement('div'); h.textContent = 'Properties'; h.style.cssText = 'font-weight:600;margin-bottom:8px;color:#e8a33d'; box.append(h);
    for (const [k, v] of rows) {
      if (!v) continue;
      const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:10px;padding:3px 0;border-bottom:1px solid #262a32';
      const a = document.createElement('span'); a.textContent = k; a.className = 'dim'; a.style.cssText = 'width:130px;flex:none';
      const b = document.createElement('span'); b.textContent = v; b.style.cssText = 'word-break:break-all;user-select:text';
      r.append(a, b); box.append(r);
    }
    const ok = document.createElement('button'); ok.textContent = 'OK'; ok.style.cssText = 'margin-top:10px;float:right';
    const done = () => { bk.remove(); window.removeEventListener('keydown', onk, true); };
    const onk = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.stopPropagation(); e.preventDefault(); done(); } };
    ok.onclick = done; bk.onclick = (e) => { if (e.target === bk) done(); };
    box.append(ok); bk.append(box); document.body.append(bk); window.addEventListener('keydown', onk, true); ok.focus();
  }
  // Click = default target (#1 of its kind); right-click / long-press = pick the target.
  function attachLoad(el, f, kind, getFile, after, onClick) {
    const getF = async () => { const fl = await getFile(); if (fl) histAdd(f); return fl; };
    const menu = (x, y) => openPick(x, y, f.name.split('/').pop(), [...targetItems(kind, getF, after), { label: 'Properties…', run: () => mediaProps(f) }]);
    el.onclick = async (e) => {
      if (Date.now() < PM.suppressClickUntil) return;
      const fl = await getF(); if (!fl) return;
      if (onClick) onClick(fl, e); else { loadAny(fl, e.shiftKey, kind); after && after(); }
    };
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (Date.now() - PM.openedAt > 700) menu(e.clientX, e.clientY); });
    let t = null, sx = 0, sy = 0;
    const clear = () => { clearTimeout(t); t = null; };
    el.addEventListener('touchstart', (e) => {
      const p = e.touches[0]; sx = p.clientX; sy = p.clientY; clear();
      t = setTimeout(() => { t = null; PM.suppressClickUntil = Date.now() + 800; if (Date.now() - PM.openedAt > 700) menu(sx, sy); }, 450);
    }, { passive: true });
    el.addEventListener('touchmove', (e) => { const p = e.touches[0]; if (Math.abs(p.clientX - sx) + Math.abs(p.clientY - sy) > 10) clear(); }, { passive: true });
    el.addEventListener('touchend', clear); el.addEventListener('touchcancel', clear);
    el.style.webkitTouchCallout = 'none'; el.style.userSelect = 'none'; el.title = (el.title ? el.title + '\n' : '') + 'Click: load into #1. Right-click or long-press: choose a drive/slot.';
  }
  // Drive pulldowns become a button that opens the pick menu; the hidden input keeps the chosen number in .value.
  function drivePicker(id) {
    const sel = $(id), hid = document.createElement('input'), btn = document.createElement('button');
    hid.type = 'hidden'; hid.id = id; hid.value = '1';
    btn.textContent = 'D1 ▾'; btn.title = 'Choose drive';
    btn.onclick = () => { const r = btn.getBoundingClientRect(); openPick(r.left, r.bottom + 2, 'Drive', driveItems((n) => { hid.value = String(n); btn.textContent = `D${n} ▾`; })); };
    sel.replaceWith(btn, hid);
  }
  ['blankslot', 'fsdrv', 'savedrv'].forEach(drivePicker);

  // ---- media library (scan a folder, filter by text and type) ----
  const MED = { files: [], kind: 'all', ext: 'all', ltype: 'all', lvendor: 'all', view: 'all', showShort: localStorage.getItem('ac.showShort') === '1' };
  // MAME software list titles: short zip/set name -> "Title (year, publisher)"
  let TITLES = {};
  try { TITLES = JSON.parse(localStorage.getItem('ac.titles') || '{}'); } catch (e) { TITLES = {}; }
  const syncTitles = () => { $('medtitles').textContent = `${Object.keys(AC.TITLES_BUILTIN || {}).length} built-in titles (MAME)` + (Object.keys(TITLES).length ? ` + ${Object.keys(TITLES).length} from your XML` : ''); };
  const setKey = (rel) => {
    const parts = rel.split('/');
    const last = parts[parts.length - 1].replace(/\.[^.]+$/, '');
    const zip = parts.length > 1 && /\.(zip|7z)$/i.test(parts[parts.length - 2]) ? parts[parts.length - 2].replace(/\.(zip|7z)$/i, '') : null;
    return [zip, last].filter(Boolean).map((s) => s.toLowerCase());
  };
  // TOSEC names: "Title v1.2 (1984)(Publisher)(US)[a][b]" -> "Title v1.2 (1984, Publisher)"
  const tosecTitle = (rel) => {
    const base = rel.split('/').pop().replace(/\.[^.]+$/, '');
    const m = /^(.+?)\s*\((\d{4}|19xx|20xx|19\d\?|19\d\d-\d\d(?:-\d\d)?)[^)]*\)\s*\(([^)]*)\)/.exec(base);
    if (!m) return '';
    const yr = /x|\?/.test(m[2]) ? '' : m[2].slice(0, 4);
    const pub = /^-$|unknown/i.test(m[3]) ? '' : m[3];
    return m[1] + (yr || pub ? ` (${[yr, pub].filter(Boolean).join(', ')})` : '');
  };
  // Lower is better: [!] verified first, bad dumps / cracks / hacks last.
  const flagRank = (n) => { const b = n.split('/').pop(); return /\[!\]/.test(b) ? 0 : /\[(b|m|t|o)\d*[ \]]|\[(b|m|t|o)\d*\]/.test(b) ? 3 : /\[(cr|h|f|tr)[^\]]*\]/.test(b) ? 2 : 1; };
  const titleFor = (rel) => { for (const k of setKey(rel)) { if (TITLES[k]) return TITLES[k]; if ((AC.TITLES_BUILTIN || {})[k]) return AC.TITLES_BUILTIN[k]; } return tosecTitle(rel); };
  async function loadTitlesXml(files) {
    let n = 0;
    for (const f of files) {
      const doc = new DOMParser().parseFromString(await f.text(), 'text/xml');
      doc.querySelectorAll('software').forEach((s) => {
        const name = (s.getAttribute('name') || '').toLowerCase();
        const d = s.querySelector(':scope > description');
        if (!name || !d) return;
        const y = s.querySelector(':scope > year'), pub = s.querySelector(':scope > publisher');
        const extra = [y && y.textContent !== '????' ? y.textContent : '', pub && !/unknown/i.test(pub.textContent) ? pub.textContent : ''].filter(Boolean).join(', ');
        TITLES[name] = d.textContent + (extra ? ` (${extra})` : '');
        n++;
      });
    }
    try { localStorage.setItem('ac.titles', JSON.stringify(TITLES)); } catch (e) { log('titles too large to remember, but active for this visit'); }
    syncTitles();
    MED.files.forEach((m) => (m.title = titleFor(m.name)));
    renderMed();
    log(`${n} titles loaded`);
  }
  $('medxml').onchange = (e) => loadTitlesXml([...e.target.files]);
  syncTitles();
  // Multi-disk sets: normalise away "disk 2", "side B", "(1 of 3)" so related disks group together.
  const groupKey = (f) => {
    const base = (f.title || f.name.split('/').pop()).replace(/\.[^.]+$/, '').toLowerCase();
    return base
      .replace(/\s*\((\d{4}|19xx|20xx)[^)]*\)\s*$/, '')
      .replace(/\s+v\d+(\.\d+)*[a-z]?\b/g, ' ')
      .replace(/\([^)]*(dis[ck]|side|part|\d\s*of\s*\d)[^)]*\)/g, ' ')
      .replace(/[\s._-]*\b(dis[ck]|side|part)[\s._-]*[0-9a-z]\b/g, ' ')
      .replace(/[\s._-]+(d|s)?[0-9ab]$/g, ' ')
      .replace(/\s+/g, ' ').trim();
  };
  const zipOf = (n) => { const p = n.split('/'); return p.length > 1 && /\.(zip|7z)$/i.test(p[p.length - 2]) ? p.slice(0, -1).join('/') : ''; };
  function showRelated(f) {
    const box = $('medrel');
    box.innerHTML = '';
    if (f.kind !== 'disk') return;
    const key = groupKey(f), zp = zipOf(f.name);
    const rel = MED.files.filter((m) => m !== f && m.kind === 'disk' && ((zp && zipOf(m.name) === zp) || (key.length >= 3 && groupKey(m) === key)));
    if (!rel.length) return;
    const h = document.createElement('div');
    h.className = 'dim'; h.style.cssText = 'font-size:11px;margin-top:4px';
    h.textContent = 'Other disks in this set (click = load into D2 without rebooting, Shift = D1):';
    box.append(h);
    rel.slice(0, 12).forEach((m) => {
      const d = document.createElement('div');
      d.textContent = (m.name.split('/').pop()) + (m.title ? ` — ${m.title}` : '');
      d.title = m.name;
      d.style.cssText = 'padding:3px 4px;cursor:pointer;font-size:12px;border-bottom:1px solid #2c313b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--acc)';
      attachLoad(d, m, 'disk', () => fileOf(m), null, (fl, e) => loadAny(fl, !e.shiftKey, 'disk', true));
      box.append(d);
    });
  }
  // Tree view: folders from the file paths at any depth, expanded lazily. With a search active, matching branches open automatically.
  MED.tree = localStorage.getItem('ac.medtree') !== '0';
  MED.open = new Set();
  const treeOf = (hits) => {
    const root = { dirs: new Map(), files: [], n: 0, path: '' };
    hits.forEach((f) => {
      const parts = f.name.split('/');
      let node = root;
      node.n++;
      for (let i = 0; i < parts.length - 1; i++) {
        let nx = node.dirs.get(parts[i]);
        if (!nx) { nx = { dirs: new Map(), files: [], n: 0, path: parts.slice(0, i + 1).join('/') }; node.dirs.set(parts[i], nx); }
        node = nx;
        node.n++;
      }
      node.files.push(f);
    });
    return root;
  };
  const allDirs = (node, out) => { node.dirs.forEach((d) => { out.push(d.path); allDirs(d, out); }); return out; };
  function drawTree(box, hits, forceOpen, ctx) {
    const root = treeOf(hits);
    const OPEN = ctx ? ctx.open : MED.open, REDRAW = ctx ? ctx.redraw : renderMed;
    if (!ctx) window.__medTreeRoot = root;
    const TREE_FILE_CAP = 400;
    const row = (depth, text, title) => {
      const d = document.createElement('div');
      d.textContent = text;
      d.title = title || text;
      d.style.cssText = `padding:2px 4px 2px ${4 + depth * 14}px;cursor:pointer;font-size:12px;border-bottom:1px solid #2c313b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
      d.onmouseenter = () => (d.style.background = '#2a2f39');
      d.onmouseleave = () => (d.style.background = '');
      box.append(d);
      return d;
    };
    const walk = (node, depth) => {
      [...node.dirs.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).forEach((name) => {
        const d = node.dirs.get(name);
        const open = forceOpen || OPEN.has(d.path);
        const r = row(depth, `${open ? '📂' : '📁'} ${name}  (${d.n})`, d.path);
        r.style.color = 'var(--acc)';
        r.onclick = () => { if (OPEN.has(d.path)) OPEN.delete(d.path); else OPEN.add(d.path); REDRAW(); };
        if (open) walk(d, depth + 1);
      });
      const files = node.files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      const used = new Set();
      files.slice(0, TREE_FILE_CAP).forEach((f) => {
        const base = shown(f.name.split('/').pop(), used);
        const ico = { disk: '💾', cart: '🎮', tape: '📼', exe: '⚙️' }[f.kind] || '📄';
        const r = row(depth, f.title ? `${ico} ${base} — ${f.title}` : `${ico} ${base}`, f.title ? `${f.title} — ${f.name}` : longTip(f));
        r.style.paddingLeft = `${4 + depth * 14 + 14}px`;
        attachLoad(r, f, f.kind, () => fileOf(f), ctx ? undefined : () => showRelated(f));
      });
      if (files.length > TREE_FILE_CAP) row(depth, `… ${files.length - TREE_FILE_CAP} more here: use the search box`).style.opacity = 0.6;
    };
    walk(root, 0);
    return root;
  }
  // Reads our "Type - Name - Vendor - Version - Release (notes)" names and TOSEC "Title vX (date)(publisher)(...)[flags]" names.
  const DUMP_FLAGS = { cr: 'cracked', f: 'fixed', h: 'hacked', m: 'modified', p: 'pirated', t: 'trained', tr: 'translated', o: 'over dump', u: 'under dump', v: 'virus', b: 'bad dump', a: 'alternate', '!': 'verified dump' };
  function parseTosec(base) {
    const m = /^(.*?)\s*((?:\((?:[^()]*)\)\s*)+)((?:\[[^\]]*\]\s*)*)$/.exec(base);
    if (!m) return null;
    const groups = [...m[2].matchAll(/\(([^()]*)\)/g)].map((g) => g[1]);
    const di = groups.findIndex((g) => /^(?:\d{4}|\d{3}x|19xx|20xx)(?:-\d\d(?:-[\dx]\d?)?)?$/.test(g));
    if (di < 0 || di + 1 >= groups.length) return null;
    const flags = [...m[3].matchAll(/\[([^\]]*)\]/g)].map((g) => g[1]);
    const notes = flags.map((f) => DUMP_FLAGS[f.split(' ')[0]] || f).concat(groups.slice(di + 2)).join(', ');
    const tv = /^(.*?)\s+((?:v\d[\w.]*|Rev [\w.]+))$/.exec(m[1]);
    return { type: 'Software', name: tv ? tv[1] : m[1], vendor: groups[di + 1], version: tv ? tv[2] : 'no version', release: groups[di], notes, tosec: true };
  }
  function parseLongName(path) {
    const base = path.split('/').pop().replace(/\.[^.]+$/, '');
    const p = base.split(' - ');
    if (p.length < 5 || !/^(OS|Firmware|Language|Cartridge|Game|Educational|Business|Utility|Software)$/.test(p[0])) return parseTosec(base);
    const m = /^(.*?)\s*\(([^)]*)\)$/.exec(p.slice(4).join(' - '));
    return { type: p[0], name: p[1], vendor: p[2], version: p[3], release: m ? m[1] : p.slice(4).join(' - '), notes: m ? m[2] : '' };
  }
  // Ctrl+L mode: prefix the 8.3 name the disk would get (unique per `used` set, i.e. per folder).
  const shown = (base, used) => (MED.showShort ? `${AC.DosFs.to83(base, used)}  ${base}` : base);
  const longTip = (f) => { const l = parseLongName(f.name); return l ? `${l.type}: ${l.name}\nVendor: ${l.vendor}\nVersion: ${l.version}\nRelease: ${l.release}${l.notes ? '\nNotes: ' + l.notes : ''}\n${f.name}` : f.name; };
  function fillSel(id, label, counts, key) {
    const s = $(id); s.innerHTML = '';
    const o0 = document.createElement('option'); o0.value = 'all'; o0.textContent = label; s.append(o0);
    Object.keys(counts).sort().forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = `${v} (${counts[v]})`; s.append(o); });
    s.value = MED[key] in counts ? MED[key] : 'all'; MED[key] = s.value;
    s.onchange = () => { MED[key] = s.value; renderMed(); };
  }
  // Space-separated terms must all match; * = any run of characters, ? = one character.
  function textMatcher(q) {
    const res = q.split(/\s+/).filter(Boolean).map((t) => new RegExp(t.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.'), 'i'));
    return (s) => res.every((r) => r.test(s));
  }
  // Library view state (search, filters, open folders, scroll, large view) and the recently-used list survive reloads.
  const MEDS = (() => { try { return JSON.parse(localStorage.getItem('ac.medstate') || '{}'); } catch (e) { return {}; } })();
  const medSave = () => {
    if (!MED.files.length) return;
    MEDS.view = MED.view; MEDS.q = $('medfilter').value; MEDS.kind = MED.kind; MEDS.ext = MED.ext; MEDS.ltype = MED.ltype; MEDS.lvendor = MED.lvendor; MEDS.open = [...MED.open];
    localStorage.setItem('ac.medstate', JSON.stringify(MEDS));
  };
  const histGet = () => { try { return JSON.parse(localStorage.getItem('ac.medhist') || '[]'); } catch (e) { return []; } };
  const freqGet = () => { try { return JSON.parse(localStorage.getItem('ac.medfreq') || '{}'); } catch (e) { return {}; } };
  const isHistView = () => MED.view === 'hist' || MED.view === 'freq';
  function histAdd(f) {
    if (!f || !f.name) return;
    const h = histGet().filter((x) => x.name !== f.name);
    h.unshift({ name: f.name, kind: f.kind, title: f.title || '' });
    localStorage.setItem('ac.medhist', JSON.stringify(h.slice(0, 100)));
    const fq = freqGet();
    fq[f.name] = { n: ((fq[f.name] && fq[f.name].n) || 0) + 1, kind: f.kind, title: f.title || '' };
    const keep = Object.entries(fq).sort((a, b) => b[1].n - a[1].n).slice(0, 300);
    localStorage.setItem('ac.medfreq', JSON.stringify(Object.fromEntries(keep)));
    renderHist(); if (isHistView()) renderMed();
  }
  // All / History / Frequent switch above the list: History and Frequent are the same list (filters, tree/flat) limited to what you loaded.
  function renderHist() {
    const box = $('medhist'), n = histGet().length, nf = Object.keys(freqGet()).length;
    box.innerHTML = '';
    const mk = (v, label) => {
      const b = document.createElement('button');
      b.textContent = label; b.className = MED.view === v ? 'on' : '';
      b.onclick = () => { MED.view = v; renderHist(); renderMed(); };
      return b;
    };
    box.append(mk('all', 'ALL'), mk('hist', `HISTORY (${n})`), mk('freq', `FREQUENT (${nf})`));
    if (isHistView() && (n || nf)) {
      const clr = document.createElement('button'); clr.textContent = MED.view === 'freq' ? 'Clear counts' : 'Clear history';
      clr.onclick = () => { localStorage.removeItem(MED.view === 'freq' ? 'ac.medfreq' : 'ac.medhist'); renderHist(); renderMed(); };
      box.append(clr);
    }
  }
  const histFiles = () => {
    let h = histGet();
    const fq = freqGet();
    if (MED.view === 'freq') h = Object.entries(fq).sort((a, b) => b[1].n - a[1].n).map(([name, v]) => ({ name, kind: v.kind, title: v.title }));
    return h.map((x) => { const m = MED.files.find((f) => f.name === x.name) || { name: x.name, kind: x.kind, title: x.title, file: null }; return MED.view === 'freq' && fq[x.name] ? Object.assign({}, m, { title: `×${fq[x.name].n}${(m.title || x.title) ? ' ' + (m.title || x.title) : ''}` }) : m; });
  };
  function renderMed() { renderMed0(); medSave(); }
  function renderMed0() {
    const q = $('medfilter').value.toLowerCase();
    if (!MED.files.length && !isHistView()) { $('medlist').innerHTML = ''; $('medcount').textContent = 'no folder'; return; }
    const base = isHistView() ? histFiles() : MED.files;
    const qm = textMatcher(q);
    const box = $('medlist');
    box.innerHTML = '';
    $('medview').textContent = MED.tree ? '☰' : '🗂';
    $('medview').title = MED.tree ? 'Tree view (click for flat list)' : 'List view (click for folder tree)';
    ['medexpand', 'medcollapse'].forEach((id) => ($(id).style.display = MED.tree ? '' : 'none'));
    box.style.maxHeight = MED.tree ? '360px' : '200px';
    const extOf = (f) => (f.name.split('.').pop() || '').toLowerCase();
    const ofKind = base.filter((f) => MED.kind === 'all' || f.kind === MED.kind);
    const counts = {};
    ofKind.forEach((f) => { const e = extOf(f); counts[e] = (counts[e] || 0) + 1; });
    if (MED.ext !== 'all' && !counts[MED.ext]) MED.ext = 'all';
    const eb = $('medextsel');
    eb.innerHTML = '';
    const exts = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const o0 = document.createElement('option');
    o0.value = 'all'; o0.textContent = `All extensions (${ofKind.length})`;
    eb.append(o0);
    exts.forEach((e) => {
      const o = document.createElement('option');
      o.value = e; o.textContent = `.${e} (${counts[e]})`;
      eb.append(o);
    });
    eb.value = MED.ext;
    eb.onchange = () => { MED.ext = eb.value; renderMed(); };
    $('medkind').value = MED.kind;
    const tc = {}, vc = {};
    ofKind.forEach((f) => { const l = parseLongName(f.name); if (l) { tc[l.type] = (tc[l.type] || 0) + 1; vc[l.vendor] = (vc[l.vendor] || 0) + 1; } });
    fillSel('medtypesel', `All media types (${Object.keys(tc).length})`, tc, 'ltype');
    fillSel('medvendsel', `All vendors (${Object.keys(vc).length})`, vc, 'lvendor');
    ['medtypesel', 'medvendsel'].forEach((id) => ($(id).parentElement.style.display = Object.keys(tc).length ? '' : 'none'));
    const hits = ofKind.filter((f) => {
      if (MED.ext !== 'all' && extOf(f) !== MED.ext) return false;
      if (MED.ltype !== 'all' || MED.lvendor !== 'all') {
        const l = parseLongName(f.name);
        if (!l || (MED.ltype !== 'all' && l.type !== MED.ltype) || (MED.lvendor !== 'all' && l.vendor !== MED.lvendor)) return false;
      }
      return qm(f.name + ' ' + (f.title || ''));
    });
    if (q && !isHistView()) hits.sort((a, b) => flagRank(a.name) - flagRank(b.name));
    if (MED.tree) {
      drawTree(box, hits, !!q && hits.length <= 600);
      $('medcount').textContent = MED.files.length ? `${MED.fromDb ? 'catalog: ' : ''}${hits.length} of ${base.length}` : 'no folder';
      return;
    }
    const usedByDir = new Map();
    hits.slice(0, 300).forEach((f) => {
      const d = document.createElement('div');
      const dir = f.name.split('/').slice(0, -1).join('/');
      if (!usedByDir.has(dir)) usedByDir.set(dir, new Set());
      const nm = shown(f.name.split('/').pop(), usedByDir.get(dir));
      d.textContent = f.title ? `${f.title} — ${nm}` : MED.showShort ? nm : f.name;
      d.title = longTip(f);
      d.style.cssText = 'padding:3px 4px;cursor:pointer;font-size:12px;border-bottom:1px solid #2c313b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      d.onmouseenter = () => (d.style.background = '#2a2f39');
      d.onmouseleave = () => (d.style.background = '');
      attachLoad(d, f, f.kind, () => fileOf(f), () => showRelated(f));
      box.append(d);
    });
    $('medcount').textContent = MED.files.length ? `${MED.fromDb ? 'catalog: ' : ''}${hits.length} of ${base.length}${hits.length > 300 ? ' (showing 300)' : ''}` : 'no folder';
  }
  // Remembered folder: the directory handle lives in IndexedDB (needs the File System Access API).
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('ataricraft-media', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const idbGet = async (k) => { const db = await idb(); return new Promise((res) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); };
  const idbSet = async (k, v) => { const db = await idb(); return new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); }); };
  // ---- media catalog (SQLite, saved in the browser) ----
  // Entries loaded from the catalog have no File yet: resolve it from the remembered folder when clicked.
  let arcCache = null;
  // Server library: a web server hosts library/ (catalog.sqlite, optional library.json, software/ and bios/ folders). SRV is its base URL.
  let SRV = null, srvLast = null, SRVMAP = {};
  async function fileOf(m) {
    if (m.file) return m.file;
    try {
      const parts = m.name.split('/');
      let f, i = 1, base;
      if (SRV) {
        while (i < parts.length - 1 && !/\.(zip|7z)$/i.test(parts[i])) i++;
        base = parts.slice(0, i + 1).join('/');
        if (srvLast && srvLast.base === base) f = srvLast.file;
        else {
          const r = await fetch(SRV + encodeURIComponent(SRVMAP[parts[0]] || parts[0]) + '/' + parts.slice(1, i + 1).map(encodeURIComponent).join('/'));
          if (!r.ok) throw new Error('server returned ' + r.status);
          f = new File([await r.blob()], parts[i]);
          Object.defineProperty(f, 'webkitRelativePath', { value: base });
          srvLast = { base, file: f };
        }
      } else {
        const root = medHandles[parts[0]] || (medHandle && medHandle.name === parts[0] ? medHandle : null);
        if (!root) throw new Error('folder ' + parts[0] + ' is not remembered on this computer');
        if ((await root.queryPermission({ mode: 'read' })) !== 'granted' && (await root.requestPermission({ mode: 'read' })) !== 'granted') throw new Error('folder access not granted');
        let h = root;
        for (; i < parts.length; i++) {
          if (/\.(zip|7z)$/i.test(parts[i]) && i < parts.length - 1) break;
          if (i === parts.length - 1) break;
          h = await h.getDirectoryHandle(parts[i]);
        }
        base = parts.slice(0, i + 1).join('/');
        f = await (await h.getFileHandle(parts[i])).getFile();
        Object.defineProperty(f, 'webkitRelativePath', { value: base });
      }
      if (i < parts.length - 1) {
        const member = parts.slice(i + 1).join('/');
        const Z = /\.7z$/i.test(parts[i]) ? AC.SevenZip : AC.Zip;
        const arc = f;
        if (!arcCache || arcCache.path !== base) arcCache = { path: base, ents: await Z.list(arc) };
        const ent = arcCache.ents.find((x) => x.name === member);
        if (!ent) throw new Error('not in archive');
        f = { name: member.split('/').pop(), webkitRelativePath: m.name, size: ent.size, arrayBuffer: () => Z.extract(arc, ent) };
      }
      m.file = f;
      return f;
    } catch (e) {
      log(`cannot open "${m.name}": ${e.message}. Use Rescan to rebuild the catalog.`);
      diag(`catalog open failed ${m.name}: ${e.name} ${e.message}`, 'warn');
      return null;
    }
  }
  const catRow = (f) => {
    const parts = f.name.split('/');
    const ci = parts.findIndex((s, i) => i < parts.length - 1 && /\.(zip|7z)$/i.test(s));
    return { path: f.name, name: parts[parts.length - 1], ext: (parts[parts.length - 1].split('.').pop() || '').toLowerCase(), kind: f.kind, size: f.size || (f.file && f.file.size) || 0, modified: f.modified || (f.file && f.file.lastModified), container: ci >= 0 ? parts.slice(0, ci + 1).join('/') : '', title: f.title || '', grp: groupKey(f) };
  };
  async function saveCatalog() {
    const sp = AC.Progress.begin('Saving catalog…', MED.files.length);
    try {
      await AC.Catalog.rebuild(MED.files.map(catRow), { root: Object.keys(medHandles).join(', ') || (medHandle ? medHandle.name : ''), scanned: new Date().toISOString(), count: MED.files.length }, (d) => sp.set(d), [...ARC.values()]);
      sp.text('Writing catalog to browser storage…');
      await AC.Progress.yieldUI();
      await idbSet('catalogDb', await AC.Catalog.exportBytes());
      MED.fromDb = false;
      diag(`catalog saved: ${MED.files.length} rows`);
    } catch (e) { diag('catalog save failed: ' + e.message, 'warn'); log('could not save catalog: ' + e.message); }
    finally { sp.end(); }
  }
  async function loadCatalogRows() {
    const bytes = await idbGet('catalogDb');
    if (!bytes) return false;
    await AC.Catalog.open(bytes);
    return useCatalog();
  }
  async function useCatalog() {
    const rows = await AC.Catalog.rows('SELECT path, kind, size, title, modified FROM files');
    const meta = Object.fromEntries((await AC.Catalog.rows('SELECT k, v FROM meta')).map((r) => [r.k, r.v]));
    if (!rows.length) return false;
    MED.files = rows.map((r) => ({ name: r.path, file: null, kind: r.kind, size: r.size, modified: r.modified || 0, title: titleFor(r.path) || r.title }));
    MED.fromDb = true;
    renderMed();
    log(`library loaded from saved catalog: ${rows.length} items${meta.scanned ? ' (scanned ' + meta.scanned.slice(0, 16).replace('T', ' ') + ')' : ''}. Rescan to rebuild.`);
    return true;
  }

  // Big trees: only keep media-looking files (checked by name, nothing is opened), skip system folders, show progress, allow Stop.
  const SCAN_CAP = 150000;
  const SCAN_SKIP = /^(\$recycle\.bin|system volume information|node_modules|\.git|windows|program files.*)$/i;
  const SCAN_EXT = new Set([...Object.values(MEDIA_EXT).flat(), 'zip', '7z']);
  const scanWant = (name) => SCAN_EXT.has((name.split('.').pop() || '').toLowerCase()) || /^a(800|5200)[^/]*\.xml$/i.test(name);
  const scanSt = { stop: false, seen: 0, keep: 0, errs: 0, tick: 0 };
  // Folder rules: {path/: true|false}. The nearest explicit rule on a folder or its ancestors wins; the default is include.
  let medRules = {};
  const ruleFor = (rules, path) => {
    let best = '', val = true;
    for (const k in rules) if (path.startsWith(k) && k.length >= best.length) { best = k; val = rules[k]; }
    return val;
  };
  const anyIncludeUnder = (rules, path) => Object.keys(rules).some((k) => rules[k] && k.startsWith(path));
  async function walkDir(h, path, out, rules) {
    const inc = ruleFor(rules, path);
    try {
      for await (const [name, e] of h.entries()) {
        if (scanSt.stop || out.length >= SCAN_CAP) return;
        if (e.kind === 'directory') {
          const sub = path + name + '/';
          if (SCAN_SKIP.test(name) || name.startsWith('.')) continue;
          if (!ruleFor(rules, sub) && !anyIncludeUnder(rules, sub)) continue;
          await walkDir(e, sub, out, rules);
          continue;
        }
        if (!inc) continue;
        scanSt.seen++;
        if (Date.now() - scanSt.tick > 150) await scanTick(path, out.length);
        if (!scanWant(name)) continue;
        try {
          const f = await e.getFile();
          Object.defineProperty(f, 'webkitRelativePath', { value: path + name });
          out.push(f);
        } catch (err) { scanSt.errs++; diag(`scan skipped file "${path + name}": ${err.name} ${err.message}`, 'warn'); continue; }
      }
    } catch (err) { scanSt.errs++; diag(`scan skipped folder "${path}": ${err.name} ${err.message}`, 'warn'); }
  }
  async function scanTick(path, found) {
    scanSt.tick = Date.now();
    const s = `${found} found, ${scanSt.seen} checked`;
    $('medcount').textContent = `scanning… ${s} - ${path}`;
    if (scanSt.prog) { scanSt.prog.text('Scanning ' + path); scanSt.prog.note(s); }
    await new Promise((r) => setTimeout(r));
  }
  async function scanHandle(h, interactive) {
    let p = await h.queryPermission({ mode: 'read' });
    if (p !== 'granted' && interactive) p = await h.requestPermission({ mode: 'read' });
    if (p !== 'granted') { $('medcount').textContent = `"${h.name}" remembered: click Refresh to allow access`; return false; }
    $('medcount').textContent = 'scanning…';
    scanSt.stop = false; scanSt.seen = 0; scanSt.errs = 0;
    $('medstop').style.display = '';
    const out = [];
    const sp = AC.Progress.begin('Scanning "' + h.name + '"…');
    scanSt.prog = sp;
    try { await walkDir(h, h.name + '/', out, medRules); } finally { sp.end(); scanSt.prog = null; $('medstop').style.display = 'none'; }
    if (scanSt.stop) log(`scan stopped: ${out.length} files kept`);
    else if (out.length >= SCAN_CAP) log(`scan capped at ${SCAN_CAP} files: pick a smaller folder for the rest`);
    diag(`scan "${h.name}": ${scanSt.seen} files checked, ${out.length} media candidates, ${scanSt.errs} unreadable skipped`);
    if (scanSt.errs) log(`${scanSt.errs} unreadable files/folders skipped (see Save log for names)`);
    await scanMedia(out, true, h.name);
    return true;
  }
  $('medstop').onclick = () => { scanSt.stop = true; };
  let medHandle = null;
  const medHandles = {};

  // Folder chooser: lazy tree of sub-folders with check boxes. Shift-click = range among siblings, Ctrl-click = only this one.
  function chooseFolders(h) {
    return new Promise((resolve) => {
      const rules = { ...medRules };
      const root = { name: h.name, path: h.name + '/', handle: h, kids: null, open: true, parent: null };
      const dlg = document.createElement('div');
      dlg.id = 'scandlg';
      dlg.innerHTML = '<div class="box"><b>Choose what to scan in "' + h.name.replace(/</g, '&lt;') + '"</b><div class="dim" style="font-size:12px">Tick folders to include. Shift-click ticks a range of folders at the same level; Ctrl-click selects only that folder. Click ▸ to open a folder.</div><div class="row"><button data-a="all">Tick all</button><button data-a="none">Untick all</button><button data-a="exp">Open all loaded</button><span class="dim" id="scsum"></span></div><div class="tree"></div><div class="row" style="justify-content:flex-end"><button data-a="cancel">Cancel</button><button data-a="go" class="on">Scan</button></div></div>';
      document.body.append(dlg);
      const tree = dlg.querySelector('.tree');
      const eff = (n) => ruleFor(rules, n.path);
      const mixed = (n) => { const v = eff(n); return Object.keys(rules).some((k) => k.startsWith(n.path) && k !== n.path && rules[k] !== v); };
      const setNode = (n, v) => { for (const k of Object.keys(rules)) if (k.startsWith(n.path)) delete rules[k]; if (ruleFor(rules, n.path) !== v || n === root) rules[n.path] = v; };
      let last = null;
      async function load(n) {
        if (n.kids) return;
        n.kids = [];
        try {
          for await (const [name, en] of n.handle.entries()) {
            if (en.kind !== 'directory' || SCAN_SKIP.test(name) || name.startsWith('.')) continue;
            n.kids.push({ name, path: n.path + name + '/', handle: en, kids: null, open: false, parent: n });
            if (n.kids.length >= 3000) break;
          }
        } catch (e) { diag('folder list failed ' + n.path + ': ' + e.message, 'warn'); }
        n.kids.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      }
      function draw(n, depth) {
        const row = document.createElement('div');
        row.className = 'nd'; row.style.paddingLeft = depth * 18 + 'px';
        const tg = document.createElement('span'); tg.className = 'tg'; tg.textContent = n.open ? '▾' : '▸';
        tg.onclick = async () => { n.open = !n.open; if (n.open) await load(n); render(); };
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = eff(n); cb.indeterminate = mixed(n);
        cb.onclick = (ev) => {
          ev.preventDefault();
          const sibs = n.parent ? n.parent.kids : [n];
          if (ev.ctrlKey || ev.metaKey) { sibs.forEach((s) => setNode(s, s === n)); setNode(n, true); }
          else if (ev.shiftKey && last && last.parent === n.parent && n.parent) {
            const a = sibs.indexOf(last), b = sibs.indexOf(n), v = !eff(n);
            for (let i = Math.min(a, b); i <= Math.max(a, b); i++) setNode(sibs[i], v);
          } else setNode(n, !eff(n));
          last = n; render();
        };
        const lb = document.createElement('label'); lb.textContent = n.name; lb.onclick = () => cb.click();
        row.append(tg, cb, lb);
        tree.append(row);
        if (n.open && n.kids) { if (!n.kids.length) { const d = document.createElement('div'); d.className = 'dim'; d.style.cssText = `padding-left:${(depth + 1) * 18 + 20}px;font-size:12px`; d.textContent = '(no sub-folders)'; tree.append(d); } n.kids.forEach((k) => draw(k, depth + 1)); }
      }
      function render() {
        const sc = tree.scrollTop;
        tree.innerHTML = '';
        draw(root, 0);
        tree.scrollTop = sc;
        const off = Object.keys(rules).filter((k) => !rules[k]).length;
        dlg.querySelector('#scsum').textContent = off ? off + ' excluded' : 'everything included';
      }
      const loaded = (n, f) => { f(n); (n.kids || []).forEach((k) => loaded(k, f)); };
      dlg.onclick = async (ev) => {
        const a = ev.target.dataset && ev.target.dataset.a;
        if (!a) return;
        if (a === 'all') { for (const k of Object.keys(rules)) delete rules[k]; render(); }
        else if (a === 'none') { for (const k of Object.keys(rules)) delete rules[k]; rules[root.path] = false; render(); }
        else if (a === 'exp') { loaded(root, (n) => { if (n.kids && n.kids.length) n.open = true; }); render(); }
        else { dlg.remove(); document.removeEventListener('keydown', esc, true); if (a === 'go') { medRules = rules; idbSet('medRules', { name: h.name, rules }); } resolve(a === 'go'); }
      };
      const esc = (ev) => { if (ev.key === 'Escape') dlg.querySelector('[data-a=cancel]').click(); };
      document.addEventListener('keydown', esc, true);
      load(root).then(render);
    });
  }
  const srvReady = (async () => {
    if (!/^https?:$/.test(location.protocol)) return;
    try {
      let base = null, man = { catalog: 'catalog.sqlite', bios: [] }, cr = null;
      // The library may sit in web/library/ or directly in web/ (software/, bios/ … beside index.html).
      for (const cand of [new URL('library/', location.href).href, new URL('./', location.href).href]) {
        const mr = await fetch(cand + 'library.json', { cache: 'no-store' }).catch(() => null);
        const m = Object.assign({ catalog: 'catalog.sqlite', bios: [] }, mr && mr.ok ? await mr.json().catch(() => ({})) : {});
        const c = await fetch(cand + encodeURI(m.catalog), { cache: 'no-store' }).catch(() => null);
        if (c && c.ok) { base = cand; man = m; cr = c; break; }
      }
      if (!cr) { $('medcount').textContent = 'no server catalog yet: run server.html (from a local copy of web/) to build catalog.sqlite'; return; }
      SRVMAP = man.map || {};
      await AC.Catalog.open(new Uint8Array(await cr.arrayBuffer()));
      SRV = base;
      if (!(await useCatalog())) { SRV = null; return; }
      $('medcount').textContent = 'server library: ' + $('medcount').textContent.replace(/^catalog: /, '');
      const roms = [];
      for (const p of man.bios) {
        try {
          const r = await fetch(base + p.split('/').map(encodeURIComponent).join('/'));
          if (!r.ok) continue;
          const f = new File([await r.blob()], p.split('/').pop());
          Object.defineProperty(f, 'webkitRelativePath', { value: p });
          roms.push(f);
        } catch (e) { /* skip */ }
      }
      if (roms.length) { await addRoms(roms); log(`server BIOS: ${roms.length} files checked`); }
    } catch (e) { diag('server library not used: ' + e.message); }
  })();
  if (window.showDirectoryPicker) {
    $('medpick').style.display = '';
    $('medsel').style.display = '';
    $('medpick').onclick = async () => {
      let h;
      try { h = await showDirectoryPicker({ id: 'ataricraft-media', mode: 'read' }); } catch (e) { return; }
      if (!medHandle || !(await medHandle.isSameEntry(h))) medRules = {};
      medHandle = h;
      medHandles[h.name] = h;
      await idbSet('medDir', h);
      await idbSet('medDirs', medHandles);
      if (await chooseFolders(h)) await scanHandle(h, true);
      else $('medcount').textContent = `"${h.name}" picked, not scanned: use Folders… or Refresh`;
    };
    $('medsel').onclick = async () => {
      if (!medHandle) { log('no folder yet: use Pick folder…'); return; }
      if ((await medHandle.queryPermission({ mode: 'read' })) !== 'granted' && (await medHandle.requestPermission({ mode: 'read' })) !== 'granted') return;
      if (await chooseFolders(medHandle)) await scanHandle(medHandle, true);
    };
    $('medrefresh').onclick = async () => {
      if (!medHandle) { log('no remembered folder yet: use Pick folder…'); return; }
      try { for (const h of Object.values(medHandles).length ? Object.values(medHandles) : [medHandle]) await scanHandle(h, true); log('library refreshed'); } catch (e) { log('refresh failed: ' + e.message); }
    };
    idbGet('medDir').then(async (h) => {
      await srvReady;
      if (!h && !SRV) {
        // Browsers only allow the folder picker after a click, so a first-run scan can't start by itself: point at the button instead.
        $('medcount').textContent = 'no library yet: click Pick folder… to choose and scan your folder';
        $('medpick').classList.add('pulse');
        $('medpick').addEventListener('click', () => $('medpick').classList.remove('pulse'), { once: true });
        return;
      }
      if (!h || SRV) return;
      medHandle = h;
      Object.assign(medHandles, (await idbGet('medDirs')) || {}, { [h.name]: h });
      const r = await idbGet('medRules');
      if (r && r.name === h.name) medRules = r.rules || {};
      try { if (!(await loadCatalogRows())) await scanHandle(h, false); } catch (e) { $('medcount').textContent = `"${h.name}" remembered: click Rescan`; }
    });
  }  $('medexp').onclick = async () => {
    try {
      const blob = new Blob([await AC.Catalog.exportBytes()], { type: 'application/x-sqlite3' });
      const name = 'ataricraft-library.sqlite';
      if (window.showSaveFilePicker) {
        try { const fh = await showSaveFilePicker({ suggestedName: name, id: 'ataricraft-diag' }); const w = await fh.createWritable(); await w.write(blob); await w.close(); log('catalog exported: ' + fh.name); return; } catch (e) { if (e.name === 'AbortError') return; }
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
      log('catalog downloaded: ' + name);
    } catch (e) { log('export failed: ' + e.message); }
  };
  $('medimp').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const bytes = await AC.Progress.read(f, 'Importing catalog ' + f.name);
      await AC.Catalog.open(bytes);
      if (!(await useCatalog())) { log('that catalog is empty'); return; }
      await idbSet('catalogDb', bytes);
    } catch (err) { log('import failed: ' + err.message); }
  };  $('medfolder').onchange = (e) => scanMedia([...e.target.files]);
  // Cartridges with no title from names/MAME: identify by CRC32 of the ROM (header-less, or after a 16-byte CART header).
  async function identifyCarts(list) {
    const db = AC.CART_DB || {};
    const todo = list.filter((f) => f.kind === 'cart' && !f.title && f.file && f.file.size <= 1048576 && /\.(bin|rom|car)$/i.test(f.name));
    if (!todo.length) return;
    let hit = 0;
    for (let i = 0; i < todo.length; i++) {
      try {
        const b = new Uint8Array(await todo[i].file.arrayBuffer());
        const hdr = b.length > 16 && b[0] === 67 && b[1] === 65 && b[2] === 82 && b[3] === 84;
        const c1 = crc32(b), c2 = hdr ? crc32(b.subarray(16)) : null;
        const e = db[c1] || (c2 && db[c2]);
        const nm = (AC.CART_NAMES || {})[c1] || (c2 && (AC.CART_NAMES || {})[c2]);
        if (e) { todo[i].title = e[2] + (e[3] ? ` (${e[3]})` : ''); hit++; }
        else if (nm) { todo[i].title = nm[0] + (nm[1] || nm[2] ? ` (${[nm[2], nm[1]].filter(Boolean).join(', ')})` : ''); hit++; }
      } catch (err) { /* unreadable file: leave untitled */ }
      if (i % 50 === 49) { log(`identifying cartridges by CRC: ${i + 1}/${todo.length}`); await new Promise((r) => setTimeout(r, 0)); }
    }
    log(`cartridges identified by CRC: ${hit} of ${todo.length} untitled`);
  }
  async function scanMedia(all, persist, root) {
    const xmls = all.filter((f) => /(^|[\\/])a(800|5200)[^\\/]*\.xml$/i.test(f.webkitRelativePath || f.name));
    if (xmls.length) await loadTitlesXml(xmls);
    const files = await expandZips(all);
    const fresh = files.map((f) => { const name = f.webkitRelativePath || f.name; return { name, file: f, kind: extKind(f.name), title: titleFor(name) }; }).filter((f) => f.kind);
    await identifyCarts(fresh);
    // A saved scan of one folder replaces only that folder's rows; other scanned folders stay in the catalog.
    MED.files = persist && root ? MED.files.filter((f) => !f.name.startsWith(root + '/')).concat(fresh) : fresh;
    MED.fromDb = false;
    renderMed();
    if (persist) await saveCatalog();
    const kc = {};
    MED.files.forEach((f) => { kc[f.kind] = (kc[f.kind] || 0) + 1; });
    log(`Scan complete: ${MED.files.length} items (${Object.entries(kc).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'})`);
    diag('scan summary ' + JSON.stringify(kc));
  }
  $('medfilter').oninput = renderMed;
  $('medkind').onchange = () => { MED.kind = $('medkind').value; MED.ext = 'all'; renderMed(); };
  $('medview').onclick = () => { MED.tree = !MED.tree; localStorage.setItem('ac.medtree', MED.tree ? '1' : '0'); renderMed(); };
  $('medexpand').onclick = () => { allDirs(window.__medTreeRoot || { dirs: new Map() }, []).forEach((p) => MED.open.add(p)); renderMed(); };
  $('medcollapse').onclick = () => { MED.open.clear(); renderMed(); };
  {
    if (MEDS.q) $('medfilter').value = MEDS.q;
    if (MEDS.view === 'hist' || MEDS.view === 'freq') MED.view = MEDS.view;
    for (const k of ['kind', 'ext', 'ltype', 'lvendor']) if (MEDS[k]) MED[k] = MEDS[k];
    (MEDS.open || []).forEach((p) => MED.open.add(p));
    const box = $('medbox'), list = $('medlist');
    const setBig = (on) => {
      box.classList.toggle('medbig', on); $('medbig').classList.toggle('on', on); $('medside').classList.toggle('on', !on);
      if (on) { box.classList.remove('collapsed'); document.querySelector('#sidetabs [data-t=fm]').click(); }
      MEDS.big = on; localStorage.setItem('ac.medstate', JSON.stringify(MEDS));
      if (MED.files.length) renderMed();
    };
    $('medbig').onclick = () => setBig(true); $('medside').onclick = () => setBig(false);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box.classList.contains('medbig') && !document.querySelector('#pickmenu, dialog[open]')) setBig(false); });
    let st = null;
    list.addEventListener('scroll', () => { clearTimeout(st); st = setTimeout(() => { if (!MED.files.length) return; MEDS.scroll = list.scrollTop; localStorage.setItem('ac.medstate', JSON.stringify(MEDS)); }, 250); });
    // The catalog loads after startup: put the scroll position back after its first render.
    const first = renderMed0; let restored = false;
    renderMed0 = function () { first(); if (!restored && MED.files.length) { restored = true; list.scrollTop = MEDS.scroll || 0; } };
    renderHist();
    if (MEDS.big) setBig(true);
  }
  $('romfilter').oninput = () => fillRomSelects();

  // ---- side-panel tabs ----
  {
    const show = (t) => {
      document.querySelectorAll('#sidetabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
      document.querySelectorAll('.side .box[data-tab]').forEach((b) => { b.style.display = b.dataset.tab === 'none' ? '' : b.dataset.tab === t ? '' : 'none'; });
      localStorage.setItem('ac.sidetab', t);
    };
    document.querySelectorAll('#sidetabs button').forEach((b) => { b.onclick = () => (b.dataset.t === 'wafm' ? AC.WebAfm.open() : show(b.dataset.t)); });
    const t0 = localStorage.getItem('ac.sidetab');
    show(['sys', 'drv', 'fm', 'net', 'dbg'].includes(t0) ? t0 : 'sys');
  }
  // ---- collapsible side-panel sections (state remembered) ----
  {
    const saved = JSON.parse(localStorage.getItem('ac.collapsed') || '{}');
    document.querySelectorAll('.box > h3').forEach((h3) => {
      const box = h3.parentElement, key = h3.textContent.trim();
      box.classList.toggle('collapsed', !!saved[key]);
      h3.title = 'Click to collapse / expand';
      h3.onclick = () => {
        saved[key] = box.classList.toggle('collapsed');
        localStorage.setItem('ac.collapsed', JSON.stringify(saved));
      };
    });
  }
  // ---- touch pad (Atari Touch Tablet / Koala Pad on port 1: paddle 0/1 = X/Y, stylus buttons = joystick left/right lines) ----
  const PAD = Object.assign({ on: false, type: 'touch', screen: false, fx: false, fy: false }, JSON.parse(localStorage.getItem('ac.pad') || '{}'));
  const padPos = { x: 0.5, y: 0.5, b: 0, held: 0, lx: null, ly: null };
  const padAcc = { x: 0, y: 0 };
  // Relative mice (ST, Amiga, trak-ball) are done here as quadrature on port 2's joystick lines: the core's mouse
  // input is unsigned, so it cannot move left or up. One quadrature step per axis per frame keeps a once-per-frame reader from aliasing.
  const QTAB = { st: [0, 2, 3, 1, 8, 10, 11, 9, 12, 14, 15, 13, 4, 6, 7, 5], amiga: [0, 2, 10, 8, 1, 3, 11, 9, 5, 7, 15, 13, 4, 6, 14, 12] };
  const Q = { x: 0, y: 0, right: 0, down: 0 };
  function padQuad() {
    const t = PAD.type;
    if (!S.emu || !PAD.on || !PADTYPES[t].rel) { padAcc.x = padAcc.y = 0; return; }
    const sx = Math.sign(Math.trunc(padAcc.x)), sy = Math.sign(Math.trunc(padAcc.y));
    padAcc.x = Math.max(-40, Math.min(40, padAcc.x - sx)); padAcc.y = Math.max(-40, Math.min(40, padAcc.y - sy));
    if (sx) { Q.x = (Q.x + sx) & 3; Q.right = sx > 0 ? 1 : 0; }
    if (sy) { Q.y = (Q.y + sy) & 3; Q.down = sy > 0 ? 1 : 0; }
    const code = t === 'trak' ? ((Q.y & 1) << 3) | (Q.down << 2) | ((Q.x & 1) << 1) | Q.right : QTAB[t][(Q.y & 3) * 4 + (Q.x & 3)];
    S.emu.down('padq', { joy1: code ^ 0xf, trig1: (padPos.b | padPos.held) & 1 ? 1 : 0 });
  }
  setInterval(padQuad, 16);
  function applyPad() {
    document.querySelectorAll('.padbtns button').forEach((b) => b.classList.toggle('down', !!((padPos.b | padPos.held) & +b.dataset.b)));
    if (!S.emu) return;
    if (!PAD.on || PADTYPES[PAD.type].rel) { S.emu.up('pad'); if (!PAD.on || !PADTYPES[PAD.type].rel) S.emu.keys.delete('padq'); return; }
    const fx = PAD.fx ? 1 - padPos.x : padPos.x;
    const fy = PAD.fy ? 1 - padPos.y : padPos.y;
    const potX = Math.round(fx * 227);
    // Touch Tablet: Y rises going up; Koala Pad: Y rises going down. Direct-mouse mode inverts the value (POT = 227 - value).
    const potY = Math.round((PAD.type === 'koala' ? fy : 1 - fy) * 227);
    S.emu.down('pad', { mousex: 227 - potX, mousey: 227 - potY, mouse_buttons: padPos.b | padPos.held, mouse_mode: 1 });
    $('padinfo').textContent = `X ${potX}  Y ${potY}${padPos.b | padPos.held ? '  button' : ''}`;
  }
  function padMove(e, el) {
    const r = el.getBoundingClientRect();
    if (PADTYPES[PAD.type].rel && padPos.lx != null) { padAcc.x += (e.clientX - padPos.lx) * 0.7; padAcc.y += (e.clientY - padPos.ly) * 0.7; }
    padPos.lx = e.clientX; padPos.ly = e.clientY;
    padPos.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    padPos.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    document.querySelectorAll('.paddot, #paddot').forEach((d) => { d.style.left = padPos.x * 100 + '%'; d.style.top = padPos.y * 100 + '%'; });
    applyPad();
  }
  function padWire(el, enabled) {
    let down = false;
    el.addEventListener('pointerdown', (e) => {
      if (!enabled()) return;
      down = true; el.setPointerCapture(e.pointerId);
      padPos.b = (e.buttons & 3) || 1; el.classList.add('dn');
      padPos.lx = null;
      padMove(e, el); e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => { if (enabled() && (down || e.pointerType === 'mouse')) { if (down) padPos.b = (e.buttons & 3) || 1; padMove(e, el); } });
    const end = () => { if (!down) return; down = false; padPos.b = 0; el.classList.remove('dn'); applyPad(); };
    el.addEventListener('pointerleave', () => { if (!down) padPos.lx = null; });
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', (e) => { if (enabled()) e.preventDefault(); });
  }
  padWire($('padarea'), () => PAD.on);
  padWire(cv, () => PAD.on && PAD.screen);
  padWire($('padarea2'), () => PAD.on);
  document.querySelectorAll('.padbtns button').forEach((b) => {
    const bit = +b.dataset.b;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('down'); padPos.held |= bit; applyPad(); });
    const up = () => { b.classList.remove('down'); padPos.held &= ~bit; applyPad(); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  });
  // ---- joysticks (Stick tab): on-screen stick plus a real USB controller, with mappable extra buttons ----
  const JACT = [['none', '(nothing)'], ['fire', 'Fire'], ['fire2', 'Fire 2 (acts as Fire)'], ['start', 'Start'], ['select', 'Select'], ['option', 'Option'], ['reset', 'Reset'], ['break', 'Break']];
  const JOYTYPES = {
    cx40: { name: 'Atari CX40 joystick (original)', info: ['One red fire button and an 8-way stick', 'Diagonals are two directions at once'],
      ctl: [['fire', 'Fire', 'big', 'fire']] },
    cx40p: { name: 'Atari CX40+ (USB)', info: ['One red fire button and an 8-way stick', '2 side buttons: default Select and Option (mappable)', 'Wired or wireless; the controller sends DB9 joystick over USB, so it shows up as a gamepad'],
      ctl: [['fire', 'Fire', 'big', 'fire'], ['s1', 'Side 1', 'small', 'select'], ['s2', 'Side 2', 'small', 'option']] },
    cxstick: { name: 'Atari CXSTICK (newest)', info: ['One red fire button and an 8-way stick', '4 buttons around the ring under the top: mappable, no fixed use', '2 side buttons: default Select and Option (mappable)', 'Wired or wireless; the controller sends DB9 joystick over USB, so it shows up as a gamepad'],
      ctl: [['fire', 'Fire', 'big', 'fire'], ['r1', 'Ring 1', 'small', 'none'], ['r2', 'Ring 2', 'small', 'none'], ['r3', 'Ring 3', 'small', 'none'], ['r4', 'Ring 4', 'small', 'none'], ['s1', 'Side 1', 'small', 'select'], ['s2', 'Side 2', 'small', 'option']] },
    atari2: { name: 'Atari CX78+ (2-button)', info: ['8-way stick: diagonals are two directions at once', 'Left button = standard trigger (Fire)', 'Right button = second button (the core has one trigger line, so it also fires)', 'Wired or wireless; the controller sends DB9 joystick over USB, so it shows up as a gamepad'],
      ctl: [['fire', 'Left (Fire)', 'big', 'fire'], ['fire2', 'Right (Fire 2)', 'big', 'fire2']] },
    paddle: { name: 'Atari CX30 paddle', mode: 'paddle', info: ['One dial (left/right) and one button', 'Dial = paddle 0 position; button = paddle trigger', 'USB: first axis of the controller turns the dial'],
      ctl: [['fire', 'Button', 'big', 'fire']] },
    driving: { name: 'Atari CX20 driving controller', mode: 'drive', info: ['A knob that turns a full 360° with no end stop, plus one button', 'Sends 16 steps per turn as a 2-bit code on the up/down lines', 'Drag around the knob, use the mouse wheel, or turn a USB stick in a circle'],
      ctl: [['fire', 'Button', 'big', 'fire']] },
    stick2: { name: 'Two-button joystick (left / right fire)', layout: 'top', info: ['8-way stick, two big fire buttons: left = Fire, right = Fire 2', 'Two small buttons just above them do the same: left = Fire, right = Fire 2', 'The core has one trigger line, so Fire 2 also fires'],
      ctl: [['fire', 'Left fire (Fire)', 'big', 'fire'], ['fire2', 'Right fire (Fire 2)', 'big', 'fire2'], ['t1', 'Top left (Fire)', 'top', 'fire', ''], ['t2', 'Top right (Fire 2)', 'top', 'fire2', '']] },
    pad2: { name: 'Two-button joypad (1 and 2 on the right)', layout: 'pad', info: ['8-way pad on the left, buttons 1 and 2 on the right: 1 = Fire, 2 = Fire 2', 'Two small buttons just above them do the same', 'The core has one trigger line, so Fire 2 also fires'],
      ctl: [['b1', 'Button 1 (Fire)', 'big', 'fire', '1'], ['b2', 'Button 2 (Fire 2)', 'big', 'fire2', '2'], ['t1', 'Top button 1 (Fire)', 'top', 'fire', ''], ['t2', 'Top button 2 (Fire 2)', 'top', 'fire2', '']] },
    c64: { name: 'C64-style joystick', info: ['8-way stick, two red buttons on top left and right', 'Top left = Fire, top right = Fire 2', '4 small buttons along the front: default Start, Select, Option, Reset (mappable)'],
      ctl: [['t1', 'Top left (Fire)', 'big', 'fire'], ['t2', 'Top right (Fire 2)', 'big', 'fire2'], ['b1', 'Front 1', 'small', 'start'], ['b2', 'Front 2', 'small', 'select'], ['b3', 'Front 3', 'small', 'option'], ['b4', 'Front 4', 'small', 'reset']] },
  };
  const GRAY = [0, 1, 3, 2];
  const JSAVED = (() => { let o = {}; try { o = JSON.parse(localStorage.getItem('ac.joyx') || '{}'); } catch (e) { /* fresh */ } return o.dev ? { p: [o], con: o.con } : o; })();
  const JSH = { con: JSAVED.con !== false, two: !!JSAVED.two };
  // While the Paddle / Driving tab is showing, both players are forced to that device; remember the Stick-tab devices so they are restored and saved.
  let joyForce = null;
  const joySave = () => localStorage.setItem('ac.joyx', JSON.stringify({ p: players.map((p, i) => Object.assign(p.save(), joyForce ? { dev: joyForce[i] } : {})), two: JSH.two, con: JSH.con }));
  const JFIELDS = { start: { start: 1 }, select: { select: 1 }, option: { option: 1 }, reset: { special: 2 }, break: { special: 5 }, help: { keycode: 0x11 } };
  function fillCon(con) {
    con.innerHTML = '';
    for (const [k, l] of [['reset', 'Reset'], ['option', 'Option'], ['select', 'Select'], ['start', 'Start'], ['help', 'Help']]) {
      const b = document.createElement('button'); b.textContent = l; b.className = 'jb ckey';
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('down'); S.emu && S.emu.down('jc:' + k, JFIELDS[k]); });
      const up = () => { b.classList.remove('down'); S.emu && S.emu.up('jc:' + k); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
      con.append(b);
    }
  }
  fillCon($('padcon'));
  const keyName = (c) => (!c ? '(none)' : ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space' })[c] || c.replace(/^Key|^Digit/, ''));
  const JKDIRS = [['up', 'Up'], ['down', 'Down'], ['left', 'Left'], ['right', 'Right']];
  function mkPlayer(idx, saved) {
  const JOY = Object.assign({ dev: 'cx40', act: {}, gpb: {}, kb: {}, kbon: true, usb: true }, saved || {});
  JOY.kbon = saved && saved.kbx !== undefined ? saved.kbx : true;
  Object.assign(JOY, { ui: 0, gp: 0, kd: 0, kdir: 0, cnt: {}, learn: null, down: {}, pot: 0.5, ang: 0, step: 0, gpAng: null, vis: {} });
  const fld = idx ? 'joy1' : 'joy0', trg = idx ? 'trig1' : 'trig0';
  function joyPaddleEl() {
    const el = document.createElement('div'); el.className = 'jpaddle'; el.title = 'Drag left/right (or use the mouse wheel) to turn the paddle';
    el.innerHTML = '<div class="jtick"></div>';
    const tick = el.firstChild; JOY.vis.tick = tick;
    const show = () => { tick.style.left = JOY.pot * 100 + '%'; };
    const aim = (e) => { const r = el.getBoundingClientRect(); JOY.pot = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); show(); sendJoy(); };
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); aim(e); e.preventDefault(); });
    el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) aim(e); });
    el.addEventListener('wheel', (e) => { e.preventDefault(); JOY.pot = Math.min(1, Math.max(0, JOY.pot + (e.deltaY > 0 ? 0.03 : -0.03))); show(); sendJoy(); }, { passive: false });
    show();
    return el;
  }
  function joyDriveEl() {
    const el = document.createElement('div'); el.className = 'jstick'; el.title = 'Drag around the knob to turn it, or use the mouse wheel'; JOY.vis.drive = el;
    el.innerHTML = '<div class="jknob" style="width:12%;height:12%;left:50%;top:2%;margin:0 0 0 -6%;background:#c63b22;border-color:#7a2415"></div>';
    const knob = el.firstChild;
    const turn = (d) => { JOY.ang += d; JOY.step = Math.floor(JOY.ang / (Math.PI / 8)); knob.style.transform = ''; el.style.transform = `rotate(${JOY.ang}rad)`; sendJoy(); };
    let last = null;
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); const r = el.parentNode.getBoundingClientRect(); last = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); e.preventDefault(); });
    el.addEventListener('pointermove', (e) => {
      if (last == null) return;
      const r = el.parentNode.getBoundingClientRect(), a = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
      let d = a - last; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
      last = a; turn(d);
    });
    const end = () => { last = null; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => { e.preventDefault(); turn(e.deltaY > 0 ? Math.PI / 8 : -Math.PI / 8); }, { passive: false });
    const wrap = document.createElement('div'); wrap.style.cssText = 'width:var(--js);height:var(--js);flex:none;position:relative'; wrap.append(el);
    el.style.transform = `rotate(${JOY.ang}rad)`;
    return wrap;
  }
  const jdef = () => JOYTYPES[JOY.dev] || JOYTYPES.cx40;
  const jact = (c) => { const t = (JOY.act[JOY.dev] || {})[c[0]]; return t || c[3]; };
  const jgpb = (c, i) => { const m = (JOY.gpb[JOY.dev] || {})[c[0]]; return m != null ? m : [0, 1, 2, 3, 4, 5, 8, 9][i]; };
  const kbDefaults = () => {
    const d = idx ? { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' } : { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
    const big = jdef().ctl.filter((c) => c[2] === 'big');
    if (big[0]) d[big[0][0]] = idx ? 'KeyF' : 'Space';
    if (big[1]) d[big[1][0]] = idx ? 'KeyG' : 'KeyZ';
    return d;
  };
  const kbMap = () => Object.assign(kbDefaults(), JOY.kb[JOY.dev] || {});
  function showBits() {
    const k = JOY.vis.knob; if (!k) return;
    const b = JOY.ui | JOY.gp | JOY.kd, x = (b & 8 ? 1 : 0) - (b & 4 ? 1 : 0), y = (b & 2 ? 1 : 0) - (b & 1 ? 1 : 0), m = Math.hypot(x, y) || 1;
    if (JOY.vis.dirs) JOY.vis.dirs.forEach(([mask, d]) => d.classList.toggle('on', (b & 15) === mask));
    k.style.transform = JOY.dragging ? k.style.transform : `translate(${(x / m) * k.parentNode.clientWidth * 0.25}px, ${(y / m) * k.parentNode.clientWidth * 0.25}px)`;
  }
  function joyCtl(id, on) {
    const c = jdef().ctl.find((x) => x[0] === id); if (!c) return;
    if (!!JOY.down[id] === on) return;
    JOY.down[id] = on;
    if (JOY.vis.btn && JOY.vis.btn[id]) JOY.vis.btn[id].classList.toggle('down', on);
    const a = jact(c); if (a === 'none') return;
    JOY.cnt[a] = (JOY.cnt[a] || 0) + (on ? 1 : -1);
    if (a === 'fire' || a === 'fire2') { sendJoy(); return; }
    if (!S.emu) return;
    if (on) S.emu.down('jx:' + idx + a, JFIELDS[a]); else if (!JOY.cnt[a]) S.emu.up('jx:' + idx + a);
  }
  function joyRelease() { for (const id of Object.keys(JOY.down)) joyCtl(id, false); JOY.ui = 0; JOY.gp = 0; JOY.kd = 0; JOY.kdir = 0; showBits(); sendJoy(); }
  const joyFire = () => ((JOY.cnt.fire || 0) + (JOY.cnt.fire2 || 0)) > 0;
  function send() {
    showBits();
    if (!S.emu) return;
    const mode = jdef().mode;
    let j = (idx ? 0 : S.joy) | JOY.ui | JOY.gp | JOY.kd;
    const fire = (!idx && S.fire) || joyFire();
    if (mode === 'paddle') { padSend(); S.emu.down(fld, { [fld]: 0, [trg]: 0 }); return; }
    if (mode === 'drive') j = (j & ~3) | GRAY[JOY.step & 3];
    S.emu.down(fld, { [fld]: j, [trg]: fire ? 1 : 0 });
  }
  function joyMenu(x, y) {
    const t = jdef();
    const items = t.info.map((l) => ({ label: l, run: () => {} }));
    items.push({ label: 'Map buttons…', run: () => joyDialog() });
    items.push({ label: 'Keyboard keys…', run: () => keyDialog() });
    for (const [k, v] of Object.entries(JOYTYPES)) if (k !== JOY.dev) items.push({ label: 'Switch to ' + v.name, run: () => joySet(k) });
    items.push({ label: (JSH.con ? 'Hide' : 'Show') + ' Start / Select / Option / Reset', run: () => { JSH.con = !JSH.con; joySave(); joyRenderAll(); } });
    items.push({ label: JOY.usb ? 'Ignore a real USB controller for this player' : 'Use a real USB controller for this player', run: () => { JOY.usb = !JOY.usb; joySave(); if (!JOY.usb) { JOY.gp = 0; sendJoy(); } } });
    openPick(x, y, `Player ${idx + 1} emulating: ${t.name}`, items);
  }
  function joySet(k) { joyRelease(); JOY.dev = k; joySave(); joyRenderAll(); padSend(); sendJoy(); }
  function joyRender() {
    const t = jdef(), box = document.createElement('div');
    box.className = 'jplayer';
    JOY.vis = { btn: {} };
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;gap:6px;align-items:center';
    const nm = document.createElement('div');
    nm.className = 'dim'; nm.title = 'Click or right-click: what is emulated, switch device, map buttons';
    nm.style.cssText = 'cursor:context-menu;padding:2px 4px;user-select:none;-webkit-touch-callout:none;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    nm.textContent = `🕹 P${idx + 1}: ${t.name} ▾`;
    nm.onclick = (e) => joyMenu(e.clientX, e.clientY);
    nm.oncontextmenu = (e) => { e.preventDefault(); joyMenu(e.clientX, e.clientY); };
    const kb = document.createElement('button'); kb.textContent = '⌨ Keys…'; kb.className = 'jkeys' + (JOY.kbon ? ' on' : '');
    kb.title = 'Map keyboard keys to this controller' + (JOY.kbon ? ' (keyboard control is on)' : '');
    kb.onclick = () => keyDialog();
    head.append(nm, kb);
    const row = document.createElement('div'); row.className = 'jrow';
    const mkStick = () => {
    const stick = document.createElement('div'); stick.className = 'jstick'; stick.title = 'Drag: 8 directions, diagonals are two directions at once';
    stick.innerHTML = '<div class="jknob"></div>';
    const knob = stick.firstChild; JOY.vis.knob = knob;
    JOY.vis.dirs = [[1, 0, -1], [9, 0.71, -0.71], [8, 1, 0], [10, 0.71, 0.71], [2, 0, 1], [6, -0.71, 0.71], [4, -1, 0], [5, -0.71, -0.71]].map(([m, dx, dy]) => {
      const d = document.createElement('div'); d.className = 'jdir';
      d.style.left = 50 + dx * 43 + '%'; d.style.top = 50 + dy * 43 + '%';
      stick.append(d); return [m, d];
    });
    const aim = (e) => {
      const r = stick.getBoundingClientRect(), R = r.width / 2;
      const dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R), th = 0.38 * R;
      JOY.ui = (dy < -th ? 1 : 0) | (dy > th ? 2 : 0) | (dx < -th ? 4 : 0) | (dx > th ? 8 : 0);
      const m = Math.min(1, Math.hypot(dx, dy) / R) || 0, a = Math.atan2(dy, dx);
      JOY.dragging = true;
      knob.style.transform = `translate(${Math.cos(a) * m * R * 0.5}px, ${Math.sin(a) * m * R * 0.5}px)`;
      sendJoy();
    };
    const rel = () => { JOY.ui = 0; JOY.dragging = false; knob.style.transform = ''; sendJoy(); };
    stick.addEventListener('pointerdown', (e) => { stick.setPointerCapture(e.pointerId); aim(e); e.preventDefault(); });
    stick.addEventListener('pointermove', (e) => { if (stick.hasPointerCapture(e.pointerId)) aim(e); });
    stick.addEventListener('pointerup', rel); stick.addEventListener('pointercancel', rel);
    return stick;
    };
    const stick = t.mode === 'paddle' ? joyPaddleEl() : t.mode === 'drive' ? joyDriveEl() : mkStick();
    const mid = document.createElement('div'); mid.className = 'jbtns' + (t.layout ? ' jl-' + t.layout : '');
    const tops = document.createElement('div'), bigs = document.createElement('div'); tops.className = 'jtops'; bigs.className = 'jbigs';
    t.ctl.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'jb ' + c[2]; b.dataset.c = c[0];
      JOY.vis.btn[c[0]] = b;
      const a = jact(c);
      b.textContent = c[4] != null ? c[4] : c[2] === 'big' ? c[1] : c[1] + ' → ' + (JACT.find((x) => x[0] === a) || [0, a])[1];
      b.title = c[1] + ' (' + (JACT.find((x) => x[0] === a) || [0, a])[1] + ')';
      if (JOY.down[c[0]]) b.classList.add('down');
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); joyCtl(c[0], true); });
      const up = () => joyCtl(c[0], false);
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
      (t.layout ? (c[2] === 'top' ? tops : bigs) : mid).append(b);
    });
    if (t.layout) mid.append(tops, bigs);
    row.append(stick, mid);
    box.append(head, row);
    return box;
  }
  function keyDialog() {
    let dlg = $('joydlg');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'joydlg'; document.body.append(dlg); }
    const t = jdef(), map = kbMap();
    dlg.innerHTML = '';
    dlg.style.cssText = 'background:#1b1e24;color:#e6e0d4;border:1px solid #4a5160;border-radius:10px;min-width:300px;max-width:min(94vw,480px)';
    const h = document.createElement('h3'); h.textContent = `Player ${idx + 1} keyboard: ${t.name}`; h.style.margin = '0 0 8px'; dlg.append(h);
    const on = document.createElement('label'); on.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:8px';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = JOY.kbon;
    cb.onchange = () => { JOY.kbon = cb.checked; if (!cb.checked) joyRelease(); joySave(); joyRenderAll(); };
    on.append(cb, 'Control this player with the keyboard (only while the Stick tab is open)'); dlg.append(on);
    const rows = [...(t.mode === 'paddle' || t.mode === 'drive' ? [['left', 'Turn left'], ['right', 'Turn right']] : JKDIRS), ...t.ctl.map((c) => [c[0], c[1]])];
    for (const [id, label] of rows) {
      const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:6px;align-items:center;margin:4px 0';
      const l = document.createElement('span'); l.textContent = label; l.style.flex = '1';
      const b = document.createElement('button'); b.textContent = keyName(map[id]) + ' · Set';
      b.onclick = () => {
        b.textContent = 'press a key… (Esc cancels, Backspace clears)';
        const h2 = (e) => {
          e.preventDefault(); e.stopImmediatePropagation(); window.removeEventListener('keydown', h2, true);
          if (e.code !== 'Escape') { (JOY.kb[JOY.dev] = JOY.kb[JOY.dev] || {})[id] = e.code === 'Backspace' ? '' : e.code; joySave(); }
          keyDialog();
        };
        window.addEventListener('keydown', h2, true);
      };
      r.append(l, b); dlg.append(r);
    }
    const rs = document.createElement('button'); rs.textContent = 'Reset keys to defaults'; rs.style.cssText = 'display:block;width:100%;margin-top:8px';
    rs.onclick = () => { delete JOY.kb[JOY.dev]; joySave(); keyDialog(); };
    const x = document.createElement('button'); x.textContent = 'Close'; x.style.cssText = 'display:block;width:100%;margin-top:6px';
    x.onclick = () => dlg.close();
    dlg.append(rs, x);
    if (!dlg.open) dlg.showModal();
  }
  function onKey(e, on) {
    if (!JOY.kbon) return false;
    const map = kbMap(), m = jdef().mode, id = Object.keys(map).find((k) => map[k] === e.code);
    if (!id) return false;
    const dir = { up: 1, down: 2, left: 4, right: 8 }[id];
    if (m === 'paddle' || m === 'drive') { if (id === 'left') JOY.kdir = on ? -1 : (JOY.kdir === -1 ? 0 : JOY.kdir); else if (id === 'right') JOY.kdir = on ? 1 : (JOY.kdir === 1 ? 0 : JOY.kdir); else joyCtl(id, on); return true; }
    if (dir) { JOY.kd = on ? JOY.kd | dir : JOY.kd & ~dir; sendJoy(); return true; }
    joyCtl(id, on); return true;
  }
  function joyDialog() {
    let dlg = $('joydlg');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'joydlg'; document.body.append(dlg); }
    const t = jdef();
    dlg.innerHTML = '';
    dlg.style.cssText = 'background:#1b1e24;color:#e6e0d4;border:1px solid #4a5160;border-radius:10px;min-width:300px;max-width:min(94vw,480px)';
    const h = document.createElement('h3'); h.textContent = 'Map buttons: ' + t.name; h.style.margin = '0 0 8px'; dlg.append(h);
    const note = document.createElement('div'); note.className = 'dim'; note.style.cssText = 'font-size:12px;margin-bottom:8px';
    note.textContent = 'Each physical button does the chosen action. "Learn" then press a button on your USB controller to bind it.'; dlg.append(note);
    t.ctl.forEach((c, i) => {
      const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:6px;align-items:center;margin:4px 0';
      const l = document.createElement('span'); l.textContent = c[1]; l.style.flex = '1';
      const sel = document.createElement('select');
      for (const [v, n] of JACT) { const o = document.createElement('option'); o.value = v; o.textContent = n; sel.append(o); }
      sel.value = jact(c);
      sel.onchange = () => { joyRelease(); (JOY.act[JOY.dev] = JOY.act[JOY.dev] || {})[c[0]] = sel.value; joySave(); joyRenderAll(); };
      const lb = document.createElement('button'); lb.textContent = 'USB: ' + jgpb(c, i) + ' · Learn';
      lb.onclick = () => { JOY.learn = (idx) => { (JOY.gpb[JOY.dev] = JOY.gpb[JOY.dev] || {})[c[0]] = idx; joySave(); JOY.learn = null; joyDialog(); }; lb.textContent = 'press a button…'; };
      r.append(l, sel, lb); dlg.append(r);
    });
    const x = document.createElement('button'); x.textContent = 'Close'; x.style.cssText = 'display:block;width:100%;margin-top:10px';
    x.onclick = () => { JOY.learn = null; dlg.close(); };
    dlg.append(x);
    if (!dlg.open) dlg.showModal();
  }
  const gdn = {};
  const turnBy = (d) => { JOY.ang += d; JOY.step = Math.floor(JOY.ang / (Math.PI / 8)); if (JOY.vis.drive) JOY.vis.drive.style.transform = `rotate(${JOY.ang}rad)`; sendJoy(); };
  const setPot = (v) => { JOY.pot = Math.min(1, Math.max(0, v)); if (JOY.vis.tick) JOY.vis.tick.style.left = JOY.pot * 100 + '%'; sendJoy(); };
  let kt = 0;
  // Called every 16 ms with the real gamepad for this player (or null): moves the on-screen controller to match it.
  function tick(g) {
    const t = jdef();
    if (JOY.kdir && t.mode === 'paddle') setPot(JOY.pot + JOY.kdir * 0.02);
    if (JOY.kdir && t.mode === 'drive' && ++kt % 4 === 0) turnBy(JOY.kdir * Math.PI / 8);
    if (!g || !JOY.usb) { if (JOY.gp) { JOY.gp = 0; sendJoy(); } return; }
    const ax = g.axes[0] || 0, ay = g.axes[1] || 0, B = (k) => g.buttons[k] && g.buttons[k].pressed;
    if (t.mode === 'paddle' && Math.abs(ax) > 0.05) setPot((ax + 1) / 2);
    if (t.mode === 'drive') {
      if (Math.hypot(ax, ay) > 0.6) {
        const a = Math.atan2(ay, ax);
        if (JOY.gpAng != null) { let d = a - JOY.gpAng; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; turnBy(d); }
        JOY.gpAng = a;
      } else JOY.gpAng = null;
    }
    const bits = (ay < -0.5 || B(12) ? 1 : 0) | (ay > 0.5 || B(13) ? 2 : 0) | (ax < -0.5 || B(14) ? 4 : 0) | (ax > 0.5 || B(15) ? 8 : 0);
    t.ctl.forEach((c, i) => { const k = jgpb(c, i); if (k >= 12 && k <= 15) return; const now = !!B(k); if (now !== !!gdn[c[0]]) { gdn[c[0]] = now; joyCtl(c[0], now); } });
    if (bits !== JOY.gp) { JOY.gp = bits; sendJoy(); }
  }
  return { JOY, setDev: joySet, send, render: joyRender, release: joyRelease, tick, onKey, jdef, padState: () => (jdef().mode === 'paddle' ? { pot: JOY.pot, btn: joyFire() } : null),
    save: () => ({ dev: JOY.dev, act: JOY.act, gpb: JOY.gpb, kb: JOY.kb, kbx: JOY.kbon, usb: JOY.usb }) };
  }
  const players = [mkPlayer(0, (JSAVED.p || [])[0]), mkPlayer(1, (JSAVED.p || [])[1])];
  function padSend() {
    if (!S.emu) return;
    const st = players.map((p, i) => (i === 0 || JSH.two ? p.padState() : null));
    if (!st[0] && !st[1]) { if (PAD.on) applyPad(); else S.emu.up('pad'); return; }
    const v = (s) => (s ? 227 - Math.round(s.pot * 227) : 113);
    S.emu.down('pad', { mousex: v(st[0]), mousey: v(st[1]), mouse_buttons: (st[0] && st[0].btn ? 1 : 0) | (st[1] && st[1].btn ? 2 : 0), mouse_mode: 1 });
  }
  function joyRenderAll() {
    const box = $('kjoy');
    box.innerHTML = '';
    const bar = document.createElement('div'); bar.className = 'jbar';
    for (const [n, l] of [[false, '1 player'], [true, '2 players side by side']]) {
      const b = document.createElement('button'); b.textContent = l; b.className = JSH.two === n ? 'on' : '';
      b.onclick = () => { JSH.two = n; if (!n) players[1].release(); joySave(); joyRenderAll(); padSend(); };
      bar.append(b);
    }
    const row = document.createElement('div'); row.className = 'jplayers';
    row.append(players[0].render());
    if (JSH.two) row.append(players[1].render());
    if (JSH.con) {
      const con = document.createElement('div'); con.className = 'jcon'; fillCon(con);
      row.append(con);
    }
    box.append(bar, row);
    if (window.AC_fitPanel) AC_fitPanel();
  }
  const gpPrev = {};
  setInterval(() => {
    if (!navigator.getGamepads) return;
    const pads = [...navigator.getGamepads()].filter(Boolean);
    for (const g of pads) {
      const prev = gpPrev[g.index] || (gpPrev[g.index] = []);
      const i = g.buttons.findIndex((b, k) => b.pressed && !prev[k]);
      if (i >= 0) { const p = players.find((q) => q.JOY.learn); if (p) p.JOY.learn(i); }
      g.buttons.forEach((b, k) => { prev[k] = b.pressed; });
    }
    players.forEach((p, i) => p.tick(i === 0 || JSH.two ? pads[i] : null));
    if (!players.some((p) => p.JOY.kdir)) kbKeepAlive = false;
  }, 16);
  let kbKeepAlive = false;
  const kbHandler = (on) => (e) => {
    if ($('kjoy').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '')) || e.target.isContentEditable) return;
    if (e.repeat) { if (players.some((p, i) => (i === 0 || JSH.two) && p.JOY.kbon && Object.values(p.JOY.kb[p.JOY.dev] || {}).concat(['x']).length)) { /* swallow repeats of mapped keys below */ } }
    for (let i = 0; i < 2; i++) if ((i === 0 || JSH.two) && players[i].onKey(e, on)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
  };
  window.addEventListener('keydown', kbHandler(true), true);
  window.addEventListener('keyup', kbHandler(false), true);
  joyRenderAll();
  // Keyboard panel tabs: Keys / Arrows / Pad / Stick. Pad turns the touch pad on while shown and restores the previous state after.
  {
    let padBefore = null;
    const setMode = (m) => {
      document.querySelectorAll('#kbmode button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
      const forced = { paddle: 'paddle', drive: 'driving' }[m];
      if (forced) {
        if (!joyForce) joyForce = players.map((p) => p.JOY.dev);
        players.forEach((p) => { if (p.JOY.dev !== forced) p.setDev(forced); });
      } else if (joyForce) {
        const prev = joyForce; joyForce = null;
        players.forEach((p, i) => { if (p.JOY.dev !== prev[i]) p.setDev(prev[i]); });
      }
      $('kbd').hidden = m !== 'keys'; $('karrows').hidden = m !== 'arrows'; $('kpad').hidden = m !== 'pad'; $('kjoy').hidden = !(m === 'joy' || forced); $('kmini').hidden = m !== 'keys';
      $('kbview').style.display = m === 'keys' ? '' : 'none';
      fitPanel();
      if (m === 'pad' && padBefore == null) { padBefore = PAD.on; PAD.on = true; syncPadUi(); applyPad(); }
      else if (m !== 'pad' && padBefore != null) { PAD.on = padBefore; padBefore = null; padPos.held = 0; syncPadUi(); applyPad(); }
      localStorage.setItem('ac.kbmode', m);
    };
    // Every controller page fills the same area as the Keys page and never grows past it: scale until it fits.
    const keysArea = () => {
      const kb = $('kbd'), mini = $('kmini'), wasK = kb.hidden, wasM = mini.hidden;
      kb.hidden = false; mini.hidden = false;
      const h = kb.offsetHeight + (mini.offsetParent ? mini.offsetHeight + 6 : 0);
      kb.hidden = wasK; mini.hidden = wasM;
      return h;
    };
    const fitTo = (el, H, set, lo, hi, v0) => {
      let v = Math.max(lo, Math.min(hi, v0));
      for (let i = 0; i < 4; i++) {
        set(v);
        const h = el.offsetHeight; if (!h) return;
        let nv = v * H / h;
        if (el.scrollWidth > el.clientWidth + 1) nv = Math.min(nv, v * el.clientWidth / el.scrollWidth);
        nv = Math.max(lo, Math.min(hi, nv));
        if (Math.abs(nv - v) < 0.5) { v = nv; break; }
        v = nv;
      }
      set(v);
    };
    const fitPanel = () => {
      const H = keysArea(); if (H < 120) return;
      const pad = $('kpad'), ar = $('karrows'), jy = $('kjoy');
      if (!ar.hidden) {
        ar.style.minHeight = ''; ar.style.flexWrap = 'nowrap';
        fitTo(ar, H, (v) => ar.style.setProperty('--as', v.toFixed(3)), 0.4, 1.7, 1);
        ar.style.minHeight = H + 'px';
      }
      if (!jy.hidden) {
        jy.style.minHeight = '';
        fitTo(jy, H, (v) => jy.style.setProperty('--js', Math.round(v) + 'px'), 70, 340, 200);
        jy.style.minHeight = H + 'px';
      }
      if (!pad.hidden) {
        const sel = $('padsize').value, avail = pad.clientWidth - 128 - 84 - 20, cap = Math.max(120, Math.min(avail, sel === 'auto' ? 900 : +sel));
        fitTo(pad, H, (v) => pad.style.setProperty('--padw', Math.round(v) + 'px'), 120, cap, cap);
      }
    };
    window.AC_fitPanel = fitPanel;
    window.addEventListener('resize', fitPanel);    document.querySelectorAll('#kbmode button').forEach((b) => { b.onclick = () => setMode(b.dataset.m); });
    const sizeSel = $('padsize'), applySize = () => {
      const v = sizeSel.value;
      void v;
      localStorage.setItem('ac.padsize', v); fitPanel();
    };
    sizeSel.value = localStorage.getItem('ac.padsize') || 'auto'; if (sizeSel.value !== (localStorage.getItem('ac.padsize') || 'auto')) sizeSel.value = 'auto';
    sizeSel.onchange = applySize; applySize();
    window.AC_setKbMode = setMode;
  }
  // Controllers that can sit in the Pad tab. Add new devices here; each one needs only a name and what its two buttons mean.
  const PADTYPES = {
    touch: { name: 'Atari Touch Tablet (CX77)', info: ['Position: paddle 0 (X) and paddle 1 (Y) on port 1', 'Button 1 = left click / touch (stylus switch)', 'Button 2 = right click (second button)'] },
    koala: { name: 'Koala Pad', info: ['Position: paddle 0 (X) and paddle 1 (Y) on port 1', 'Button 1 = left click / touch', 'Button 2 = right click', 'Y runs the opposite way to the Touch Tablet'] },
    st: { rel: true, name: 'Atari ST mouse (Diamond GOS default)', info: ['Quadrature on the joystick lines of port 2', 'Left button = fire'] },
    amiga: { rel: true, name: 'Amiga mouse', info: ['Quadrature on the joystick lines of port 2', 'Left button = fire'] },
    trak: { rel: true, name: 'CX-22 trak-ball', info: ['Trak-ball on port 2', 'Left button = fire'] },
  };
  function padHeadSync() {
    const t = PADTYPES[PAD.type] || PADTYPES.touch;
    $('padhead').textContent = `🖱 ${t.name} ▾  (right-click for details)`;
  }
  function padMenu(x, y) {
    const t = PADTYPES[PAD.type] || PADTYPES.touch;
    const items = Object.entries(PADTYPES).map(([k, v]) => ({ label: (k === PAD.type ? '✓ ' : '') + v.name, run: () => { if (k !== PAD.type) { $('padtype').value = k; $('padtype').onchange({ target: $('padtype') }); } } }));
    items.push(...t.info.map((l) => ({ label: '· ' + l, run: () => {} })));
    for (const [id, label] of [['padscreen', 'Draw on the main screen'], ['padfx', 'Flip X'], ['padfy', 'Flip Y']]) {
      items.push({ label: ($(id).checked ? '✓ ' : '☐ ') + label, run: () => { $(id).checked = !$(id).checked; $(id).onchange({ target: $(id) }); } });
    }
    openPick(x, y, 'Pad device: ' + t.name, items);
  }
  {
    const hd = $('padhead');
    hd.addEventListener('contextmenu', (e) => { e.preventDefault(); padMenu(e.clientX, e.clientY); });
    $('padmap').onclick = (e) => { const r = e.target.getBoundingClientRect(); padMenu(r.left, r.bottom); };
    hd.addEventListener('click', (e) => padMenu(e.clientX, e.clientY));
    let t0 = null;
    hd.addEventListener('touchstart', (e) => { const q = e.touches[0]; t0 = setTimeout(() => { t0 = null; padMenu(q.clientX, q.clientY); }, 450); }, { passive: true });
    ['touchend', 'touchmove', 'touchcancel'].forEach((ev) => hd.addEventListener(ev, () => { clearTimeout(t0); t0 = null; }, { passive: true }));
  }
  const syncPadUi = () => {
    padHeadSync();
    $('padon').checked = PAD.on; $('padtype').value = PAD.type; $('padscreen').checked = PAD.screen; $('padfx').checked = PAD.fx; $('padfy').checked = PAD.fy;
    $('padarea').classList.toggle('off', !PAD.on);
    cv.style.cursor = PAD.on && PAD.screen ? 'crosshair' : '';
    cv.style.touchAction = PAD.on && PAD.screen ? 'none' : '';
    $('padinfo').textContent = PAD.on ? $('padinfo').textContent : '';
  };
  for (const [id, key, isChk] of [['padon', 'on', 1], ['padtype', 'type', 0], ['padscreen', 'screen', 1], ['padfx', 'fx', 1], ['padfy', 'fy', 1]]) {
    $(id).onchange = (e) => {
      PAD[key] = isChk ? e.target.checked : e.target.value;
      localStorage.setItem('ac.pad', JSON.stringify(PAD)); syncPadUi(); applyPad(); e.target.blur();
      if (id === 'padtype') { padAcc.x = padAcc.y = 0; if (S.emu) S.emu.keys.delete('padq'); }
    };
  }
  syncPadUi();
  // ---- device activity lights (keyboard panel, top right) ----
  const DEVLIST = [['K1', 'CART1'], ['K2', 'CART2']].concat([...Array(8)].map((_, i) => ['D' + (i + 1), 'D' + (i + 1) + ':']), [['H', 'H:'], ['C', 'C:'], ['P', 'P:'], ['R', 'R:'], ['N', 'N:']]);
  const devEl = {};
  DEVLIST.forEach(([id, label]) => {
    const s = document.createElement('span');
    s.className = 'dv'; s.innerHTML = '<i></i>' + label + '<small></small>';
    s.tabIndex = 0; s.style.cursor = 'pointer';
    s.addEventListener('mouseenter', () => { s.title = devInfo(id).lines.join('\n'); });
    s.addEventListener('click', () => devDialog(id));
    s.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); devDialog(id); } });
    s.addEventListener('contextmenu', (e) => { e.preventDefault(); devDialog(id); });
    $('devbar').append(s);
    devEl[id] = s;
  });
  const devId = (dev) => (dev >= 0x31 && dev <= 0x38 ? 'D' + (dev - 0x30) : dev === 0x60 ? 'C' : dev >= 0x40 && dev <= 0x43 ? 'P' : dev >= 0x50 && dev <= 0x53 ? 'R' : dev >= 0x70 && dev <= 0x7f ? 'N' : null);
  // XF551-style drive pictures (front view) for D1-D8: LED follows SIO activity, the sleeve shows when a disk is mounted.
  const xfEl = {};
  const ramOn = () => $('ramd8').checked;
  const xfSync = {};
  for (let n = 1; n <= 8; n++) {
    const d = document.createElement('div');
    d.className = 'xf';
    d.innerHTML = `<svg viewBox="0 0 220 64" aria-hidden="true">
      <rect x="2" y="2" width="216" height="60" rx="5" fill="#ebe8e1" stroke="#9c988e"/>
      <rect x="2" y="2" width="216" height="9" rx="4" fill="#f7f5f0"/>
      <rect x="14" y="20" width="150" height="24" rx="2" fill="#1d1d1f" stroke="#55524b"/>
      <rect class="disk" x="22" y="26" width="134" height="12" rx="1" fill="#fbfaf6" stroke="#d0cdc4"/><rect class="disk" x="30" y="29" width="30" height="6" fill="#d9362c"/>
      <rect x="22" y="31.5" width="140" height="1.6" fill="#000"/>
      <g class="ramtag"><rect x="22" y="24" width="134" height="16" rx="2" fill="#2f7d4f" stroke="#9fd8b4"/><text x="89" y="36" text-anchor="middle" font-size="11" font-weight="bold" fill="#e8fff0" font-family="Consolas,monospace">RAM DISK</text></g>
      <rect x="68" y="46" width="50" height="7" rx="2" fill="#a8a49a"/>
      <circle class="led" cx="196" cy="50" r="4"/>
      <text x="210" y="32" text-anchor="end" font-size="14" font-weight="bold" fill="#5f5b52" font-family="Consolas,monospace">D${n}:</text>
    </svg><div class="nm">empty</div>`;
    $('drvviz').append(d);
    xfEl[n] = d;
    bindPic(d, () => $('f' + n).click(), (x, y) => drvMenu(n, x, y), (files) => loadMedia(files, n));
    const span = $('d' + n);
    const sync = () => {
      const t = span.textContent.trim();
      const ram = n === 8 && ramOn();
      d.classList.toggle('ram', ram);
      d.classList.toggle('has', !!t && t !== 'empty');
      d.querySelector('.nm').textContent = ram ? 'RAM disk' + (t && t !== 'empty' ? ' (a disk image is also mounted here: ' + t + ')' : ' (not a disk image)') : t || 'empty';
    };
    xfSync[n] = sync;
    new MutationObserver(sync).observe(span, { childList: true, characterData: true, subtree: true });
    sync();
  }
  // Click = load a file, right-click / long-press = menu, drop a file = load it here.
  function bindPic(el, onClick, menu, onDrop) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => { if (Date.now() >= PM.suppressClickUntil) onClick(); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (Date.now() - PM.openedAt > 700) menu(e.clientX, e.clientY); });
    let t = null, sx = 0, sy = 0;
    const clear = () => { clearTimeout(t); t = null; };
    el.addEventListener('touchstart', (e) => {
      const p = e.touches[0]; sx = p.clientX; sy = p.clientY; clear();
      t = setTimeout(() => { t = null; PM.suppressClickUntil = Date.now() + 800; if (Date.now() - PM.openedAt > 700) menu(sx, sy); }, 450);
    }, { passive: true });
    el.addEventListener('touchmove', (e) => { const p = e.touches[0]; if (Math.abs(p.clientX - sx) + Math.abs(p.clientY - sy) > 10) clear(); }, { passive: true });
    el.addEventListener('touchend', clear); el.addEventListener('touchcancel', clear);
    el.style.webkitTouchCallout = 'none'; el.style.userSelect = 'none';
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.remove('drop'); if (e.dataTransfer.files.length) onDrop(e.dataTransfer.files); });
  }
  // The old blank/browse/save controls take their drive from a hidden value: borrow it, press the button, put it back.
  const viaVal = (id, v, fn) => { const h = $(id), old = h.value; h.value = String(v); try { fn(); } finally { h.value = old; } };
  function insertBlank(n, fmt, f) {
    const sd = $('blanksdfs'), md = $('blankmydos'), fm = $('blankfmt'), o = [sd.checked, md.checked, fm.value];
    sd.checked = !!f.sd; md.checked = !!f.md; fm.value = fmt;
    try { viaVal('blankslot', n, () => $('blankmk').click()); } finally { sd.checked = o[0]; md.checked = o[1]; fm.value = o[2]; }
  }
  function blankMenu(n, x, y) {
    openPick(x, y, `Blank disk for D${n}:`, [...$('blankfmt').options].map((o) => ({
      label: o.textContent,
      run: () => {
        const [ss, sec] = o.value.split(',').map(Number);
        const fs = [{ label: 'Unformatted (format with your DOS)' }];
        if (ss === 256) fs.push({ label: 'Pre-formatted SpartaDOS / BW-DOS (SDFS)', sd: true });
        if (ss === 256 || (ss === 128 && sec === 720)) fs.push({ label: 'Pre-formatted MyDOS', md: true });
        if (fs.length === 1) insertBlank(n, o.value, fs[0]);
        else openPick(x, y, o.textContent, fs.map((f) => ({ label: f.label, run: () => insertBlank(n, o.value, f) })));
      },
    })));
  }
  function driveProps(n) {
    const d = S.disks[n], box = $('fslist');
    if (!d) { box.textContent = `D${n}: empty`; return box.textContent; }
    const b = (S.emu && S.emu.readDisk(n)) || d.bytes;
    let t = `D${n}: ${d.name}\n${b.length} bytes${S.dirty[n] ? ', changed since loading' : ''}`;
    if (b[0] === 0x96 && b[1] === 0x02) {
      const ss = b[4] | (b[5] << 8), par = b[2] | (b[3] << 8) | (b[6] << 16);
      t += `\nATR, ${ss}-byte sectors, ${Math.round(par * 16 / ss)} sectors`;
    }
    const v = AC.DosFs && AC.DosFs.open(b);
    t += v ? `\nFile system: ${v.kind.toUpperCase()}${v.label ? ' ' + v.label : ''}, ${v.readOnly ? 'read-only here' : 'writable here'}` : '\nFile system: not recognised (boot disk or custom format)';
    if (S.folders && S.folders[n]) t += `\nMirrors host folder "${S.folders[n].handle.name}"`;
    box.textContent = t;
    return t;
  }
  function moveDisk(from, to) {
    if (from === to || !S.disks[from]) return;
    if (S.emu) syncDisks(true);
    const a = S.disks[from], b = S.disks[to];
    const place = (n, d, dirty) => {
      if (S.emu) { S.emu.ejectDisk(n); if (S.emu.diskPaths) delete S.emu.diskPaths[n]; }
      if (!d) { delete S.disks[n]; delete S.dirty[n]; delete S.pend[n]; $('d' + n).textContent = 'empty'; $('f' + n).value = ''; return; }
      if (S.emu && !S.emu.mountDisk(n, d.name, d.bytes)) log(`could not mount ${d.name} in D${n}`);
      S.disks[n] = d; S.dirty[n] = dirty; S.pend[n] = false; $('d' + n).textContent = d.name;
    };
    const da = !!S.dirty[from], db = !!S.dirty[to];
    place(from, b, db); place(to, a, da);
    if (typeof shadow !== 'undefined') { shadow[from] = S.disks[from]; shadow[to] = S.disks[to]; }
    log(b ? `D${from}: and D${to}: swapped` : `D${from}: moved to D${to}:`);
  }
  function drvMenu(n, x, y) { openPick(x, y, `D${n}: ${S.disks[n] ? S.disks[n].name : 'empty'}`, drvItems(n, x, y)); }
  function drvItems(n, x, y) {
    const have = S.disks[n];
    const items = [
      { label: 'Load from file explorer…', run: () => $('f' + n).click() },
      { label: have ? 'Eject' : 'Eject (nothing mounted)', run: () => $('de' + n).click() },
      { label: 'Insert blank disk…', run: () => blankMenu(n, x, y) },
    ];
    if (have) for (let t = 1; t <= 8; t++) if (t !== n) items.push({ label: `Move to D${t}:${S.disks[t] ? ' (swap with ' + S.disks[t].name + ')' : ''}`, run: () => moveDisk(n, t) });
    const pick = (id, fn) => { $(id).value = String(n); fn(); };
    if (have) items.push(
      { label: 'Open in WebAFM (left pane)', run: () => AC.WebAfm.openDrive(0, n) },
      { label: 'Open in WebAFM (right pane)', run: () => AC.WebAfm.openDrive(1, n) },
      { label: 'Properties…', run: () => driveProps(n) },
      { label: 'Browse files', run: () => pick('fsdrv', () => $('fsbrowse').click()) },
      { label: 'Add files…', run: () => pick('fsdrv', () => {
        const p = prompt(`Folder on D${n}: for the added files (blank = top level; only used on SDFS / MyDOS disks)`, $('fspath').value);
        if (p === null) return;
        $('fspath').value = p; $('fsadd').click();
      }) },
      { label: 'Save disk image', run: () => viaVal('savedrv', n, () => $('savedisk').click()) },
      { label: 'Save all files (.zip)', run: () => pick('fsdrv', () => $('fszip').click()) },
      { label: 'Sync back to folder', run: () => pick('fsdrv', () => $('fssync').click()) });
    items.push({ label: 'Mount host folder as SDFS…', run: () => {
      const mb = prompt('Spare space to leave free on the disk, in MB (0-15)', $('fsfree').value);
      if (mb === null) return;
      $('fsfree').value = mb; pick('fsdrv', () => $('fsmount').click());
    } });
    if (n === 8) items.push({ label: ramOn() ? 'Unmark D8: as a RAM disk' : 'Mark D8: as a RAM disk', run: () => $('ramd8').click() });
    return items;
  }
  const cartItems = (n) => [
    { label: 'Load from file explorer…', run: () => $('c' + n).click() },
    { label: 'Eject', run: () => $('ce' + n).click() },
  ];
  for (const [host, n] of [['drvviz', 1], ['drvviz', 2]]) {
    const d = document.createElement('div');
    d.className = 'xf cart';
    d.title = n === 1 ? 'Cartridge 1 (main, right slot)' : 'Cartridge 2 (left slot)';
    d.innerHTML = `<svg viewBox="0 0 220 68" aria-hidden="true">
      <rect x="2" y="2" width="216" height="64" rx="6" fill="#ebe8e1" stroke="#9c988e"/>
      <rect x="2" y="2" width="216" height="9" rx="4" fill="#f7f5f0"/>
      <rect class="slot" x="12" y="12" width="196" height="50" rx="3" fill="#121214" stroke="#55524b"/>
      <g class="ribs" stroke="#2c2c30" stroke-width="1.2">${[...Array(15)].map((_, i) => `<line x1="${34 + i * 10.4}" y1="16" x2="${34 + i * 10.4}" y2="58"/>`).join('')}</g>
      <image class="cartimg" href="img/cart-top.png" x="26" y="13" width="168" height="48" preserveAspectRatio="none"/>
      <g class="mt"><rect x="14" y="14" width="9" height="46" rx="2" fill="#c9ccd1" stroke="#7c8088"/><rect x="16" y="18" width="2.5" height="38" fill="#f4f6f8"/><rect x="197" y="14" width="9" height="46" rx="2" fill="#c9ccd1" stroke="#7c8088"/><rect x="199" y="18" width="2.5" height="38" fill="#f4f6f8"/></g>
      <text class="ct" x="210" y="9.5" text-anchor="end" font-size="8" font-weight="bold" font-family="Consolas,monospace">CART ${n}:</text>
    </svg><div class="nm">empty</div>`;
    $(host).append(d);
    const span = $('cn' + n);
    const sync = () => {
      const t = span.textContent.replace(/^[^:]*:\s*/, '').trim();
      d.classList.toggle('has', !!t && t !== 'empty');
      d.querySelector('.nm').textContent = t || 'empty';
    };
    new MutationObserver(sync).observe(span, { childList: true, characterData: true, subtree: true });
    sync();
    bindPic(d, () => $('c' + n).click(), (x, y) => openPick(x, y,     `Cart ${n}: ${(S.carts[n] && S.carts[n].name) || 'empty'}`, cartItems(n)), (files) => insertCart(n, files[0]));
  }
  const tapeItems = () => [
    { label: 'Load from file explorer…', run: () => $('tape').click() },
    { label: 'Eject', run: () => $('te').click() },
    { label: 'Boot tape (Start held)', run: () => $('tboot').click() },
    { label: 'Rewind', run: () => $('trew').click() },
  ];
  {
    const d = document.createElement('div');
    d.className = 'xf tape';
    d.title = 'Cassette recorder (C:)';
    const reel = (cx) => `<g class="reel" style="transform-origin:${cx}px 33px"><circle cx="${cx}" cy="33" r="11" fill="#2a2a2e" stroke="#777"/><circle cx="${cx}" cy="33" r="3" fill="#ddd"/>${[0, 60, 120, 180, 240, 300].map((a) => `<line x1="${cx}" y1="33" x2="${cx + 9 * Math.cos(a * Math.PI / 180)}" y2="${33 + 9 * Math.sin(a * Math.PI / 180)}" stroke="#ddd" stroke-width="1.6"/>`).join('')}</g>`;
    d.innerHTML = `<svg viewBox="0 0 220 68" aria-hidden="true">
      <rect x="2" y="2" width="216" height="64" rx="6" fill="#ebe8e1" stroke="#9c988e"/>
      <rect x="2" y="2" width="216" height="9" rx="4" fill="#f7f5f0"/>
      <rect x="14" y="14" width="140" height="44" rx="3" fill="#121214" stroke="#55524b"/>
      <g class="tapeimg"><rect x="20" y="18" width="128" height="36" rx="3" fill="#c9c2ae" stroke="#8a8474"/><rect x="28" y="22" width="112" height="12" fill="#fbfaf6"/><rect x="28" y="22" width="30" height="12" fill="#d9362c"/>${reel(58)}${reel(110)}</g>
      <rect x="162" y="18" width="14" height="10" rx="2" fill="#a8a49a"/><rect x="180" y="18" width="14" height="10" rx="2" fill="#a8a49a"/><rect x="198" y="18" width="12" height="10" rx="2" fill="#a8a49a"/>
      <circle class="led" cx="196" cy="50" r="4"/>
      <text x="210" y="9.5" text-anchor="end" font-size="8" font-weight="bold" fill="#5f5b52" font-family="Consolas,monospace">C: CASSETTE</text>
    </svg><div class="nm">empty</div>`;
    $('drvviz').append(d);
    xfEl.C = d;
    const span = $('tn');
    const sync = () => {
      const t = span.textContent.trim();
      d.classList.toggle('has', !!t && t !== 'empty');
      d.querySelector('.nm').textContent = t || 'empty';
    };
    new MutationObserver(sync).observe(span, { childList: true, characterData: true, subtree: true });
    sync();
    bindPic(d, () => $('tape').click(), (x, y) => openPick(x, y, 'C: cassette: ' + (span.textContent.trim() || 'empty'), tapeItems()), (files) => loadAny(files[0], false, 'tape'));
  }
  const devTimer = {};
  $('ramd8').checked = localStorage.getItem('ac.ramd8') === '1';
  $('ramd8').onchange = () => { localStorage.setItem('ac.ramd8', $('ramd8').checked ? '1' : '0'); xfSync[8](); };
  xfSync[8]();
  function devFlash(id, cls) {    const xf = id === 'C' ? xfEl.C : xfEl[id && id[0] === 'D' ? +id.slice(1) : 0];
    if (xf) {
      xf.classList.remove('rd', 'wr', 'ot'); xf.classList.add(cls);
      clearTimeout(xf._t); xf._t = setTimeout(() => xf.classList.remove('rd', 'wr', 'ot'), 140);
    }
    const el = devEl[id];
    if (!el) return;
    el.classList.remove('rd', 'wr', 'ot');
    el.classList.add(cls);
    clearTimeout(devTimer[id]);
    devTimer[id] = setTimeout(() => el.classList.remove('rd', 'wr', 'ot'), 140);
  }
  // H: is handled by the emulator's host-file layer (not SIO), so watch the in-memory /host files instead.
  function hookHost(emu) {
    const FS = emu.m.FS;
    let quiet = 0;
    const isHost = (s) => !quiet && s && typeof s.path === 'string' && s.path.startsWith('/host');
    const open = FS.open, read = FS.read, write = FS.write;
    FS.open = function (path, flags, ...r) {
      const s = open.call(this, path, flags, ...r);
      if (!quiet && typeof path === 'string' && path.startsWith('/host')) devFlash('H', typeof flags === 'number' && (flags & 3) ? 'wr' : 'ot');
      return s;
    };
    FS.read = function (s, ...r) { if (isHost(s)) devFlash('H', 'rd'); return read.call(this, s, ...r); };
    FS.write = function (s, ...r) { if (isHost(s)) devFlash('H', 'wr'); return write.call(this, s, ...r); };
    for (const k of ['hostFiles', 'hostWrite', 'hostDelete']) {
      const f = emu[k];
      emu[k] = function (...a) { quiet++; try { return f.apply(this, a); } finally { quiet--; } };
    }
  }  function hookDevices() {
    const m = S.emu.m, inner = m.acSio;
    hookHost(S.emu);
    S.emu.onActivity = (id, kind) => {
      devFlash(id, kind);
      const n = /^D[1-8]$/.test(id) ? +id[1] : 0;
      if (n) { S.io[n] = performance.now(); if (kind === 'wr') S.dirty[n] = S.pend[n] = true; else if (S.emu.aw) S.pend[n] = true; }
    };
    m.acSio = (dev, cmd, dstats, aux, data, len) => {
      const id = devId(dev);
      if (id) devFlash(id, cmd === 0x52 ? 'rd' : cmd === 0x57 || cmd === 0x50 ? 'wr' : 'ot');
      if (dev >= 0x31 && dev <= 0x38) S.io[dev - 0x30] = performance.now();
      if (dev >= 0x31 && dev <= 0x38 && (cmd === 0x57 || cmd === 0x50 || cmd === 0x21 || cmd === 0x22 || cmd === 0x23)) { S.dirty[dev - 0x30] = true; S.pend[dev - 0x30] = true; }
      return inner ? inner(dev, cmd, dstats, aux, data, len) : 0;
    };
  }
  let tapePosPrev = -1;
  function pollTape() {
    if ($('tn').textContent === 'empty') { tapePosPrev = -1; return; }
    const p = S.emu.tapeInfo().pos;
    if (tapePosPrev >= 0 && p !== tapePosPrev) devFlash('C', 'rd');
    tapePosPrev = p;
  }
  setInterval(() => {
    for (let n = 1; n <= 8; n++) {
      devEl['D' + n].classList.toggle('has', !!S.disks[n] || !!(FujiNet.slots && FujiNet.slots[n - 1] && FujiNet.slots[n - 1].mounted && FujiNet.enabled));
      devEl['D' + n].classList.toggle('unsaved', !!S.dirty[n] && !!(S.emu && S.emu.diskPaths && S.emu.diskPaths[n]));
    }
    try { devEl.H.classList.toggle('has', !!S.emu && S.emu.m.FS.readdir('/host').length > 2); } catch (e) { /* not booted */ }
    devEl.K1.classList.toggle('has', !!S.carts[1]);
    devEl.K2.classList.toggle('has', !!S.carts[2]);
    devEl.C.classList.toggle('has', $('tn').textContent !== 'empty');
    devEl.N.classList.toggle('has', !!FujiNet.enabled);
    for (const id of Object.keys(devEl)) { const sm = devEl[id].querySelector('small'), t = devShort(id); if (sm.textContent !== t) sm.textContent = t; }
  }, 400);

  // ---- device bar: short state in the bar, details on hover, a dialog for just that device on click ----
  function devShort(id) {
    if (id[0] === 'D' && id.length === 2) { const n = +id[1]; return S.disks[n] ? S.disks[n].name.replace(/\.[^.]*$/, '') : (n === 8 && ramOn() ? 'RAM' : ''); }
    if (id[0] === 'K') { const c = S.carts[+id[1]]; return c ? c.name.replace(/\.[^.]*$/, '') : ''; }
    if (id === 'C') { const t = $('tn').textContent; return t === 'empty' ? '' : t.replace(/\.[^.]*$/, ''); }
    if (id === 'N') return FujiNet.enabled ? 'on' : '';
    return '';
  }
  function devInfo(id) {
    const st = devEl[id].classList.contains('rd') ? 'reading' : devEl[id].classList.contains('wr') ? 'writing' : devEl[id].classList.contains('ot') ? 'busy' : 'idle';
    const L = [];
    let title = id, acts = [];
    if (id[0] === 'D' && id.length === 2) {
      const n = +id[1], d = S.disks[n];
      title = `Drive D${n}:`;
      L.push(d ? `Disk: ${d.name}` : 'Empty - no disk inserted');
      if (d) { L.push(`Size: ${d.bytes.length} bytes`); if (S.dirty[n]) L.push('Changed since loading (not saved)'); }
      if (n === 8 && ramOn()) L.push('Marked as a RAM disk');
      if (d) L.push('', ...driveProps(n).split('\n').slice(2));
      acts = drvItems(n, innerWidth / 2, innerHeight / 3);
    } else if (id[0] === 'K') {
      const n = +id[1], c = S.carts[n];
      title = `Cartridge ${n} (${n === 1 ? 'main, right slot' : 'left slot'})`;
      L.push(c ? `Cartridge: ${c.name}` : 'Empty - no cartridge inserted');
      if (c) { L.push(`Size: ${c.bytes.length} bytes`); if (c.type != null) L.push(`Cartridge type: ${c.type}`); }
      acts = cartItems(n);
    } else if (id === 'H') {
      title = 'H: host files';
      let n = 0; try { n = S.emu.m.FS.readdir('/host').length - 2; } catch (e) { /* not booted */ }
      L.push(n > 0 ? `${n} file(s) shared with the emulator` : 'No host files shared');
    } else if (id === 'C') {
      title = 'C: cassette';
      const has = $('tn').textContent !== 'empty';
      L.push(has ? 'Tape: ' + $('tn').textContent : 'Empty - no tape loaded');
      if (has && S.emu) { const ti = S.emu.tapeInfo(); if (ti && ti.pos != null) L.push('Position: block ' + ti.pos + (ti.size ? ' of ' + ti.size : '')); }
      acts = tapeItems();
    } else if (id === 'N') {
      title = 'N: FujiNet';
      L.push(FujiNet.enabled ? 'FujiNet emulation is on' : 'FujiNet emulation is off');
    } else {
      title = id + ':';
      L.push(id === 'P' ? 'Printer device (output is captured)' : id === 'R' ? 'RS-232 serial (R:) device' : '');
    }
    L.push('', 'Activity: ' + st + ' (green read, red write, yellow other)');
    return { title, lines: [title, ...L], body: L, acts };
  }
  function devDialog(id) {
    const info = devInfo(id);
    let dlg = $('devdlg');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'devdlg'; document.body.append(dlg); }
    dlg.innerHTML = '';
    dlg.style.cssText = 'background:#1b1e24;color:#e6e0d4;border:1px solid #4a5160;border-radius:10px;min-width:260px;max-width:min(92vw,420px)';
    const h = document.createElement('h3'); h.textContent = info.title; h.style.margin = '0 0 8px';
    const p = document.createElement('pre'); p.textContent = info.body.join('\n'); p.style.cssText = 'white-space:pre-wrap;margin:0 0 10px;font:12px ui-monospace,Consolas,monospace';
    dlg.append(h, p);
    for (const it of info.acts) {
      const b = document.createElement('button'); b.textContent = it.label; b.style.cssText = 'display:block;width:100%;margin:4px 0;text-align:left';
      b.onclick = () => { dlg.close(); it.run(); };
      dlg.append(b);
    }
    const c = document.createElement('button'); c.textContent = 'Close'; c.style.cssText = 'display:block;width:100%;margin-top:8px'; c.onclick = () => dlg.close();
    dlg.append(c);
    dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
    dlg.showModal();
  }

  // ---- diagnostics log ----
  const diagText = () => {
    const st = S.emu ? JSON.stringify({ carts: Object.fromEntries(Object.entries(S.carts).map(([k, c]) => [k, { name: c.name, size: c.bytes.length, type: c.type }])), disks: Object.fromEntries(Object.entries(S.disks).map(([k, d]) => [k, d.name])), tape: $('tn').textContent, model: $('model').value, basic: $('basic').checked }) : 'not booted';
    return `ataricraft diagnostics\nsaved ${new Date().toISOString()}\nstate: ${st}\n\n${DIAG.join('\n')}\n`;
  };
  const syncDiag = () => { $('diagcount').textContent = DIAG.length + ' lines'; };
  syncDiag();
  setInterval(syncDiag, 2000);
  $('diagclear').onclick = () => { DIAG = []; localStorage.removeItem('ac.diag'); syncDiag(); };
  $('diagsave').onclick = async () => {
    diag('log saved by user');
    const name = 'ataricraft-diag-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.txt';
    const blob = new Blob([diagText()], { type: 'text/plain' });
    try {
      if (window.showSaveFilePicker) {
        const h = await showSaveFilePicker({ suggestedName: name, id: 'ataricraft-diag', types: [{ description: 'Text', accept: { 'text/plain': ['.txt'] } }] });
        const w = await h.createWritable(); await w.write(blob); await w.close();
        log('diagnostics saved: ' + h.name);
        return;
      }
    } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    log('diagnostics downloaded: ' + name);
  };

  // ---- cassette ----
  $('tape').onchange = (e) => e.target.files[0] && loadAny(e.target.files[0], false, 'tape');
  $('te').onclick = () => { S.tape = null; if (!S.emu) { $('tn').textContent = 'empty'; $('tape').value = ''; return; } S.emu.tapeEject(); $('tn').textContent = 'empty'; $('tape').value = ''; $('tpos').textContent = ''; };
  $('tboot').onclick = () => { if (S.emu && S.emu.tapeInfo().status) S.emu.tapeBoot(); };
  $('trew').onclick = () => { if (S.emu) S.emu.tapeRewind(); };
  setInterval(() => {
    if (!S.emu) return;
    const t = S.emu.tapeInfo();
    $('tpos').textContent = t.status && t.size ? `block ${t.pos} / ${t.size}` : '';
  }, 500);

  // ---- virtual FujiNet host node (folder browser; no SIO network emulation yet) ----
  const FN = { files: [], open: new Set(), tree: localStorage.getItem('ac.fntree') !== '0', handle: null };
  const FN_IMG = /\.(atr|atx|dcm|pro|gz|xex|com|bas|xfd)$/i;
  function renderFn() {
    const q = $('fnfilter').value.toLowerCase();
    const box = $('fnlist');
    box.innerHTML = '';
    const fqm = textMatcher(q);
    const hits = FN.files.filter((f) => fqm(f.name));
    $('fnview').textContent = FN.tree ? '☰' : '🗂';
    $('fnview').title = FN.tree ? 'Tree view (click for flat list)' : 'List view (click for folder tree)';
    ['fnexpand', 'fncollapse'].forEach((id) => ($(id).style.display = FN.tree ? '' : 'none'));
    box.style.maxHeight = FN.tree ? '360px' : '170px';
    if (FN.tree) { drawTree(box, hits, !!q && hits.length <= 600, { open: FN.open, redraw: renderFn }); return; }
    hits.slice(0, 300).forEach((f) => {
      const d = document.createElement('div');
      d.textContent = f.name;
      d.style.cssText = 'padding:3px 4px;cursor:pointer;font-size:12px;border-bottom:1px solid #2c313b';
      d.onmouseenter = () => (d.style.background = '#2a2f39');
      d.onmouseleave = () => (d.style.background = '');
      attachLoad(d, f, f.kind, async () => f.file);
      box.append(d);
    });
  }
  function setFnFiles(list, label) {
    FN.files = list.map((f) => ({ name: f.name, file: f.file, kind: extKind(f.name) || 'disk' }));
    $('fncount').textContent = (label ? label + ': ' : '') + FN.files.length + ' images';
    FujiNet.setFiles(FN.files.map((f) => ({ rel: f.name, file: f.file })));
    renderFn();
  }
  $('fnfolder').onchange = async (e) => {
    const fl = (await expandZips([...e.target.files])).filter((f) => FN_IMG.test(f.name));
    setFnFiles(fl.map((f) => ({ name: f.webkitRelativePath || f.name, file: f })));
  };
  // Pass 1 lists names only (fast); pass 2 opens the image files 8 at a time. Both report progress and skip unreadable entries.
  async function scanFnHandle(h, path, out, st) {
    try {
      for await (const [name, e] of h.entries()) {
        if (st.stop) return;
        if (e.kind === 'directory') {
          if (SCAN_SKIP.test(name) || name.startsWith('.')) continue;
          await scanFnHandle(e, path + name + '/', out, st);
        } else {
          st.seen++;
          if (FN_IMG.test(name)) out.push({ path: path + name, e });
          if (Date.now() - st.tick > 150) { st.tick = Date.now(); st.prog.text('Listing ' + path); st.prog.note(`${out.length} images, ${st.seen} files checked`); $('fncount').textContent = `scanning… ${out.length} images - ${path}`; await new Promise((r) => setTimeout(r)); }
        }
      }
    } catch (err) { st.errs++; diag(`SD scan skipped folder "${path}": ${err.name} ${err.message}`, 'warn'); }
  }
  async function loadFnHandle(h, ask) {
    if ((await h.queryPermission({ mode: 'read' })) !== 'granted') {
      if (!ask) { $('fncount').textContent = `"${h.name}" remembered: click Rescan`; return; }
      if ((await h.requestPermission({ mode: 'read' })) !== 'granted') return;
    }
    $('fncount').textContent = 'scanning…';
    const st = { stop: false, seen: 0, errs: 0, tick: 0, prog: AC.Progress.begin('Scanning "' + h.name + '"…') };
    const found = [], out = [];
    try {
      await scanFnHandle(h, h.name + '/', found, st);
      st.prog.text('Opening image files'); st.prog.set(0, found.length);
      let i = 0, done = 0;
      const worker = async () => {
        while (i < found.length) {
          const it = found[i++];
          try {
            const file = await it.e.getFile();
            Object.defineProperty(file, 'webkitRelativePath', { value: it.path });
            out.push({ name: it.path, file });
          } catch (err) { st.errs++; diag(`SD scan skipped "${it.path}": ${err.name} ${err.message}`, 'warn'); }
          done++;
          if (done % 20 === 0) { st.prog.set(done); st.prog.note(it.path.split('/').pop()); $('fncount').textContent = `scanning… ${done}/${found.length}`; await new Promise((r) => setTimeout(r)); }
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
    } finally { st.prog.end(); }
    out.sort((a, b) => (a.name < b.name ? -1 : 1));
    if (st.errs) log(`${st.errs} unreadable SD entries skipped`);
    setFnFiles(out);
  }
  if (window.showDirectoryPicker) {
    ['fnpick', 'fnrescan'].forEach((id) => ($(id).style.display = ''));
    $('fnpick').onclick = async () => {
      let h;
      try { h = await showDirectoryPicker({ id: 'ataricraft-fujinet', mode: 'read' }); } catch (e) { return; }
      FN.handle = h; await idbSet('fnDir', h); await loadFnHandle(h, true);
    };
    $('fnrescan').onclick = async () => {
      if (!FN.handle) { log('no remembered FujiNet folder yet: use Pick folder'); return; }
      try { await loadFnHandle(FN.handle, true); log('FujiNet SD rescanned'); } catch (e) { log('rescan failed: ' + e.message); }
    };
    idbGet('fnDir').then(async (h) => { if (!h) return; FN.handle = h; try { await loadFnHandle(h, false); } catch (e) {} });
  }
  $('fnview').onclick = () => { FN.tree = !FN.tree; localStorage.setItem('ac.fntree', FN.tree ? '1' : '0'); renderFn(); };
  $('fnexpand').onclick = () => { allDirs(treeOf(FN.files), []).forEach((p) => FN.open.add(p)); renderFn(); };
  $('fncollapse').onclick = () => { FN.open.clear(); renderFn(); };
  function syncFnUi() {
    $('fnbtn').classList.toggle('on', FujiNet.enabled);
    $('fnboot').disabled = !FujiNet.enabled;
  }
  $('fnbtn').onclick = () => {
    FujiNet.enabled = !FujiNet.enabled;
    localStorage.setItem('ac.fujinet', FujiNet.enabled ? '1' : '0');
    syncFnUi();
    if (S.emu && S.emu.fnDevice) S.emu.fnDevice(FujiNet.enabled);
    log('FujiNet ' + (FujiNet.enabled ? 'on' : 'off (device $70 absent; takes effect immediately, reset to reboot)'));
    if (FujiNet.enabled && S.emu && !S.off) { FujiNet.bootConfig(); $('d1').textContent = 'FujiNet CONFIG'; }
  };
  syncFnUi();
  $('fnreset').onclick = () => { FujiNet.reset(); renderHosts(); log('FujiNet config reset (hosts and drive slots cleared)'); };
  function renderHosts() {
    const box = $('fnhosts');
    box.innerHTML = '';
    $('fnpub').innerHTML = FujiNet.publicHosts.map((h) => `<option value="${h}">`).join('');
    FujiNet.hosts.forEach((h, i) => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;gap:6px;align-items:center;margin:2px 0';
      const n = document.createElement('span');
      n.textContent = i + 1; n.style.cssText = 'width:12px;color:#8b93a1';
      const inp = document.createElement('input');
      inp.value = h; inp.setAttribute('list', 'fnpub');
      inp.style.cssText = 'flex:1;min-width:0;background:#14161a;color:#d8dce4;border:1px solid #2c313b;border-radius:5px;padding:3px 5px';
      if (i === 0) { inp.disabled = true; inp.title = 'Reserved for local files (the folder you point at)'; }
      else inp.onchange = () => { FujiNet.hosts[i] = inp.value.trim().slice(0, 31); FujiNet.save(); };
      r.append(n, inp);
      box.append(r);
    });
  }
  renderHosts();
  const probed = new Map(); // host -> ms, or <0 for no answer
  function renderMaster() {
    const box = $('fnmlist');
    box.innerHTML = '';
    FujiNet.publicHosts.forEach((h) => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;gap:6px;align-items:center;margin:1px 0';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = !FujiNet.off.has(h);
      cb.onchange = () => { if (cb.checked) FujiNet.off.delete(h); else FujiNet.off.add(h); FujiNet.saveMaster(); renderMaster(); };
      const dot = document.createElement('span');
      const p = probed.get(h);
      dot.textContent = '●';
      dot.style.color = p === undefined ? '#555' : p >= 0 ? '#4c4' : '#d44';
      dot.title = p === undefined ? 'not checked' : p >= 0 ? 'answered in ' + p + ' ms' : 'no answer';
      const nm = document.createElement('span');
      nm.textContent = h; nm.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis';
      const x = document.createElement('button');
      x.textContent = '✕'; x.title = 'Remove from the list';
      x.onclick = () => { FujiNet.removeHost(h); renderMaster(); };
      r.append(cb, dot, nm, x);
      box.append(r);
    });
    const sel = FujiNet.selected().length, per = 7;
    $('fnmcount').textContent = '(' + sel + ' of ' + FujiNet.publicHosts.length + ' ticked)';
    const pg = $('fnmpages');
    pg.innerHTML = '';
    for (let i = 0; i < FujiNet.pageCount(); i++) {
      const b = document.createElement('button');
      const a = i * per + 1, z = Math.min(sel, (i + 1) * per);
      b.textContent = sel ? a + '-' + z : '-';
      b.title = 'Put ticked servers ' + a + '-' + z + ' into host slots 2-8';
      b.onclick = () => { FujiNet.fillPage(i); renderHosts(); $('fnhostmsg').textContent = 'loaded servers ' + a + '-' + z + ' (reboot FujiNet CONFIG to see them)'; };
      pg.append(b);
    }
  }
  renderMaster();
  const addMaster = () => { if (FujiNet.addHost($('fnmadd').value)) { $('fnmadd').value = ''; renderMaster(); renderHosts(); } };
  $('fnmaddbtn').onclick = addMaster;
  $('fnmadd').onkeydown = (e) => { if (e.key === 'Enter') addMaster(); };
  $('fnmall').onclick = () => { FujiNet.off.clear(); FujiNet.saveMaster(); renderMaster(); };
  $('fnmnone').onclick = () => { FujiNet.publicHosts.forEach((h) => FujiNet.off.add(h)); FujiNet.saveMaster(); renderMaster(); };
  $('fnmreset').onclick = () => { FujiNet.resetMaster(); probed.clear(); renderMaster(); renderHosts(); };
  $('fnmcheck').onclick = async () => {
    const b = $('fnmcheck');
    b.disabled = true;
    $('fnhostmsg').textContent = 'checking…';
    const q = FujiNet.publicHosts.slice(), total = q.length;
    let ok = 0, done = 0;
    const worker = async () => {
      for (let h; (h = q.shift());) {
        const ms = await FujiNet.probe(h);
        probed.set(h, ms);
        if (ms >= 0) ok++;
        done++;
        renderMaster();
        if (ms === -2) { q.length = 0; $('fnhostmsg').textContent = 'relay not reachable - start it (see below)'; return; }
        $('fnhostmsg').textContent = 'checking ' + done + '/' + total + '…';
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    b.disabled = false;
    if (!/relay not/.test($('fnhostmsg').textContent)) $('fnhostmsg').textContent = ok + ' of ' + FujiNet.publicHosts.length + ' answered';
  };
  $('fnhostfill').onclick = () => { FujiNet.fillPage(0); renderHosts(); $('fnhostmsg').textContent = 'filled'; };
  $('fnhostrefresh').onclick = async () => {
    $('fnhostmsg').textContent = 'checking…';
    try {
      const n = await FujiNet.refreshPublic();
      renderMaster(); renderHosts();
      $('fnhostmsg').textContent = n.up + ' servers online, ' + n.fresh + ' new added to the list';
    } catch (e) {
      $('fnhostmsg').textContent = 'could not reach fujinet.online (start the TNFS relay to fetch it); list unchanged';
    }
  };
  $('fnboot').onclick = () => {
    if (!S.emu) { log('boot first'); return; }
    if (!FujiNet.enabled) { log('FujiNet is off'); return; }
    FujiNet.bootConfig();
    $('d1').textContent = 'FujiNet CONFIG';
  };
  $('fnfilter').oninput = renderFn;
  $('tnfsurl').value = FujiNet.bridge;
  $('tnfsurl').onchange = () => { FujiNet.bridge = $('tnfsurl').value.trim().replace(/\/$/, ''); localStorage.setItem('ac.tnfsbridge', FujiNet.bridge); FujiNet.down = 0; };
  $('tnfstest').onclick = async () => {
    $('tnfsmsg').textContent = '…';
    try { const t = await (await fetch(FujiNet.bridge + '/ping')).text(); $('tnfsmsg').textContent = /tnfs-bridge/.test(t) ? 'relay running' : 'not the relay'; FujiNet.down = 0; }
    catch (e) { $('tnfsmsg').textContent = 'not running'; }
  };
  // ---- netplay lobby (public, CORS-open list of hosted Altirra games) ----
  const LOBBY = 'https://lobby.atari.org.pl/v1/public/sessions?include_awaiting=1';
  async function lobbyRefresh() {
    const msg = $('lobmsg'), box = $('loblist');
    msg.textContent = 'loading…';
    try {
      const r = await fetch(LOBBY, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const list = await r.json();
      box.textContent = '';
      for (const s of list) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:6px;align-items:center;margin:3px 0';
        const t = document.createElement('span');
        t.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        t.textContent = `${s.cartName} · ${s.hostHandle} · ${s.hardwareMode} ${s.videoStandard} ${s.memoryMode} · ${s.playerCount}/${s.maxPlayers}`;
        t.title = t.textContent;
        row.append(t);
        if (s.requiresCode) row.append(Object.assign(document.createElement('span'), { textContent: '🔒 private' }));
        else if (s.state === 'playing') row.append(Object.assign(document.createElement('span'), { textContent: 'playing', className: 'dim' }));
        else if (/^https:\/\/lobby\.atari\.org\.pl\//.test(s.joinUrl)) {
          const a = document.createElement('a');
          a.href = s.joinUrl; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Join';
          row.append(a);
        }
        box.append(row);
      }
      if (!list.length) box.textContent = 'No one is hosting a game right now.';
      msg.textContent = list.length + ' session' + (list.length === 1 ? '' : 's');
    } catch (e) {
      msg.textContent = 'could not reach the lobby';
    }
  }
  $('lobrefresh').onclick = lobbyRefresh;
  setInterval(() => {
    if ($('lobauto').checked && !document.hidden && document.querySelector('#sidetabs button.on')?.dataset.t === 'net') lobbyRefresh();
  }, 15000);
  document.querySelector('#sidetabs button[data-t="net"]').addEventListener('click', lobbyRefresh);
  // ---- cartridges and eject ----
  S.pendingCart = null;
  const crc32 = (b) => {
    let t = crc32.t;
    if (!t) { t = crc32.t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 255] ^ (c >>> 8);
    return ((c ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
  };
  // ---- blank disks ----
  function blankAtr(secSize, nsec) {
    const len = secSize === 256 ? 384 + (nsec - 3) * 256 : nsec * 128;
    const out = new Uint8Array(16 + len), par = len >> 4;
    out.set([0x96, 0x02, par & 255, (par >> 8) & 255, secSize & 255, secSize >> 8, (par >> 16) & 255]);
    return out;
  }
  const mdOk = (ss, n) => $('blankmydos').checked && (ss === 256 || (ss === 128 && n === 720));
  const makeBlank = (ss, n) => (mdOk(ss, n) ? AC.DosFs.createMyDos({ sectorSize: ss, sectors: n }) : $('blanksdfs').checked && ss === 256 ? AC.DosFs.createSdfs({ sectorSize: 256, sectors: n, label: 'BLANK' }) : blankAtr(ss, n));
  const blankName =  () => { const [ss, n] = $('blankfmt').value.split(',').map(Number); return `blank_${$('blankfmt').selectedOptions[0].textContent.split(' (')[0].replace(/[^\w]+/g, '_')}${mdOk(ss, n) ? '_mydos' : $('blanksdfs').checked && ss === 256 ? '_sdfs' : ''}.atr`; };
  $('blankmk').onclick = () => {
    if (!S.emu) { log('boot first, then insert a blank disk'); return; }
    const [ss, n] = $('blankfmt').value.split(',').map(Number), slot = +$('blankslot').value;
    if ($('blanksdfs').checked && ss !== 256) log('SDFS needs 256-byte sectors: making an unformatted disk instead');
    const bytes = makeBlank(ss, n), name = blankName();
    if (!S.emu.mountDisk(slot, name, bytes)) { log('could not mount the blank disk'); return; }
    S.disks[slot] = { name, bytes };
    S.dirty[slot] = true;
    if ($('d' + slot)) $('d' + slot).textContent = name;
    log(`D${slot}: blank ${$('blankfmt').selectedOptions[0].textContent}. Format it with your DOS (for example DOS XL or DOS 2.5 option I)`);
  };
  // ---- RAM bank test ----
  let memTimer = 0;
  $('memtest').onclick = () => {
    if (!S.emu) { $('memout').textContent = 'boot first (press Boot)'; return; }
    clearInterval(memTimer);
    const ram = S.emu.opt.ram, want = AC.MemTest.expectedBanks(ram), box = $('memout');
    if ($('ram').value !== ram) { box.textContent = `Machine is running ${ram} but the RAM selector says ${$('ram').value}: press Boot first, then run the test.`; return; }
    box.textContent = `RAM option ${ram}: expecting ${want} extended banks. Running…`;
    S.emu.bootFile('memtest.xex', AC.MemTest.program());
    S.running = true;
    const t0 = Date.now();
    memTimer = setInterval(() => {
      const r = AC.MemTest.read(S.emu);
      const ph = ['', 'fill', 'verify', 'fill (inverted)', 'verify (inverted)'][r.phase] || 'probing';
      if (!r.done) { box.textContent = `RAM option ${ram}: expecting ${want} extended banks. ${ph} bank ${r.bank}… ${Math.round((Date.now() - t0) / 1000)} s`; if (Date.now() - t0 > 600000) { clearInterval(memTimer); box.textContent += '\nno result after 10 minutes'; } return; }
      clearInterval(memTimer);
      const ext = r.mainIntact ? r.found : 0;
      const ok = ext === want && r.errors === 0;
      const f = r.first;
      box.textContent = `${ok ? 'PASS' : 'FAIL'}: ${ram} (${S.emu.opt.model || ''})\nExtended banks found: ${ext} (expected ${want})${r.mainIntact ? '' : ' (no bank switching seen)'}\nMemory errors: ${r.errors}` +
        (r.errors ? `\nFirst error: PORTB combo ${f.combo} ($${AC.MemTest.combos()[f.combo].toString(16).toUpperCase()}), page $${f.page.toString(16).toUpperCase()}, expected $${f.expected.toString(16).toUpperCase()} got $${f.got.toString(16).toUpperCase()}, ${['', 'pattern', 'pattern', 'inverted', 'inverted'][f.phase]} pass` : '') +
        `\nTook ${Math.round((Date.now() - t0) / 1000)} s. Press Reset to leave the test.`;
      diag('ram test ' + box.textContent.replace(/\n/g, ' | '));
    }, 300);
  };
  $('fullreset').onclick = async () => {
    if (!confirm('Forget everything stored by this page (catalog, remembered folders, ROMs, settings, log) and reload?\nYour files on disk are not touched.')) return;
    try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* ignore */ }
    try {
      const dbs = indexedDB.databases ? await indexedDB.databases() : [{ name: 'ataricraft' }, { name: 'ataricraft-media' }];
      await Promise.all(dbs.map((d) => new Promise((res) => { const r = indexedDB.deleteDatabase(d.name); r.onsuccess = r.onerror = r.onblocked = () => res(); })));
    } catch (e) { /* ignore */ }
    try {
      if (navigator.storage && navigator.storage.getDirectory) {
        const root = await navigator.storage.getDirectory();
        for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true }).catch(() => { });
      }
    } catch (e) { /* ignore */ }
    location.reload();
  };
  $('blankdl').onclick = () => {
    const [ss, n] = $('blankfmt').value.split(',').map(Number);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([makeBlank(ss, n)], { type: 'application/octet-stream' }));
    a.download = blankName(); a.click();
  };
  // ---- browse / extract / add files on a mounted disk ----
  const fsBytes = (n) => { if (!S.emu) return null; const b = S.emu.readDisk(n); return b || (S.disks[n] && S.disks[n].bytes) || null; };
  const saveBlob = (name, parts, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(parts, { type: type || 'application/octet-stream' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  const crcNum = (b) => parseInt(crc32(b), 16);
  AC.WebAfmHost = {
    disk: (n) => { const d = S.disks[n]; if (!d) return null; return { name: d.name, bytes: (S.emu && S.emu.readDisk(n)) || d.bytes }; },
    commit: (n, bytes) => { const d = S.disks[n]; if (!d) return; if (S.emu) S.emu.mountDisk(n, d.name, bytes); S.disks[n] = { name: d.name, bytes }; S.dirty[n] = true; },
    renameDisk: (n, name) => { const d = S.disks[n]; if (!d) return; d.name = name; S.dirty[n] = true; const el = $('d' + n); if (el) el.textContent = name; },
    running: () => !!(S.emu && !S.off),
    titleFor: (name) => titleFor(name),
    library: () => MED.files.map((f) => ({ name: f.name, kind: f.kind, title: f.title || '' })),
    libraryFile: async (name) => {
      const m = MED.files.find((f) => f.name === name); if (!m) return null;
      const fl = await fileOf(m); if (!fl) return null;
      return new File([await fl.arrayBuffer()], fl.name || name.split('/').pop(), { lastModified: m.modified || (fl.lastModified) || Date.now() });
    },
    save: (name, bytes, type) => saveBlob(name, [bytes], type),
    zip: (files) => storedZip(files),
    log: (s) => log(s),
  };
  function storedZip(files) {
    const parts = [], cd = [];
    let off = 0;
    const enc = new TextEncoder();
    for (const f of files) {
      const nm = enc.encode(f.name), crc = crcNum(f.data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, nm.length, true);
      parts.push(h.buffer, nm, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      cd.push(c.buffer, nm);
      off += 30 + nm.length + f.data.length;
    }
    const cdLen = cd.reduce((s, x) => s + (x.byteLength || x.length), 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdLen, true); e.setUint32(16, off, true);
    return [...parts, ...cd, e.buffer];
  }
  function fsOpen() {
    const n = +$('fsdrv').value, bytes = fsBytes(n);
    if (!bytes) { $('fslist').textContent = `D${n}: is empty`; return null; }
    const v = AC.DosFs.open(bytes);
    if (!v) { $('fslist').textContent = `D${n}: no DOS 2.x / MyDOS / SpartaDOS-family file system found`; return null; }
    return { n, bytes, v };
  }
  function fsShow() {
    const o = fsOpen(); if (!o) return;
    const { n, v } = o, list = v.list(), box = $('fslist');
    box.textContent = '';
    const head = document.createElement('div');
    head.textContent = `D${n}: ${v.kind.toUpperCase()} ${v.label || ''}  ${v.sectors} x ${v.sectorSize} B${v.freeSectors ? ', free ' + v.freeSectors() + ' sectors' : ''}${v.readOnly ? ' (read-only here)' : ''}  ${list.filter((e) => !e.dir).length} files`;
    box.append(head);
    for (const e of list.slice(0, 1000)) {
      const row = document.createElement('div');
      row.textContent = (e.dir ? '[' + e.path + ']' : e.path) + (e.dir ? '' : `  ${e.approxSize ? '~' : ''}${e.size} B  `);
      if (!e.dir) {
        const b = document.createElement('a'); b.href = '#'; b.textContent = 'download'; b.onclick = (ev) => { ev.preventDefault(); saveBlob(e.name, [v.read(e)]); }; row.append(b);
        if (!v.readOnly && v.remove) {
          const r = document.createElement('a'); r.href = '#'; r.textContent = ' remove'; r.onclick = (ev) => {
            ev.preventDefault();
            if (!confirm(`Remove ${e.path} from D${n}:?`)) return;
            try {
              v.remove(e.path);
              const name = (S.disks[n] && S.disks[n].name) || `d${n}.atr`;
              S.emu.mountDisk(n, name, o.bytes); S.disks[n] = { name, bytes: o.bytes }; S.dirty[n] = true;
              log(`D${n}: removed ${e.path}. Press Reset so the DOS rereads the disk.`);
            } catch (er) { log('remove: ' + er.message); }
            fsShow();
          };
          row.append(r);
        }
      }
      box.append(row);
    }
    if (list.length > 1000) box.append('… ' + (list.length - 1000) + ' more (use Save all .zip)');
  }
  $('fsbrowse').onclick = fsShow;
  $('fszip').onclick = async () => {
    const o = fsOpen(); if (!o) return;
    const list = o.v.list().filter((e) => !e.dir), files = [];
    const p = AC.Progress.begin(`Building D${o.n}_files.zip…`, list.length);
    try {
      for (const e of list) { files.push({ name: e.path, data: o.v.read(e) }); p.set(files.length); if (files.length % 20 === 0) await AC.Progress.yieldUI(); }
      p.text('Saving zip…'); await AC.Progress.yieldUI();
      await saveBlob(`D${o.n}_files.zip`, storedZip(files), 'application/zip');
    } finally { p.end(); }
    log(`D${o.n}: saved ${files.length} files as zip`);
  };
  const to83 = (name) => {
    const i = name.lastIndexOf('.'), base = i > 0 ? name.slice(0, i) : name, ext = i > 0 ? name.slice(i + 1) : '';
    const c = (s, k) => s.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, k);
    return c(base, 8) + (ext ? '.' + c(ext, 3) : '');
  };
  $('fsadd').onchange = async (ev) => {
    const files = [...ev.target.files]; ev.target.value = '';
    const o = fsOpen(); if (!o) return;
    if (o.v.readOnly) { log(`D${o.n}: adding files is not possible on this disk (${o.v.kind}, ${o.v.sectorSize}-byte sectors)`); return; }
    const dir = $('fspath').value.trim().toUpperCase().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const added = [], prog = AC.Progress.begin(`Adding files to D${o.n}…`, files.length);
    try {
      for (const f of files) {
        prog.text('Adding ' + f.name); prog.set(added.length);
        const data = await AC.Progress.read(f), nm = to83(f.name);
        o.v.writeFile(dir ? dir + '/' + nm : nm, data);
        const back = o.v.list().find((e) => e.path === (dir ? dir + '/' + nm : nm));
        if (!back || Buffer_eq(o.v.read(back), data) === false) throw new Error('read-back check failed for ' + nm);
        added.push(nm + (nm !== f.name ? ` (from ${f.name})` : ''));
      }
    } catch (e) { log('add files: ' + e.message + (added.length ? '; added before the error: ' + added.join(', ') : '')); }
    finally { prog.end(); }
    if (added.length) {
      const name = (S.disks[o.n] && S.disks[o.n].name) || `d${o.n}.atr`;
      S.emu.mountDisk(o.n, name, o.bytes); S.disks[o.n] = { name, bytes: o.bytes }; S.dirty[o.n] = true;
      log(`D${o.n}: added ${added.length} file(s) (${added.join(', ')}), verified by reading back. Press Reset so the DOS rereads the disk.`);
    }
    fsShow();
  };
  const Buffer_eq = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  // ---- mount a host folder as an SDFS disk, and sync changes back ----
  S.folders = S.folders || {};
  async function readFolder(dir, prefix, out, st) {
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith('.')) continue;
      const p = prefix ? prefix + '/' + name : name;
      if (h.kind === 'directory') await readFolder(h, p, out, st);
      else {
        const f = await h.getFile(); st.total += f.size; if (st.total > (16 << 20)) throw new Error('folder is larger than a 16 MB SDFS image');
        if (st.prog) { st.prog.text('Reading ' + p); st.prog.note(out.length + ' files'); }
        out.push({ path: p, data: await AC.Progress.read(f) });
      }
    }
  }
  async function hostFile(root, path, create) {
    const parts = path.split('/'); let d = root;
    for (let i = 0; i < parts.length - 1; i++) d = await d.getDirectoryHandle(parts[i], { create });
    return d.getFileHandle(parts[parts.length - 1], { create });
  }
  $('fsmount').onclick = async () => {
    if (!window.showDirectoryPicker) { log('Mount folder needs a Chromium browser (File System Access API)'); return; }
    if (!S.emu) { log('boot first'); return; }
    let h; try { h = await showDirectoryPicker({ id: 'ataricraft-folder', mode: 'readwrite' }); } catch (e) { return; }
    const n = +$('fsdrv').value;
    try {
      const files = [], st = { total: 0, prog: AC.Progress.begin('Reading folder "' + h.name + '"…') };
      try { await readFolder(h, '', files, st); } finally { st.prog.end(); }
      const free = Math.max(0, +$('fsfree').value || 0) << 20;
      let r; try { r = AC.DosFs.buildSdfs(files, { freeBytes: free, label: h.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 8) || 'FOLDER' }); }
      catch (e) { if (!free) throw e; r = AC.DosFs.buildSdfs(files, { freeBytes: 0, label: 'FOLDER' }); log('not enough room for spare space; mounted without it'); }
      const name = `folder_${h.name}.atr`;
      S.emu.mountDisk(n, name, r.image); S.disks[n] = { name, bytes: r.image }; S.dirty[n] = false;
      S.folders[n] = { handle: h, orig: new Map(r.entries.map((e) => [e.sdfs, { host: e.host, data: files.find((f) => f.path === e.host).data }])) };
      log(`D${n}: mounted folder "${h.name}" as SDFS, ${files.length} files, ${(st.total / 1024).toFixed(0)} KB, ${r.free} free sectors. Use "Sync back" to write changes to the folder. Press Reset so the DOS rereads the disk.`);
      fsShow();
    } catch (e) { log('mount folder: ' + e.message); }
  };
  $('fssync').onclick = async () => {
    const o = fsOpen(); if (!o) return;
    const F = S.folders[o.n]; if (!F) { log(`D${o.n}: no folder mounted here`); return; }
    if (o.v.kind !== 'sdfs') { log(`D${o.n}: disk is no longer SDFS; not syncing`); return; }
    try {
      if ((await F.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') { log('write permission to the folder was denied'); return; }
      let wrote = 0, same = 0; const seen = new Set();
      const all = o.v.list().filter((e) => !e.dir), sp = AC.Progress.begin(`Syncing D${o.n} to "${F.handle.name}"…`, all.length);
      try { for (const e of all) {
        sp.set(seen.size); sp.text('Syncing ' + e.path);
        seen.add(e.path);
        const data = o.v.read(e), old = F.orig.get(e.path);
        if (old && Buffer_eq(old.data, data)) { same++; continue; }
        const host = old ? old.host : e.path.toLowerCase();
        const fh = await hostFile(F.handle, host, true), w = await fh.createWritable();
        await w.write(data); await w.close();
        F.orig.set(e.path, { host, data }); wrote++;
      } } finally { sp.end(); }
      const gone = [...F.orig.keys()].filter((p) => !seen.has(p));
      log(`D${o.n}: synced to folder "${F.handle.name}": ${wrote} written, ${same} unchanged${gone.length ? `, ${gone.length} deleted on the disk but left in the folder (${gone.slice(0, 5).join(', ')}${gone.length > 5 ? ', …' : ''})` : ''}`);
    } catch (e) { log('sync back: ' + e.message); }
  };
  async function insertCart(slot, file, bytes) {
    if (!S.emu) { log('boot first'); return; }
    bytes = bytes || await AC.Progress.read(file, 'Loading ' + file.name);
    const r = S.emu.insertCart(slot, file.name, bytes);
    diag(`insertCart slot ${slot} "${file.name}" -> ${JSON.stringify(r)}`);
    if (!r.ok) { log('cartridge: ' + r.error); return; }
    $('cn' + slot).textContent = (slot === 1 ? '1 (main, right): ' : '2 (left): ') + file.name;
    S.carts[slot] = { name: file.name, bytes, type: null };
    devFlash('K' + slot, 'rd');
    if (r.kb) {
      const types = S.emu.cartTypes(r.kb);
      $('ctype').innerHTML = '';
      types.forEach((t) => $('ctype').append(new Option(t.name, String(t.id))));
      const known = (AC.CART_DB || {})[crc32(bytes)];
      if (known && [...$('ctype').options].some((o) => +o.value === known[1])) {
        $('ctype').value = String(known[1]);
        S.pendingCart = slot;
        $('ctypeok').onclick();
        log(`cartridge recognised: ${known[2]}${known[3] ? ' (' + known[3] + ')' : ''}, type "${$('ctype').selectedOptions[0].textContent}"`);
        return;
      }
      const pref = /sparta|sdx|spado/i.test(file.name) ? /SpartaDOS X/i : null;
      const hit = pref && [...$('ctype').options].find((o) => pref.test(o.textContent) && (!/128/.test(o.textContent) || r.kb === 128));
      if (hit) {
        $('ctype').value = hit.value;
        S.pendingCart = slot;
        $('ctypeok').onclick();
        if ($('basic').checked) { $('basic').checked = false; $('basic').onchange(); log('SpartaDOS X detected: type set, BASIC turned off'); }
        return;
      }
      const opts = [...$('ctype').options];
      const guess = opts.find((o) => /^Standard/i.test(o.textContent)) || opts.find((o) => !/5200/.test(o.textContent)) || opts[0];
      if (guess) {
        $('ctype').value = guess.value;
        S.pendingCart = slot;
        $('ctypeok').onclick();
        $('ctyperow').style.display = 'flex';
        S.pendingCart = slot;
        log(`${r.kb} KB cart loaded as "${guess.textContent}". If it shows diagnostics, pick another type and press OK`);
      }
    } else if (slot === 2) S.emu.coldStart();
  }
  // Cartridges are only changed with the power off: warn, then switch the computer off.
  // ---- File-menu equivalents: boot image, state save/load, detach/rotate disks, save cartridge, full screen ----
  async function saveBytes(name, bytes) {
    const p = AC.Progress.begin('Saving ' + name + '…', 0);
    try {
      const blob = new Blob([bytes]);
      if (window.showSaveFilePicker) {
        try { const fh = await showSaveFilePicker({ suggestedName: name }); p.text('Writing ' + fh.name + '…'); const w = await fh.createWritable(); await w.write(blob); await w.close(); return fh.name; } catch (e) { if (e.name === 'AbortError') return null; }
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
      return name;
    } finally { p.end(); }
  }
  const running = () => { if (S.emu && !S.off) return true; log('Power on first (press Boot)'); return false; };
  function stateBytes() {
    const hdr = new TextEncoder().encode('ACST1' + JSON.stringify({ model: $('model').value, ram: $('ram').value, tv: $('tv').value }) + '\n');
    const snap = S.emu.snapshot();
    const out = new Uint8Array(hdr.length + snap.length);
    out.set(hdr); out.set(snap, hdr.length);
    return out;
  }
  function applyState(bytes) {
    const nl = bytes.indexOf(10);
    if (nl < 0 || new TextDecoder().decode(bytes.subarray(0, 5)) !== 'ACST1') throw new Error('not an Ataricraft state file');
    const h = JSON.parse(new TextDecoder().decode(bytes.subarray(5, nl)));
    if (h.model !== $('model').value || h.ram !== $('ram').value || h.tv !== $('tv').value) throw new Error(`state is for ${h.model} / ${h.ram} / ${h.tv}: pick that machine and Boot first`);
    S.emu.restore(bytes.subarray(nl + 1));
  }
  $('qsave').onclick = () => { if (running()) { S.quick = stateBytes(); log('quick saved'); } };
  $('qload').onclick = () => { if (!S.quick) return log('Nothing quick-saved yet'); if (!running()) return; try { applyState(S.quick); log('quick loaded'); } catch (e) { log(e.message); } };
  $('savestate').onclick = async () => { if (!running()) return; const n = await saveBytes('ataricraft-' + $('model').value + '.acstate', stateBytes()); if (n) log('state saved: ' + n); };
  $('loadstate').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f || !running()) return;
    try { applyState(await AC.Progress.read(f, 'Loading ' + f.name)); log('state loaded: ' + f.name); } catch (err) { log('Could not load state: ' + err.message); }
  };
  $('detachall').onclick = () => { for (let n = 1; n <= 8; n++) $('de' + n).click(); log('all disks detached'); };
  function rotateDisks(dir) {
    const used = [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => S.disks[n]);
    if (used.length < 2) return log('Rotate needs at least two mounted disks');
    if (!running()) return;
    const imgs = used.map((n) => ({ disk: { name: S.disks[n].name, bytes: S.emu.readDisk(n) || S.disks[n].bytes }, dirty: S.dirty[n] }));
    used.forEach((n) => S.emu.ejectDisk(n));
    imgs.forEach((im, i) => {
      const n = used[(i + dir + used.length) % used.length];
      S.emu.mountDisk(n, im.disk.name, im.disk.bytes);
      S.disks[n] = im.disk; S.dirty[n] = im.dirty;
      $('d' + n).textContent = im.disk.name;
    });
    log('disks rotated');
  }
  $('rotdn').onclick = () => rotateDisks(1);
  $('rotup').onclick = () => rotateDisks(-1);
  for (const n of [1, 2]) {
    $('savecart' + n).onclick = async () => {
      const c = S.carts[n];
      if (!c) return log(`No cartridge in slot ${n}`);
      const nm = await saveBytes(c.name, c.bytes);
      if (nm) log('cartridge saved: ' + nm);
    };
  }
  $('bootimg').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!S.emu || S.off) { await loadAny(f, false, null); await boot(); return; }
    await loadAny(f, false, null);
    if (S.disks[1] && S.disks[1].name === f.name && S.emu) S.emu.coldStart();
  };
  $('fullscr').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => log('Full screen was blocked by the browser')); };

  function confirmCartPower(what) {
    if (!S.emu || S.off) return true;
    if (!confirm(`Cartridges should only be changed with the power off.\n\nPower off now and ${what} the cartridge? Press Boot afterwards to start again.`)) return false;
    powerOff();
    return true;
  }
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
    $('de' + n).onclick = () => {
      if (S.emu) {
        S.emu.ejectDisk(n);
        if (S.emu.diskPaths) delete S.emu.diskPaths[n];
      }
      delete S.disks[n]; delete S.dirty[n];
      $('d' + n).textContent = 'empty';
      $('f' + n).value = '';
    };
  }
  for (const n of [1, 2]) {
    $('c' + n).onchange = (e) => e.target.files[0] && (S.emu ? insertCart(n, e.target.files[0]) : loadAny(e.target.files[0], n === 2, 'cart'));
    $('ce' + n).onclick = () => {
      if (!confirmCartPower('eject')) return;
      if (S.emu) S.emu.ejectCart(n);
      delete S.carts[n];
      devFlash('K' + n, 'ot');
      $('cn' + n).textContent = (n === 1 ? '1 (main, right): ' : '2 (left): ') + 'empty';
      $('c' + n).value = '';
    };
  }
  $('savedisk').onclick = () => {
    const n = +$('savedrv').value;
    const path = S.emu && S.emu.diskPaths && S.emu.diskPaths[n];
    const bytes = path ? S.emu.readDisk(n) : (S.disks[n] && S.disks[n].bytes);
    if (!bytes) { log(`D${n}: no disk mounted`); return; }
    const name = (S.disks[n] && S.disks[n].name) || (path || '').replace(/^\/d\d_/, '') || `d${n}.atr`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    a.download = name; a.click();
    S.dirty[n] = false;
    log(`D${n}: saved ${name} (${bytes.length} bytes) to your Downloads`);
  };
  // Save all / Load all: every mounted disk and cartridge as one .zip (with a slot manifest), or many files at once.
  const SETMAN = 'ataricraft-set.json';
  $('saveall').onclick = () => {
    const files = [], man = { disks: {}, carts: {} };
    for (let n = 1; n <= 8; n++) {
      const path = S.emu && S.emu.diskPaths && S.emu.diskPaths[n];
      const bytes = path ? S.emu.readDisk(n) : (S.disks[n] && S.disks[n].bytes);
      if (!bytes) continue;
      const nm = (S.disks[n] && S.disks[n].name) || (path || '').replace(/^\/d\d_/, '') || `d${n}.atr`;
      files.push({ name: `D${n}_${nm}`, data: bytes }); man.disks[n] = `D${n}_${nm}`;
      if (S.dirty) S.dirty[n] = false;
    }
    for (const n of [1, 2]) {
      const c = S.carts[n]; if (!c || !c.bytes) continue;
      files.push({ name: `CART${n}_${c.name}`, data: c.bytes }); man.carts[n] = `CART${n}_${c.name}`;
    }
    if (!files.length) { log('nothing mounted to save'); return; }
    files.push({ name: SETMAN, data: new TextEncoder().encode(JSON.stringify(man)) });
    saveBlob('ataricraft-drives.zip', storedZip(files), 'application/zip');
    log(`saved ${files.length - 1} disk/cartridge images as ataricraft-drives.zip`);
  };
  const putCart = (slot, f) => (S.emu ? insertCart(slot, f) : loadAny(f, slot === 2, 'cart'));
  $('loadall').onchange = async (e) => {
    const picked = [...e.target.files]; e.target.value = '';
    if (!picked.length) return;
    let nd = 0, nc = 0;
    try {
      let items = [];
      for (const f of picked) {
        if (/\.zip$/i.test(f.name)) {
          const ents = await AC.Zip.list(f);
          const mi = ents.find((x) => x.name === SETMAN);
          const man = mi ? JSON.parse(new TextDecoder().decode(await AC.Zip.extract(f, mi))) : null;
          for (const en of ents) {
            if (en === mi) continue;
            const base = en.name.split('/').pop();
            let slot = null;
            if (man) {
              for (const [n, v] of Object.entries(man.disks || {})) if (v === en.name) slot = { disk: +n };
              for (const [n, v] of Object.entries(man.carts || {})) if (v === en.name) slot = { cart: +n };
              if (!slot) continue;
            }
            items.push({ name: man ? base.replace(/^(D\d|CART\d)_/, '') : base, slot, get: async () => new File([await AC.Zip.extract(f, en)], man ? base.replace(/^(D\d|CART\d)_/, '') : base) });
          }
        } else items.push({ name: f.name, slot: null, get: async () => f });
      }
      let nextD = 1, nextC = 1;
      const usedD = new Set(items.filter((i) => i.slot && i.slot.disk).map((i) => i.slot.disk));
      for (const it of items) {
        const fl = await it.get();
        const kind = extKind(fl.name);
        if (it.slot && it.slot.disk) { await loadAny(fl, it.slot.disk, 'disk', true); nd++; }
        else if (it.slot && it.slot.cart) { await putCart(it.slot.cart, fl); nc++; }
        else if (kind === 'cart') { if (nextC <= 2) { await putCart(nextC++, fl); nc++; } else log(`no free cartridge slot for ${fl.name}`); }
        else if (kind === 'disk' || !kind) { while (usedD.has(nextD)) nextD++; if (nextD <= 8) { usedD.add(nextD); await loadAny(fl, nextD, 'disk', true); nd++; } else log(`no free drive for ${fl.name}`); }
        else await loadAny(fl, false, kind);
      }
      $('allinfo').textContent = `${nd} disk${nd === 1 ? '' : 's'}, ${nc} cart${nc === 1 ? '' : 's'}`;
      log(`loaded ${nd} disk(s) and ${nc} cartridge(s)`);
    } catch (err) { log('Load all failed: ' + (err && err.message || err)); }
  };  window.addEventListener('beforeunload', (e) => {
    if (Object.keys(S.pend).some((n) => S.pend[n]) || (lastSig !== null && lastMediaSig() !== lastSig)) { e.preventDefault(); e.returnValue = ''; }
  });
  $('ctypeok').onclick = () => {
    if (!S.emu || !S.pendingCart) return;
    S.emu.setCartType(S.pendingCart, +$('ctype').value);
    if (S.carts[S.pendingCart]) S.carts[S.pendingCart].type = +$('ctype').value;
    S.emu.coldStart();
    S.pendingCart = null;
    $('ctyperow').style.display = 'none';
    log('cartridge inserted');
  };
  // side panel: expandable; on phones it is a drawer that starts closed
  const phone = () => matchMedia('(max-width:900px)').matches;
  const saved = localStorage.getItem('ac.sidebar');
  document.body.classList.toggle('nosb', saved ? saved === '0' : phone());
  {
    const wrap = $('kbdwrap');
    const kv = JSON.parse(localStorage.getItem('ac.kbview') || '{"base":true,"shift":true,"ctrl":true}');
    const apply = () => {
      document.querySelectorAll('#kbview button').forEach((b) => {
        b.classList.toggle('on', !!kv[b.dataset.v]);
        wrap.classList.toggle('hide-' + b.dataset.v, !kv[b.dataset.v]);
      });
      localStorage.setItem('ac.kbview', JSON.stringify(kv));
    };
    document.querySelectorAll('#kbview button').forEach((b) => { b.onclick = () => { kv[b.dataset.v] = !kv[b.dataset.v]; apply(); }; });
    apply();
  }
  $('sbtoggle').onclick = () => {
    const hide = !document.body.classList.contains('nosb');
    document.body.classList.toggle('nosb', hide);
    localStorage.setItem('ac.sidebar', hide ? '0' : '1');
  };
  $('sbclose').onclick = () => document.body.classList.add('nosb');
  // On a phone the open panel covers the ☰ button: tapping the dimmed page outside it closes the panel.
  document.addEventListener('pointerdown', (e) => {
    if (phone() && !document.body.classList.contains('nosb') && !e.target.closest('.side, #sbtoggle, .pickmenu, dialog')) document.body.classList.add('nosb');
  });
  $('boot').addEventListener('click', () => { if (phone()) document.body.classList.add('nosb'); });

  fillRomSelects();
  loadSavedRoms();

  // ---- UI wiring ----
  AC.keyboard.restoreCharset();
  AC.keyboard.build($('kbd'), handle);
  AC.keyboard.buildArrows($('karrows'), handle, false);
  AC.keyboard.buildArrows($('kmini'), handle, true);
  window.AC_setKbMode(['keys', 'arrows', 'pad', 'joy', 'paddle', 'drive'].includes(localStorage.getItem('ac.kbmode')) ? localStorage.getItem('ac.kbmode') : 'keys');
  $('kblayout').onchange = (e) => AC.keyboard.build($('kbd'), handle, e.target.value);
  $('romfiles').onchange = (e) => addRoms(e.target.files);
  $('model').onchange = () => { fillRomSelects(); const m = $('model').value; if ([...$('kblayout').options].some((o) => o.value === m)) { $('kblayout').value = m; AC.keyboard.build($('kbd'), handle, m); } };
  function saveRomSel() {
    const kind = $('model').value === '800' ? 'os800' : 'osxl';
    const s = JSON.parse(localStorage.getItem('ac.romsel') || '{}');
    const o = S.lib[kind][+$('osrom').value];
    if (o) s[kind] = o.name;
    s.basic = $('basicrom').value === '' ? '' : (S.basicList[+$('basicrom').value] || {}).name || '';
    localStorage.setItem('ac.romsel', JSON.stringify(s));
  }
  $('osrom').onchange = () => { updateCharset(); saveRomSel(); };
  $('basicrom').onchange = () => { S.basicTouched = true; saveRomSel(); };
  $('romfolder').onchange = (e) => addRoms(e.target.files);

  // The ROM folder is remembered (Chromium) and rescanned on every page load; if the browser wants the permission again, the first click or key press re-grants it.
  if (window.showDirectoryPicker) {
    const romWalk = async (d, path, out, depth) => {
      for await (const [name, e] of d.entries()) {
        if (out.length >= 3000) return;
        if (e.kind === 'directory') { if (depth < 6) await romWalk(e, path + name + '/', out, depth + 1); continue; }
        if (!/\.(rom|bin|rm|zip|7z)$/i.test(name)) continue;
        try {
          const f = await e.getFile();
          if (/\.(zip|7z)$/i.test(name) ? f.size > 4e6 : ![8192, 10240, 16384].includes(f.size)) continue;
          Object.defineProperty(f, 'webkitRelativePath', { value: path + name });
          out.push(f);
        } catch (err) { /* unreadable */ }
      }
    };
    const romScan = async (h, interactive) => {
      let p = await h.queryPermission({ mode: 'read' });
      if (p !== 'granted' && interactive) p = await h.requestPermission({ mode: 'read' });
      if (p !== 'granted') return false;
      const out = [];
      await romWalk(h, h.name + '/', out, 0);
      await addRoms(out);
      log(`ROM folder "${h.name}" scanned`);
      return true;
    };
    // Several ROM folders can be remembered (e.g. your own dumps plus the bundled roms/altirra); Scan folder… adds one, Rescan reads them all.
    const romDirs = async () => {
      const l = (await idbGet('romDirs')) || [];
      const old = await idbGet('romDir');
      if (old && !l.length) l.push(old);
      return l;
    };
    $('romfolder').addEventListener('click', async (e) => {
      e.preventDefault();
      let h;
      try { h = await showDirectoryPicker({ id: 'ataricraft-roms', mode: 'read' }); } catch (err) { return; }
      const l = await romDirs();
      let dup = false;
      for (const x of l) if (await x.isSameEntry(h)) dup = true;
      if (!dup) l.push(h);
      await idbSet('romDirs', l);
      $('romrescan').style.display = '';
      await romScan(h, true);
    });
    $('romrescan').onclick = async () => {
      const l = await romDirs();
      if (!l.length) { log('no ROM folder yet: use Scan folder…'); return; }
      for (const h of l) {
        try { if (!(await romScan(h, true))) log(`access to "${h.name}" was not granted`); } catch (e) { log('ROM rescan failed: ' + e.message); }
      }
    };
    romDirs().then(async (l) => {
      if (!l.length) return;
      $('romrescan').style.display = '';
      const pending = [];
      for (const h of l) { try { if (!(await romScan(h, false))) pending.push(h); } catch (e) { /* skip */ } }
      if (!pending.length) return;
      const regrant = async () => { for (const h of pending) { try { await romScan(h, true); } catch (e) { /* denied */ } } };
      document.addEventListener('pointerdown', regrant, { once: true });
      document.addEventListener('keydown', regrant, { once: true });
    }).catch(() => {});
  }
  function syncPower() { $('boot').classList.toggle('on', !!S.emu && !S.off); $('boot').title = S.emu && !S.off ? 'Power off (Shift+click: reboot)' : 'Power on / Boot'; }
  function powerOff() {
    S.running = false; S.off = true;
    sctx.fillStyle = '#000'; sctx.fillRect(0, 0, src.width, src.height);
    present();
    if (SND.ctx && SND.ctx.state === 'running') SND.ctx.suspend().catch(() => {});
    $('pause').textContent = 'Run';
    log('power off');
    syncPower();
  }
  $('boot').onclick = async (e) => {
    if (S.emu && !S.off && !e.shiftKey) return powerOff();
    S.off = false;
    await boot();
    if (S.emu && S.pending) { const p = S.pending; S.pending = null; await loadAny(p.file, p.alt, p.hint, p.noBoot); }
  };
  $('reset').onclick = () => S.emu && S.emu.warmStart();
  function coldOrExe() { if (S.lastExe) S.emu.bootFile(S.lastExe.name, S.lastExe.bytes); else S.emu.coldStart(); }
  $('cold').onclick = () => S.emu && coldOrExe();
  $('pause').onclick = () => { S.running = !S.running; $('pause').textContent = S.running ? 'Pause' : 'Run'; };
  $('speed').oninput = (e) => { S.speed = Math.pow(2, +e.target.value); const s = S.speed.toFixed(S.speed < 1 ? 2 : 1); $('speedv').textContent = s + '×'; $('spd').textContent = s; };

  // ---- remembered settings and last-used media (survive reloads) ----
  const CTL = ['model', 'ram', 'tv', 'xep80', 'kblayout', 'speed', 'blankfmt', 'blanksdfs', 'blankmydos'];
  const ctlRead = () => { try { return JSON.parse(localStorage.getItem('ac.ctl') || '{}'); } catch (e) { return {}; } };
  const ctlVal = (el) => (el.type === 'checkbox' ? el.checked : el.value);
  for (const id of CTL) {
    const el = $(id);
    if (!el) continue;
    const save = () => { const c = ctlRead(); c[id] = ctlVal(el); localStorage.setItem('ac.ctl', JSON.stringify(c)); };
    el.addEventListener('change', save);
    el.addEventListener('input', save);
  }
  {
    const c = ctlRead();
    const put = (id, ev) => {
      const el = $(id);
      if (!el || !(id in c)) return;
      if (el.type === 'checkbox') el.checked = !!c[id];
      else if (el.type === 'range' || [...el.options].some((o) => o.value === String(c[id]))) el.value = c[id];
      else return;
      if (ev) el.dispatchEvent(new Event(ev));
    };
    // The model rebuilds the RAM list and keyboard layout, so it goes first.
    put('model', 'change'); put('ram'); put('kblayout', 'change'); put('tv'); put('xep80');
    put('speed', 'input'); put('blankfmt'); put('blanksdfs'); put('blankmydos');
  }

  // ---- edited disks: pull the emulated image back into S.disks so reboots, reloads and sets keep your changes ----
  const sameBytes = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  function syncDisks(force) {
    if (!S.emu || (S.off && !force)) return;
    const now = performance.now();
    for (let n = 1; n <= 8; n++) {
      const d = S.disks[n];
      if (!d || !S.pend[n] || !S.emu.diskPaths || !S.emu.diskPaths[n]) continue;
      if (!force && now - (S.io[n] || 0) < 1500) continue; // reading the image can interrupt the drive, so wait for it to go quiet
      S.pend[n] = false;
      const b = S.emu.readDisk(n);
      if (!b || sameBytes(b, d.bytes)) continue;
      if (!d.orig) d.orig = d.bytes;
      d.bytes = new Uint8Array(b); d.rev = (d.rev || 0) + 1; S.dirty[n] = true;
    }
  }
  const BK = { list: [] };
  const bkSave = () => idbSet('bk:index', BK.list);
  async function snapDisk(d, n, why) {
    if (!d || !d.rev) return;
    const id = Date.now() + '_' + n;
    await idbSet('bk:' + id, d.bytes);
    BK.list.unshift({ id, n, name: d.name, size: d.bytes.length, ts: Date.now(), why });
    while (BK.list.length > 12) { const o = BK.list.pop(); idbSet('bk:' + o.id, null); }
    await bkSave(); bkRender();
  }
  function bkRender() {
    const sel = $('bklist'); sel.innerHTML = '';
    for (const b of BK.list) { const o = document.createElement('option'); o.value = b.id; o.textContent = `${new Date(b.ts).toLocaleString()} - ${b.name} (D${b.n}, ${b.why})`; sel.append(o); }
    if (!BK.list.length) { const o = document.createElement('option'); o.textContent = 'no backups yet'; o.value = ''; sel.append(o); }
    $('bkinfo').textContent = BK.list.length ? '(' + BK.list.length + ')' : '';
  }
  const bkDrv = () => $('bkdrv');
  for (let n = 1; n <= 8; n++) { const o = document.createElement('option'); o.value = n; o.textContent = 'D' + n + ':'; bkDrv().append(o); }
  idbGet('bk:index').then((l) => { BK.list = l || []; bkRender(); });
  const shadow = {};
  setInterval(async () => {
    syncDisks();
    for (let n = 1; n <= 8; n++) {
      if (shadow[n] && shadow[n] !== S.disks[n] && shadow[n].rev && !shadow[n].snapped) { shadow[n].snapped = true; await snapDisk(shadow[n], n, 'replaced or ejected'); }
      shadow[n] = S.disks[n];
    }
  }, 1000);
  $('bknow').onclick = async () => {
    const n = +bkDrv().value; syncDisks(true);
    const d = S.disks[n];
    if (!d) return log(`D${n}: no disk mounted`);
    if (!d.rev) { d.rev = 1; d.orig = d.orig || d.bytes; if (S.emu && S.emu.diskPaths && S.emu.diskPaths[n]) { const b = S.emu.readDisk(n); if (b) d.bytes = new Uint8Array(b); } }
    await snapDisk(d, n, 'manual'); log(`D${n}: backed up ${d.name}`);
  };
  async function putDisk(n, name, bytes, orig) {
    if (S.emu) S.emu.mountDisk(n, name, bytes);
    S.disks[n] = { name, bytes, orig, rev: orig ? 1 : 0 }; S.dirty[n] = !!orig; S.pend[n] = false;
    shadow[n] = S.disks[n];
    $('d' + n).textContent = name;
    if (S.emu && !S.off) S.emu.coldStart();
  }
  $('bkrev').onclick = async () => {
    const n = +bkDrv().value; syncDisks(true);
    const d = S.disks[n];
    if (!d || !d.orig) return log(`D${n}: nothing to revert (no changes since loading)`);
    const orig = d.orig; await snapDisk(d, n, 'before revert'); shadow[n] = null;
    await putDisk(n, d.name, orig, null); log(`D${n}: reverted to ${d.name} as loaded`);
  };
  $('bkrest').onclick = async () => {
    const b = BK.list.find((x) => x.id === $('bklist').value);
    if (!b) return;
    const n = +bkDrv().value; syncDisks(true);
    if (S.disks[n] && S.disks[n].rev) { await snapDisk(S.disks[n], n, 'before restore'); }
    const bytes = await idbGet('bk:' + b.id);
    if (!bytes) return log('backup data is missing');
    shadow[n] = null;
    await putDisk(n, b.name, new Uint8Array(bytes), new Uint8Array(bytes)); log(`D${n}: restored backup of ${b.name}`);
  };
  $('bkdl').onclick = async () => {
    const b = BK.list.find((x) => x.id === $('bklist').value);
    if (!b) return;
    const bytes = await idbGet('bk:' + b.id);
    if (bytes) saveBlob(b.name, [bytes], 'application/octet-stream');
  };
  $('bkdel').onclick = async () => {
    const i = BK.list.findIndex((x) => x.id === $('bklist').value);
    if (i < 0) return;
    await idbSet('bk:' + BK.list[i].id, null); BK.list.splice(i, 1); await bkSave(); bkRender();
  };
  // Last disks and cartridges are kept in IndexedDB and re-inserted at startup (read when you press Boot).
  const lastMediaSig = () => JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8].map((n) => S.disks[n] && [S.disks[n].name, S.disks[n].bytes.length, S.disks[n].rev || 0]).concat([1, 2].map((n) => S.carts[n] && [S.carts[n].name, S.carts[n].bytes.length,   S.carts[n].type]))).concat([S.tape && [S.tape.name, S.tape.bytes.length]]);
  let lastSig = null;
  (async () => {
    try {
      const m = await idbGet('lastmedia');
      if (m && !S.emu && !Object.keys(S.disks).length && !Object.keys(S.carts).length) {
        for (const [n, d] of Object.entries(m.disks || {})) { S.disks[n] = { name: d.name, bytes: d.bytes, orig: d.orig, rev: d.rev || 0 }; S.dirty[n] = !!d.rev; $('d' + n).textContent = d.name; }
        for (const [s, c] of Object.entries(m.carts || {})) { S.carts[s] = { name: c.name, bytes: c.bytes, type: c.type }; $('cn' + s).textContent = (s === '1' ? '1 (main, right): ' : '2 (left): ') + c.name; }
        if (m.tape && !S.tape) { S.tape = { name: m.tape.name, bytes: m.tape.bytes }; $('tn').textContent = m.tape.name; }
        if (Object.keys(m.disks || {}).length + Object.keys(m.carts || {}).length || m.tape) log('restored last disks, cartridges and tape');
      }
    } catch (e) { /* no saved media */ }
    lastSig = lastMediaSig();
    setInterval(() => {
      const sig = lastMediaSig();
      if (sig === lastSig) return;
      lastSig = sig;
      idbSet('lastmedia', { disks: Object.fromEntries(Object.entries(S.disks).map(([n, d]) => [n, { name: d.name, bytes: d.bytes, orig: d.orig, rev: d.rev || 0 }])), carts: Object.fromEntries(Object.entries(S.carts).map(([n, c]) => [n,       { name: c.name, bytes: c.bytes, type: c.type }])), tape: S.tape ? { name: S.tape.name, bytes: S.tape.bytes } : null });
    }, 1000);
  })();
  $('profile').value = S.profile;
  $('profile').onchange = (e) => { S.profile = e.target.value; localStorage.setItem('ac.profile', S.profile); renderMap(); };
  $('mapreset').onclick = () => { S.overrides = {}; localStorage.removeItem('ac.keymap'); renderMap(); };
  renderMap();
  $('mapbtn').onclick = () => { renderMap(); $('mapdlg').showModal(); };
  $('sndbtn').onclick = () => { SND.on = !SND.on; localStorage.setItem('ac.sound', SND.on ? '1' : '0'); sndCtx(); syncSndUi(); };
  $('vol').oninput = (e) => { SND.vol = +e.target.value; localStorage.setItem('ac.vol', SND.vol); sndCtx(); };
  window.addEventListener('pointerdown', () => sndCtx(), { once: true });
  window.addEventListener('keydown', () => sndCtx(), { once: true });
  syncSndUi();
  $('mapclose').onclick = () => { S.capture = null; $('mapdlg').close(); };
  S.joyMode = localStorage.getItem('ac.gameMode') === '1';
  $('joy').checked = S.joyMode;
  $('joy').onchange = (e) => {
    S.joyMode = e.target.checked;
    localStorage.setItem('ac.gameMode', S.joyMode ? '1' : '0');
    e.target.blur();
    if (!S.joyMode) { S.joy = 0; S.fire = false; if (S.emu) sendJoy(); }
    log(S.joyMode ? 'GAME MODE on: WASD / arrows = joystick, Space = fire (W/A/S/D/Space no longer type)' : 'GAME MODE off: keyboard typing restored');
  };
  for (const [id, field] of [['start', 'start'], ['select', 'select'], ['option', 'option'], ['brk', 'special']]) {
    const b = $(id);
    const fields = field === 'special' ? { special: 5 } : { [field]: 1 };
    b.onpointerdown = () => S.emu && S.emu.down('btn:' + id, fields);
    b.onpointerup = b.onpointerleave = () => S.emu && S.emu.up('btn:' + id);
  }
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
    $('f' + n).onchange = (e) => loadMedia(e.target.files, n);
  }
  document.body.addEventListener('dragover', (e) => e.preventDefault());
  document.body.addEventListener('drop', (e) => { e.preventDefault(); loadMedia(e.dataTransfer.files, 1); });
  requestAnimationFrame(loop);

  // ---- clipboard ----
  // Paste types the clipboard into the Atari (paced); copy sends the text screen or the picture out.
  function pasteText(text) {
    if (!S.emu) { log('boot first'); return; }
    const t = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
    let n = 0;
    for (const ch of t) {
      const c = ch.charCodeAt(0);
      if (ch === '\n') S.typeQ.push({ keychar: 10 });
      else if (c >= 32 && c < 127) S.typeQ.push({ keychar: c });
      else continue;
      n++;
    }
    log('pasting ' + n + ' chars');
  }
  async function copyScreenText() {
    if (!S.emu) return;
    const t = S.emu.screenText().replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
    await navigator.clipboard.writeText(t);
    log('copied ' + t.length + ' chars of screen text');
  }
  async function copyScreenImage() {
    if (!S.emu) return;
    const c = document.createElement('canvas');
    c.width = AC.SCREEN.w * 2; c.height = AC.SCREEN.h * 2;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(cv, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    log('copied screen image');
  }
  const clip = (fn) => () => fn().catch((e) => log('clipboard: ' + e.message));
  window.addEventListener('paste', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    e.preventDefault();
    pasteText((e.clipboardData && e.clipboardData.getData('text')) || '');
  });
  $('pastebtn').onclick = clip(async () => pasteText(await navigator.clipboard.readText()));
  $('copytxt').onclick = clip(copyScreenText);
  $('copyimg').onclick = clip(copyScreenImage);
  $('stoptype').onclick = () => { S.typeQ.length = 0; log('paste cancelled'); };

  // ---- agent API ----
  function shot(scale, format) {
    const c = document.createElement('canvas');
    c.width = AC.SCREEN.w * scale; c.height = AC.SCREEN.h * scale;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(cv, 0, 0, c.width, c.height);
    return c.toDataURL(format || 'image/png');
  }

  const VERSION = '0.4.0-dev', BUILD = '2026-10-27 19:30';
  { const h = $('appver'); if (h) { h.title = `Ataricraft v${VERSION}, built ${BUILD}`; h.querySelector('small').textContent = `v${VERSION} · ${BUILD}`; } console.log(`Ataricraft v${VERSION} (${BUILD})`); }
  window.ataricraft = {
    version: `${VERSION} (${BUILD})`,
    diskState: () => Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].filter((n) => S.disks[n]).map((n) => [n, { rev: S.disks[n].rev || 0, orig: !!S.disks[n].orig, pend: !!S.pend[n], idle: Math.round(performance.now() - (S.io[n] || 0)) }])),
    describe: () => ({
      name: 'ataricraft', core: S.emu && S.emu.core === 'altirra' ? 'AltirraSDL (WASM)' : 'libatari800 (WASM reference)',
      calls: ['loadRoms(files)', 'boot({model,tv,basic})', 'screenshot({scale}) -> PNG data URL', 'screenText()', 'type(text)', 'press(fields,frames)',
        'joy(bits,fire)', 'console({start,select,option})', 'step(n)', 'run()/pause()', 'speed(x)', 'peek(addr,len)', 'poke(addr,bytes)',
        'mountDisk(n,name,bytes)', 'bootFile(name,bytes)', 'snapshot()', 'restore(snap)', 'reset(cold)', 'state()'],
      models: Object.keys(AC.MODELS),
    }),
    state: () => ({ booted: !!S.emu, running: S.running, frames: S.emu ? S.emu.frames : 0, speed: S.speed, model: $('model').value, tv: $('tv').value, roms: Object.fromEntries(Object.entries(S.roms).map(([k, v]) => [k, !!v])) }),
    addRoms: (files) => addRoms(files),
    boot: async (o) => { if (o && o.model) $('model').value = o.model; if (o && o.tv) $('tv').value = o.tv; if (o && o.basic != null) $('basic').checked = !!o.basic; return boot(); },
    screenshot: (o) => shot((o && o.scale) || 2, o && o.format),
    screenText: () => S.emu.screenText(),
    type: (text) => pasteText(text),
    copyText: () => S.emu.screenText(),
    press: (fields, frames) => S.emu.tap(fields, frames || 4),
    scanDir: (handle) => scanHandle(handle, false),
    scanFn: (handle) => loadFnHandle(handle, false),
    mediaList: () => MED.files.map((f) => ({ name: f.name, kind: f.kind })),
    loadEntry: async (name, drive) => {
      const m = MED.files.find((f) => f.name === name);
      if (!m) return { ok: false, msg: 'not in library' };
      let msg = '';
      try { await loadAny(await fileOf(m), drive >= 2 ? (drive === 2 ? true : drive) : false, m.kind); msg = $('status').textContent; } catch (e) { return { ok: false, msg: String(e && e.message || e) }; }
      return { ok: !/^(Could not|could not|boot first)|unrecognised/.test(msg), msg };
    },
    catalogQuery: (sqlText, params) => AC.Catalog.query(sqlText, params),
    chooseFolders: async (handle) => { medRules = {}; const ok = await chooseFolders(handle); return ok ? await scanHandle(handle, false) : false; },
    joy: (bits, fire) => { S.joy = bits | 0; S.fire = !!fire; sendJoy(); },
    console: (f) => S.emu.tap(f, 6),
    step: (n) => { stepFrames(n || 1); draw(); return S.emu.frames; },
    run: () => { S.running = true; }, pause: () => { S.running = false; },
    speed: (x) => { S.speed = x; },
    peek: (a, l) => S.emu.peek(a, l), poke: (a, b) => S.emu.poke(a, b),
    readDisk: (n) => fsBytes(n),
    mountDisk: (n, name, bytes) => S.emu.mountDisk(n, name, bytes), bootFile: (name, bytes) => S.emu.bootFile(name, bytes),
    insertCart: (slot, name, bytes) => S.emu.insertCart(slot, name, bytes), cartTypes: (kb) => S.emu.cartTypes(kb),
    setCartType: (slot, t) => S.emu.setCartType(slot, t), ejectCart: (slot) => S.emu.ejectCart(slot), ejectDisk: (n) => S.emu.ejectDisk(n),
    snapshot: () => S.emu.snapshot(), restore: (s) => { S.emu.restore(s); draw(); },
    reset: (cold) => (cold ? coldOrExe() : S.emu.warmStart()),
    typing: () => S.typeQ.length,
    // Debug: fn(dev,cmd,dstats,aux,data,len) sees every SIO call; return a status code ('C' = 0x43) to claim it.
    sioTap: (fn) => {
      const m = S.emu.m, inner = m.acSio;
      m.acSio = (dev, cmd, dstats, aux, data, len) => fn(dev, cmd, dstats, aux, data, len) || (inner ? inner(dev, cmd, dstats, aux, data, len) : 0);
    },
  };
})();
