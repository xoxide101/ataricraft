// ataricraft app: UI + agent API (window.ataricraft). Humans and agents drive the same machine.
(function () {
  const $ = (id) => document.getElementById(id);
  const S = { emu: null, roms: { os800: null, osxl: null, basic: null }, running: false, speed: 1, acc: 0, last: 0, typeQ: [], typeWait: 0, joyMode: false, joy: 0, fire: false };
  const pal = AC.makePalette();
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
    if (bytes.length === 10240) return 'os800';
    if (bytes.length === 16384) return 'osxl';
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
  $('romforget').onclick = async () => {
    const db = await romDb;
    if (db) db.transaction('roms', 'readwrite').objectStore('roms').clear();
    localStorage.removeItem('ac.romsel');
    S.lib = { os800: [], osxl: [], basic: [] };
    fillRomSelects();
    log('saved ROMs cleared');
  };

  // MAME-style .zip files are expanded into virtual files (extracted only when used).
  async function expandZips(files) {
    const out = [];
    let zips = 0;
    for (const f of files) {
      if (!/\.(zip|7z)$/i.test(f.name)) { out.push(f); continue; }
      try {
        const base = f.webkitRelativePath || f.name;
        const Z = /\.7z$/i.test(f.name) ? AC.SevenZip : AC.Zip;
        for (const ent of await Z.list(f)) {
          out.push({ name: ent.name.split('/').pop(), webkitRelativePath: base + '/' + ent.name, size: ent.size, arrayBuffer: () => Z.extract(f, ent) });
        }
        zips++;
      } catch (e) { out.push(f); }
    }
    if (zips) log(`read ${zips} archive${zips > 1 ? 's' : ''}`);
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

  function fillRomSelects() {
    fillRam();
    const kind = $('model').value === '800' ? 'os800' : 'osxl';
    const sel_ = JSON.parse(localStorage.getItem('ac.romsel') || '{}');
    const fill = (sel, list, none, key) => {
      const prev = sel.value;
      sel.innerHTML = '';
      if (none) sel.append(new Option('(none)', ''));
      list.forEach((e, i) => sel.append(new Option(e.name.replace(/^.*[\\/]/, '') , String(i))));
      const si = key in sel_ ? (sel_[key] === '' ? '' : String(list.findIndex((e) => e.name === sel_[key]))) : null;
      if (si !== null && si !== '-1' && [...sel.options].some((o) => o.value === si)) { sel.value = si; if (key === 'basic') S.basicTouched = true; }
      else if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
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
    if (SND.ctx.state === 'suspended') SND.ctx.resume();
    SND.gain.gain.value = SND.on ? SND.vol * 3 : 0;
    return SND.ctx;
  }
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
  const syncSndUi = () => { $('sndbtn').textContent = SND.on ? 'Sound: on' : 'Sound: off'; $('vol').value = SND.vol; };

  const handle = {
    down: (id, f) => S.emu && S.emu.down(id, f),
    up: (id) => S.emu && S.emu.up(id),
  };

  $('basic').checked = localStorage.getItem('ac.basicOn') !== '0';
  $('basic').onchange = () => {
    localStorage.setItem('ac.basicOn', $('basic').checked ? '1' : '0');
    if (S.running) boot();
  };

  S.carts = {};
  S.disks = {};
  async function boot() {
    const model = $('model').value;
    const os = chosenOs();
    if (!os) { log('Need an OS ROM for ' + model + ' (scan a ROM folder first)'); return false; }
    log('booting…');
    if (S.emu) S.host = Object.assign(S.host || {}, S.emu.hostFiles());
    S.emu = await AC.Emu.boot({ model, os, ram: $('ram').value, basic: chosenBasic(), basicOn: $('basic').checked, tv: $('tv').value, host: S.host });
    FujiNet.attach(S.emu);
    hookDevices();
    applyPad();
    for (const [n, d] of Object.entries(S.disks)) S.emu.mountDisk(+n, d.name, d.bytes);
    for (const [slot, c] of Object.entries(S.carts)) {
      const r = S.emu.insertCart(+slot, c.name, c.bytes);
      if (r.ok && r.kb && c.type != null) S.emu.setCartType(+slot, c.type);
    }
    FujiNet.log = log;
    S.emu.run(120);
    hookAudio();
    sndCtx();
    S.running = true;
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
    for (const f of e.target.files) S.emu.hostWrite(hostName(f.name) || 'FILE', new Uint8Array(await f.arrayBuffer()));
    e.target.value = '';
    renderHost(true);
  };

  function draw() {
    if (!S.emu) return;
    S.emu.render(img32, pal);
    sctx.putImageData(img, 0, 0);
    pollTape();
    present();
  }

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
    const native = (scaleMode === 'sharp' || scaleMode === 'smooth') && !scanOn;
    const dpr = window.devicePixelRatio || 1;
    const w = native ? AC.SCREEN.w : Math.max(AC.SCREEN.w, Math.round(cv.clientWidth * dpr));
    const h = native ? AC.SCREEN.h : Math.max(AC.SCREEN.h, Math.round(cv.clientHeight * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    cv.style.imageRendering = scaleMode === 'sharp' ? 'pixelated' : 'auto';
    present();
  }
  function present() {
    const W = cv.width, H = cv.height;
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
  $('scalemode').value = scaleMode;
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
      fpsStat.t = t; fpsStat.draws = 0; fpsStat.f0 = fr;
    }
  }

  function sendJoy() {
    if (!S.emu) return;
    S.emu.down('joy0', { joy0: S.joy, trig0: S.fire ? 1 : 0 });
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
    if (el) { el.classList.add('down'); lit[e.code] = el; }
  }
  function litOff(code) {
    if (lit[code]) { lit[code].classList.remove('down'); delete lit[code]; }
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
    exe: ['xex', 'com', 'exe', 'bas', 'lst', 'obj'],
  };
  const extKind = (name) => {
    const e = (name.split('.').pop() || '').toLowerCase();
    return Object.keys(MEDIA_EXT).find((k) => MEDIA_EXT[k].includes(e)) || null;
  };
  const typeKind = (t) => ([1, 2, 3, 4, 5, 15, 16].includes(t) ? 'disk' : [6, 7, 8].includes(t) ? 'exe' : [9, 10].includes(t) ? 'cart' : [11, 12].includes(t) ? 'tape' : null);

  // Detects the format from the file contents (extensions are only a hint), then routes it to the right device.
  async function loadAny(file, alt, hint, noBoot) {
    if (!S.emu) { log('boot first (press Boot, then load ' + file.name + ')'); return; }
    log('loading ' + file.name + '…');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const t = S.emu.detect(file.name, bytes);
    const k = typeKind(t) || hint || extKind(file.name);
    diag(`load "${file.name}" ${bytes.length} bytes, detect=${t}, kind=${k}, first bytes=${[...bytes.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`);
    if (k !== 'tape' && S.emu.tapeInfo().status) {
      S.emu.tapeEject(); $('tn').textContent = 'empty'; $('tape').value = ''; $('tpos').textContent = '';
    }
    if (k === 'disk') {
      const n = alt ? 2 : 1;
      if (!S.emu.mountDisk(n, file.name, bytes)) { log('could not mount ' + file.name); return; }
      S.disks[n] = { name: file.name, bytes };
      $('d' + n).textContent = file.name;
      S.emu.coldStart && !noBoot && S.emu.coldStart();
      log(`D${n}: ${file.name}${noBoot ? ' (no reboot)' : ''}`);
    } else if (k === 'exe') {
      S.emu.bootFile(file.name, bytes);
      log('running ' + file.name);
    } else if (k === 'cart') {
      await insertCart(alt ? 2 : 1, file, bytes);
    } else if (k === 'tape') {
      if (!S.emu.tapeInsert(file.name, bytes)) { log('could not read tape ' + file.name); return; }
      $('tn').textContent = file.name;
      S.emu.tapeBoot();
      log('tape: ' + file.name + ' (booting with Start held; for BASIC tapes reset and use CLOAD)');
    } else log(`${file.name}: unrecognised format${t === 13 || t === 14 ? ' (saved states are not supported)' : ''}`);
  }
  async function loadMedia(files, drive) {
    for (const f of files) await loadAny(f, drive === 2, drive ? 'disk' : null);
  }

  // ---- media library (scan a folder, filter by text and type) ----
  const MED = { files: [], kind: 'all', ext: 'all' };
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
  const titleFor = (rel) => { for (const k of setKey(rel)) { if (TITLES[k]) return TITLES[k]; if ((AC.TITLES_BUILTIN || {})[k]) return AC.TITLES_BUILTIN[k]; } return ''; };
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
      d.onclick = async (e) => { const fl = await fileOf(m); if (fl) loadAny(fl, !e.shiftKey, 'disk', true); };
      box.append(d);
    });
  }
  function renderMed() {
    const q = $('medfilter').value.toLowerCase();
    const box = $('medlist');
    box.innerHTML = '';
    const extOf = (f) => (f.name.split('.').pop() || '').toLowerCase();
    const ofKind = MED.files.filter((f) => MED.kind === 'all' || f.kind === MED.kind);
    const counts = {};
    ofKind.forEach((f) => { const e = extOf(f); counts[e] = (counts[e] || 0) + 1; });
    if (MED.ext !== 'all' && !counts[MED.ext]) MED.ext = 'all';
    const eb = $('medexts');
    eb.innerHTML = '';
    const exts = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    if (exts.length > 1) exts.forEach((e) => {
      const b = document.createElement('button');
      b.textContent = `.${e} ${counts[e]}`;
      b.style.cssText = 'padding:1px 6px;font-size:11px;opacity:' + (MED.ext === e ? 1 : 0.55) + (MED.ext === e ? ';border-color:var(--acc)' : '');
      b.onclick = () => { MED.ext = MED.ext === e ? 'all' : e; renderMed(); };
      eb.append(b);
    });
    const hits = ofKind.filter((f) => (MED.ext === 'all' || extOf(f) === MED.ext) && (f.name + ' ' + (f.title || '')).toLowerCase().includes(q));
    hits.slice(0, 300).forEach((f) => {
      const d = document.createElement('div');
      d.textContent = f.title ? `${f.title} — ${f.name}` : f.name;
      d.title = d.textContent;
      d.style.cssText = 'padding:3px 4px;cursor:pointer;font-size:12px;border-bottom:1px solid #2c313b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      d.onmouseenter = () => (d.style.background = '#2a2f39');
      d.onmouseleave = () => (d.style.background = '');
      d.onclick = async (e) => { const fl = await fileOf(f); if (fl) { loadAny(fl, e.shiftKey, f.kind); showRelated(f); } };
      box.append(d);
    });
    $('medcount').textContent = MED.files.length ? `${MED.fromDb ? 'catalog: ' : ''}${hits.length} of ${MED.files.length}${hits.length > 300 ? ' (showing 300)' : ''}` : 'no folder';
  }
  // Remembered folder: the directory handle lives in IndexedDB (needs the File System Access API).
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('ataricraft-media', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const idbGet = async (k) => { const db = await idb(); return new Promise((res) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); };
  const idbSet = async (k, v) => { const db = await idb(); return new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); }); };
  // ---- media catalog (SQLite, saved in the browser) ----
  // Entries loaded from the catalog have no File yet: resolve it from the remembered folder when clicked.
  let arcCache = null;
  // Server library: a web server hosts library/ (catalog.sqlite, optional library.json, software/ and bios/ folders). SRV is its base URL.
  let SRV = null, srvLast = null;
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
          const r = await fetch(SRV + 'software/' + parts.slice(1, i + 1).map(encodeURIComponent).join('/'));
          if (!r.ok) throw new Error('server returned ' + r.status);
          f = new File([await r.blob()], parts[i]);
          Object.defineProperty(f, 'webkitRelativePath', { value: base });
          srvLast = { base, file: f };
        }
      } else {
        if (!medHandle) throw new Error('no remembered folder');
        if ((await medHandle.queryPermission({ mode: 'read' })) !== 'granted' && (await medHandle.requestPermission({ mode: 'read' })) !== 'granted') throw new Error('folder access not granted');
        let h = medHandle;
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
    return { path: f.name, name: parts[parts.length - 1], ext: (parts[parts.length - 1].split('.').pop() || '').toLowerCase(), kind: f.kind, size: f.size || (f.file && f.file.size) || 0, modified: f.file && f.file.lastModified, container: ci >= 0 ? parts.slice(0, ci + 1).join('/') : '', title: f.title || '', grp: groupKey(f) };
  };
  async function saveCatalog() {
    try {
      await AC.Catalog.rebuild(MED.files.map(catRow), { root: medHandle ? medHandle.name : '', scanned: new Date().toISOString(), count: MED.files.length });
      await idbSet('catalogDb', await AC.Catalog.exportBytes());
      MED.fromDb = false;
      diag(`catalog saved: ${MED.files.length} rows`);
    } catch (e) { diag('catalog save failed: ' + e.message, 'warn'); log('could not save catalog: ' + e.message); }
  }
  async function loadCatalogRows() {
    const bytes = await idbGet('catalogDb');
    if (!bytes) return false;
    await AC.Catalog.open(bytes);
    return useCatalog();
  }
  async function useCatalog() {
    const rows = await AC.Catalog.rows('SELECT path, kind, size, title FROM files');
    const meta = Object.fromEntries((await AC.Catalog.rows('SELECT k, v FROM meta')).map((r) => [r.k, r.v]));
    if (!rows.length) return false;
    MED.files = rows.map((r) => ({ name: r.path, file: null, kind: r.kind, size: r.size, title: titleFor(r.path) || r.title }));
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
  const scanSt = { stop: false, seen: 0, keep: 0, errs: 0 };
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
        if (!scanWant(name)) continue;
        try {
          const f = await e.getFile();
          Object.defineProperty(f, 'webkitRelativePath', { value: path + name });
          out.push(f);
        } catch (err) { scanSt.errs++; diag(`scan skipped file "${path + name}": ${err.name} ${err.message}`, 'warn'); continue; }
        if (out.length % 50 === 0) { $('medcount').textContent = `scanning… ${out.length} found (${scanSt.seen} files checked)`; await new Promise((r) => setTimeout(r)); }
      }
    } catch (err) { scanSt.errs++; diag(`scan skipped folder "${path}": ${err.name} ${err.message}`, 'warn'); }
  }  async function scanHandle(h, interactive) {
    let p = await h.queryPermission({ mode: 'read' });
    if (p !== 'granted' && interactive) p = await h.requestPermission({ mode: 'read' });
    if (p !== 'granted') { $('medcount').textContent = `"${h.name}" remembered: click Refresh to allow access`; return false; }
    $('medcount').textContent = 'scanning…';
    scanSt.stop = false; scanSt.seen = 0; scanSt.errs = 0;
    $('medstop').style.display = '';
    const out = [];
    try { await walkDir(h, h.name + '/', out, medRules); } finally { $('medstop').style.display = 'none'; }
    if (scanSt.stop) log(`scan stopped: ${out.length} files kept`);
    else if (out.length >= SCAN_CAP) log(`scan capped at ${SCAN_CAP} files: pick a smaller folder for the rest`);
    diag(`scan "${h.name}": ${scanSt.seen} files checked, ${out.length} media candidates, ${scanSt.errs} unreadable skipped`);
    if (scanSt.errs) log(`${scanSt.errs} unreadable files/folders skipped (see Save log for names)`);
    await scanMedia(out, true);
    return true;
  }
  $('medstop').onclick = () => { scanSt.stop = true; };
  let medHandle = null;

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
      const base = new URL('library/', location.href).href;
      let man = { catalog: 'catalog.sqlite', bios: [] };
      const mr = await fetch(base + 'library.json', { cache: 'no-store' });
      if (mr.ok) man = Object.assign(man, await mr.json());
      const cr = await fetch(base + encodeURI(man.catalog), { cache: 'no-store' });
      if (!cr.ok) return;
      await AC.Catalog.open(new Uint8Array(await cr.arrayBuffer()));
      SRV = base;
      if (!(await useCatalog())) { SRV = null; return; }
      $('medcount').textContent = 'server library: ' + $('medcount').textContent.replace(/^catalog: /, '');
      const roms = [];
      for (const p of man.bios) {
        try {
          const r = await fetch(base + 'bios/' + p.split('/').map(encodeURIComponent).join('/'));
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
      await idbSet('medDir', h);
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
      try { await scanHandle(medHandle, true); log('library refreshed'); } catch (e) { log('refresh failed: ' + e.message); }
    };
    idbGet('medDir').then(async (h) => {
      await srvReady;
      if (!h || SRV) return;
      medHandle = h;
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
      const bytes = new Uint8Array(await f.arrayBuffer());
      await AC.Catalog.open(bytes);
      if (!(await useCatalog())) { log('that catalog is empty'); return; }
      await idbSet('catalogDb', bytes);
    } catch (err) { log('import failed: ' + err.message); }
  };  $('medfolder').onchange = (e) => scanMedia([...e.target.files]);
  async function scanMedia(all, persist) {
    const xmls = all.filter((f) => /(^|[\\/])a(800|5200)[^\\/]*\.xml$/i.test(f.webkitRelativePath || f.name));
    if (xmls.length) await loadTitlesXml(xmls);
    const files = await expandZips(all);
    MED.files = files.map((f) => { const name = f.webkitRelativePath || f.name; return { name, file: f, kind: extKind(f.name), title: titleFor(name) }; }).filter((f) => f.kind);
    MED.fromDb = false;
    renderMed();
    if (persist) await saveCatalog();
    const kc = {};
    MED.files.forEach((f) => { kc[f.kind] = (kc[f.kind] || 0) + 1; });
    log(`Scan complete: ${MED.files.length} items (${Object.entries(kc).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'})`);
    diag('scan summary ' + JSON.stringify(kc));
  }
  $('medfilter').oninput = renderMed;
  document.querySelectorAll('#medchips button').forEach((b) => {
    b.onclick = () => {
      MED.kind = b.dataset.t; MED.ext = 'all';
      document.querySelectorAll('#medchips button').forEach((x) => x.classList.toggle('on', x === b));
      renderMed();
    };
  });
  $('romfilter').oninput = () => fillRomSelects();

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
  const padPos = { x: 0.5, y: 0.5, b: 0 };
  function applyPad() {
    if (!S.emu) return;
    if (!PAD.on) { S.emu.up('pad'); return; }
    const fx = PAD.fx ? 1 - padPos.x : padPos.x;
    const fy = PAD.fy ? 1 - padPos.y : padPos.y;
    const potX = Math.round(fx * 227);
    // Touch Tablet: Y rises going up; Koala Pad: Y rises going down. Direct-mouse mode inverts the value (POT = 227 - value).
    const potY = Math.round((PAD.type === 'koala' ? fy : 1 - fy) * 227);
    S.emu.down('pad', { mousex: 227 - potX, mousey: 227 - potY, mouse_buttons: padPos.b, mouse_mode: 1 });
    $('padinfo').textContent = `X ${potX}  Y ${potY}${padPos.b ? '  button' : ''}`;
  }
  function padMove(e, el) {
    const r = el.getBoundingClientRect();
    padPos.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    padPos.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    $('paddot').style.left = padPos.x * 100 + '%';
    $('paddot').style.top = padPos.y * 100 + '%';
    applyPad();
  }
  function padWire(el, enabled) {
    let down = false;
    el.addEventListener('pointerdown', (e) => {
      if (!enabled()) return;
      down = true; el.setPointerCapture(e.pointerId);
      padPos.b = (e.buttons & 3) || 1; $('padarea').classList.add('dn');
      padMove(e, el); e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => { if (enabled() && (down || e.pointerType === 'mouse')) { if (down) padPos.b = (e.buttons & 3) || 1; padMove(e, el); } });
    const end = () => { if (!down) return; down = false; padPos.b = 0; $('padarea').classList.remove('dn'); applyPad(); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('contextmenu', (e) => { if (enabled()) e.preventDefault(); });
  }
  padWire($('padarea'), () => PAD.on);
  padWire(cv, () => PAD.on && PAD.screen);
  const syncPadUi = () => {
    $('padon').checked = PAD.on; $('padtype').value = PAD.type; $('padscreen').checked = PAD.screen; $('padfx').checked = PAD.fx; $('padfy').checked = PAD.fy;
    $('padarea').classList.toggle('off', !PAD.on);
    cv.style.cursor = PAD.on && PAD.screen ? 'crosshair' : '';
    cv.style.touchAction = PAD.on && PAD.screen ? 'none' : '';
    $('padinfo').textContent = PAD.on ? $('padinfo').textContent : '';
  };
  for (const [id, key, isChk] of [['padon', 'on', 1], ['padtype', 'type', 0], ['padscreen', 'screen', 1], ['padfx', 'fx', 1], ['padfy', 'fy', 1]]) {
    $(id).onchange = (e) => { PAD[key] = isChk ? e.target.checked : e.target.value; localStorage.setItem('ac.pad', JSON.stringify(PAD)); syncPadUi(); applyPad(); e.target.blur(); };
  }
  syncPadUi();
  // ---- device activity lights (keyboard panel, top right) ----
  const DEVLIST = [...Array(8)].map((_, i) => ['D' + (i + 1), 'D' + (i + 1) + ':']).concat([['H', 'H:'], ['K1', 'CART1'], ['K2', 'CART2'], ['C', 'C:'], ['P', 'P:'], ['R', 'R:'], ['N', 'N:']]);
  const devEl = {};
  DEVLIST.forEach(([id, label]) => {
    const s = document.createElement('span');
    s.className = 'dv'; s.innerHTML = '<i></i>' + label;
    $('devbar').append(s);
    devEl[id] = s;
  });
  const devId = (dev) => (dev >= 0x31 && dev <= 0x38 ? 'D' + (dev - 0x30) : dev === 0x60 ? 'C' : dev >= 0x40 && dev <= 0x43 ? 'P' : dev >= 0x50 && dev <= 0x53 ? 'R' : dev >= 0x70 && dev <= 0x7f ? 'N' : null);
  const devTimer = {};
  function devFlash(id, cls) {
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
    m.acSio = (dev, cmd, dstats, aux, data, len) => {
      const id = devId(dev);
      if (id) devFlash(id, cmd === 0x52 ? 'rd' : cmd === 0x57 || cmd === 0x50 ? 'wr' : 'ot');
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
    for (let n = 1; n <= 8; n++) devEl['D' + n].classList.toggle('has', !!S.disks[n] || !!(FujiNet.slots && FujiNet.slots[n - 1] && FujiNet.slots[n - 1].mounted && FujiNet.enabled));
    try { devEl.H.classList.toggle('has', !!S.emu && S.emu.m.FS.readdir('/host').length > 2); } catch (e) { /* not booted */ }
    devEl.K1.classList.toggle('has', !!S.carts[1]);
    devEl.K2.classList.toggle('has', !!S.carts[2]);
    devEl.C.classList.toggle('has', $('tn').textContent !== 'empty');
    devEl.N.classList.toggle('has', !!FujiNet.enabled);
  }, 400);

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
  $('te').onclick = () => { if (!S.emu) return; S.emu.tapeEject(); $('tn').textContent = 'empty'; $('tape').value = ''; $('tpos').textContent = ''; };
  $('tboot').onclick = () => { if (S.emu && S.emu.tapeInfo().status) S.emu.tapeBoot(); };
  $('trew').onclick = () => { if (S.emu) S.emu.tapeRewind(); };
  setInterval(() => {
    if (!S.emu) return;
    const t = S.emu.tapeInfo();
    $('tpos').textContent = t.status && t.size ? `block ${t.pos} / ${t.size}` : '';
  }, 500);

  // ---- virtual FujiNet host node (folder browser; no SIO network emulation yet) ----
  const FN = { files: [] };
  function renderFn() {
    const q = $('fnfilter').value.toLowerCase();
    const box = $('fnlist');
    box.innerHTML = '';
    FN.files.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 300).forEach((f) => {
      const d = document.createElement('div');
      d.textContent = f.name;
      d.style.cssText = 'padding:3px 4px;cursor:pointer;font-size:12px;border-bottom:1px solid #2c313b';
      d.onmouseenter = () => (d.style.background = '#2a2f39');
      d.onmouseleave = () => (d.style.background = '');
      d.onclick = (e) => loadMedia([f.file], e.shiftKey ? 2 : 1);
      box.append(d);
    });
  }
  $('fnfolder').onchange = async (e) => {
    FN.files = (await expandZips([...e.target.files])).filter((f) => /\.(atr|atx|dcm|pro|gz|xex|com|bas|xfd)$/i.test(f.name)).map((f) => ({ name: f.webkitRelativePath || f.name, file: f }));
    $('fncount').textContent = FN.files.length + ' images';
    FujiNet.setFiles(FN.files.map((f) => ({ rel: f.name, file: f.file })));
    renderFn();
  };
  function syncFnUi() {
    $('fnbtn').textContent = 'FujiNet: ' + (FujiNet.enabled ? 'on' : 'off');
    $('fnboot').disabled = !FujiNet.enabled;
  }
  $('fnbtn').onclick = () => {
    FujiNet.enabled = !FujiNet.enabled;
    localStorage.setItem('ac.fujinet', FujiNet.enabled ? '1' : '0');
    syncFnUi();
    log('FujiNet ' + (FujiNet.enabled ? 'on' : 'off (device $70 absent; takes effect immediately, reset to reboot)'));
  };
  syncFnUi();
  $('fnreset').onclick = () => { FujiNet.reset(); log('FujiNet config reset (hosts and drive slots cleared)'); };
  $('fnboot').onclick = () => {
    if (!S.emu) { log('boot first'); return; }
    if (!FujiNet.enabled) { log('FujiNet is off'); return; }
    FujiNet.bootConfig();
    $('d1').textContent = 'FujiNet CONFIG';
  };
  $('fnfilter').oninput = renderFn;

  // ---- cartridges and eject ----
  S.pendingCart = null;
  async function insertCart(slot, file, bytes) {
    if (!S.emu) { log('boot first'); return; }
    bytes = bytes || new Uint8Array(await file.arrayBuffer());
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
  for (const n of [1, 2]) {
    $('c' + n).onchange = (e) => e.target.files[0] && insertCart(n, e.target.files[0]);
    $('ce' + n).onclick = () => {
      if (!S.emu) return;
      S.emu.ejectCart(n);
      delete S.carts[n];
      devFlash('K' + n, 'ot');
      $('cn' + n).textContent = (n === 1 ? '1 (main, right): ' : '2 (left): ') + 'empty';
      $('c' + n).value = '';
    };
    $('de' + n).onclick = () => {
      if (!S.emu) return;
      S.emu.ejectDisk(n);
      delete S.disks[n];
      $('d' + n).textContent = 'empty';
      $('f' + n).value = '';
    };
  }
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
  $('boot').addEventListener('click', () => { if (phone()) document.body.classList.add('nosb'); });

  fillRomSelects();
  loadSavedRoms();

  // ---- UI wiring ----
  AC.keyboard.restoreCharset();
  AC.keyboard.build($('kbd'), handle);
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
  $('boot').onclick = boot;
  $('reset').onclick = () => S.emu && S.emu.warmStart();
  $('cold').onclick = () => S.emu && S.emu.coldStart();
  $('pause').onclick = () => { S.running = !S.running; $('pause').textContent = S.running ? 'Pause' : 'Run'; };
  $('speed').oninput = (e) => { S.speed = Math.pow(2, +e.target.value); const s = S.speed.toFixed(S.speed < 1 ? 2 : 1); $('speedv').textContent = s + '×'; $('spd').textContent = s; };
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
  for (const n of [1, 2]) {
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

  window.ataricraft = {
    describe: () => ({
      name: 'ataricraft', core: 'libatari800 (WASM reference)',
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
    catalogQuery: (sqlText, params) => AC.Catalog.query(sqlText, params),
    chooseFolders: async (handle) => { medRules = {}; const ok = await chooseFolders(handle); return ok ? await scanHandle(handle, false) : false; },
    joy: (bits, fire) => { S.joy = bits | 0; S.fire = !!fire; sendJoy(); },
    console: (f) => S.emu.tap(f, 6),
    step: (n) => { stepFrames(n || 1); draw(); return S.emu.frames; },
    run: () => { S.running = true; }, pause: () => { S.running = false; },
    speed: (x) => { S.speed = x; },
    peek: (a, l) => S.emu.peek(a, l), poke: (a, b) => S.emu.poke(a, b),
    mountDisk: (n, name, bytes) => S.emu.mountDisk(n, name, bytes), bootFile: (name, bytes) => S.emu.bootFile(name, bytes),
    insertCart: (slot, name, bytes) => S.emu.insertCart(slot, name, bytes), cartTypes: (kb) => S.emu.cartTypes(kb),
    setCartType: (slot, t) => S.emu.setCartType(slot, t), ejectCart: (slot) => S.emu.ejectCart(slot), ejectDisk: (n) => S.emu.ejectDisk(n),
    snapshot: () => S.emu.snapshot(), restore: (s) => { S.emu.restore(s); draw(); },
    reset: (cold) => (cold ? S.emu.coldStart() : S.emu.warmStart()),
    typing: () => S.typeQ.length,
  };
})();
