# ACNet — a network adapter for the Atari, as software

ACNet is its **own node on the LAN**: its own MAC address, its own DHCP lease (with renewal), it answers ARP and ping, and every TCP/UDP packet it sends comes from *its* address, not the host PC's. The Atari program sees a small socket API. There is no DynDNS and no hardware design here.

One **service core** (`web/js/acnet-core.js`) implements the socket API. Two transports expose it, and they behave identically:

| Transport | For | How the Atari reaches it |
|---|---|---|
| **Register window `$D1A0–$D1BF`** (+ IRQ) | the emulator (atari800 core) | memory-mapped; patched wasm calls `Module.acNet` |
| **SIO device `$65`** | emulator **and a real Atari** | standard `SIOV` calls; on a real Atari over a USB-SIO cable + `serialport` |

```
 Atari program (acnet.inc)
   │  registers/IRQ  or  SIO $65
   ▼
 acnet-core.js  ──JSON messages──►  StackBackend (tools/acnet/backend.cjs)
   │ (browser: acnet.js → WebSocket → tools/acnet/bridge.cjs)           │
   │ (real Atari: sio-serial.cjs, same core in Node)                    ▼
                                      userspace stack (stack.cjs): Ethernet, ARP, DHCP, IPv4, ICMP, UDP, TCP, DNS
                                                                        ▼
                                      L2 backend:  l2-pcap.cjs (Npcap, real LAN)  |  l2-virtual.cjs (tests)
```

## Evidence: what is proven and how

| Claim | Real network | Virtual LAN | Real Atari |
|---|---|---|---|
| Own MAC, DHCP lease from the router, gateway/DNS/mask from the lease | **yes** (`lan-smoke.cjs`, adapter `5.0_External`, lease in ~3 s) | yes | – |
| Ping to gateway and 1.1.1.1 from the ACNet address | **yes** | yes | – |
| DNS (example.com → A record) via the lease's resolver | **yes** | yes | – |
| TCP connect + HTTP GET (port 80, 200 OK) from the ACNet address | **yes** | yes | – |
| Inbound: ping/connect to the ACNet address from another machine | **not verified** (a NIC does not hairpin its own frames, so it needs a 2nd machine) | yes | – |
| ARP reply, DHCP renew, TCP flow control, 8 % packet loss, 600 KB TCP | – | yes (`acnet-stack-test`) | – |
| Core API through register **and** SIO transports (DNS, ping, TCP 120 KB, listener ×3, UDP, 15 sockets, errors, no-link) | – | yes (`acnet-core-test`) | – |
| 6502 driver + demo in the real emulator (wasm, Chrome): netinfo, DNS, ping, HTTP GET, UDP, listener, refused, 8 concurrent sockets, 20 KB full-duplex echo, IRQ-driven receive, no-link when the bridge is down | – | yes, both transports (`acnet-test`) | – |
| SIO wire protocol over a (loopback) serial stream: framing, checksums, NAK, resync, 50 KB echo, UDP, listener | – | yes (`acnet-serial-test`) | **no** |
| A real Atari on a real USB-SIO cable | – | – | **untested** |

The virtual-LAN peer is the same stack implementation, so it is not independent validation; the real-LAN smoke test is the independent evidence for the stack.

Honest limits: Wi-Fi adapters, Hyper-V vSwitches and VPN adapters often drop frames from MACs the NIC didn't register, so use a **wired** NIC (tested: Realtek USB 5GbE). The real-Atari serial path is built to the SIO spec but has never touched a real Atari; timing (SIO inter-byte/ACK delays) and the command-line signal of your particular cable are the likely first problems.

## Quick start

```
cd tools\acnet && npm install                 # koffi (Npcap access) + serialport; Npcap itself: https://npcap.com (WinPcap-compatible mode not needed)
node tools\acnet\bridge.cjs --l2 pcap                              # list capture devices
node tools\acnet\bridge.cjs --l2 pcap --adapter "5.0_External"     # real LAN; DHCP from your router
node tools\acnet\bridge.cjs --l2 virtual                           # no network needed (peer 10.7.0.1: DNS host.test, TCP echo 8000, UDP echo 7777)
node tools\acnet\bridge.cjs --l2 pcap --adapter "..." --serial COM5 --baud 19200   # additionally serve a real Atari on SIO $65
```
Emulator: load the atari800 core (the Altirra core has no register window), enable the chip at the bottom right ("ACNet", click toggles; right-click sets the bridge URL, default `ws://127.0.0.1:8765`). Without a bridge the device reports "no link" and every network call fails fast with `NOLINK` (it never hangs).

Inbound test from another machine: run the bridge with `--l2 pcap`, note the printed IP, `ping` it, or listen from the guest and `curl http://<ip>:<port>` from the other machine.

Tests (all offline except where noted): `node scripts\acnet-stack-test.cjs`, `acnet-core-test.cjs`, `acnet-serial-test.cjs`, `acnet-test.cjs` (Playwright + Chrome + the mads demo); `node tools\acnet\lan-smoke.cjs --adapter "..."` (real LAN, outbound).

## Register window (emulator fast path, offsets from `$D1A0`)

| Off | R | W |
|---|---|---|
| 0–2 | ID `$AC`,`$4E`, version | – |
| 3 | STATUS: b7 link, b6 IRQ, b5 bridge, b4 any event | – |
| 4 | RESULT of last command | CMD |
| 5 | SOCK (ALLOC/ACCEPT set it to the new handle) | select socket |
| 6 | SSTAT | – |
| 7 | EV | clear the EV bits in the mask |
| 8/9 | RX bytes available (lo/hi) | – |
| 10/11 | TX bytes free | – |
| 12 | DATA: pop RX | push TX |
| 13 | IRQEN | bit0 = interrupt enable |
| 14/15 | bitmap of sockets with events | – |
| 16–23 | ARG0–7 | ARG0–7 |
| 24 | SERR (last socket error) | – |

Commands: ALLOC 1, CONNECT 2 (host string/IP staged in the socket's TX, port in ARG0/1), LISTEN 3 (port ARG0/1), ACCEPT 4, CLOSE 5, UDP_OPEN 6, FLUSH 7, UDP_PEER 8 (ARG0–3 ip, 4/5 port), DNS 9 (name in socket 0 TX → 4 bytes in socket 0 RX), PEERINFO 10, NETINFO 11 (26 bytes: MAC6, IP4, mask4, gw4, dns1 4, dns2 4), PING 12 (ARG0–3 ip → RTT ms in socket 0 RX), RESET 13, DROP 16, SHUTDOWN 17.

Results: OK 0, BADCMD 1, BADSOCK 2, NOSOCK 3, NOLINK 4, BADSTATE 5, WOULDBLOCK 6, BADARG 7, TXFULL 8, INUSE 9. Socket errors (SERR): REFUSED 1, RESET 2, TIMEOUT 3, DNS 4, NOLINK 5, OTHER 6, NXDOMAIN 7.
SSTAT bits: OPEN 1, RX 2, TX 4, EOF 8, ERR 0x10, CONNECTING 0x20, LISTEN 0x40, ACCEPT 0x80. EV bits: RX 1, EOF 2, ACCEPT 4, CONN 8, ERR 0x10, TX 0x20, LINK 0x40.

Semantics: 16 handles (0 = control socket for DNS/ping/NETINFO, 1–15 usable); per-socket RX ring 4096 B, TX ring 2048 B; TCP is a byte stream, UDP keeps datagram boundaries (queue of 8, one datagram per read). Writes go to the TX ring and leave on FLUSH (or when the ring fills). DNS and ping complete asynchronously with `EV.CONN` (or `EV.ERR` + SERR) on socket 0. RX window is advertised from ring space, so a slow Atari gets real TCP flow control.

**Interrupt**: level-triggered, IRQ asserts while `IRQEN=1` and any socket has an event. The handler reads EV-map (14/15), clears IRQEN, and the foreground acks with EV writes and re-arms (`an_irq_arm`). Nothing is lost because the event bits persist until acknowledged.

## SIO device `$65` (emulator and real Atari)

| Cmd | Dir | Data | Meaning |
|---|---|---|---|
| `$53` | read | 32 | status for socket aux1: result, sock, sstat, ev, rx lo/hi, tx lo/hi, STATUS, evmask lo/hi, serr, ARG0–7 at 12–19, current sock at 20 |
| `$C0` | write | 16 | exec: cmd, sock, ARG0–7 |
| `$C1` | read | 256 | `len16` + data; aux1 = socket, aux2 = max bytes (≤254) |
| `$C2` | write | 256 | `len16` + data for socket aux1 (check TX free first; surplus is dropped) |
| `$C3` | – | – | event ack: aux1 = socket, aux2 = mask |

Polled (no interrupt on SIO). Over a serial cable the host (`sio-serial.cjs`) implements standard SIO framing: 5-byte command frame (dev `$65`, cmd, aux1, aux2, checksum), ACK `$41`/NAK `$4E`, data frame + checksum, COMPLETE `$43`/ERROR `$45`. Frames for other devices are ignored; line noise is skipped by resync; a partial frame is dropped after a 50 ms idle gap. The default is 19200 baud; a faster rate needs a high-speed SIO routine on the Atari and the same `--baud` on the host. Cable detail (which modem line is the command line) is not used: the host resyncs on header + checksum instead.

## Guest API (`guest/acnet/acnet.inc`, mads)

`an_init` · `an_netinfo` · `an_dns` · `an_ping` · `an_tcp_open` · `an_alloc/an_connect` · `an_listen/an_accept` · `an_send_all` · `an_recv` · `an_close` · `an_udp_open/an_udp_to` · `an_flush` · `an_irq_install/an_irq_arm`. All calls block with an optional timeout (`an_tmo`, in jiffies) and return carry set on error with `an_res`/`an_serr`. Build for the register window by default, or `-d:ACNET_SIO=1` for SIO (the same source runs on a real Atari). `guest/acnet/demo.asm` is the end-to-end program exercised by `acnet-test.cjs`.

**ACX OS threads**: every wait loop calls `jmp (an_idlev)` once per poll; point `an_idlev` at the thread yield routine and a thread simply blocks in `an_recv`/`an_accept` while others run. With the register transport the ISR latches `an_evm`, so a scheduler can mark a thread runnable when its socket bit is set, then re-arm with `an_irq_arm`. Note: VIMIRQ handlers receive no saved registers from the OS, the ISR saves A itself.

## Emulator integration (what changed)

- `web/js/acnet.js` (new, `window.ACNet`): hooks the FujiNet attach point (SIO `$65` first, otherwise the existing handler), steps the core each frame, runs the WebSocket client and the status chip.
- `web/index.html`: one added line loading `js/acnet-core.js` and `js/acnet.js`. `web/js/app.js` is not touched.
- Wasm core: `build/atari800-acx.patch` + `build/ac_glue.c` route `$D1A0–$D1BF` to `Module.acNet` and raise the PBI-style IRQ; `web/ref/` is gitignored, so rebuild with `scripts\build-reference.ps1` after pulling.

## Security

The bridge binds to `127.0.0.1`, accepts one owner (second client gets 409), and disposes that owner's sockets on disconnect. The ACNet address is a real LAN peer: anything the guest listens on is reachable from the LAN. No credentials are stored anywhere.

## Real hardware (note only)

The register window is shaped so a PBI/ECI board with a microcontroller running a TCP/IP stack could implement the same registers and IRQ, and SIO/FujiNet-style devices remain a possible fallback. No such design exists here.
