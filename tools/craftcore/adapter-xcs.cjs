// Craft Container adapter for .xcs (Craft spreadsheet, CRFT type 'S'). Node only; the format code is tools/xccalc/xcsformat.cjs.
// Derived form: sheet.json (the lossless JSON twin). export() rebuilds the binary from it.
'use strict';
module.exports = function (U, make, jbytes, ext) {
  const F = require('../xccalc/xcsformat.cjs');
  return {
    name: 'xcs',
    // beats the generic CRFT (cwd) detector, which scores 0.95
    detect: (b, n) => (b.length >= 16 && U.dec(b.subarray(0, 4)) === 'CRFT' && b[5] === 0x53 ? 0.97 : ext(n) === 'xcs' ? 0.3 : 0),
    import(bytes, o) {
      o = o || {}; bytes = U.u8(bytes);
      const r = F.fromBinary(bytes);
      const c = make('sheet.xcs', o.name || 'sheet.xcs', bytes, Object.assign({ mediaType: 'application/x-craft-sheet' }, o));
      c.addDerived('sheet.json', U.enc(JSON.stringify(F.toJSON(r.wb))), { kind: 'sheet.json', mediaType: 'application/json', from: 'original', tool: 'xcsformat' });
      for (const w of r.info.warnings || []) c.addLoss({ code: 'xcs-warning', severity: 'warn', where: 'original', count: 1, detail: String(w) });
      c.addProvenance({ step: 'import', adapter: 'xcs' });
      return c;
    },
    export(c) { return U.u8(F.toBinary(F.fromJSON(U.dec(c.blob('sheet.json')))).bytes); },
  };
};
