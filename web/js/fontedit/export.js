// Export: ACF/JSON/INC/FNT/PNG sheet/XCF/BDF/TTF per size, a whole family as a ZIP (our stored-zip container), specimen PNG,
// Send to ACWriter (H:), Use in xCWriter.
(() => {
  'use strict';
  const FE = window.FE, CF = FE.CF, FP = FE.FP, $ = FE.$, st = FE.state;
  FE.download = (name, data, type) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: type || 'application/octet-stream' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  };
  const download = FE.download;
  FE.fname = () => ($('name').value || 'font').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 8).toUpperCase() || 'FONT';
  const longName = () => ($('name').value || 'font').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40) || 'font';
  const fname = FE.fname;

  // the stored glyph range must cover every slot that holds a glyph
  function ensureRange(f) {
    let lo = 32, hi = f.first + f.count - 1;
    const used = (s) => s >= 0 && s < 256 && f.glyphs[s] && f.glyphs[s].some((b) => b);
    for (let s = 0; s < 256; s++) if (used(s)) { lo = Math.min(lo, s); hi = Math.max(hi, s); }
    for (let c = 0; c < 256; c++) if (used(f.map[c])) { lo = Math.min(lo, f.map[c]); hi = Math.max(hi, f.map[c]); }
    f.first = lo; f.count = hi - lo + 1;
  }
  FE.exportAcf = () => { st.f.name = $('name').value || st.f.name; ensureRange(st.f); return CF.serialize(st.f); };
  const exportAcf = FE.exportAcf;

  // an 8x8 set of this family (derived on the fly from the master when the family has none) for Atari charsets
  FE.atari8 = (derive) => {
    if (st.f.adv === 8 && st.f.gw <= 8) return st.f;
    const f8 = st.fam && st.fam.sizes[8]; if (f8) return f8;
    if (!derive) return null;
    const m = st.fam.sizes[st.fam.master] || st.f;
    if (!FE.a8cache || FE.a8cache.m !== m) FE.a8cache = { m, f: CF.derive(m, 8, { threshold: +$('dth').value, keepStems: $('dkeep').checked }) };
    return FE.a8cache.f;
  };

  FE.acwriterFile = () => {
    const f = st.f, acf = exportAcf();
    return f.adv === 8 && f.gw <= 8 ? [fname() + '.FNT', new Uint8Array(CF.toFnt(f))] : [fname() + '.ACF', new Uint8Array(acf)];
  };
  const directEmu = () => {
    const c = [window.FujiNet && window.FujiNet.emu];
    try { if (window.opener && !window.opener.closed) c.push(window.opener.FujiNet && window.opener.FujiNet.emu); } catch (e) { /* cross-origin opener */ }
    return c.find((e) => e && typeof e.hostWrite === 'function') || null;
  };
  function viaChannel(name, bytes) {
    return new Promise((res) => {
      if (!window.BroadcastChannel) return res({ ok: false, msg: 'BroadcastChannel is not available' });
      const bc = new BroadcastChannel('xcwriter'); let done = false;
      const end = (r) => { if (done) return; done = true; bc.close(); res(r); };
      bc.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === 'pong') { if (!m.booted) end({ ok: false, msg: 'the emulator tab is open but not booted' }); else bc.postMessage({ type: 'hostWrite', name, bytes: Array.from(bytes) }); }
        else if (m.type === 'result') end({ ok: m.ok, name: m.name, msg: m.msg });
      };
      bc.postMessage({ type: 'ping' });
      setTimeout(() => end({ ok: false, msg: 'no emulator tab found: open index.html in this browser and boot ACWriter' }), 1500);
    });
  }
  FE.sendToAcwriter = async () => {
    const [name, bytes] = FE.acwriterFile(), emu = directEmu();
    let r;
    if (emu) { emu.hostWrite(name, bytes); r = { ok: true, name, via: 'emulator' }; }
    else { r = await viaChannel(name, bytes); r.via = 'channel'; }
    FE.toast(r.ok ? 'Wrote H:' + (r.name || name) + ' (' + bytes.length + ' bytes). In ACWriter use Character > Font and pick ' + (r.name || name) : 'Not sent: ' + r.msg);
    return Object.assign({ name, size: bytes.length }, r);
  };
  FE.useInXcwriter = () => {
    if (!window.XFACE) throw new Error('faces.js is not loaded');
    const id = XFACE.faceId(fname() + '.acf'), bytes = new Uint8Array(exportAcf());
    XFACE.saveUser(id, bytes);
    FE.toast('xCWriter font list now has ' + id + ' (Font editor group, this browser)');
    return id;
  };

  const canvasPng = (cv, name) => cv.toBlob((bl) => download(name, bl, 'image/png'));
  function pipeExport(ext) {
    const fam = st.fam, size = st.f.adv, base = fname();
    const only = ext === 'xcf' ? fam : { sizes: { [size]: st.f }, master: size, name: fam.name };
    const out = FP.files(only, base, { formats: [ext] }), names = Object.keys(out);
    const n = names.find((k) => k.endsWith('.' + ext)); download(n, out[n], ext === 'xcf' ? 'application/json' : 'application/octet-stream');
    FE.toast(ext.toUpperCase() + ' exported: ' + n);
  }
  // all sizes in every format, the kerning table and a README, in one zip
  FE.familyZip = () => {
    const fam = st.fam, base = longName(), files = [];
    const out = FP.files(fam, base, { formats: ['acf', 'bdf', 'ttf', 'json', 'xcf'] });
    for (const [n, d] of Object.entries(out)) files.push([base + '/' + n, typeof d === 'string' ? Buffer.from(d, 'utf8') : Buffer.from(d)]);
    const f8 = FE.atari8(false); if (f8) files.push([base + '/' + base + '8.fnt', Buffer.from(CF.toFnt(f8))]);
    if (Object.keys(st.kern).length) files.push([base + '/kerning.json', Buffer.from(JSON.stringify(st.kern, null, 1))]);
    files.push([base + '/README.txt', Buffer.from('Craft font family "' + fam.name + '"\nSizes: ' + Object.keys(fam.sizes).join(', ') + ' px (master ' + fam.master + ')\nMade with the Craft Font Editor (docs/FONT.md).\n.acf = Craft ACF2, .bdf/.ttf = lossless pixel exports, .xcf = whole family, .fnt = Atari 1K charset (8x8).\n')]);
    return { name: base + '.zip', zip: Buffer.from(XCW.zipStore(files)), count: files.length };
  };
  FE.specimenPng = () => { if (!FE.specimenCanvas) return null; const cv = FE.specimenCanvas(); canvasPng(cv, longName() + '.specimen.png'); return cv; };

  document.addEventListener('DOMContentLoaded', () => {
    $('bsave').onclick = () => { const b = exportAcf(); download(fname() + '.acf', b); FE.toast('Saved ' + b.length + ' bytes (ACF2, ' + st.f.adv + ' px)'); };
    $('bjson').onclick = () => { exportAcf(); download(fname() + '.json', CF.toJson(st.f), 'application/json'); };
    $('binc').onclick = () => { exportAcf(); download(fname() + '.inc', CF.toInc(st.f, 'cf'), 'text/plain'); };
    $('bfnt').onclick = () => {
      const f = FE.atari8(true); if (!f) return FE.toast('Cannot make an 8x8 set');
      download(fname() + '.fnt', CF.toFnt(f), 'application/octet-stream'); FE.toast('Exported ' + fname() + '.fnt (1024 bytes, 8x8, screen-code order' + (f === st.f || (st.fam && st.fam.sizes[8] === f) ? '' : ', derived on the fly from ' + st.f.adv + ' px') + ')');
    };
    $('bpng').onclick = () => {
      const sh = CF.toSheet(st.f), cv = document.createElement('canvas'); cv.width = sh.w; cv.height = sh.h;
      const c = cv.getContext('2d'), im = c.createImageData(sh.w, sh.h);
      for (let i = 0; i < sh.data.length; i++) { const v = sh.data[i] ? 0 : 255; im.data.set([v, v, v, 255], i * 4); }
      c.putImageData(im, 0, 0); canvasPng(cv, fname() + '.sheet.png');
    };
    $('bprev').onclick = () => canvasPng($('preview'), fname() + '.preview.png');
    $('bxcf').onclick = () => pipeExport('xcf'); $('bbdf').onclick = () => pipeExport('bdf'); $('bttf').onclick = () => pipeExport('ttf');
    $('bfam').onclick = () => download(longName() + '.family.json', CF.familyToJson(st.fam), 'application/json');
    $('bzip').onclick = () => { const r = FE.familyZip(); download(r.name, r.zip, 'application/zip'); FE.toast('Family zip: ' + r.count + ' files, ' + Object.keys(st.fam.sizes).length + ' sizes'); };
    $('bspec').onclick = () => FE.specimenPng();
    $('bsend').onclick = FE.sendToAcwriter; $('buse').onclick = () => { try { FE.useInXcwriter(); } catch (e) { FE.toast(e.message); } };
  });
})();
