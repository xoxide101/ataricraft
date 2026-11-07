// ACNet over a serial line: the SIO wire protocol for a REAL Atari behind a USB-SIO cable (SIO2PC / APE / "SIO2USB" style).
// The same service core (web/js/acnet-core.js) that backs the $D1A0 register window answers SIO device $65, so a real
// Atari and the emulator see identical sockets. Framing follows the standard Atari SIO bus:
//   command frame  Atari -> host : dev(=$65) cmd aux1 aux2 chk
//   host answers ACK ($41) or NAK ($4E)
//   write cmds     Atari -> host : data frame (N bytes + chk), host answers ACK/NAK
//   host answers COMPLETE ($43) or ERROR ($45)
//   read cmds      host -> Atari : data frame (N bytes + chk) after COMPLETE
// chk = 8-bit sum with end-around carry. Commands (all on device $65): $53 status(32 read), $C0 exec(16 write), $C1 read(256),
// $C2 write(256), $C3 event ack (no data; aux1 = socket, aux2 = mask). Use the standard OS SIOV, or any SIO routine.
// Without a command line signal the host resyncs on a valid header and drops a partial frame after an idle gap.
const DEV = 0x65;
const LEN = { 0x53: ['r', 32], 0xc0: ['w', 16], 0xc1: ['r', 256], 0xc2: ['w', 256], 0xc3: ['n', 0] };

function chk(b) { let s = 0; for (const x of b) { s += x; s = (s & 255) + (s >> 8); } return s & 255; }

class SioHost {
  constructor(stream, core, opt = {}) {
    this.s = stream; this.core = core; this.gap = opt.gapMs || 50; this.log = opt.log || (() => {});
    this.buf = []; this.state = 'cmd'; this.last = 0; this.cmd = null; this.stats = { frames: 0, badChk: 0, naks: 0 };
    stream.on('data', (d) => this.feed(d));
  }
  put(bytes) { this.s.write(Buffer.from(bytes)); }
  feed(d) {
    const now = Date.now();
    if (now - this.last > this.gap && this.state === 'cmd') this.buf = [];
    this.last = now;
    for (const b of d) { this.buf.push(b); this.step(); }
  }
  step() {
    const b = this.buf;
    if (this.state === 'cmd') {
      while (b.length >= 5) {
        const f = b.slice(0, 5);
        if (f[0] !== DEV || chk(f.slice(0, 4)) !== f[4]) {
          // other device or noise: slide by one byte (header of another SIO device is 5 bytes; skip the whole frame if its checksum is valid)
          if (chk(f.slice(0, 4)) === f[4]) b.splice(0, 5); else { if (f[0] === DEV) this.stats.badChk++; b.shift(); }
          continue;
        }
        b.splice(0, 5); this.stats.frames++;
        const spec = LEN[f[1]];
        if (!spec) { this.put([0x4e]); this.stats.naks++; continue; }
        this.cmd = { cmd: f[1], a1: f[2], a2: f[3], dir: spec[0], n: spec[1] };
        this.put([0x41]);
        if (spec[0] === 'w') { this.state = 'data'; break; }
        this.finish(null);
      }
    } else if (this.state === 'data' && b.length >= this.cmd.n + 1) {
      const f = b.splice(0, this.cmd.n + 1);
      this.state = 'cmd';
      if (chk(f.slice(0, this.cmd.n)) !== f[this.cmd.n]) { this.stats.badChk++; this.put([0x4e]); this.buf = []; return; }
      this.put([0x41]);
      this.finish(Uint8Array.from(f.slice(0, this.cmd.n)));
      if (this.buf.length) this.step();
    }
  }
  finish(data) {
    const c = this.cmd, r = this.core.sio(c.cmd, c.a1, c.a2, data);
    if (r.st !== 0x43) { this.put([0x45]); return; }
    this.put([0x43]);
    if (c.dir === 'r') { const o = Array.from(r.data.subarray(0, c.n)); this.put([...o, chk(o)]); }
  }
}

// Open a real serial port (npm 'serialport', optional dependency). baud 19200 = standard SIO; higher needs a high-speed SIO driver on the Atari.
function openSerial(path, baud = 19200) {
  let SP; try { SP = require('serialport'); } catch (e) { throw new Error("npm package 'serialport' not installed (cd tools\\acnet && npm i serialport)"); }
  return new SP.SerialPort({ path, baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none' });
}

module.exports = { SioHost, openSerial, chk, DEV };
