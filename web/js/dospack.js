// ACDOS.PAK reader + disk installer. Works in the browser and in Node.
// Container: "ACDOSPK1" | u32le manifestLen | manifest JSON | blobs (raw deflate)
(function () {
  const AC = (window.AC = window.AC || {});
  const FMT = 'ACDOSPK1';

  async function inflate(bytes) {
    if (typeof DecompressionStream !== 'undefined') {
      const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(s).arrayBuffer());
    }
    return new Uint8Array(require('zlib').inflateRawSync(Buffer.from(bytes)));
  }

  function open(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let magic = '';
    for (let i = 0; i < 8; i++) magic += String.fromCharCode(b[i]);
    if (magic !== FMT) throw new Error('not an ACDOS pack');
    const mlen = b[8] | (b[9] << 8) | (b[10] << 16) | (b[11] << 24);
    const man = JSON.parse(new TextDecoder().decode(b.subarray(12, 12 + mlen)));
    const base = 12 + mlen;
    const byId = new Map(man.items.map((i) => [i.id, i]));
    const get = async (id) => {
      const it = byId.get(id);
      if (!it) throw new Error('unknown pack item: ' + id);
      return inflate(b.subarray(base + it.off, base + it.off + it.len));
    };
    return {
      manifest: man,
      list: (kind) => man.items.filter((i) => !kind || i.kind === kind),
      info: (id) => byId.get(id),
      get,
      // Build a ready disk: DOS template plus the chosen tool ids ('all', [] or ids).
      async install(id, opts) {
        opts = opts || {};
        const it = byId.get(id);
        if (!it || it.kind !== 'dos') throw new Error('not a DOS item: ' + id);
        const img = await get(id);
        let tools = opts.tools === undefined ? 'all' : opts.tools;
        if (tools === 'all') tools = man.items.filter((i) => i.kind === 'tool').map((i) => i.id);
        if (!tools.length) return { bytes: img, added: [], item: it };
        const C = AC.AfmCore;
        const m = C.mount(img, id + '.atr');
        const added = [], skipped = [];
        for (const t of tools) {
          const ti = byId.get(t);
          if (!ti || ti.kind !== 'tool') throw new Error('unknown tool: ' + t);
          try { m.vol.writeFile(ti.dest, await get(t), true); added.push(ti.dest); } catch (e) { skipped.push(ti.dest + ': ' + e.message); }
        }
        C.refresh(m);
        return { bytes: new Uint8Array(m.bytes), added, skipped, item: it };
      },
    };
  }

  async function load(url) {
    const r = await fetch(url || 'library/dospack/ACDOS.PAK');
    if (!r.ok) throw new Error('ACDOS.PAK: HTTP ' + r.status);
    return open(new Uint8Array(await r.arrayBuffer()));
  }

  AC.DosPack = { open, load };
})();
