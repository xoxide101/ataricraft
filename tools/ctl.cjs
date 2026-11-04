#!/usr/bin/env node
// Drive a running Ataricraft page from outside the browser, through the local relay (tools/tnfs-bridge/bridge.cjs).
// Setup: start the relay, open its address in a browser (the page connects by itself), then:
//   AC_TOKEN=<token> node tools/ctl.cjs <command> ...        (AC_URL defaults to http://127.0.0.1:8765; with AC_TOKEN unset the AC_TOKEN env of the relay is not known)
// Commands: state | ram | net | ip | setip key=value... | peek ADDR [LEN] | poke ADDR BYTE... | fill ADDR LEN BYTE | find "hex or text"
//           run FILE | mount DRIVE FILE | type "text" | press JSON | screen | shot FILE.png | reset [cold] | pause | resume | step N
//           progs | prog NAME (run a built-in program: PING, IPCONFIG, MEMTEST...) | banks | bank N [OFF] [LEN] | bankfind "hex or text" | bankwrite N OFF BYTE...
//           mock URLPART STATUS BODY | unmock | resetnet | call METHOD [JSON args...]
const fs = require('fs');
const url = (process.env.AC_URL || 'http://127.0.0.1:8765').replace(/\/$/, ''), token = process.env.AC_TOKEN || '';
const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0'), num = (s) => parseInt(String(s).replace(/^\$|^0x/i, ''), 16);

async function call(method, args) {
  const r = await fetch(url + '/ctl/call', { method: 'POST', headers: { 'X-AC-Token': token }, body: JSON.stringify({ method, args: args || [] }) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { throw new Error(r.status + ' ' + t); }
  if (!j.ok) throw new Error(j.error || t);
  return j.result;
}
const b64 = (f) => fs.readFileSync(f).toString('base64');

async function main(a) {
  const [cmd, ...r] = a;
  const out = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  switch (cmd) {
    case 'state': return out(await call('state'));
    case 'ram': return out((await call('ram')).text);
    case 'net': { const n = await call('net'); out(n.summary); n.events.slice(-30).forEach((e) => console.log(new Date(e.t).toISOString().slice(11, 19), e.kind, e.status || e.err || '', e.rx || '', e.desc)); return; }
    case 'ip': return out(await call('ip'));
    case 'setip': { const o = {}; r.forEach((kv) => { const [k, v] = kv.split('='); o[k] = v === 'true' ? true : v === 'false' ? false : v; }); return out(await call('setIp', [o])); }
    case 'peek': { const ad = num(r[0]), n = +r[1] || 16, d = Buffer.from((await call('dump', [ad, n])), 'base64'); for (let i = 0; i < d.length; i += 16) console.log('$' + hex(ad + i, 4), [...d.subarray(i, i + 16)].map((x) => hex(x, 2)).join(' ')); return; }
    case 'poke': return out(await call('poke', [num(r[0]), r.slice(1).map(num)]));
    case 'fill': return out(await call('fill', [num(r[0]), num(r[1]), num(r[2])]));
    case 'find': return out((await call('find', [r[0], 0, 0xFFFF])).map((x) => '$' + hex(x, 4)).join(' ') || 'not found');
    case 'run': return out(await call('load', [require('path').basename(r[0]).toUpperCase(), b64(r[0])]));
    case 'mount': return out(await call('mountDisk', [+r[0], require('path').basename(r[1]), b64(r[1])]));
    case 'type': return out(await call('type', [r.join(' ')]));
    case 'press': return out(await call('press', [JSON.parse(r[0]), +r[1] || 4]));
    case 'screen': return out(await call('screenText'));
    case 'shot': { const d = await call('screenshot', [{ scale: 2 }]); fs.writeFileSync(r[0] || 'shot.png', Buffer.from(String(d).replace(/^data:[^,]+,/, ''), 'base64')); return out('saved ' + (r[0] || 'shot.png')); }
    case 'reset': return out(await call('reset', [r[0] === 'cold']));
    case 'pause': return out(await call('pause'));
    case 'resume': return out(await call('run'));
    case 'step': return out(await call('step', [+r[0] || 1]));
    case 'progs': return (await call('progs')).forEach((p) => console.log(p.name.padEnd(10), p.group.padEnd(10), p.desc));
    case 'prog': return out(await call('runProg', [r[0]]));
    case 'banks': { const b = await call('bankScan'); console.log(b.length + ' banks'); b.forEach((x) => console.log('bank', String(x.n).padStart(2), 'PORTB $' + hex(x.portb, 2), 'pages used', x.used + '/64')); return; }
    case 'bank': { const n = +r[0], off = num(r[1] || '0'), len = +r[2] || 64, d = Buffer.from(await call('bankRead', [n, off, len]), 'base64'); for (let i = 0; i < d.length; i += 16) console.log('b' + n + ':' + hex(off + i, 4), [...d.subarray(i, i + 16)].map((x) => hex(x, 2)).join(' ')); return; }
    case 'bankfind': return out((await call('bankFind', [r.join(' '), 64])).map((x) => `bank ${x.bank} +$${hex(x.offset, 4)}`).join('\n') || 'not found');
    case 'bankwrite': return out(await call('bankWrite', [+r[0], num(r[1]), r.slice(2).map(num)]));
    case 'mock': return out(await call('mock', [r[0], +r[1] || 200, r.slice(2).join(' ')]));
    case 'unmock': return out(await call('unmock'));
    case 'resetnet': return out(await call('resetNet'));
    case 'call': return out(await call(r[0], r.slice(1).map((x) => JSON.parse(x))));
    default: console.log('commands: state ram progs prog banks bank bankfind bankwrite net ip setip peek poke fill find run mount type press screen shot reset pause resume step mock unmock resetnet call'); process.exit(cmd ? 2 : 0);
  }
}
main(process.argv.slice(2)).catch((e) => { console.error('ctl: ' + e.message); process.exit(1); });
