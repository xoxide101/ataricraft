// craftcore text encodings: ATASCII, PETSCII (upper/lower mode), ASCII, Latin-1, UTF-8 <-> Unicode, each with a loss list.
// decode(bytes, name) -> {text, lost:[{pos, byte, why}]}; encode(text, name) -> {bytes, lost:[{pos, char, why}]}.
// ATASCII and PETSCII are marked partial: anything not certain is reported as lost instead of guessed.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./util.cjs'));
  else { root.AC = root.AC || {}; root.AC.CraftCore = root.AC.CraftCore || {}; root.AC.CraftCore.encodings = factory(root.AC.CraftCore.util); }
})(typeof self !== 'undefined' ? self : this, function (U) {
  'use strict';

  // ATASCII (partial): 20-5F and 61-7A are ASCII, 7C is '|', 9B is end of line, 00 heart, 60 diamond, 7B spade.
  // Inverse video (bit 7 set) is dropped and reported. Other graphics/control codes are reported as lost.
  const ATA_EXTRA = { 0x00: '\u2665', 0x60: '\u2666', 0x7b: '\u2660' };
  const atasciiDecode = (b) => {
    let text = ''; const lost = [];
    for (let i = 0; i < b.length; i++) {
      const c = b[i];
      if (c === 0x9b) { text += '\n'; continue; }
      const base = c & 0x7f;
      let ch = ATA_EXTRA[base];
      if (ch === undefined && ((base >= 0x20 && base <= 0x5f) || (base >= 0x61 && base <= 0x7a) || base === 0x7c)) ch = String.fromCharCode(base);
      if (ch === undefined) { text += '\ufffd'; lost.push({ pos: i, byte: c, why: 'no Unicode mapping for ATASCII control or graphics code' }); continue; }
      if (c & 0x80) lost.push({ pos: i, byte: c, why: 'inverse video dropped' });
      text += ch;
    }
    return { text, lost };
  };
  const ataEnc = (() => { const m = new Map(); for (let c = 0x20; c < 0x7f; c++) if (c !== 0x7b && c !== 0x60) m.set(String.fromCharCode(c), c); for (const k of Object.keys(ATA_EXTRA)) m.set(ATA_EXTRA[k], +k); m.set('\n', 0x9b); m.set('\r', 0x9b); return m; })();

  // PETSCII upper/lower-case mode (partial): 20-40 ASCII, 41-5A lower case, C1-DA upper case, 5B '[', 5D ']', 5C pound, 5E up arrow, 5F left arrow, 0D newline.
  const petsciiDecode = (b) => {
    let text = ''; const lost = [];
    for (let i = 0; i < b.length; i++) {
      const c = b[i]; let ch;
      if (c === 0x0d) ch = '\n';
      else if (c >= 0x20 && c <= 0x40) ch = String.fromCharCode(c);
      else if (c >= 0x41 && c <= 0x5a) ch = String.fromCharCode(c + 32);
      else if (c >= 0xc1 && c <= 0xda) ch = String.fromCharCode(c - 128);
      else if (c === 0x5b) ch = '['; else if (c === 0x5d) ch = ']'; else if (c === 0x5c) ch = '\u00a3'; else if (c === 0x5e) ch = '\u2191'; else if (c === 0x5f) ch = '\u2190';
      if (ch === undefined) { text += '\ufffd'; lost.push({ pos: i, byte: c, why: 'PETSCII control or graphics code (not mapped)' }); } else text += ch;
    }
    return { text, lost };
  };
  const petEnc = (() => { const m = new Map(); for (let c = 0x20; c <= 0x40; c++) m.set(String.fromCharCode(c), c); for (let c = 0x61; c <= 0x7a; c++) m.set(String.fromCharCode(c), c - 32); for (let c = 0x41; c <= 0x5a; c++) m.set(String.fromCharCode(c), c + 128); m.set('[', 0x5b); m.set(']', 0x5d); m.set('\u00a3', 0x5c); m.set('\u2191', 0x5e); m.set('\u2190', 0x5f); m.set('\n', 0x0d); return m; })();

  const asciiDecode = (b) => {
    let text = ''; const lost = [];
    for (let i = 0; i < b.length; i++) { const c = b[i]; if (c < 0x80) text += String.fromCharCode(c); else { text += '\ufffd'; lost.push({ pos: i, byte: c, why: 'not 7-bit ASCII' }); } }
    return { text, lost };
  };
  const latin1Decode = (b) => { let text = ''; for (let i = 0; i < b.length; i++) text += String.fromCharCode(b[i]); return { text, lost: [] }; };
  const utf8Decode = (b) => {
    const text = new TextDecoder('utf-8').decode(b), lost = [];
    if (text.indexOf('\ufffd') >= 0 && !U.equals(new TextEncoder().encode(text), b)) lost.push({ pos: text.indexOf('\ufffd'), byte: -1, why: 'invalid UTF-8 replaced with U+FFFD' });
    return { text, lost };
  };

  const mapEncode = (map, name) => (text) => {
    const out = []; const lost = []; let pos = 0;
    for (const ch of text) {
      const c = map.get(ch);
      if (c === undefined) { out.push(0x3f); lost.push({ pos, char: ch, why: 'not representable in ' + name + ', written as ?' }); } else out.push(c);
      pos += ch.length;
    }
    return { bytes: Uint8Array.from(out), lost };
  };
  const rangeEncode = (limit, name) => (text) => {
    const out = []; const lost = []; let pos = 0;
    for (const ch of text) { const c = ch.codePointAt(0); if (c < limit) out.push(c); else { out.push(0x3f); lost.push({ pos, char: ch, why: 'not representable in ' + name + ', written as ?' }); } pos += ch.length; }
    return { bytes: Uint8Array.from(out), lost };
  };

  const TABLE = {
    atascii: { decode: atasciiDecode, encode: mapEncode(ataEnc, 'ATASCII'), partial: true },
    petscii: { decode: petsciiDecode, encode: mapEncode(petEnc, 'PETSCII'), partial: true },
    ascii: { decode: asciiDecode, encode: rangeEncode(0x80, 'ASCII') },
    latin1: { decode: latin1Decode, encode: rangeEncode(0x100, 'Latin-1') },
    utf8: { decode: utf8Decode, encode: (t) => ({ bytes: new TextEncoder().encode(t), lost: [] }) },
  };
  const names = () => Object.keys(TABLE);
  const decode = (bytes, name) => { const e = TABLE[name]; if (!e) throw new Error('unknown encoding ' + name); return e.decode(U.u8(bytes)); };
  const encode = (text, name) => { const e = TABLE[name]; if (!e) throw new Error('unknown encoding ' + name); return e.encode(text); };
  return { names, decode, encode, partial: (n) => !!(TABLE[n] && TABLE[n].partial) };
});
