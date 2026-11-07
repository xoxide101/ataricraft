'use strict';
// ACNet L2 backend: raw Ethernet through Npcap's wpcap.dll (via the koffi FFI package).
// Interface: { mac?, send(frame), onFrame(fn), close() }. Frames are Buffers starting at the Ethernet header.
const path = require('path');
const fs = require('fs');

const DLL = process.env.ACNET_WPCAP || 'C:\\Windows\\System32\\Npcap\\wpcap.dll';

function loadKoffi() {
  const tries = [path.join(__dirname, 'node_modules', 'koffi'), 'koffi'];
  for (const t of tries) { try { return require(t); } catch (e) { /* next */ } }
  throw new Error('koffi is not installed: run "npm install" in tools\\acnet');
}

let cached = null;
function api() {
  if (cached) return cached;
  const koffi = loadKoffi();
  if (!fs.existsSync(DLL)) throw new Error('Npcap not found (' + DLL + '). Install Npcap from https://npcap.com');
  const lib = koffi.load(DLL);
  const pcap_if = koffi.struct('acn_pcap_if', {
    next: 'void *', name: 'const char *', description: 'const char *', addresses: 'void *', flags: 'uint32',
  });
  const pkthdr = koffi.struct('acn_pkthdr', { tv_sec: 'int32', tv_usec: 'int32', caplen: 'uint32', len: 'uint32' });
  return (cached = {
    koffi, pkthdr, pcap_if,
    findalldevs: lib.func('int pcap_findalldevs(_Out_ void **alldevs, _Out_ uint8_t *errbuf)'),
    freealldevs: lib.func('void pcap_freealldevs(void *alldevs)'),
    open_live: lib.func('void *pcap_open_live(const char *dev, int snaplen, int promisc, int to_ms, _Out_ uint8_t *errbuf)'),
    setnonblock: lib.func('int pcap_setnonblock(void *p, int nb, _Out_ uint8_t *errbuf)'),
    next_ex: lib.func('int pcap_next_ex(void *p, _Out_ void **hdr, _Out_ void **data)'),
    sendpacket: lib.func('int pcap_sendpacket(void *p, const uint8_t *buf, int size)'),
    close: lib.func('void pcap_close(void *p)'),
    geterr: lib.func('const char *pcap_geterr(void *p)'),
  });
}

function cstr(buf) { const i = buf.indexOf(0); return buf.toString('latin1', 0, i < 0 ? buf.length : i); }

// Lists capture devices as { name, description } (name is the \Device\NPF_{GUID} string).
function listDevices() {
  const A = api();
  const err = Buffer.alloc(256), head = [null];
  if (A.findalldevs(head, err) !== 0) throw new Error('pcap_findalldevs: ' + cstr(err));
  const out = [];
  let p = head[0];
  while (p) {
    const d = A.koffi.decode(p, A.pcap_if);
    out.push({ name: d.name, description: d.description || '' });
    p = d.next;
  }
  A.freealldevs(head[0]);
  return out;
}

// Opens a device by its \Device\NPF_{...} name. Poll-based receive (2 ms) keeps everything on the Node main thread.
function open(name, opts = {}) {
  const A = api();
  const err = Buffer.alloc(256);
  const h = A.open_live(name, 65535, 1, 1, err);
  if (!h) throw new Error('pcap_open_live: ' + cstr(err));
  A.setnonblock(h, 1, err);
  const hdrp = [null], datap = [null];
  let handler = null, closed = false;
  const timer = setInterval(() => {
    for (let n = 0; n < 64 && !closed; n++) {
      const r = A.next_ex(h, hdrp, datap);
      if (r !== 1) break;
      const hd = A.koffi.decode(hdrp[0], A.pkthdr);
      const frame = Buffer.from(A.koffi.decode(datap[0], 'uint8_t', hd.caplen));
      if (handler) handler(frame);
    }
  }, opts.pollMs || 2);
  return {
    kind: 'pcap', name,
    send(frame) { if (!closed && A.sendpacket(h, frame, frame.length) !== 0) throw new Error(cstr(Buffer.from(A.geterr(h) || '', 'latin1'))); },
    onFrame(fn) { handler = fn; },
    close() { closed = true; clearInterval(timer); A.close(h); },
  };
}

module.exports = { listDevices, open };

if (require.main === module) {
  for (const d of listDevices()) console.log(d.name, '-', d.description);
}
