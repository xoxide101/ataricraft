// Menu disks (several XEX/COM/cartridge files -> one boot disk with a menu) and the cartridge-slot request those disks post.
// Save all / Load all (every mounted disk and cartridge as one ZIP with a slot manifest) lives here too.
// Split out of app.js: app.js passes the few things these need (state, log, helpers) to AC.DriveSets.init(d).
(function (root) {
  const AC = root.AC = root.AC || {};
  AC.DriveSets = { init(d) {
    const { S, $, log, saveBlob, storedZip, chosenOs, chosenBasic, insertCart, loadAny, extKind } = d;
    // A plain cart wrapped for a disk runs from RAM, so any game that writes into its own address range destroys itself
    // (a real ROM ignores those writes). Run each cart in a hidden machine and see whether its RAM copy survives.
    let cartTester = null;
    async function cartSurvives(item) {
      try { return await cartSurvives1(item); } catch (e) { cartTester = null; return false; }
    }
    async function cartSurvives1(item) {
      const os = chosenOs();
      if (!os) return null;
      const d = item.data, rom = d[0] === 0x43 && d[1] === 0x41 && d[2] === 0x52 && d[3] === 0x54 ? d.subarray(16) : d;
      if (!cartTester) cartTester = await AC.Emu.boot({ model: '130xe', os, ram: '128', basic: chosenBasic(), basicOn: false, tv: 'ntsc', fastSio: true, host: {} });
      const e = cartTester;
      e.mountDisk(1, 'test.atr', AC.DiskConv.menuToAtr([{ name: item.name, data: d }]));
      e.coldStart(); e.run(450);
      e.tap({ keychar: 0x31 }, 3); e.run(1500);
      const m = e.mem(), base = 0xc000 - rom.length;
      for (let i = 0; i < rom.length; i++) if (m[base + i] !== rom[i]) return false;
      return true;
    }
    // The "slot" entries post 'ACRT' + size at $06F0 once loaded: insert the real cartridge and cold start.
    function cartRequest() {
      const m = S.emu.mem();
      if (m[0x6f0] !== 0x41 || m[0x6f1] !== 0x43 || m[0x6f2] !== 0x52 || m[0x6f3] !== 0x54) return;
      let car;
      if (m[0x6f4] === 0) {
        const sec = m[0x6f5] | (m[0x6f6] << 8), len = m[0x6f7] | (m[0x6f8] << 8) | (m[0x6f9] << 16);
        const img = (S.emu.diskPaths && S.emu.diskPaths[1] && S.emu.readDisk(1)) || (S.disks[1] && S.disks[1].bytes);
        if (!img || len < 16 || 16 + (sec - 1) * 128 + len > img.length) return;
        m[0x6f0] = 0;
        car = img.slice(16 + (sec - 1) * 128, 16 + (sec - 1) * 128 + len);
      } else {
        if (m[0x6f4] !== 8 && m[0x6f4] !== 16) return;
        const kb = m[0x6f4], rom = m.slice(0xc000 - kb * 1024, 0xc000);
        car = new Uint8Array(16 + rom.length);
        m[0x6f0] = 0;
        car.set([0x43, 0x41, 0x52, 0x54, 0, 0, 0, kb === 8 ? 1 : 2], 0);
        let sum = 0; for (const b of rom) sum += b;
        car.set([sum >>> 24, (sum >> 16) & 255, (sum >> 8) & 255, sum & 255], 8);
        car.set(rom, 16);
      }    log('menu disk: this cartridge needs a real cartridge slot, inserting it and restarting');
      insertCart(1, { name: 'menu-disk cartridge.car' }, car).then(() => S.emu.coldStart());
    }
    // Several XEX/COM files or cartridges -> one boot disk with a 1-9, 0, A-Z menu (no DOS).
    $('menufile').onchange = async () => {
      try {
        const items = [];
        for (const f of $('menufile').files) items.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
        const slotted = [];
        for (const [i, it] of items.entries()) {
          if (it.data[0] === 0xff && it.data[1] === 0xff) continue;
          let plain = true;
          const isCar = it.data[0] === 0x43 && it.data[1] === 0x41 && it.data[2] === 0x52 && it.data[3] === 0x54;
          if (isCar && it.data[7] !== 1 && it.data[7] !== 2) { it.needsSlot = true; slotted.push(it.name); continue; }
          try { AC.DiskConv.cartToXex(it.data); } catch (e) { throw new Error(`${it.name}: ${e.message}`); }
          log(`menu disk: testing ${it.name} (${i + 1}/${items.length})`);
          const ok = await cartSurvives(it);
          if (ok === null) { log('menu disk: no OS ROM loaded, cannot test cartridges'); break; }
          if (!ok) { it.needsSlot = true; slotted.push(it.name); }
        }
        const atr = AC.DiskConv.menuToAtr(items);
        saveBlob('menu-disk.atr', [atr]);
        log(`menu-disk.atr: ${items.length} programs, ${atr.length} bytes${slotted.length ? `. Marked * (need Ataricraft's real cartridge slot, so they only start in Ataricraft): ${slotted.join(', ')}` : ''}`);
      } catch (e) { log('menu disk: ' + e.message); }
      $('menufile').value = '';
    };
    // Save all / Load all: every mounted disk and cartridge as one .zip (with a slot manifest), or many files at once.
    const SETMAN = 'ataricraft-set.json';
    $('saveall').onclick = () => {
      const files = [], man = { disks: {}, carts: {} };
      for (let n = 1; n <= 8; n++) {
        const path = S.emu && S.emu.diskPaths && S.emu.diskPaths[n];
        const bytes = path ? S.emu.readDisk(n) : (S.disks[n] && S.disks[n].bytes);
        if (!bytes) continue;
        const nm = (S.disks[n] && S.disks[n].name) || (path || '').replace(/^\/d\d_/, '') || `d${n}.atr`;
        files.push({ name: `D${n}_${nm}`, data: bytes }); man.disks[n] = `D${n}_${nm}`;
        if (S.dirty) S.dirty[n] = false;
      }
      for (const n of [1, 2]) {
        const c = S.carts[n]; if (!c || !c.bytes) continue;
        files.push({ name: `CART${n}_${c.name}`, data: c.bytes }); man.carts[n] = `CART${n}_${c.name}`;
      }
      if (!files.length) { log('nothing mounted to save'); return; }
      files.push({ name: SETMAN, data: new TextEncoder().encode(JSON.stringify(man)) });
      saveBlob('ataricraft-drives.zip', storedZip(files), 'application/zip');
      log(`saved ${files.length - 1} disk/cartridge images as ataricraft-drives.zip`);
    };
    const putCart = (slot, f) => (S.emu ? insertCart(slot, f) : loadAny(f, slot === 2, 'cart'));
    $('loadall').onchange = async (e) => {
      const picked = [...e.target.files]; e.target.value = '';
      if (!picked.length) return;
      let nd = 0, nc = 0;
      try {
        let items = [];
        for (const f of picked) {
          if (/\.zip$/i.test(f.name)) {
            const ents = await AC.Zip.list(f);
            const mi = ents.find((x) => x.name === SETMAN);
            const man = mi ? JSON.parse(new TextDecoder().decode(await AC.Zip.extract(f, mi))) : null;
            for (const en of ents) {
              if (en === mi) continue;
              const base = en.name.split('/').pop();
              let slot = null;
              if (man) {
                for (const [n, v] of Object.entries(man.disks || {})) if (v === en.name) slot = { disk: +n };
                for (const [n, v] of Object.entries(man.carts || {})) if (v === en.name) slot = { cart: +n };
                if (!slot) continue;
              }
              items.push({ name: man ? base.replace(/^(D\d|CART\d)_/, '') : base, slot, get: async () => new File([await AC.Zip.extract(f, en)], man ? base.replace(/^(D\d|CART\d)_/, '') : base) });
            }
          } else items.push({ name: f.name, slot: null, get: async () => f });
        }
        let nextD = 1, nextC = 1;
        const usedD = new Set(items.filter((i) => i.slot && i.slot.disk).map((i) => i.slot.disk));
        for (const it of items) {
          const fl = await it.get();
          const kind = extKind(fl.name);
          if (it.slot && it.slot.disk) { await loadAny(fl, it.slot.disk, 'disk', true); nd++; }
          else if (it.slot && it.slot.cart) { await putCart(it.slot.cart, fl); nc++; }
          else if (kind === 'cart') { if (nextC <= 2) { await putCart(nextC++, fl); nc++; } else log(`no free cartridge slot for ${fl.name}`); }
          else if (kind === 'disk' || !kind) { while (usedD.has(nextD)) nextD++; if (nextD <= 8) { usedD.add(nextD); await loadAny(fl, nextD, 'disk', true); nd++; } else log(`no free drive for ${fl.name}`); }
          else await loadAny(fl, false, kind);
        }
        $('allinfo').textContent = `${nd} disk${nd === 1 ? '' : 's'}, ${nc} cart${nc === 1 ? '' : 's'}`;
        log(`loaded ${nd} disk(s) and ${nc} cartridge(s)`);
      } catch (err) { log('Load all failed: ' + (err && err.message || err)); }
    };
    return { cartRequest };
  } };
})(typeof self !== 'undefined' ? self : this);
