/* Virtual raw-sector read-only drives D9: ($39) and D10: ($3A) for ataricraft.
   Serves FAT / ISO 9660 / UDF images (or any raw image) to a 6502 program that talks to SIO directly (CMD).
   Hooked from the SIO patch via Module.acSio(dev, cmd, dstats, aux, data, len); only the libatari800 core can claim these IDs.

   SIO commands (all read-only; writes are NAKed):
     $53 status   -> 8 bytes: sector count u32 LE, sector size u16 LE, flags (bit0 = image present, bit1 = read-only), unit
     $48 set high -> AUX1/AUX2 = bits 16-31 of the next sector number, no data (cleared after each read)
     $52 read     -> AUX1/AUX2 = bits 0-15 of the sector number; transfers DBYT bytes from sector * sector size
*/
(function () {
  const C = 0x43, N = 0x4e, E = 0x45;
  const RawDisk = {
    units: { 0x39: null, 0x3a: null },     // {name, bytes, ss}
    hi: { 0x39: 0, 0x3a: 0 },
    onChange: null,
    mem: null,

    attach(emu) {
      if (emu.core === 'altirra' || !emu.m) return false;   // the Altirra core only claims $70
      this.mem = () => (emu.fnMem ? emu.fnMem() : emu.mem());
      const inner = emu.m.acSio;
      emu.m.acSio = (dev, cmd, dstats, aux, data, len) => {
        if (dev !== 0x39 && dev !== 0x3a) return inner ? inner(dev, cmd, dstats, aux, data, len) : 0;
        try { return this.sio(dev, cmd, aux, data, len); } catch (e) { console.error('rawdisk', e); return E; }
      };
      return true;
    },

    // Sector size from the content: 2048 for ISO 9660 / UDF, otherwise 512.
    guessSectorSize(b) {
      const iso = b.length > 0x8006 && String.fromCharCode(b[0x8001], b[0x8002], b[0x8003], b[0x8004], b[0x8005]) === 'CD001';
      return iso || b.length % 2048 === 0 && b.length > 0x100000 && this.isUdf(b) ? 2048 : 512;
    },
    isUdf(b) {
      const o = 256 * 2048;
      return b.length > o + 2 && b[o] === 2 && b[o + 1] === 0;
    },

    set(unit, name, bytes, ss) {
      const dev = unit === 10 ? 0x3a : 0x39;
      this.units[dev] = bytes ? { name, bytes, ss: ss || this.guessSectorSize(bytes) } : null;
      this.hi[dev] = 0;
      if (this.onChange) this.onChange(unit, this.units[dev]);
    },

    sio(dev, cmd, aux, data, len) {
      const u = this.units[dev];
      const m = this.mem();
      switch (cmd) {
        case 0x53: {
          const n = u ? Math.floor(u.bytes.length / u.ss) : 0, ss = u ? u.ss : 0;
          const st = [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255, ss & 255, ss >> 8, u ? 3 : 0, dev - 0x38];
          for (let i = 0; i < len; i++) m[data + i] = st[i] || 0;
          return C;
        }
        case 0x48: this.hi[dev] = aux & 0xffff; return C;
        case 0x52: {
          if (!u) return E;
          const off = ((this.hi[dev] * 65536) + (aux & 0xffff)) * u.ss;
          this.hi[dev] = 0;
          if (off + len > u.bytes.length) return E;
          m.set(u.bytes.subarray(off, off + len), data);
          return C;
        }
        default: return N;
      }
    },
  };
  window.RawDisk = RawDisk;
})();
