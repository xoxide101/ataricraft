// Craft transport framing (docs/ARCH-TRANSPORT.md): frames with chunking + checksums for small 8-bit buffers, a streaming decoder
// that resynchronises after damage, a stop-and-wait Endpoint (ACK/NAK/retry), and the message layer (op + JSON meta + body).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./util.cjs'));
  else { root.AC = root.AC || {}; root.AC.CraftCore = root.AC.CraftCore || {}; root.AC.CraftCore.framing = factory(root.AC.CraftCore.util); }
})(typeof self !== 'undefined' ? self : this, function (U) {
  'use strict';

  const PROTOCOL = 1, SYNC = 0xc7, HEADER = 10;
  const TYPE = { REQ: 1, RES: 2, EVT: 3, ACK: 4, NAK: 5, ERR: 6 };
  const FLAG = { MORE: 1, CRC32: 2 };
  const MAX_PAYLOAD = 0xffff;

  // Error codes. Names are the ones web/js/transport.js already uses; the numbers are new and live on the wire.
  const ERRORS = { OK: 0, Error: 1, NotFound: 2, Exists: 3, NotAllowed: 4, BadToken: 5, Unreachable: 6, Unsupported: 7, BadFrame: 8, BadChecksum: 9, TooLarge: 10, Timeout: 11, Busy: 12, BadVersion: 13, Aborted: 14, OutOfOrder: 15 };
  const ERROR_NAMES = Object.keys(ERRORS).reduce((m, k) => { m[ERRORS[k]] = k; return m; }, {});
  const errorName = (code) => ERROR_NAMES[code] || 'Error';
  const errorCode = (name) => (ERRORS[name] == null ? ERRORS.Error : ERRORS[name]);

  // Compact opcodes for the operations in docs/TRANSPORT.md. 0 means "the op name follows as a string"; 128-255 are free for applications.
  const OPCODES = {
    'sys.hello': 1, 'sys.ping': 2, 'sys.echo': 3, 'sys.caps': 4,
    'fs.list': 16, 'fs.read': 17, 'fs.write': 18, 'fs.mkdir': 19, 'fs.rmdir': 20, 'fs.unlink': 21, 'fs.rename': 22,
    'net.http': 32, 'net.tcp.open': 33, 'net.tcp.read': 34, 'net.tcp.write': 35, 'net.tcp.close': 36, 'net.udp.open': 37, 'net.udp.send': 38, 'net.udp.read': 39, 'net.udp.close': 40,
    'disk.read': 48, 'disk.write': 49, 'disk.mount': 50, 'disk.eject': 51,
    'sql.query': 64, 'sql.exec': 65, 'sql.schema': 66, 'sql.tables': 67,
    'container.put': 80, 'container.get': 81, 'container.list': 82,
  };
  const OPNAMES = Object.keys(OPCODES).reduce((m, k) => { m[OPCODES[k]] = k; return m; }, {});

  class ProtocolError extends Error {
    constructor(name, message) { super(message || name); this.name = 'ProtocolError'; this.errorName = name; this.code = errorCode(name); }
  }

  // ---------------------------------------------------------------- frames
  // frame = {type, msgId, seq, more, payload, crc32}. Wire: C7 ver type flags msgId(2) seq(2) len(2) payload crc(2 or 4), all little-endian.
  // The checksum covers everything after the sync byte. CRC-16/CCITT-FALSE by default; flag CRC32 selects CRC-32 (IEEE).
  function encodeFrame(f) {
    const p = U.u8(f.payload);
    if (p.length > MAX_PAYLOAD) throw new ProtocolError('TooLarge', 'frame payload over 65535 bytes');
    const cl = f.crc32 ? 4 : 2, out = new Uint8Array(HEADER + p.length + cl), dv = new DataView(out.buffer);
    out[0] = SYNC; out[1] = PROTOCOL; out[2] = f.type; out[3] = (f.more ? FLAG.MORE : 0) | (f.crc32 ? FLAG.CRC32 : 0);
    dv.setUint16(4, f.msgId & 0xffff, true); dv.setUint16(6, (f.seq || 0) & 0xffff, true); dv.setUint16(8, p.length, true);
    out.set(p, HEADER);
    const body = out.subarray(1, HEADER + p.length);
    if (f.crc32) dv.setUint32(HEADER + p.length, U.crc32(body), true); else dv.setUint16(HEADER + p.length, U.crc16(body), true);
    return out;
  }

  // Parse exactly one frame at the start of b. Returns {frame, used} | {need: n} (more bytes needed) | {error: name, skip: 1}.
  function parseFrame(b, maxPayload) {
    if (b.length < HEADER) return { need: HEADER - b.length };
    if (b[0] !== SYNC) return { error: 'BadFrame', skip: 1 };
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), len = dv.getUint16(8, true), crc32 = !!(b[3] & FLAG.CRC32), total = HEADER + len + (crc32 ? 4 : 2);
    if (len > (maxPayload || MAX_PAYLOAD)) return { error: 'BadFrame', skip: 1 };
    if (b.length < total) return { need: total - b.length };
    const body = b.subarray(1, HEADER + len), ok = crc32 ? U.crc32(body) === dv.getUint32(HEADER + len, true) : U.crc16(body) === dv.getUint16(HEADER + len, true);
    if (!ok) return { error: 'BadChecksum', skip: 1 };
    if (b[1] !== PROTOCOL) return { error: 'BadVersion', skip: total };
    if (b[2] < 1 || b[2] > 6) return { error: 'BadFrame', skip: total };
    return { frame: { type: b[2], msgId: dv.getUint16(4, true), seq: dv.getUint16(6, true), more: !!(b[3] & FLAG.MORE), crc32, payload: b.slice(HEADER, HEADER + len) }, used: total };
  }

  // Streaming decoder: feed any byte slices; after garbage or a damaged frame it hunts for the next sync byte. Never throws.
  class Decoder {
    constructor(maxPayload) { this.maxPayload = maxPayload || MAX_PAYLOAD; this.buf = new Uint8Array(0); this.stats = { frames: 0, badChecksum: 0, badVersion: 0, badFrame: 0, skipped: 0 }; }
    push(bytes) {
      this.buf = this.buf.length ? U.concat([this.buf, U.u8(bytes)]) : U.u8(bytes).slice();
      const out = []; let p = 0;
      for (;;) {
        while (p < this.buf.length && this.buf[p] !== SYNC) { p++; this.stats.skipped++; }
        if (p >= this.buf.length) break;
        const r = parseFrame(this.buf.subarray(p), this.maxPayload);
        if (r.need) {
          // A damaged length field can claim bytes that never come: if a complete valid frame sits further on, this one is junk.
          let q = p + 1, found = -1;
          while ((q = this.buf.indexOf(SYNC, q)) !== -1) { if (parseFrame(this.buf.subarray(q), this.maxPayload).frame) { found = q; break; } q++; }
          if (found < 0) break;
          this.stats.skipped += found - p; p = found; continue;
        }
        if (r.frame) { out.push(r.frame); this.stats.frames++; p += r.used; continue; }
        this.stats['bad' + r.error.slice(3)]++; p += r.skip; this.stats.skipped += r.skip;
      }
      this.buf = this.buf.slice(p);
      if (this.buf.length > 70000) this.buf = this.buf.slice(this.buf.length - 70000); // never grow without bound on a noisy line
      return out;
    }
  }

  // Split a message payload into frames (the last one has no MORE flag). maxChunk is the data bytes per frame (8-bit clients use 64-256).
  function chunk(type, msgId, payload, o) {
    o = o || {}; payload = U.u8(payload);
    const max = Math.max(1, Math.min(o.maxChunk || 128, MAX_PAYLOAD)), n = Math.max(1, Math.ceil(payload.length / max)), out = [];
    if (n > 0x10000) throw new ProtocolError('TooLarge', 'message needs more than 65536 chunks');
    for (let i = 0; i < n; i++) out.push({ type, msgId, seq: i, more: i < n - 1, crc32: !!o.crc32, payload: payload.subarray(i * max, (i + 1) * max) });
    return out;
  }

  // ---------------------------------------------------------------- messages
  const meta = (m) => { const j = U.enc(JSON.stringify(m == null ? {} : m)); if (j.length > 0xffff) throw new ProtocolError('TooLarge', 'meta over 65535 bytes'); return j; };
  const u16 = (n) => Uint8Array.of(n & 255, (n >> 8) & 255);
  function encodeRequest(m) {
    const code = OPCODES[m.op] || 0, parts = [Uint8Array.of(code)];
    if (!code) { const n = U.enc(m.op); if (!n.length || n.length > 255) throw new ProtocolError('BadFrame', 'op name must be 1-255 bytes'); parts.push(Uint8Array.of(n.length), n); }
    const mj = meta(m.args); parts.push(u16(mj.length), mj, U.u8(m.body));
    return U.concat(parts);
  }
  function readMeta(b, p) {
    if (b.length < p + 2) throw new ProtocolError('BadFrame', 'message too short');
    const ml = b[p] | (b[p + 1] << 8); p += 2;
    if (b.length < p + ml) throw new ProtocolError('BadFrame', 'meta runs past the end');
    let m; try { m = JSON.parse(U.dec(b.subarray(p, p + ml))); } catch (e) { throw new ProtocolError('BadFrame', 'meta is not JSON'); }
    return { meta: m, next: p + ml };
  }
  function decodeRequest(b) {
    b = U.u8(b); if (!b.length) throw new ProtocolError('BadFrame', 'empty message');
    let p = 1, op;
    if (b[0] === 0) { if (b.length < 2 || b.length < 2 + b[1]) throw new ProtocolError('BadFrame', 'op name truncated'); op = U.dec(b.subarray(2, 2 + b[1])); p = 2 + b[1]; }
    else { op = OPNAMES[b[0]]; if (!op) throw new ProtocolError('Unsupported', 'unknown opcode ' + b[0]); }
    const r = readMeta(b, p);
    return { op, args: r.meta, body: b.slice(r.next) };
  }
  // reply = {ok, meta, body, error:{name,code,message}} as in web/js/transport.js -> {type: RES|ERR, payload}
  function encodeReply(r) {
    if (r.ok) { const mj = meta(r.meta); return { type: TYPE.RES, payload: U.concat([u16(0), u16(mj.length), mj, U.u8(r.body)]) }; }
    const e = r.error || { name: 'Error', message: '' }, mj = meta({ name: e.name, message: e.message || '', native: e.native != null ? e.native : (e.code && e.code !== errorCode(e.name) ? e.code : undefined) });
    return { type: TYPE.ERR, payload: U.concat([u16(errorCode(e.name)), u16(mj.length), mj]) };
  }
  function decodeReply(type, b) {
    b = U.u8(b); if (b.length < 2) throw new ProtocolError('BadFrame', 'reply too short');
    const code = b[0] | (b[1] << 8), r = readMeta(b, 2);
    if (type === TYPE.ERR) { const m = r.meta || {}; return { ok: false, meta: {}, body: null, error: { name: errorName(code), code, message: m.message || '', native: m.native } }; }
    return { ok: true, meta: r.meta, body: b.slice(r.next), error: null };
  }

  // ---------------------------------------------------------------- endpoint: reliable messages over an unreliable byte pipe
  // Stop-and-wait: one data frame in flight, ACK(seq) releases the next, NAK or silence retransmits (up to `retries`).
  // Duplicates are re-ACKed and ignored, so a lost ACK never duplicates data. write(bytes) is the raw pipe (serial port, socket, ...).
  class Endpoint {
    constructor(o) {
      this.write = o.write; this.maxChunk = o.maxChunk || 128; this.crc32 = !!o.crc32; this.ackTimeoutMs = o.ackTimeoutMs || 50; this.retries = o.retries == null ? 12 : o.retries;
      this.onMessage = o.onMessage || (() => {}); this.maxMessage = o.maxMessage || 1 << 20;
      this.dec = new Decoder(o.maxFrame || 4096); this.rx = new Map(); this.done = new Map(); this.pending = null; this.tx = Promise.resolve();
      this.stats = { sent: 0, retransmits: 0, naks: 0, timeouts: 0, duplicates: 0, messagesIn: 0, messagesOut: 0, dropped: 0 };
    }
    receive(bytes) { for (const f of this.dec.push(bytes)) this._frame(f); }
    _ctl(type, msgId, seq) { this.write(encodeFrame({ type, msgId, seq, payload: new Uint8Array(0), crc32: this.crc32 })); }
    _frame(f) {
      if (f.type === TYPE.ACK || f.type === TYPE.NAK) {
        const p = this.pending;
        if (p && p.msgId === f.msgId && (f.type === TYPE.NAK || p.seq === f.seq)) { this.pending = null; clearTimeout(p.timer); p.done(f.type === TYPE.ACK); }
        return;
      }
      const key = f.type + ':' + f.msgId; let a = this.rx.get(key);
      if (!a) {
        if (f.seq !== 0) { if (this.done.get(key) === f.seq) { this.stats.duplicates++; this._ctl(TYPE.ACK, f.msgId, f.seq); } else this._ctl(TYPE.NAK, f.msgId, 0); return; }
        a = { next: 0, parts: [], size: 0 }; this.rx.set(key, a);
      }
      if (f.seq < a.next) { this.stats.duplicates++; this._ctl(TYPE.ACK, f.msgId, f.seq); return; }
      if (f.seq > a.next) { this._ctl(TYPE.NAK, f.msgId, a.next); return; }
      a.size += f.payload.length;
      if (a.size > this.maxMessage) { this.rx.delete(key); this.stats.dropped++; this._ctl(TYPE.NAK, f.msgId, 0); return; }
      a.parts.push(f.payload); a.next++;
      this._ctl(TYPE.ACK, f.msgId, f.seq);
      if (!f.more) {
        this.rx.delete(key); this.done.set(key, f.seq); if (this.done.size > 64) this.done.delete(this.done.keys().next().value);
        this.stats.messagesIn++; this.onMessage({ type: f.type, msgId: f.msgId, payload: U.concat(a.parts) });
      }
    }
    // Resolves when every chunk is ACKed; rejects with ProtocolError('Timeout') when the far end stays silent.
    send(type, msgId, payload) {
      const frames = chunk(type, msgId, payload, { maxChunk: this.maxChunk, crc32: this.crc32 });
      const run = async () => {
        for (const f of frames) {
          const bytes = encodeFrame(f); let ok = false;
          for (let t = 0; t <= this.retries && !ok; t++) {
            if (t) this.stats.retransmits++;
            ok = await new Promise((res) => {
              this.pending = { msgId, seq: f.seq, done: res, timer: setTimeout(() => { this.pending = null; this.stats.timeouts++; res(false); }, this.ackTimeoutMs) };
              this.stats.sent++; this.write(bytes);
            });
          }
          if (!ok) throw new ProtocolError('Timeout', 'no acknowledgement for msg ' + msgId + ' chunk ' + f.seq);
        }
        this.stats.messagesOut++;
      };
      const p = this.tx.then(run); this.tx = p.catch(() => {}); return p;
    }
  }

  return { PROTOCOL, SYNC, HEADER, TYPE, FLAG, ERRORS, OPCODES, ProtocolError, errorName, errorCode, encodeFrame, parseFrame, Decoder, chunk, encodeRequest, decodeRequest, encodeReply, decodeReply, Endpoint };
});
