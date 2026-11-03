// WebAFM on the relay: SD folder mounted as a drive, read, write back, delete, and a read-only relay refusing changes.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = 'C:/Users/raver/ataricraft';
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafm-'));
  fs.writeFileSync(path.join(dir, 'README.TXT'), 'hello relay');
  fs.mkdirSync(path.join(dir, 'GAMES')); fs.writeFileSync(path.join(dir, 'GAMES', 'A.BIN'), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(dir, 'Long Name File.txt'), 'long');
  const env = Object.assign({}, process.env, { AC_TOKEN: 'testtoken' });
  const rw = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', '8795', '--sd', dir, '--allow-write'], { env });
  const ro = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', '8796', '--sd', dir], { env });
  const none = spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', '8797'], { env });
  await new Promise((r) => setTimeout(r, 900));
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const run = async (port, fn) => {
    const p = await (await b.newContext()).newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://127.0.0.1:' + port + '/');
    const r = await p.evaluate(fn);
    await p.context().close();
    return { r, errs };
  };
  try {
    const A = await run(8795, async () => {
      const out = {};
      out.probe = await AC.RelayFs.probe();
      await AC.WebAfm.openFolder(0, AC.RelayFs.sd());
      const W = AC.WebAfm._state, rec = [...W.mounts.values()].pop(), vol = rec.m.vol;
      out.names = vol.list().map((e) => e.path || e.name).sort();
      out.label = rec.handle.scheme;
      vol.writeFile('NEW.TXT', new TextEncoder().encode('written by webafm'), true);
      vol.mkdir('MADE');
      await vol.flush();
      return out;
    });
    ok(A.r.probe.relay && A.r.probe.token && A.r.probe.sd, 'probe sees relay, token and SD folder', A.r.probe);
    ok(A.r.names.some((n) => /README\.TXT/.test(n)) && A.r.names.some((n) => /GAMES/.test(n)), 'SD folder appears as a WebAFM drive', A.r.names);
    ok(fs.existsSync(path.join(dir, 'NEW.TXT')) && fs.readFileSync(path.join(dir, 'NEW.TXT'), 'utf8') === 'written by webafm', 'file written from WebAFM lands in the folder');
    ok(fs.existsSync(path.join(dir, 'MADE')) && fs.statSync(path.join(dir, 'MADE')).isDirectory(), 'new folder created in the SD folder');
    ok(A.errs.length === 0, 'no page errors', A.errs);

    const D = await run(8795, async () => {
      await AC.WebAfm.openFolder(0, AC.RelayFs.sd());
      const rec = [...AC.WebAfm._state.mounts.values()].pop(), vol = rec.m.vol;
      vol.remove('NEW.TXT'); vol.remove('MADE'); vol.remove('GAMES/A.BIN'); vol.remove('GAMES');
      await vol.flush();
      return true;
    });
    ok(!fs.existsSync(path.join(dir, 'NEW.TXT')) && !fs.existsSync(path.join(dir, 'MADE')) && !fs.existsSync(path.join(dir, 'GAMES')), 'delete (including a non-empty folder) reaches the folder', D.errs);

    const B = await run(8796, async () => {
      await AC.WebAfm.openFolder(0, AC.RelayFs.sd());
      const rec = [...AC.WebAfm._state.mounts.values()].pop(), vol = rec.m.vol;
      vol.writeFile('BLOCK.TXT', new TextEncoder().encode('x'), true);
      let err = ''; try { await vol.flush(); } catch (e) { err = e.message; }
      return err;
    });
    ok(/allow-write/.test(B.r) && !fs.existsSync(path.join(dir, 'BLOCK.TXT')), 'read-only relay refuses writes with a clear message', B.r);

    const C = await run(8797, async () => AC.RelayFs.probe());
    ok(C.r.relay && C.r.token && !C.r.sd, 'probe reports a relay with no SD folder', C.r);

    const U = await run(8795, async () => {
      AC.WebAfm.open();
      const s = document.querySelector('#wafm .wp[data-i="0"] .src');
      const has = [...s.options].some((o) => o.value === 'rsd') && [...s.options].some((o) => o.value === 'rtnfs');
      s.value = 'rsd'; s.dispatchEvent(new Event('change'));
      await new Promise((r) => setTimeout(r, 1500));
      const rows = document.querySelector('#wafm .wp[data-i="0"] .wl').textContent;
      return { has, rows: rows.slice(0, 200), src: document.querySelector('#wafm .wp[data-i="0"] .src').selectedOptions[0].textContent };
    });
    ok(U.r.has && /README/i.test(U.r.rows) && /N: FujiNet SD/.test(U.r.src), 'pane dropdown mounts the relay SD folder', U.r);
  } finally {
    await b.close(); rw.kill(); ro.kill(); none.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(bad ? 'FAILED ' + bad : 'all passed');
  process.exit(bad ? 1 : 0);
})();
