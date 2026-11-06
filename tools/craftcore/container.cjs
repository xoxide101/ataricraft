// Craft Container (docs/ARCH-CONTAINER.md): original bytes kept + manifest + derived forms + schema + loss report, in one file.
// Node (require) and browser (AC.CraftCore.Container). Deterministic: the same inputs give the same bytes.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./util.cjs'));
  else { root.AC = root.AC || {}; root.AC.CraftCore = root.AC.CraftCore || {}; root.AC.CraftCore.Container = factory(root.AC.CraftCore.util); }
})(typeof self !== 'undefined' ? self : this, function (U) {
  'use strict';

  const MAGIC = 'CCNT', VERSION = 1, HEAD = 16, TAIL = 32;
  const SEVERITIES = ['info', 'warn', 'lossy'];
  const FIELD_TYPES = ['int', 'uint', 'float', 'decimal', 'bool', 'string', 'bytes', 'date', 'time', 'datetime', 'blob', 'json'];
  const ENCODINGS = ['craft', 'atascii', 'petscii', 'ascii', 'latin1', 'utf8'];
  const ORIGINAL = 'original';

  class ContainerError extends Error { constructor(code, message) { super(message); this.name = 'ContainerError'; this.code = code; } }
  const bad = (code, msg) => { throw new ContainerError(code, msg); };
  const blobInfo = (b) => ({ size: b.length, sha256: U.sha256hex(b), crc32: U.crc32(b) });

  class Container {
    constructor(manifest, blobs) { this.manifest = manifest; this.blobs = blobs || new Map(); }

    // o: {type, name, source:{kind,uri,transport,retrieved}, tool:{name,version}, created (ISO string; pass a fixed one for reproducible files)}
    static create(o) {
      o = o || {};
      return new Container({
        craft: { container: VERSION, created: o.created || new Date().toISOString(), tool: o.tool || null },
        type: o.type || 'unknown', name: o.name || '',
        source: o.source || { kind: 'unknown' },
        original: null, blobs: {}, derived: [], schema: null, losses: [], provenance: [], tags: o.tags || {},
      });
    }

    setOriginal(bytes, o) {
      o = o || {}; bytes = U.u8(bytes);
      this.blobs.set(ORIGINAL, bytes);
      this.manifest.blobs[ORIGINAL] = Object.assign(blobInfo(bytes), { role: 'original', mediaType: o.mediaType || 'application/octet-stream', name: o.name || this.manifest.name });
      this.manifest.original = ORIGINAL;
      this.manifest.source = Object.assign({}, this.manifest.source, { size: bytes.length, sha256: this.manifest.blobs[ORIGINAL].sha256 });
      return this;
    }

    // o: {kind, mediaType, lossy, from (blob id), tool, params, encoding}
    addDerived(id, bytes, o) {
      o = o || {}; bytes = U.u8(bytes);
      if (id === ORIGINAL) bad('BadId', 'the id "original" is reserved');
      if (this.blobs.has(id)) bad('Exists', 'derived blob already exists: ' + id);
      if (o.encoding && ENCODINGS.indexOf(o.encoding) < 0) bad('BadEncoding', 'unknown encoding ' + o.encoding);
      this.blobs.set(id, bytes);
      const e = Object.assign(blobInfo(bytes), { role: 'derived', kind: o.kind || 'data', mediaType: o.mediaType || 'application/octet-stream', lossy: !!o.lossy, from: o.from || ORIGINAL });
      if (o.encoding) e.encoding = o.encoding;
      if (o.tool) e.tool = o.tool;
      if (o.params) e.params = o.params;
      this.manifest.blobs[id] = e;
      this.manifest.derived.push(id);
      return this;
    }

    // schema: {encoding, records, fields:[{name,type,size?,encoding?,nullable?,key?,native?}]}; see docs/ARCH-CONTAINER.md
    setSchema(schema) { this.manifest.schema = schema; return this; }

    // {code, severity:'info'|'warn'|'lossy', where:'derived:id' | 'field:name' | 'original', count, detail, samples?}
    addLoss(l) {
      if (!l || !l.code) bad('BadLoss', 'a loss entry needs a code');
      this.manifest.losses.push({ code: l.code, severity: l.severity || 'lossy', where: l.where || 'original', count: l.count == null ? 1 : l.count, detail: l.detail || '', samples: l.samples });
      return this;
    }
    addProvenance(p) { this.manifest.provenance.push(Object.assign({ at: this.manifest.craft.created }, p)); return this; }

    blob(id) { const b = this.blobs.get(id); if (!b) bad('NotFound', 'no blob ' + id); return b; }
    original() { return this.blob(ORIGINAL); }
    hasBlob(id) { return this.blobs.has(id); }
    losses(severity) { return this.manifest.losses.filter((l) => !severity || l.severity === severity); }
    isLossless() { return this.losses('lossy').length === 0; }

    // Returns {ok, problems:[string]}: every blob matches its size and checksums, derived blobs name an existing source, schema and losses are well-formed.
    verify() {
      const m = this.manifest, problems = [];
      if (!m.original || !this.blobs.has(m.original)) problems.push('no original blob');
      for (const id of Object.keys(m.blobs)) {
        const b = this.blobs.get(id), e = m.blobs[id];
        if (!b) { problems.push('blob missing: ' + id); continue; }
        if (b.length !== e.size) problems.push('size differs: ' + id);
        else if (U.sha256hex(b) !== e.sha256) problems.push('sha256 differs: ' + id);
        else if (U.crc32(b) !== e.crc32) problems.push('crc32 differs: ' + id);
        if (e.role === 'derived' && !m.blobs[e.from]) problems.push('derived blob ' + id + ' comes from unknown blob ' + e.from);
      }
      for (const id of this.blobs.keys()) if (!m.blobs[id]) problems.push('blob not in manifest: ' + id);
      if (m.source && m.source.sha256 && m.blobs[ORIGINAL] && m.source.sha256 !== m.blobs[ORIGINAL].sha256) problems.push('source checksum differs from original');
      if (m.schema) {
        const names = new Set();
        for (const f of m.schema.fields || []) {
          if (!f.name || names.has(f.name)) problems.push('schema: missing or duplicate field name ' + f.name);
          names.add(f.name);
          if (FIELD_TYPES.indexOf(f.type) < 0) problems.push('schema: unknown type "' + f.type + '" for field ' + f.name);
          if (f.encoding && ENCODINGS.indexOf(f.encoding) < 0) problems.push('schema: unknown encoding "' + f.encoding + '" for field ' + f.name);
        }
      }
      for (const l of m.losses) if (SEVERITIES.indexOf(l.severity) < 0) problems.push('loss: bad severity ' + l.severity);
      return { ok: problems.length === 0, problems };
    }

    // ---- single-file form: CCNT, version, flags, reserved, manifestLen u32, blobLen u32, manifest JSON, blobs, sha256 of all before ----
    serialize() {
      const ids = Object.keys(this.manifest.blobs).sort();
      const layout = {}; let off = 0;
      for (const id of ids) { layout[id] = { offset: off, length: this.blobs.get(id).length }; off += layout[id].length; }
      const m = JSON.parse(JSON.stringify(this.manifest));
      for (const id of ids) { m.blobs[id].offset = layout[id].offset; }
      const mj = U.enc(U.canonical(m));
      const head = new Uint8Array(HEAD), dv = new DataView(head.buffer);
      head.set(U.enc(MAGIC)); head[4] = VERSION; dv.setUint32(8, mj.length, true); dv.setUint32(12, off, true);
      const body = U.concat([head, mj, ...ids.map((id) => this.blobs.get(id))]);
      return U.concat([body, U.sha256(body)]);
    }

    static parse(bytes) {
      bytes = U.u8(bytes);
      if (bytes.length < HEAD + TAIL) bad('Truncated', 'file too short for a Craft Container');
      if (U.dec(bytes.subarray(0, 4)) !== MAGIC) bad('BadMagic', 'not a Craft Container (magic ' + MAGIC + ' expected)');
      if (bytes[4] !== VERSION) bad('BadVersion', 'unsupported container version ' + bytes[4]);
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const ml = dv.getUint32(8, true), bl = dv.getUint32(12, true);
      if (HEAD + ml + bl + TAIL !== bytes.length) bad('Truncated', 'length fields do not match the file size');
      const body = bytes.subarray(0, bytes.length - TAIL);
      if (!U.equals(U.sha256(body), bytes.subarray(bytes.length - TAIL))) bad('BadChecksum', 'container checksum differs: the file is damaged');
      const m = JSON.parse(U.dec(bytes.subarray(HEAD, HEAD + ml)));
      const base = HEAD + ml, blobs = new Map();
      for (const id of Object.keys(m.blobs)) {
        const e = m.blobs[id];
        if (e.offset + e.size > bl) bad('Truncated', 'blob ' + id + ' lies outside the blob area');
        blobs.set(id, bytes.slice(base + e.offset, base + e.offset + e.size));
        delete e.offset;
      }
      return new Container(m, blobs);
    }

    // ---- folder form: {'manifest.json', 'original/<name>', 'derived/<id>'} as a Map of path -> bytes (used by the Archive lane) ----
    toFiles() {
      const f = new Map(), m = JSON.parse(JSON.stringify(this.manifest));
      for (const id of Object.keys(m.blobs)) {
        const path = id === ORIGINAL ? 'original/' + (m.blobs[id].name || 'original.bin') : 'derived/' + id;
        m.blobs[id].path = path; f.set(path, this.blobs.get(id));
      }
      f.set('manifest.json', U.enc(JSON.stringify(m, null, 2)));
      return f;
    }
    static fromFiles(files) {
      const mj = files.get('manifest.json'); if (!mj) bad('NotFound', 'manifest.json missing');
      const m = JSON.parse(U.dec(mj)), blobs = new Map();
      for (const id of Object.keys(m.blobs)) { const p = m.blobs[id].path; if (!files.has(p)) bad('NotFound', 'file missing: ' + p); blobs.set(id, U.u8(files.get(p))); delete m.blobs[id].path; }
      return new Container(m, blobs);
    }
  }

  // Round-trip diff discipline (like the word processor): import -> export -> compare with the original.
  // adapters: {import(bytes, opts) -> Container, export(container) -> Uint8Array}. Returns {ok, identical, firstDiff, sizeIn, sizeOut, container, exported, losses}.
  function roundTrip(adapter, bytes, opts) {
    bytes = U.u8(bytes);
    const c = Container.parse(Container.prototype.serialize.call(adapter.import(bytes, opts))); // through the file form, as a real transfer would
    const out = U.u8(adapter.export(c));
    const d = U.firstDiff(bytes, out);
    return { ok: c.verify().ok && d < 0, identical: d < 0, firstDiff: d, sizeIn: bytes.length, sizeOut: out.length, container: c, exported: out, losses: c.losses() };
  }

  return { Container, ContainerError, roundTrip, MAGIC, VERSION, FIELD_TYPES, ENCODINGS, SEVERITIES, ORIGINAL };
});
