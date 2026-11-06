// DOS boot records: format, validation and DOS detection for Atari 8-bit disk images.
// Pure logic, no DOM and no file access, so the same file runs in the browser, in Node (scanner, relay, tests)
// and can be copied as the blueprint for other emulator "craft" machines (see docs/DOSBOOT.md).
(function () {
  const FORMAT = 'ataricraft.bootrecords';
  const VERSION = 1;
  const rd16 = (a, o) => a[o] | (a[o + 1] << 8);

  function layout(b) {
    const atr = b.length >= 16 && b[0] === 0x96 && b[1] === 0x02;
    const hdr = atr ? 16 : 0, data = b.length - hdr;
    const ss = atr ? (rd16(b, 4) || 128) : (data % 128 === 0 && (data / 128 === 720 || data / 128 === 1040) ? 128 : (data % 256 === 0 ? 256 : 128));
    const uniform = ss === 128 || data % ss === 0;
    const nsec = ss === 128 ? Math.floor(data / 128) : uniform ? Math.floor(data / ss) : 3 + Math.floor((data - 384) / ss);
    const sec = (n) => {
      if (n < 1 || n > nsec) return null;
      const o = hdr + (uniform ? (n - 1) * ss : n <= 3 ? (n - 1) * 128 : 384 + (n - 4) * ss);
      return b.subarray(o, o + (uniform || n > 3 ? ss : 128));
    };
    return { atr, ss, nsec, sec };
  }

  // DOS 2.x style directory (sectors 361-368): used for names even when the volume does not pass a strict check.
  function rawDir(L) {
    const names = [];
    if (L.nsec < 369) return names;
    for (let s = 361; s <= 368; s++) {
      const d = L.sec(s);
      if (!d) break;
      for (let o = 0; o + 16 <= d.length; o += 16) {
        const fl = d[o];
        if (fl === 0) break;
        if (fl & 0x80) continue;
        let nm = '';
        for (let k = 5; k < 16; k++) nm += String.fromCharCode(d[o + k]);
        if (/^[ -~]{11}$/.test(nm) && !/^-+$/.test(nm.trim())) names.push(nm.slice(0, 8).trim() + (nm.slice(8).trim() ? '.' + nm.slice(8).trim() : ''));
      }
    }
    return names;
  }

  const ascii = (a) => { let s = ''; for (let i = 0; i < a.length; i++) { const c = a[i]; s += c >= 32 && c < 127 ? String.fromCharCode(c) : '\u0001'; } return s; };
  const hex = (a) => Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');

  // Returns { bootable, family, name, version, confidence, files, evidence[], sectorSize, sectors, bootHeader }.
  // names: optional file names from a stricter reader (e.g. DosFs for SpartaDOS volumes).
  function detect(bytes, names, kind) {
    const L = layout(bytes);
    const ev = [];
    const out = { bootable: false, family: 'unknown', name: 'Unknown', version: '', confidence: 0, evidence: ev, sectorSize: L.ss, sectors: L.nsec, bootHeader: '', files: [] };
    const s1 = L.sec(1);
    if (!s1 || L.nsec < 3) { ev.push('too small to be a boot disk'); return out; }
    const nboot = s1[1], load = rd16(s1, 2), init = rd16(s1, 4);
    out.bootHeader = hex(s1.subarray(0, 8));
    out.bootable = nboot >= 1 && nboot <= 40 && load > 0 && load < 0xc000 && L.nsec >= nboot;
    let bootText = '';
    for (let i = 1; i <= Math.min(3, L.nsec); i++) bootText += ascii(L.sec(i));
    const files = (names && names.length ? names : rawDir(L)).map((n) => n.toUpperCase());
    out.files = files.slice(0, 40);
    const has = (re) => files.some((f) => re.test(f));
    const set = (family, name, version, conf, why) => { if (conf > out.confidence) { out.family = family; out.name = name; out.version = version; out.confidence = conf; } ev.push(why); };

    if (/^..030030e007/.test(out.bootHeader)) set('spartados', 'SpartaDOS-compatible', '', 70, 'SpartaDOS-style boot loader (load $3000, init $07E0)');
    if (/BW-DOS/.test(bootText) || has(/^(DOS\/)?XBW\d+\.DOS$/) || has(/^XBW/)) {
      const m = files.map((f) => /XBW(\d)(\d\d)\.DOS/.exec(f)).find(Boolean);
      set('bw-dos', 'BW-DOS', m ? m[1] + '.' + m[2] : '', 95, m ? 'XBW' + m[1] + m[2] + '.DOS' : 'BW-DOS boot loader text');
    }
    if (has(/(^|\/)SPARTA\.SYS$|(^|\/)SDX\.SYS$|(^|\/)SPARTA\.DOS$/) || /SPARTA/.test(bootText) || (out.family === 'unknown' && has(/^X?SPARTA/))) {
      set('spartados', 'SpartaDOS', has(/SDX/) ? 'X' : '3.x', 90, 'SpartaDOS system file');
    }
    if (/^4d030007/.test(out.bootHeader) || has(/\.AR0$/)) set('mydos', 'MyDOS', '', 90, 'MyDOS boot header / ramdisk handler');
    else if (kind === 'mydos' && has(/^DOS\.SYS$/) && has(/^DUP\.SYS$/)) set('mydos', 'MyDOS', '', 60, 'MyDOS-format volume with DOS.SYS');
    if (/No DOS|NO DOS/.test(bootText)) { out.bootable = false; out.confidence = 0; out.family = 'unknown'; ev.push('boot loader says there is no DOS on this disk'); return out; }
    if (has(/^DOSXL\.(SYS|XL)$/)) set('dos-xl', 'DOS XL', '', 95, 'DOSXL system file');
    if (has(/^MACH\.SYS$/)) set('mach-dos', 'Mach DOS', '', 95, 'MACH.SYS');
    if (has(/^UDP\.SYS$/)) set('warp-speed-dos', 'Warp Speed DOS', '', 90, 'UDP.SYS');
    if (has(/^(CONV234|DOSINFO|RESET)\.(COM|TUR)$/) || has(/^SETUP\.(BAT|NT)$/)) set('turbo-dos', 'Turbo-DOS', '', 85, 'Turbo-DOS utilities');
    if (has(/^(130XE|AXLON|IZRAMDSK|MOSAIC)$/)) set('top-dos', 'Top-DOS', '', 90, 'Top-DOS utility files');
    if (/FMS\u0001+SYS/.test(bootText.replace(/ /g, '')) || /FMS {5}SYS/.test(bootText)) set('atari-dos3', 'Atari DOS 3', '3', 90, 'FMS.SYS in boot sectors');
    if (/QDUP\.SYS/.test(bootText) && /CONFIG\.SYS/.test(bootText)) set('atari-dos4', 'Atari DOS 4', '4.0', 90, 'CONFIG.SYS + QDUP.SYS boot');
    if (/^58030007/.test(out.bootHeader)) set('dos-xe', 'DOS XE', '', 85, 'DOS XE boot header (58 03 00 07)');
    if (out.bootHeader === 'c4030007fb1238b0') {
      if (/DOS Control|^DC|DC\d+\.COM|DC_\d+\.DOC/i.test(bootText) || has(/^DC/)) set('dos-control', 'DOS Control', '', 85, 'DOS Control files');
      else set('dos-ii-d', 'DOS II+D', '', 80, 'DOS II+D boot header (c4 03 00 07 fb 12)');
    }
    if (/CAR DOS|AR DOS/.test(bootText) && has(/^DOS\.SYS$/) && out.confidence < 80) set('happy-dos', 'Happy-Computer DOS II+D', '4.5', 70, 'Happy DOS boot text');
    if (has(/^DOS\.SYS$/) && has(/^DUP\.SYS$/) && out.confidence < 60) {
      const big = L.nsec > 720 || has(/^(RAMDISK|SETUP|COPY32)\.COM$/);
      set('atari-dos2', 'Atari DOS 2', big ? '2.5' : '2.0', 60, 'DOS.SYS + DUP.SYS' + (big ? ' with 2.5 utilities / enhanced density' : ''));
    } else if (has(/^DOS\.SYS$/) && out.confidence < 50) {
      set('atari-dos2', 'DOS 2 compatible', '', 50, 'DOS.SYS only');
    }
    if (out.family === 'unknown' && out.bootable && init === 0x0714 && L.nsec < 100) {
      set('bootstub', 'DOS 2 boot stub (no DOS.SYS)', '', 30, 'DOS 2 boot sector but a tiny file collection');
      out.bootable = false;
    }
    if (out.family === 'unknown' && /^00030007/.test(out.bootHeader) && init === 0x1540) set('atari-dos2', 'Atari DOS 2', '2.0', 55, 'DOS 2.x boot sectors (load $0700, init $1540)');
    if (out.family === 'unknown' && !out.bootable) ev.push('no boot header');
    if (out.family === 'unknown') ev.push('boot header ' + out.bootHeader);
    return out;
  }

  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

  // Machine defaults per DOS family (Atari800 core model names, see AC.MODELS).
  function machineFor(det) {
    const xe = ['bw-dos', 'mydos', 'spartados', 'dos-xe', 'turbo-dos', 'dos-control', 'dos-ii-d'].includes(det.family) || det.version === '2.5';
    return { system: 'atari8', model: xe ? '130xe' : '800xl', ram: xe ? '128' : '64', tv: 'ntsc', basic: false, fastSio: true };
  }

  // What the boot should show. DOS screens are matched case-insensitively against the emulator's screen text.
  const EXPECT = {
    'atari-dos2': ['SELECT ITEM', 'DISK OPERATING'], 'dos-xl': ['DOS XL', 'D1:', 'SELECT', 'COMMAND'],
    'bw-dos': ['D1:', 'BW-DOS', 'DOS'], 'spartados': ['D1:', 'SPARTA'],
    'dos-xe': ['DOS XE', 'D1:', 'SELECT', 'COMMAND'], 'mach-dos': ['MACH', 'SELECT', 'D1:'],
    'turbo-dos': ['TURBO', 'SELECT ITEM', 'D1:', 'D1>'], 'top-dos': ['TOP', 'SELECT', 'D1:'],
    'dos-control': ['DOS', 'D1:', 'SELECT'], 'dos-ii-d': ['DISK OPERATING', 'SELECT ITEM', 'D1:'],
    'mydos': ['MYDOS', 'SELECT ITEM', 'D1:'],
  };

  function newRecord(o) {
    const det = o.detect || {};
    const m = Object.assign(machineFor(det), o.machine || {});
    const slot = o.slot || 'D1';
    return {
      id: o.id || slug(o.name || 'dos'), name: o.name || det.name || 'DOS', kind: 'dos',
      family: det.family || 'unknown', version: o.version || det.version || '',
      machine: m,
      media: [Object.assign({ slot, role: 'boot', format: 'atr' }, o.media || {})],
      boot: { target: slot, autorun: null, expect: { anyText: o.expect || EXPECT[det.family] || [], afterFrames: 600 } },
      detect: det.family ? { confidence: det.confidence, bootHeader: det.bootHeader, sectorSize: det.sectorSize, sectors: det.sectors, files: (det.files || []).slice(0, 12), evidence: det.evidence } : undefined,
      notes: o.notes || '',
    };
  }

  const SLOT = /^D[1-8]$/;
  function validateRecord(r) {
    const e = [];
    if (!r || typeof r !== 'object') return ['record is not an object'];
    if (!r.id || !/^[a-z0-9][a-z0-9._-]*$/i.test(r.id)) e.push('id must be letters, digits, . _ -');
    if (!r.name) e.push('name is required');
    const m = r.machine || {};
    if (m.system && m.system !== 'atari8') e.push('machine.system "' + m.system + '" is not supported here (atari8)');
    if (!Array.isArray(r.media) || !r.media.length) e.push('media needs at least one entry');
    else {
      const seen = {};
      r.media.forEach((x, i) => {
        if (!SLOT.test(x.slot || '')) e.push('media[' + i + '].slot must be D1..D8');
        else if (seen[x.slot]) e.push('slot ' + x.slot + ' used twice');
        else seen[x.slot] = 1;
        if (!x.path && !x.folder && !x.blank) e.push('media[' + i + '] needs path, folder or blank');
        if (x.path && /(^|[\\/])\.\.([\\/]|$)/.test(x.path)) e.push('media[' + i + '].path may not contain ..');
      });
      const t = (r.boot && r.boot.target) || (r.media[0] && r.media[0].slot);
      if (!r.media.some((x) => x.slot === t)) e.push('boot.target ' + t + ' has no media entry');
    }
    return e;
  }

  function parse(text) {
    const d = typeof text === 'string' ? JSON.parse(text) : text;
    if (!d || d.format !== FORMAT) throw new Error('not a ' + FORMAT + ' file');
    if (d.version > VERSION) throw new Error('records are version ' + d.version + ', this app reads ' + VERSION);
    return d;
  }

  // Merge fresh scan results into an existing file: records the user edited (userEdited or notes) are kept.
  function merge(existing, found) {
    const byId = new Map((existing.records || []).map((r) => [r.id, r]));
    const out = [];
    for (const f of found) {
      const old = byId.get(f.id);
      if (old && old.userEdited) { out.push(old); byId.delete(f.id); continue; }
      if (old) { f.notes = old.notes || f.notes; byId.delete(f.id); }
      out.push(f);
    }
    for (const old of byId.values()) if (old.userEdited || old.manual) out.push(old);
    return out;
  }

  const api = { FORMAT, VERSION, layout, rawDir, detect, newRecord, validateRecord, machineFor, parse, merge, slug, EXPECT };
  if (typeof AC !== 'undefined') AC.DosBoot = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
