// SD: protocol (a folder served by the relay with --sd DIR) through the emulator N: hook.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = 'C:/Users/raver/ataricraft';
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };

async function session(b, relayPort, steps) {
  const p = await (await b.newContext()).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.click('#boot'); await p.waitForTimeout(2500);
  const r = await p.evaluate(async ({ relayPort, steps }) => {
    FujiNet.enabled = true; FujiNet.bridge = 'http://127.0.0.1:' + relayPort; localStorage.setItem('ac.nettoken', 'testtoken');
    const m = () => FujiNet.emu.mem(), A = 0x600, hook = FujiNet.emu.m.acSio, out = {};
    const str = (s) => { m().fill(0, A, A + 256); for (let i = 0; i < s.length; i++) m()[A + i] = s.charCodeAt(i); m()[A + s.length] = 0x9b; };
    const call = (cmd, aux, len) => hook(0x71, cmd, 0, aux, A, len);
    const errCode = () => { call(0x45, 0, 1); return m()[A]; };
    const readAll = () => { call(0x53, 0, 4); const n = m()[A] | (m()[A + 1] << 8); if (!n) return ''; call(0x52, n, n); return String.fromCharCode(...m().subarray(A, A + n)); };
    for (const s of steps) {
      const k = s[1];
      if (s[0] === 'open') { str(s[2]); out[k] = call(0x4f, s[3], 256); out[k + 'err'] = errCode(); }
      else if (s[0] === 'write') { m().fill(0, A, A + 256); for (let i = 0; i < s[2].length; i++) m()[A + i] = s[2].charCodeAt(i); out[k] = call(0x57, s[2].length, s[2].length); }
      else if (s[0] === 'close') { out[k] = call(0x43, 0, 0); out[k + 'err'] = errCode(); }
      else if (s[0] === 'cmd') { str(s[3]); out[k] = call(s[2], 0, 256); out[k + 'err'] = errCode(); }
      else if (s[0] === 'read') out[k] = readAll();
    }
    return out;
  }, { relayPort, steps });
  await p.context().close();
  return { r, errs };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-')), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sdout-'));
  fs.writeFileSync(path.join(dir, 'hello.txt'), 'FROM SD');
  fs.mkdirSync(path.join(dir, 'games')); fs.writeFileSync(path.join(dir, 'games', 'a.bin'), 'x');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET');
  let linked = true;
  try { fs.symlinkSync(outside, path.join(dir, 'link'), 'junction'); } catch (e) { linked = false; }
  const spawnRelay = (port, extra) => spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', String(port), '--allow-lan'].concat(extra), { env: Object.assign({}, process.env, { AC_TOKEN: 'testtoken' }) });
  const rw = spawnRelay(8791, ['--sd', dir, '--allow-write']), ro = spawnRelay(8792, ['--sd', dir]), none = spawnRelay(8793, []);
  await new Promise((r) => setTimeout(r, 900));
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const f = (n) => path.join(dir, n);
    const A = await session(b, 8791, [
      ['open', 'o1', 'N:SD:/hello.txt', 4], ['read', 'rd1'], ['close', 'c1'],
      ['open', 'o2', 'N:SD:/', 6], ['read', 'ls'], ['close', 'c2'],
      ['open', 'o3', 'N:SD:/new.txt', 8], ['write', 'w3', 'ONE'], ['close', 'c3'],
      ['open', 'o4', 'N:SD:/new.txt', 9], ['write', 'w4', 'TWO'], ['close', 'c4'],
      ['cmd', 'mk', 0x2a, 'N:SD:/made'],
      ['cmd', 'rn', 0x20, 'N:SD:/new.txt,renamed.txt'],
      ['cmd', 'del', 0x21, 'N:SD:/hello.txt'],
      ['cmd', 'rm', 0x2b, 'N:SD:/made'],
      ['cmd', 'rmfull', 0x2b, 'N:SD:/games'],
      ['cmd', 'delmiss', 0x21, 'N:SD:/nope.txt'],
      ['open', 'omiss', 'N:SD:/nope.txt', 4],
      ['open', 'trav', 'N:SD:/../outside.txt', 8], ['write', 'wt', 'EVIL'], ['close', 'ct'],
      ['open', 'ol', 'N:SD:/link/secret.txt', 4],
      ['cmd', 'dl', 0x21, 'N:SD:/link/secret.txt'],
    ]);
    const r = A.r;
    ok(r.o1 === 67 && r.rd1 === 'FROM SD', 'read a file from SD:', r.rd1);
    ok(r.o2 === 67 && /\/ GAMES {3}DIR 001/.test(r.ls) && /  HELLO {3}TXT 001/.test(r.ls) && /999\+FREE SECTORS/.test(r.ls), 'directory listing uses the firmware 8.3 records and a free-sectors trailer', r.ls);
    ok(r.c3 === 67 && r.c4 === 67 && fs.readFileSync(f('renamed.txt'), 'latin1') === 'ONETWO', 'write then append, then rename keeps data');
    ok(r.mk === 67 && r.rm === 67 && !fs.existsSync(f('made')), 'mkdir and rmdir');
    ok(r.del === 67 && !fs.existsSync(f('hello.txt')), 'delete');
    ok(r.rmfull === 69, 'rmdir of a non-empty folder fails', r.rmfull);
    ok(r.delmiss === 69 && r.delmisserr === 170 && r.omiss === 69 && r.omisserr === 170, 'missing files report not found', [r.delmisserr, r.omisserr]);
    ok(!fs.existsSync(path.join(dir, '..', 'outside.txt')) && fs.existsSync(f('outside.txt')), '.. is clamped to the SD root, never escapes');
    if (linked) ok(r.ol === 69 && fs.existsSync(path.join(outside, 'secret.txt')) && r.dl === 69, 'a link out of the folder is refused (read and delete)', [r.ol, r.dl]);
    else console.log('skip link test (could not create a junction)');
    ok(A.errs.length === 0, 'no page errors', A.errs);

    const B = await session(b, 8792, [['open', 'o1', 'N:SD:/renamed.txt', 4], ['read', 'rd'], ['close', 'c'], ['open', 'o2', 'N:SD:/x.txt', 8], ['write', 'w', 'X'], ['close', 'c2'], ['cmd', 'del', 0x21, 'N:SD:/renamed.txt']]);
    ok(B.r.o1 === 67 && B.r.rd === 'ONETWO', 'read-only relay still reads');
    ok(B.r.c2 === 69 && B.r.c2err === 167 && B.r.del === 69 && !fs.existsSync(f('x.txt')) && fs.existsSync(f('renamed.txt')), 'relay without --allow-write refuses writes and delete');
    const C = await session(b, 8793, [['open', 'o1', 'N:SD:/renamed.txt', 4]]);
    ok(C.r.o1 === 69 && C.r.o1err === 170, 'relay without --sd cannot open SD: files', [C.r.o1, C.r.o1err]);
  } finally {
    await b.close(); rw.kill(); ro.kill(); none.kill();
    try { fs.rmSync(path.join(dir, 'link'), { force: true }); } catch (e) {}
    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true });
  }
  console.log(bad ? 'FAILED ' + bad : 'all passed');
  process.exit(bad ? 1 : 0);
})();
