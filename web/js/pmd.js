// MIDI -> PMD converter, PMD playback events, and SAP header tools. Shared by tools/midiconv.cjs and web/workbench.html.
// PMD layout: 'P','M','D',1, then 3-byte records: frames to wait, register 0-7 (AUDF1,AUDC1,AUDF2,...), value. Register $FF ends the song.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.AC = root.AC || {}; root.AC.Pmd = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  const u16 = (b, p) => (b[p] << 8) | b[p + 1], u32 = (b, p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
  const ascii = (b, a, e) => { let s = ''; for (let i = a; i < e; i++) s += String.fromCharCode(b[i]); return s; };

  function convert(b, o = {}) {
    const FPS = o.pal ? 50 : 60, drums = o.drums !== false;
    if (ascii(b, 0, 4) !== 'MThd') throw new Error('not a MIDI file');
    const ntr = u16(b, 10), div = u16(b, 12);
    if (div & 0x8000) throw new Error('SMPTE time division is not supported');
    const ev = [], ctl = [], tempos = [{ tick: 0, us: 500000 }];
    let p = 14;
    for (let t = 0; t < ntr && p < b.length; t++) {
      if (ascii(b, p, p + 4) !== 'MTrk') break;
      const end = p + 8 + u32(b, p + 4); p += 8;
      let tick = 0, run = 0;
      const vl = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7F); } while (c & 0x80); return v; };
      while (p < end) {
        tick += vl();
        let s = b[p];
        if (s === 0xFF) { const type = b[p + 1]; p += 2; const len = vl(); if (type === 0x51 && len === 3) tempos.push({ tick, us: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2] }); p += len; continue; }
        if (s === 0xF0 || s === 0xF7) { p++; p += vl(); continue; }
        if (s & 0x80) { run = s; p++; } else s = run;
        const kind = s & 0xF0, ch = s & 15;
        if (kind === 0xC0 || kind === 0xD0) { p++; continue; }
        const d1 = b[p++], d2 = b[p++];
        if (kind === 0xB0) { ctl.push({ tick, ch, cc: d1, val: d2 }); continue; }
        if (kind === 0x90 && d2 > 0) ev.push({ tick, on: true, ch, n: d1, vel: d2 });
        else if (kind === 0x80 || kind === 0x90) ev.push({ tick, on: false, ch, n: d1 });
      }
      p = end;
    }
    tempos.sort((x, y) => x.tick - y.tick);
    const toSec = (tick) => {
      let sec = 0, lastT = 0, us = 500000;
      for (const tp of tempos) { if (tp.tick > tick) break; sec += (tp.tick - lastT) * us / 1e6 / div; lastT = tp.tick; us = tp.us; }
      return sec + (tick - lastT) * us / 1e6 / div;
    };
    ev.forEach((e) => (e.f = Math.round(toSec(e.tick) * FPS)));
    ev.sort((x, y) => x.f - y.f || (x.on ? 1 : 0) - (y.on ? 1 : 0));
    ctl.forEach((e) => (e.f = Math.round(toSec(e.tick) * FPS)));
    ctl.sort((x, y) => x.f - y.f);

    const audf = (note) => {
      let n = note;
      while (n < 47) n += 12;
      while (n > 108) n -= 12;
      const f = 440 * Math.pow(2, (n - 69) / 12);
      return Math.max(0, Math.min(255, Math.round(63921 / (2 * f)) - 1));
    };
    const drumF = (n) => (n <= 36 ? 150 : n <= 40 ? 60 : n <= 44 ? 12 : 30);
    const voices = [0, 1, 2, 3].map((i) => ({ i, ch: -1, n: -1, born: 0, until: 0 }));
    const recs = [], state = new Array(8).fill(-1);
    let curF = 0, lastF = 0;
    const put = (reg, val) => {
      if (state[reg] === val) return;
      state[reg] = val;
      let d = curF - lastF;
      while (d > 255) { recs.push([255, 0xFE, 0]); d -= 255; }
      recs.push([d, reg, val]); lastF = curF;
    };
    const frames = ev.length ? ev[ev.length - 1].f : 0;
    let i = 0, notes = 0, dropped = 0;
    const finish = (notes, dropped, extra) => {
      for (let k = 0; k < 4; k++) { curF = frames + 2; put(k * 2 + 1, 0); }
      recs.push([0, 0xFF, 0]);
      const pmd = new Uint8Array(4 + recs.length * 3);
      pmd.set([0x50, 0x4D, 0x44, 1]);
      recs.forEach((r, k) => pmd.set(r, 4 + k * 3));
      return Object.assign({ pmd, records: recs.length, seconds: frames / FPS, notes, dropped, fps: FPS, tooBig: pmd.length > 30720 }, extra);
    };
    if (o.smart) {
      // Priority allocation: keep the highest and lowest notes on their own voices, share the rest by arpeggio on the last free voice.
      // Notes below about B2 use the 4-bit poly distortion ($C0) instead of being moved up octaves.
      const pitch = (note) => {
        if (note >= 47) { let n = note; while (n > 108) n -= 12; return { f: audf(n), c: 0xA0 }; }
        let n = note; for (;;) { const hz = 440 * Math.pow(2, (n - 69) / 12), d = Math.round(63921 / (15 * hz)) - 1; if (d <= 255 || n > 108) return { f: Math.max(0, Math.min(255, d)), c: 0xC0 }; n += 12; }
      };
      const chVol = new Array(16).fill(100 / 127), expr = new Array(16).fill(1), active = new Map(), owner = [null, null, null, null], hits = [], sharedSet = new Set();
      let ci = 0, notes2 = 0, drumVoice = false;
      for (let f = 0; f <= frames + 1; f++) {
        curF = f;
        while (ci < ctl.length && ctl[ci].f <= f) { const c = ctl[ci++]; if (c.cc === 7) chVol[c.ch] = c.val / 127; else if (c.cc === 11) expr[c.ch] = c.val / 127; else if (c.cc === 123 || c.cc === 120) { for (const k of [...active.keys()]) if (((k / 128) | 0) === c.ch) active.delete(k); } }
        while (i < ev.length && ev[i].f <= f) {
          const e = ev[i++];
          if (e.ch === 9) { if (drums && e.on) { hits.push({ until: f + 3, n: e.n, vel: e.vel }); notes2++; } continue; }
          const key = e.ch * 128 + e.n;
          if (e.on) { active.set(key, { ch: e.ch, n: e.n, vel: e.vel, start: f }); notes2++; } else active.delete(key);
        }
        while (hits.length && hits[0].until <= f) hits.shift();
        const drum = hits.length ? hits[hits.length - 1] : null, cap = drum ? 3 : 4;
        if (drum) {
          if (owner[3] !== 'drum') { owner[3] = 'drum'; put(7, 0); }
          put(6, drumF(drum.n)); put(7, 0x80 | Math.max(4, Math.round(drum.vel / 127 * 15)));
          drumVoice = true;
        } else if (drumVoice) { drumVoice = false; owner[3] = null; put(7, 0); }
        const list = [...active.entries()].map(([key, a]) => ({ key, a })).sort((x, y) => y.a.n - x.a.n || x.a.start - y.a.start);
        let sel = list, arp = null;
        if (list.length > cap) {
          const direct = [list[0], list[list.length - 1]];
          for (let q = 1; q < list.length - 1 && direct.length < cap - 1; q++) direct.push(list[q]);
          const pool = list.filter((x) => !direct.includes(x));
          pool.forEach((x) => sharedSet.add(x.key));
          sel = direct; arp = pool[f % pool.length];
        }
        const want = new Map(); sel.forEach((x) => want.set(x.key, x));
        for (let v = 0; v < cap; v++) if (owner[v] !== null && owner[v] !== 'arp' && !want.has(owner[v])) { put(v * 2 + 1, 0); owner[v] = null; }
        if (!arp) for (let v = 0; v < cap; v++) if (owner[v] === 'arp') { put(v * 2 + 1, 0); owner[v] = null; }
        const free = () => { for (let v = 0; v < cap; v++) if (owner[v] === null) return v; return -1; };
        const play = (v, x) => {
          const pt = pitch(x.a.n); let vol = Math.round(x.a.vel / 127 * 15 * chVol[x.a.ch] * expr[x.a.ch] * 1.15);
          if (o.decay) vol -= Math.floor((f - x.a.start) / 6);
          vol = Math.max(o.decay ? 2 : 1, Math.min(15, vol));
          put(v * 2, pt.f); put(v * 2 + 1, pt.c | vol);
        };
        for (const x of sel) { let v = owner.indexOf(x.key); if (v < 0 || v >= cap) { v = free(); if (v < 0) continue; owner[v] = x.key; } play(v, x); }
        if (arp) { let v = owner.indexOf('arp'); if (v < 0) { v = free(); if (v >= 0) owner[v] = 'arp'; } if (v >= 0) play(v, arp); }
      }
      return finish(notes2, 0, { shared: sharedSet.size, smart: true });
    }    for (let f = 0; f <= frames + 1; f++) {
      curF = f;
      for (const v of voices) if (v.until && v.until <= f) { put(v.i * 2 + 1, 0); v.ch = -1; v.until = 0; }
      while (i < ev.length && ev[i].f <= f) {
        const e = ev[i++];
        if (e.ch === 9) {
          if (!drums || !e.on) continue;
          const v = voices.find((x) => x.ch < 0);
          if (!v) { dropped++; continue; }
          v.ch = 9; v.n = -1; v.born = f; v.until = f + 3;
          put(v.i * 2, drumF(e.n)); put(v.i * 2 + 1, 0x80 | Math.max(4, Math.round(e.vel / 127 * 15)));
          notes++; continue;
        }
        if (e.on) {
          let v = voices.find((x) => x.ch < 0);
          if (!v) { v = voices.filter((x) => x.ch !== 9).sort((a, c) => a.born - c.born)[0]; if (!v) { dropped++; continue; } dropped++; }
          v.ch = e.ch; v.n = e.n; v.born = f; v.until = 0;
          put(v.i * 2, audf(e.n)); put(v.i * 2 + 1, 0xA0 | Math.max(3, Math.round(e.vel / 127 * 15)));
          notes++;
        } else {
          const v = voices.find((x) => x.ch === e.ch && x.n === e.n);
          if (v) { put(v.i * 2 + 1, 0); v.ch = -1; v.n = -1; }
        }
      }
    }
    for (let k = 0; k < 4; k++) { curF = frames + 2; put(k * 2 + 1, 0); }
    recs.push([0, 0xFF, 0]);
    const pmd = new Uint8Array(4 + recs.length * 3);
    pmd.set([0x50, 0x4D, 0x44, 1]);
    recs.forEach((r, k) => pmd.set(r, 4 + k * 3));
    return { pmd, records: recs.length, seconds: frames / FPS, notes, dropped, fps: FPS, tooBig: pmd.length > 30720 };
  }

  // Absolute-time register writes from a .PMD: [{t seconds, reg 0-7, val}]. Last item is the end time.
  function events(pmd, fps = 60) {
    const out = []; let f = 0;
    for (let p = 4; p + 2 < pmd.length; p += 3) {
      f += pmd[p]; const reg = pmd[p + 1];
      if (reg === 0xFF) return { list: out, end: f / fps };
      if (reg < 8) out.push({ t: f / fps, reg, val: pmd[p + 2] });
    }
    return { list: out, end: f / fps };
  }

  // SAP file: ASCII header lines ending CR LF, then FF FF and Atari binary blocks.
  function parseSap(b) {
    if (ascii(b, 0, 3) !== 'SAP') throw new Error('not a SAP file (must start with SAP)');
    let p = 0; const lines = [];
    while (p < b.length - 1) {
      if (b[p] === 0xFF && b[p + 1] === 0xFF) break;
      let e = p; while (e < b.length && b[e] !== 10) e++;
      lines.push(ascii(b, p, e).replace(/\r$/, '')); p = e + 1;
    }
    if (!(b[p] === 0xFF && b[p + 1] === 0xFF)) throw new Error('no binary data found after the SAP header');
    const fields = [], q = (s) => { const m = /^"(.*)"$/.exec(s); return m ? m[1] : s; };
    for (const l of lines) { if (!l || l === 'SAP') continue; const m = /^(\w+)(?:\s+(.*))?$/.exec(l); if (m) fields.push({ key: m[1].toUpperCase(), value: q(m[2] || '') }); }
    const blocks = []; let d = p, first = true;
    while (d + 3 < b.length) {
      if (b[d] === 0xFF && b[d + 1] === 0xFF) d += 2;
      else if (first) break;
      first = false;
      const s = b[d] | (b[d + 1] << 8), e = b[d + 2] | (b[d + 3] << 8);
      if (e < s) break;
      const len = e - s + 1; if (d + 4 + len > b.length) { blocks.push({ start: s, end: e, truncated: true }); break; }
      blocks.push({ start: s, end: e, len, data: b.subarray(d + 4, d + 4 + len) }); d += 4 + len;
    }
    return { fields, binary: b.subarray(p), blocks, get: (k) => (fields.find((f) => f.key === k) || {}).value };
  }
  function buildSap(fields, binary) {
    const text = ['SAP'].concat(fields.filter((f) => f.key).map((f) => (['AUTHOR', 'NAME', 'DATE'].includes(f.key) ? `${f.key} "${f.value}"` : f.value === '' ? f.key : `${f.key} ${f.value}`))).join('\r\n') + '\r\n';
    const h = new Uint8Array(text.length + binary.length);
    for (let i = 0; i < text.length; i++) h[i] = text.charCodeAt(i) & 255;
    h.set(binary, text.length); return h;
  }
  return { convert, events, parseSap, buildSap };
});
