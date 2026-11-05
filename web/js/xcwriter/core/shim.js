// Browser stand-ins for the Node modules the shared tools use (Buffer, fs, path, zlib). Part of the generated xcw-core.js.
// Buffer is a Uint8Array subclass with just the methods tools/*.cjs call; keep it small.
const __mods = {}, __defs = {};
function __def(name, fn) { __defs[name] = fn; }
function __require(name) {
  const n = name.replace(/^.*\//, '');
  if (n === 'fs') return { readFileSync() { throw new Error('fs is not available in the browser'); }, writeFileSync() { throw new Error('fs is not available in the browser'); } };
  if (n === 'path') return PATH;
  if (n === 'zlib') { const inf = __require('inflate.cjs'); return { inflateRawSync: (b) => Buffer.from(inf.inflateRaw(b)) }; }
  if (!__mods[n]) {
    if (!__defs[n]) throw new Error('module not bundled: ' + name);
    const m = { exports: {} }; __mods[n] = m; __defs[n](m, m.exports, __require);
  }
  return __mods[n].exports;
}
__require.main = null;
const PATH = {
  extname: (p) => { const b = String(p).replace(/^.*[\\/]/, ''), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },
  basename: (p, e) => { let b = String(p).replace(/^.*[\\/]/, ''); if (e && b.endsWith(e)) b = b.slice(0, -e.length); return b; },
  dirname: (p) => String(p).replace(/[\\/][^\\/]*$/, '') || '.',
  join: (...a) => a.join('/'),
};

class Buffer extends Uint8Array {
  static from(v, enc) {
    if (typeof v === 'string') {
      enc = (enc || 'utf8').toLowerCase();
      if (enc === 'latin1' || enc === 'binary' || enc === 'ascii') { const b = new Buffer(v.length); for (let i = 0; i < v.length; i++) b[i] = v.charCodeAt(i) & 255; return b; }
      if (enc === 'utf16le' || enc === 'ucs2') { const b = new Buffer(v.length * 2); for (let i = 0; i < v.length; i++) { b[i * 2] = v.charCodeAt(i) & 255; b[i * 2 + 1] = v.charCodeAt(i) >> 8; } return b; }
      if (enc === 'hex') { const b = new Buffer(v.length >> 1); for (let i = 0; i < b.length; i++) b[i] = parseInt(v.substr(i * 2, 2), 16); return b; }
      if (enc === 'base64') { const s = atob(v), b = new Buffer(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
      const u = new TextEncoder().encode(v), b = new Buffer(u.length); b.set(u); return b;
    }
    if (v instanceof ArrayBuffer) return new Buffer(v);
    const b = new Buffer(v.length); b.set(v); return b;
  }
  static alloc(n) { return new Buffer(n); }
  static isBuffer(b) { return b instanceof Buffer; }
  static concat(list) {
    const b = new Buffer(list.reduce((n, x) => n + x.length, 0)); let o = 0;
    for (const x of list) { b.set(x, o); o += x.length; }
    return b;
  }
  get _dv() { return new DataView(this.buffer, this.byteOffset, this.byteLength); }
  slice(s, e) { return this.subarray(s, e); }
  toString(enc, s = 0, e = this.length) {
    enc = (enc || 'utf8').toLowerCase(); e = Math.min(e, this.length);
    if (enc === 'latin1' || enc === 'binary' || enc === 'ascii') { let r = ''; for (let i = s; i < e; i += 8192) r += String.fromCharCode.apply(null, this.subarray(i, Math.min(e, i + 8192))); return r; }
    if (enc === 'utf16le' || enc === 'ucs2') { let r = ''; for (let i = s; i + 1 < e; i += 2) r += String.fromCharCode(this[i] | (this[i + 1] << 8)); return r; }
    if (enc === 'hex') return [...this.subarray(s, e)].map((x) => x.toString(16).padStart(2, '0')).join('');
    if (enc === 'base64') return btoa(this.toString('latin1', s, e));
    return new TextDecoder('utf-8').decode(this.subarray(s, e));
  }
  readUInt8(o) { return this[o]; }
  readUInt16LE(o) { return this._dv.getUint16(o, true); }
  readUInt16BE(o) { return this._dv.getUint16(o, false); }
  readUInt32LE(o) { return this._dv.getUint32(o, true); }
  readUInt32BE(o) { return this._dv.getUint32(o, false); }
  readInt32LE(o) { return this._dv.getInt32(o, true); }
  writeUInt16LE(v, o) { this._dv.setUint16(o, v, true); return o + 2; }
  writeUInt32LE(v, o) { this._dv.setUint32(o, v, true); return o + 4; }
  write(str, o = 0, enc) { const b = Buffer.from(str, enc); this.set(b.subarray(0, this.length - o), o); return b.length; }
  includes(v) { if (typeof v === 'number') return super.includes(v); const n = Buffer.from(v); outer: for (let i = 0; i + n.length <= this.length; i++) { for (let k = 0; k < n.length; k++) if (this[i + k] !== n[k]) continue outer; return true; } return false; }
}
global.Buffer = global.Buffer || Buffer;
