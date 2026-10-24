// BW-DOS 1.5 APT.COM against the virtual APT device. Usage: node out/apt-bw.cjs "<cmd1>" "<cmd2>" ...
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
(async () => {
  const R = 'C:/Users/raver/ataricraft/';
  const RD = R + 'software_n_roms/8bit/Atari 8-Bit/Atari 8-bit Archive of Archives/Atari800WinPLus 40/xf25/';
  fs.mkdirSync(R + 'out/apt', { recursive: true });
  const rom = fs.readFileSync(RD + 'ATARIXL.ROM');
  rom[0x1803] = 0x80; rom[0x180b] = 0x91;
  fs.writeFileSync(R + 'out/apt/ATARIXLP.ROM', rom);
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto('file:///' + R + 'web/index.html');
  await p.setInputFiles('#romfiles', [R + 'out/apt/ATARIXLP.ROM', RD + 'ATARIBAS.ROM']);
  await p.waitForTimeout(800);
  await p.selectOption('#model', '130xe');
  await p.evaluate(() => { document.getElementById('basic').checked = false; });
  await p.click('#boot'); await p.waitForTimeout(2000);
  const APT = require(R + 'tools/apt/apt.cjs');
  const mk = (n, name, sz) => ({ sectorSize: sz, sectors: n, name, mapping: 0, data: new Uint8Array(n * sz) });
  const Dos = require(R + 'web/js/dosfs.js');
  const sdfsPart = (ss, n, name, files) => {
    const img = Dos.createSdfs({ sectorSize: ss, sectors: n, label: name }), v = Dos.open(img), L = Dos.layout(img);
    for (const [k, d] of Object.entries(files)) v.writeFile(k, d);
    const raw = new Uint8Array(n * ss);
    for (let s = 1; s <= n; s++) raw.set(L.sec(s), (s - 1) * ss);
    return { sectorSize: ss, sectors: n, name, mapping: 0, data: raw };
  };
  const hello = new Uint8Array([...'HELLO FROM APT 512\r'].map((c) => c.charCodeAt(0) === 13 ? 0x9b : c.charCodeAt(0)));
  const big = Uint8Array.from({ length: 300000 }, (_, i) => (i * 7 + 3) % 250 + 1);
  fs.writeFileSync(R + 'out/apt/big.bin', big);
  const image = APT.build([sdfsPart(512, 8192, 'ONE', { 'HELLO.TXT': hello, 'BIG.DAT': big }), sdfsPart(256, 8000, 'TWO', { 'T.TXT': hello })]);
  await p.evaluate((img) => {
    window.__sio = [];
    const disk = new Uint8Array(img), SECT = disk.length / 512; window.__disk = disk;
    const put = (a, bytes) => { const o = new Uint8Array(512); o.set(bytes.slice(0, 512)); ataricraft.poke(a, [...o]); };
    const str = (s) => [...s].map((c) => c.charCodeAt(0));
    ataricraft.sioTap((dev, cmd, dstats, aux, data, len) => {
      const dcb = ataricraft.peek(0x300, 16);
      if (dev < 0x90 && !(dev === 0x31 && dcb[1] === 1)) window.__sio.push({ raw: dev, du: dcb[1], cmd, st: dstats });
      if (dev >= 0x32 && dev <= 0x3f) {
        const un = dev - 0x30, eo = 512 + 16 * un;
        if (!(disk[eo] & 0x40)) return 0;
        const code = disk[eo] & 3, ss = code === 1 ? 128 : code === 2 ? 256 : 512;
        const start = (disk[eo + 2] | disk[eo + 3] << 8 | disk[eo + 4] << 16) * 512, cnt = disk[eo + 6] | disk[eo + 7] << 8 | disk[eo + 8] << 16;
        const sec = dcb[10] | dcb[11] << 8;
        window.__sio.push({ drv: un, cmd, sec, len, dcb: dcb.join(',') });
        if (cmd === 0x53) { put(data, [ss > 128 ? 0x20 : 0, 0xff, 0xe0, 0]); return 0x43; }
        if (cmd === 0x4e) { put(data, [1, 3, 0, 18, 0, ss > 128 ? 4 : 0, ss >> 8, ss & 255, 0xff, 0, 0, 0]); return 0x43; }
        if (cmd === 0x52 || cmd === 0x57 || cmd === 0x50) {
          if (sec < 1 || sec > cnt) return 0x4e;
          const o = start + (sec - 1) * ss;
          if (cmd === 0x52) ataricraft.poke(data, [...disk.subarray(o, o + Math.min(len, ss))]);
          else disk.set(ataricraft.peek(data, ss), o);
          return 0x43;
        }
        return 0x4e;
      }
      if (dev < 0x90 || dev > 0xaf) return 0;
      const unit = dcb[1], lba = dcb[10] | dcb[11] << 8 | dcb[12] << 16 | dcb[13] << 24;
      window.__sio.push({ dev, cmd, unit, lba, len });
      if (dev !== 0x9f && dev !== 0xa0) return 0x45;
      const C = 0x43;
      if (cmd === 0x53) { put(data, [0, 0, 0, 0]); return C; }
      if (cmd === 0x46) return C;
      if (cmd === 0xec) { const x = new Uint8Array(512); put(data, x); return C; }
      if (cmd === 0x6e) {
        const x = new Uint8Array(512); x[0] = 1;
        x[6] = 0; x[7] = 2; x[8] = SECT & 255; x[9] = (SECT >> 8) & 255; x[10] = SECT >> 16;
        x.set(str('Ataricraft media'), 0x10); x.set(str('Ataricraft APT v1'), 0x38);
        put(data, x); return C;
      }
      if (cmd === 0x52) { put(data, disk.subarray(lba * 512, lba * 512 + 512)); return C; }
      if (cmd === 0x57) { disk.set(ataricraft.peek(data, 512), lba * 512); return C; }
      return 0x4e;
    });
  }, [...image]);
  await p.setInputFiles('#f1', R + 'out/bw15/bw15.atr'); await p.waitForTimeout(1000);
  await p.evaluate(() => ataricraft.reset(true)); await p.waitForTimeout(7000);
  console.log('boot:', JSON.stringify(await p.evaluate(() => ataricraft.screenText().trim().slice(-300))));
  await p.evaluate(() => ataricraft.poke(0x247,[0xff]));
  for (const c of process.argv.slice(2)) {
    await p.evaluate((c) => ataricraft.type(c + '\n'), c); await p.waitForTimeout(+(process.env.WAIT || 5000));
    console.log('> ' + c + ':', JSON.stringify(await p.evaluate(() => ataricraft.screenText().trim().slice(-420))));
  }
  const log = await p.evaluate(() => window.__sio.slice(0, 40));
  console.log('SIO:', JSON.stringify(log));
  if (process.env.CHECK) {
    const d = new Uint8Array(await p.evaluate(() => [...window.__disk]));
    const eo = 512 + 16 * 3, st = (d[eo + 2] | d[eo + 3] << 8 | d[eo + 4] << 16) * 512, n = d[eo + 6] | d[eo + 7] << 8 | d[eo + 8] << 16;
    const img = Dos.makeAtr(256, n), L = Dos.layout(img);
    for (let s = 1; s <= n; s++) { const x = L.sec(s); x.set(d.subarray(st + (s - 1) * 256, st + (s - 1) * 256 + x.length)); }
    const v = Dos.open(img);
    for (const f of v.list()) console.log('FILE', f.path, f.size, f.size < 100 ? JSON.stringify(Buffer.from(v.read(f)).toString('latin1')) : '');
    fs.writeFileSync(R + 'out/apt/part2.atr', img);
  }
  await b.close();
})();








