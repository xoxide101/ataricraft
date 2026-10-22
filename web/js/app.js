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
      if (!/\.zip$/i.test(f.name)) { out.push(f); continue; }
      try {
        const base = f.webkitRelativePath || f.name;
        for (const ent of await AC.Zip.list(f)) {
          out.push({ name: ent.name.split('/').pop(), webkitRelativePath: base + '/' + ent.name, size: ent.size, arrayBuffer: () => AC.Zip.extract(f, ent) });
        }
        zips++;
      } catch (e) { out.push(f); }
    }
    if (zips) log(`read ${zips} zip file${zips > 1 ? 's' : ''}`);
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
  const MED = { files: [], kind: 'all' };
  // MAME software list titles: short zip/set name -> "Title (year, publisher)"
  let TITLES = {};
  try { TITLES = JSON.parse(localStorage.getItem('ac.titles') || '{}'); } catch (e) { TITLES = {}; }
  const syncTitles = () => { $('medtitles').textContent = `${Object.keys(AC.TITLES_BUILTIN || {}).length} built-in titles (MAME)` + (Object.keys(TITLES).length ? ` + ${Object.keys(TITLES).length} from your XML` : ''); };
  const setKey = (rel) => {
    const parts = rel.split('/');
    const last = parts[parts.length - 1].replace(/\.[^.]+$/, '');
    const zip = parts.length > 1 && /\.zip$/i.test(parts[parts.length - 2]) ? parts[parts.length - 2].replace(/\.zip$/i, '') : null;
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
  const zipOf = (n) => { const p = n.split('/'); return p.length > 1 && /\.zip$/i.test(p[p.length - 2]) ? p.slice(0, -1).join('/') : ''; };
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
      d.onclick = (e) => { loadAny(m.file, !e.shiftKey, 'disk', true); };
      box.append(d);
    });
  }
  function renderMed() {
    const q = $('medfilter').value.toLowerCase();
    const box = $('medlist');
    box.innerHTML = '';
    const hits = MED.files.filter((f) => (MED.kind === 'all' || f.kind === MED.kind) && (f.name + ' ' + (f.title || '')).toLowerCase().includes(q));
    hits.slice(0, 300).forEach((f) => {
      const d = document.createElement('div');
      d.textContent = f.title ? `${f.title} — ${f.name}` : f.name;
      d.title = d.textContent;
      d.style.cssText = 'padding:3px 4px;cursor:pointer;font-size:12px;border-bottom:1px solid #2c313b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      d.onmouseenter = () => (d.style.background = '#2a2f39');
      d.onmouseleave = () => (d.style.background = '');
      d.onclick = (e) => { loadAny(f.file, e.shiftKey, f.kind); showRelated(f); };
      box.append(d);
    });
    $('medcount').textContent = MED.files.length ? `${hits.length} of ${MED.files.length}${hits.length > 300 ? ' (showing 300)' : ''}` : 'no folder';
  }
  // Remembered folder: the directory handle lives in IndexedDB (needs the File System Access API).
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('ataricraft-media', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const idbGet = async (k) => { const db = await idb(); return new Promise((res) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); };
  const idbSet = async (k, v) => { const db = await idb(); return new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); }); };
  // Big trees: only keep media-looking files (checked by name, nothing is opened), skip system folders, show progress, allow Stop.
  const SCAN_CAP = 50000;
  const SCAN_SKIP = /^(\$recycle\.bin|system volume information|node_modules|\.git|windows|program files.*)$/i;
  const SCAN_EXT = new Set([...Object.values(MEDIA_EXT).flat(), 'zip']);
  const scanWant = (name) => SCAN_EXT.has((name.split('.').pop() || '').toLowerCase()) || /^a(800|5200)[^/]*\.xml$/i.test(name);
  const scanSt = { stop: false, seen: 0, keep: 0 };
  async function walkDir(h, path, out) {
    for await (const [name, e] of h.entries()) {
      if (scanSt.stop || out.length >= SCAN_CAP) return;
      if (e.kind === 'directory') { if (!SCAN_SKIP.test(name) && !name.startsWith('.')) await walkDir(e, path + name + '/', out); continue; }
      scanSt.seen++;
      if (!scanWant(name)) continue;
      const f = await e.getFile();
      Object.defineProperty(f, 'webkitRelativePath', { value: path + name });
      out.push(f);
      if (out.length % 50 === 0) { $('medcount').textContent = `scanning… ${out.length} found (${scanSt.seen} files checked)`; await new Promise((r) => setTimeout(r)); }
    }
  }
  async function scanHandle(h, interactive) {
    let p = await h.queryPermission({ mode: 'read' });
    if (p !== 'granted' && interactive) p = await h.requestPermission({ mode: 'read' });
    if (p !== 'granted') { $('medcount').textContent = `"${h.name}" remembered: click Refresh to allow access`; return false; }
    $('medcount').textContent = 'scanning…';
    scanSt.stop = false; scanSt.seen = 0;
    $('medstop').style.display = '';
    const out = [];
    try { await walkDir(h, h.name + '/', out); } finally { $('medstop').style.display = 'none'; }
    if (scanSt.stop) log(`scan stopped: ${out.length} files kept`);
    else if (out.length >= SCAN_CAP) log(`scan capped at ${SCAN_CAP} files: pick a smaller folder for the rest`);
    diag(`scan "${h.name}": ${scanSt.seen} files checked, ${out.length} media candidates`);
    await scanMedia(out);
    return true;
  }
  $('medstop').onclick = () => { scanSt.stop = true; };
  let medHandle = null;
  if (window.showDirectoryPicker) {
    $('medpick').style.display = '';
    $('medpick').onclick = async () => {
      try { medHandle = await showDirectoryPicker({ id: 'ataricraft-media', mode: 'read' }); } catch (e) { return; }
      await idbSet('medDir', medHandle);
      await scanHandle(medHandle, true);
    };
    $('medrefresh').onclick = async () => {
      if (!medHandle) { log('no remembered folder yet: use Pick folder…'); return; }
      try { await scanHandle(medHandle, true); log('library refreshed'); } catch (e) { log('refresh failed: ' + e.message); }
    };
    idbGet('medDir').then(async (h) => {
      if (!h) return;
      medHandle = h;
      try { await scanHandle(h, false); } catch (e) { $('medcount').textContent = `"${h.name}" remembered: click Refresh`; }
    });
  }
  $('medfolder').onchange = (e) => scanMedia([...e.target.files]);
  async function scanMedia(all) {
    const xmls = all.filter((f) => /(^|[\\/])a(800|5200)[^\\/]*\.xml$/i.test(f.webkitRelativePath || f.name));
    if (xmls.length) await loadTitlesXml(xmls);
    const files = await expandZips(all);
    MED.files = files.map((f) => { const name = f.webkitRelativePath || f.name; return { name, file: f, kind: extKind(f.name), title: titleFor(name) }; }).filter((f) => f.kind);
    renderMed();
      }
  $('medfilter').oninput = renderMed;
  document.querySelectorAll('#medchips button').forEach((b) => {
    b.onclick = () => {
      MED.kind = b.dataset.t;
      document.querySelectorAll('#medchips button').forEach((x) => x.classList.toggle('on', x === b));
      renderMed();
    };
  });
  $('romfilter').oninput = () => fillRomSelects();

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
