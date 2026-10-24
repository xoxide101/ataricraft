const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs');
(async () => {
  const R = 'C:/Users/raver/ataricraft/';
  const RD = R + 'software_n_roms/8bit/Atari 8-Bit/Atari 8-bit Archive of Archives/Atari800WinPLus 40/xf25/';
  fs.mkdirSync(R + 'out/apt', { recursive: true });
  const rom = fs.readFileSync(RD + 'ATARIXL.ROM');
  // Fake the APT PBI ID bytes in the FP ROM area so FDISK's $D803/$D80B probe passes (observation only).
  if (process.argv[2] !== 'real') { rom[0x1803] = 0x80; rom[0x180b] = 0x91; }
  fs.writeFileSync(R + 'out/apt/ATARIXLP.ROM', rom);
  const fdisk = fs.readFileSync(R + 'out/apt_apps/FDISK/FDISK.COM');

  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.goto('file:///' + R + 'web/index.html');
  await p.setInputFiles('#romfiles', [R + 'out/apt/ATARIXLP.ROM', RD + 'ATARIBAS.ROM']);
  await p.waitForTimeout(800);
  await p.click('#boot');
  await p.waitForTimeout(2500);
  await p.evaluate(() => {
    window.__sio = [];
    const SECT = 16384, disk = new Uint8Array(SECT * 512); // 8 MB virtual device
    const put = (a, bytes) => { const o = new Uint8Array(512); o.set(bytes.slice(0, 512)); ataricraft.poke(a, [...o]); };
    const str = (s) => [...s].map((c) => c.charCodeAt(0));
    ataricraft.sioTap((dev, cmd, dstats, aux, data, len) => {
      if (dev < 0x90 || dev > 0xaf) return 0;
      const dcb = ataricraft.peek(0x300, 16);
      const unit = dcb[1], lba = dcb[10] | dcb[11] << 8 | dcb[12] << 16 | dcb[13] << 24;
      window.__sio.push({ dev, cmd, unit, lba, len });
      if (dev !== 0x9f && dev !== 0xa0) return 0x45;
      const C = 0x43;
      if (cmd === 0x53) { put(data, [0, 0, 0, 0]); return C; }
      if (cmd === 0x46) return C;
      if (cmd === 0xec) {
        const b = new Uint8Array(512), w = (i, v) => { b[i * 2] = v & 255; b[i * 2 + 1] = v >> 8; };
        w(1, 16); w(3, 16); w(6, 32); w(60, SECT & 65535); w(61, SECT >> 16);
        b.set(str('AtaricraftVirtualAPT'), 54);
        put(data, b); return C;
      }
      if (cmd === 0x6e) {
        const b = new Uint8Array(512); b[0] = 1; b[1] = 0; b[2] = 0;
        b[8] = SECT & 255; b[9] = (SECT >> 8) & 255; b[10] = SECT >> 16;
        b.set(str('Ataricraft virtual APT'), 0x10); b.set(str('v1'), 0x38);
        put(data, b); window.__sio.push({ after: [...ataricraft.peek(data, 8)], data }); return C;
      }
      if (cmd === 0x52) { put(data, disk.subarray(lba * 512, lba * 512 + 512)); return C; }
      if (cmd === 0x57) { disk.set(ataricraft.peek(data, 512), lba * 512); return C; }
      return 0x4e;
    });
  });
  await p.evaluate((a) => ataricraft.bootFile('FDISK.COM', new Uint8Array(a)), [...fdisk]);
  await p.waitForTimeout(8000);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(3000);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(3000);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(3000);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(4000);
  console.log((await p.evaluate(() => ataricraft.screenText())).split('\n').filter((l) => l.trim()).join('\n'));
  const log = await p.evaluate(() => window.__sio.filter((e) => e.cmd && e.cmd !== 0x53 && e.cmd !== 0x6e));
  console.log('non-probe SIO calls:', log.length);
  for (const e of log.slice(0, 30)) console.log(JSON.stringify(e));
  const hx = (a) => a.map((v) => v.toString(16).padStart(2, '0')).join(' ');
  console.log('0400', await p.evaluate(() => [...ataricraft.peek(0x400, 24)]).then(hx), '7C85', await p.evaluate(() => [...ataricraft.peek(0x7c85, 1)]).then(hx), '79D2', await p.evaluate(() => [...ataricraft.peek(0x79d2, 1)]).then(hx));
  await p.locator('#screen').screenshot({ path: R + 'out/apt/fdisk.png' });
  await b.close();
})();

