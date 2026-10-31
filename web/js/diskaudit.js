// Disk audit for Atari DOS 2.x / MyDOS ATR images (128-byte sectors, 720 or 1040 sectors).
// Finds what the directory does not show: deleted files that can still be recovered, data left in sectors the
// VTOC calls free, used sectors that no file claims, and extra bytes in the ATR header. Read-only.
// Sector chain format: bytes 0-124 data, byte 125 = file number (bits 7-2) + next sector high bits (1-0), 126 = next low, 127 = bytes used.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.AC = root.AC || {}; root.AC.DiskAudit = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  const hex = (a) => Array.from(a, (v) => v.toString(16).padStart(2, '0')).join('');

  function scan(b) {
    if (!b || b.length < 16 + 720 * 128 || b[0] !== 0x96 || b[1] !== 0x02 || (b[4] | (b[5] << 8)) !== 128) return null;
    const nsec = Math.floor((b.length - 16) / 128);
    if (nsec !== 720 && nsec !== 1040) return null;
    const sec = (n) => b.subarray(16 + (n - 1) * 128, 16 + n * 128);
    const vtoc = sec(360);
    if (vtoc[0] !== 2 && vtoc[0] !== 3) return null;
    const ed = nsec === 1040 && vtoc[0] === 2;
    const isFree = (n) => {
      if (n < 1 || n > nsec) return false;
      if (ed && n >= 720) return !!(sec(1024)[(n - 48) >> 3] & (0x80 >> ((n - 48) & 7)));
      return !!(vtoc[10 + (n >> 3)] & (0x80 >> (n & 7)));
    };
    const isZero = (s) => { for (let i = 0; i < s.length; i++) if (s[i]) return false; return true; };
    const name = (s, o) => { const n = String.fromCharCode(...s.subarray(o + 5, o + 13)).replace(/[^\x20-\x7e]/g, '?').trim(), e = String.fromCharCode(...s.subarray(o + 13, o + 16)).replace(/[^\x20-\x7e]/g, '?').trim(); return e ? n + '.' + e : n; };

    function chain(start, idx, max) {
      const secs = [], parts = [];
      let n = start, status = 'intact', guard = 0;
      while (n) {
        if (n < 1 || n > nsec || ++guard > nsec) { status = 'broken'; break; }
        const s = sec(n), len = s[127];
        if (idx === null) idx = s[125] >> 2;
        if (s[125] >> 2 !== idx) { status = secs.length ? 'broken' : 'overwritten'; break; }
        if (len > 125) { status = 'broken'; break; }
        secs.push(n); parts.push(s.subarray(0, len));
        n = ((s[125] & 3) << 8) | s[126];
        if (max && secs.length >= max) { if (n) status = 'probable'; break; }
      }
      let total = 0; for (const p of parts) total += p.length;
      const data = new Uint8Array(total); let o = 0; for (const p of parts) { data.set(p, o); o += p.length; }
      return { secs, data, status };
    }

    const r = { fs: vtoc[0] === 3 ? 'mydos' : 'dos2', sectors: nsec, live: [], deleted: [], limited: false };
    const claimed = new Set([1, 2, 3, 360]);
    for (let n = 361; n <= 368; n++) claimed.add(n);
    if (ed) claimed.add(1024);
    const rows = [];
    for (let d = 361; d <= 368; d++) {
      const s = sec(d);
      for (let k = 0; k < 8; k++) {
        const o = k * 16, f = s[o], idx = (d - 361) * 8 + k, cnt = s[o + 1] | (s[o + 2] << 8), st = s[o + 3] | (s[o + 4] << 8);
        if (!f) continue;
        rows.push({ f, idx, cnt, st, name: name(s, o) });
      }
    }
    for (const e of rows) {
      if (e.f & 0x10) { r.limited = true; continue; }
      if ((e.f & 0x40) && !(e.f & 0x80)) {
        r.live.push(e.name);
        if (e.st >= 1 && e.st <= nsec) { const c = chain(e.st, e.idx); c.secs.forEach((x) => claimed.add(x)); }
      }
    }
    const recSecs = new Set();
    for (const e of rows) {
      if (!(e.f & 0x80) || e.cnt < 1 || e.st < 1 || e.st > nsec || !/^[\x20-\x7e]+$/.test(e.name)) continue;
      const c = chain(e.st, null, e.cnt);
      if (!c.secs.length) { r.deleted.push({ name: e.name, status: 'overwritten', sectors: [], expected: e.cnt, bytes: 0, data: new Uint8Array(0) }); continue; }
      const reused = c.secs.filter((x) => claimed.has(x) || !isFree(x)).length;
      let status = c.status;
      if ((status === 'intact' || status === 'probable') && c.secs.length !== e.cnt) status = 'partial';
      if ((status === 'intact' || status === 'probable') && reused) status = 'partial';
      c.secs.forEach((x) => recSecs.add(x));
      r.deleted.push({ name: e.name, status, sectors: c.secs, expected: e.cnt, bytes: c.data.length, data: c.data });
    }
    r.freeData = []; r.orphans = [];
    for (let n = 4; n <= (ed ? 1023 : 719); n++) {
      if (claimed.has(n)) continue;
      const s = sec(n);
      if (isFree(n)) { if (!isZero(s)) r.freeData.push(n); } else r.orphans.push(n);
    }
    if (r.limited) r.orphans = [];
    r.residue = r.freeData.filter((n) => !recSecs.has(n));
    const text = [];
    for (const n of r.residue.slice(0, 400)) {
      const run = String.fromCharCode(...sec(n).subarray(0, 125).map((c) => (c >= 32 && c < 127 ? c : 0))).split('\0').filter((t) => t.trim().length >= 8 && /[A-Za-z]{4}/.test(t));
      for (const t of run) { if (text.length < 8) text.push(t.trim().slice(0, 60)); }
    }
    r.residueText = text;
    r.headerExtra = b[8] || b[9] || b[10] || b[11] || b[12] || b[13] || b[14] || b[15] ? hex(b.subarray(8, 16)) : null;
    return r;
  }

  return { scan };
});
