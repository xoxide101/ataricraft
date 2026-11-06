// Craft Container adapter for .xcd (Craft database, CRFT type 'D'). Node only; the format code is tools/xcdformat.cjs.
// Derived form: database.json (the lossless JSON twin). export() rebuilds the binary from it.
'use strict';
module.exports = function (U, make, jbytes, ext) {
  const F = require('../xcdformat.cjs'), D = require('../dbcore.cjs');
  return {
    name: 'xcd',
    // beats the generic CRFT (cwd) detector, which scores 0.95
    detect: (b, n) => (b.length >= 16 && U.dec(b.subarray(0, 4)) === 'CRFT' && b[5] === 0x44 ? 0.97 : ext(n) === 'xcd' ? 0.3 : 0),
    import(bytes, o) {
      o = o || {}; bytes = U.u8(bytes);
      const r = F.fromBinary(bytes);
      const c = make('database.xcd', o.name || 'database.xcd', bytes, Object.assign({ mediaType: 'application/x-craft-database' }, o));
      c.addDerived('database.json', U.enc(JSON.stringify(D.toJSON(r.db))), { kind: 'database.json', mediaType: 'application/json', from: 'original', tool: 'xcdformat' });
      for (const w of r.info.warnings || []) c.addLoss({ code: 'xcd-warning', severity: 'warn', where: 'original', count: 1, detail: String(w) });
      c.addProvenance({ step: 'import', adapter: 'xcd' });
      return c;
    },
    export(c) { return U.u8(F.toBinary(D.fromJSON(U.dec(c.blob('database.json')))).bytes); },
  };
};
