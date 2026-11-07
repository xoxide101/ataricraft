'use strict';
// Real-LAN smoke test for the ACNet stack over Npcap. The stack gets its own MAC, a DHCP lease from the LAN's
// DHCP server, then pings the gateway, resolves a name via the leased DNS server and fetches a page over TCP.
// Usage: node tools/acnet/lan-smoke.cjs [--adapter "5.0_External"] [--host example.com] [--ping 1.1.1.1] [--listen 8080 --hold 60]
const { execFileSync } = require('child_process');
const { Stack } = require('./stack.cjs');
const pcap = require('./l2-pcap.cjs');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };

function guidOf(adapter) {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-NetAdapter -Name '${adapter}').InterfaceGuid`]).toString().trim();
  if (!out) throw new Error('no such adapter: ' + adapter);
  return out.toUpperCase();
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const adapter = arg('adapter', '5.0_External');
  const guid = guidOf(adapter);
  const dev = pcap.listDevices().find((d) => d.name.toUpperCase().includes(guid));
  if (!dev) throw new Error('Npcap has no device for ' + adapter);
  console.log('adapter', adapter, '->', dev.name, '-', dev.description);
  const l2 = pcap.open(dev.name);
  const st = new Stack(l2, { hostname: 'acnet' });
  const res = { adapter, mac: st.mac.toString('hex') };
  const t0 = Date.now();
  while (!st.info().up && Date.now() - t0 < 25000) await wait(100);
  const inf = st.info(); res.lease = inf; res.leaseMs = Date.now() - t0;
  console.log('lease:', JSON.stringify(inf), `(${res.leaseMs} ms)`);
  if (!inf.up) { console.log('NO DHCP LEASE (adapter may block extra MACs: Wi-Fi/Hyper-V/VPN)'); st.close(); process.exit(2); }
  try { res.pingGw = await st.ping(inf.gw, 3000); console.log('ping gateway', inf.gw, res.pingGw, 'ms'); } catch (e) { console.log('ping gateway failed', e.message); }
  const pt = arg('ping', '1.1.1.1');
  try { res.pingExt = await st.ping(pt, 3000); console.log('ping', pt, res.pingExt, 'ms'); } catch (e) { console.log('ping', pt, 'failed', e.message); }
  const host = arg('host', 'example.com');
  let ip = null;
  try { ip = await st.resolve(host); console.log('dns', host, '->', ip, 'via', inf.dns.join(',')); } catch (e) { console.log('dns failed', e.message); }
  if (ip) {
    await new Promise((resolve) => {
      const s = st.tcpConnect(ip, 80); let body = Buffer.alloc(0);
      const to = setTimeout(() => { console.log('tcp timeout'); s.abort(); resolve(); }, 15000);
      s.onconnect = () => { console.log('tcp connected to', ip + ':80'); s.write(Buffer.from(`GET / HTTP/1.0\r\nHost: ${host}\r\nConnection: close\r\n\r\n`)); };
      s.ondata = (d) => { body = Buffer.concat([body, d]); s.consume(d.length); };
      s.oneof = () => s.close();
      s.onclose = (e) => { clearTimeout(to); console.log('tcp closed', e, 'bytes', body.length, 'first line:', body.toString('latin1').split('\r\n')[0]); res.http = body.toString('latin1').split('\r\n')[0]; resolve(); };
    });
  }
  const lp = +arg('listen', 0);
  if (lp) {
    st.tcpListen(lp, (s) => { console.log('INBOUND from', s.rip, s.rport); s.ondata = (d) => { s.write(Buffer.from('ACNet says hello: ' + d)); s.consume(d.length); s.close(); }; });
    st.udpBind(lp).onmessage = (b, rip, rp) => console.log('udp from', rip, rp, b.length);
    console.log(`listening on ${inf.ip}:${lp} for ${arg('hold', 60)} s; ping/connect to it from another machine`);
    await wait(+arg('hold', 60) * 1000);
  }
  console.log('stats', st.stats);
  console.log('RESULT', JSON.stringify(res));
  st.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
