// TNFS writes and file commands through the emulator N: hook, against a local mock TNFS server and a live relay.
// Checks the on-disk result, and that a relay without --allow-write refuses.
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = 'C:/Users/raver/ataricraft';
const mock = require(ROOT + '/tools/tests/mocktnfs.cjs');
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };

async function session(b, relayPort, port, steps) {
  const p = await (await b.newContext()).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('file:///' + ROOT + '/web/index.html');
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.click('#boot'); await p.waitForTimeout(2500);
  const r = await p.evaluate(async ({ relayPort, port, steps }) => {
    FujiNet.enabled = true; FujiNet.bridge = 'http://127.0.0.1:' + relayPort; localStorage.setItem('ac.nettoken', 'testtoken');
    const m = () => FujiNet.emu.mem(), A = 0x600, hook = FujiNet.emu.m.acSio, out = {};
    const str = (s) => { m().fill(0, A, A + 256); for (let i = 0; i < s.length; i++) m()[A + i] = s.charCodeAt(i); m()[A + s.length] = 0x9b; };
    const call = (cmd, aux, len) => hook(0x71, cmd, 0, aux, A, len);
    const U = 'TNFS://127.0.0.1:' + port;
    const errCode = () => { call(0x45, 0, 1); return m()[A]; };
    const spec = (cmd, s) => { str(s); return call(cmd, 0, 256); };
    const open = (s, mode) => { str(s); return call(0x4f, mode, 256); };
    const write = (s) => { m().fill(0, A, A + 256); for (let i = 0; i < s.length; i++) m()[A + i] = s.charCodeAt(i); return call(0x57, s.length, s.length); };
    const readAll = () => { call(0x53, 0, 4); const n = m()[A] | (m()[A + 1] << 8); if (!n) return ''; call(0x52, n, n); return String.fromCharCode(...m().subarray(A, A + n)); };
    for (const s of steps) {
      if (s[0] === 'open') out[s[1]] = open(U + s[2], s[3]);
      else if (s[0] === 'write') out[s[1]] = write(s[2]);
      else if (s[0] === 'close') { out[s[1]] = call(0x43, 0, 0); out[s[1] + 'err'] = errCode(); }
      else if (s[0] === 'cmd') { out[s[1]] = spec(s[2], s[3].replace('@', U)); out[s[1] + 'err'] = errCode(); }
      else if (s[0] === 'read') out[s[1]] = readAll();
    }
    return out;
  }, { relayPort, port, steps });
  await p.context().close();
  return { r, errs };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tnfs-'));
  const srv = await mock.start(dir);
  const spawnRelay = (port, extra) => spawn('node', [ROOT + '/tools/tnfs-bridge/bridge.cjs', String(port), '--allow-lan'].concat(extra), { env: Object.assign({}, process.env, { AC_TOKEN: 'testtoken' }) });
  const relay = spawnRelay(8791, ['--allow-write']), relay2 = spawnRelay(8792, []);
  await new Promise((r) => setTimeout(r, 900));
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const f = (n) => path.join(dir, n);
    const A = await session(b, 8791, srv.port, [
      ['open', 'o1', '/new.txt', 8], ['write', 'w1', 'HELLO WORLD'], ['close', 'c1'],
      ['open', 'o2', '/new.txt', 9], ['write', 'w2', '!!'], ['close', 'c2'],
      ['open', 'o3', '/new.txt', 4], ['read', 'rd'], ['close', 'c3'],
      ['cmd', 'mk', 0x2a, '@/sub'],
      ['cmd', 'rn', 0x20, '@/new.txt,old.txt'],
      ['cmd', 'rnmiss', 0x20, '@/nothere.txt,x.txt'],
      ['open', 'o4', '/sub/in.txt', 8], ['write', 'w4', 'IN'], ['close', 'c4'],
      ['cmd', 'rmfull', 0x2b, '@/sub'],
      ['cmd', 'del1', 0x21, '@/sub/in.txt'],
      ['cmd', 'rm', 0x2b, '@/sub'],
      ['cmd', 'delmiss', 0x21, '@/nothere.txt'],
      ['cmd', 'http', 0x21, 'HTTP://127.0.0.1:1/x'],
    ]);
    const r = A.r;
    ok(r.o1 === 67 && r.w1 === 67 && r.c1 === 67, 'write open, write and close succeed', r);
    ok(r.c2 === 67 && r.rd === 'HELLO WORLD!!', 'append then read back', r.rd);
    ok(r.mk === 67 && r.rmfull === 69 && r.rm === 67, 'mkdir (directory exists until rmdir removes it)');
    ok(r.rn === 67 && fs.existsSync(f('old.txt')) && !fs.existsSync(f('new.txt')) && fs.readFileSync(f('old.txt'), 'latin1') === 'HELLO WORLD!!', 'rename keeps contents');
    ok(r.rnmiss === 69 && r.rnmisserr === 170, 'rename of a missing file reports not found', [r.rnmiss, r.rnmisserr]);
    ok(r.c4 === 67 && r.rmfull === 69 && r.del1 === 67, 'write inside the new directory (rmdir fails while the file exists, delete finds it)');
    ok(r.rmfull === 69, 'rmdir of a non-empty directory fails', r.rmfull);
    ok(r.del1 === 67 && !fs.existsSync(f('sub/in.txt')), 'delete');
    ok(r.rm === 67 && !fs.existsSync(f('sub')), 'rmdir');
    ok(r.delmiss === 69 && r.delmisserr === 170, 'delete of a missing file reports not found', [r.delmiss, r.delmisserr]);
    ok(r.http === 69 && r.httperr === 146, 'file commands on HTTP report not implemented', [r.http, r.httperr]);
    ok(A.errs.length === 0, 'no page errors', A.errs);

    const B = await session(b, 8792, srv.port, [
      ['open', 'o1', '/ro.txt', 8], ['write', 'w1', 'X'], ['close', 'c1'],
      ['cmd', 'mk', 0x2a, '@/nope'],
      ['cmd', 'del', 0x21, '@/old.txt'],
    ]);
    ok(B.r.c1 === 69 && B.r.c1err === 167, 'relay without --allow-write refuses a write', [B.r.c1, B.r.c1err]);
    ok(B.r.mk === 69 && B.r.del === 69, 'relay without --allow-write refuses file commands');
    ok(!fs.existsSync(f('ro.txt')) && !fs.existsSync(f('nope')) && fs.existsSync(f('old.txt')), 'nothing changed on disk');
  } finally {
    await b.close(); relay.kill(); relay2.kill(); srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(bad ? 'FAILED ' + bad : 'all passed');
  process.exit(bad ? 1 : 0);
})();
