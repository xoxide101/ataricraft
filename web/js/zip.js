// Minimal ZIP reader (central directory + stored/deflate) for MAME-style software zips. Uses the browser's DecompressionStream.
(function () {
  const u16 = (d, o) => d.getUint16(o, true);
  const u32 = (d, o) => d.getUint32(o, true);

  async function list(file) {
    const size = file.size;
    const tailLen = Math.min(size, 66000);
    const tail = new DataView(await file.slice(size - tailLen).arrayBuffer());
    let e = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('not a zip');
    const count = u16(tail, e + 10), cdSize = u32(tail, e + 12), cdOff = u32(tail, e + 16);
    if (cdOff === 0xffffffff || count === 0xffff) throw new Error('zip64 not supported');
    const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const bytes = new Uint8Array(cd.buffer);
    const out = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
      if (u32(cd, p) !== 0x02014b50) break;
      const nameLen = u16(cd, p + 28), extraLen = u16(cd, p + 30), cmtLen = u16(cd, p + 32);
      const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
      if (!name.endsWith('/')) out.push({ name, method: u16(cd, p + 10), csize: u32(cd, p + 20), size: u32(cd, p + 24), offset: u32(cd, p + 42) });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
  }

  async function extract(file, ent) {
    const lh = new DataView(await file.slice(ent.offset, ent.offset + 30).arrayBuffer());
    if (u32(lh, 0) !== 0x04034b50) throw new Error('bad zip entry');
    const start = ent.offset + 30 + u16(lh, 26) + u16(lh, 28);
    const raw = file.slice(start, start + ent.csize);
    const P = window.AC && AC.Progress;
    const label = 'Extracting ' + (ent.name || 'file').split('/').pop();
    if (ent.method === 0) return P ? P.read(raw, label) : new Uint8Array(await raw.arrayBuffer());
    if (ent.method !== 8) throw new Error('unsupported zip method ' + ent.method);
    const prog = P && ent.csize >= (2 << 20) ? P.begin(label, ent.csize, true) : null;
    try {
      let n = 0;
      const counter = new TransformStream({ transform(chunk, c) { n += chunk.length; if (prog) prog.set(n); c.enqueue(chunk); } });
      const stream = raw.stream().pipeThrough(counter).pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } finally { if (prog) prog.end(); }
  }

  window.AC = window.AC || {};
  AC.Zip = { list, extract };
})();
