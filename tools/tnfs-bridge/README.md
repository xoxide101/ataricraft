# TNFS relay

**Easiest way:** run `start.cmd` (Windows) or `./start.sh` (macOS/Linux/Pi/Termux) in the project folder. It serves the emulator and the relay together and fills in the token for you. See [docs/GETTING-STARTED.md](../../docs/GETTING-STARTED.md).

Lets the Virtual FujiNet in ataricraft browse and mount images from public TNFS servers (host slots 2-8).
Browsers cannot send UDP, so this small dependency-free Node program (Node 18+) answers the page over local HTTP.

    node tools\tnfs-bridge\bridge.cjs [port]

It listens on 127.0.0.1:8765 only. In the page: Online & networking > TNFS relay > Test.
Then, with FujiNet on, press RETURN on a host in CONFIG to browse it and pick a disk image.

Transport: the relay tries TCP first (faster) and falls back to UDP for UDP-only hosts. To force one, put a prefix on the host name,
e.g. `tcp://tnfs.fujinet.online` or `udp://fujinet.diller.org` (a `:port` suffix still works).
Works on both cores.

## N: network devices (/net/*)

The relay also carries HTTP, TCP and UDP for the virtual N1:-N8: devices (see docs/FUJINET.md).

    node tools\tnfs-bridge\bridge.cjs [port] [--allow-lan] [--allow-write] [--sd DIR]

`--sd DIR` serves a folder as `N:SD:/`. `--allow-write` permits writes, rename, delete, mkdir and rmdir on TNFS and SD (off by default).

At start it prints a random token; paste it into the page (Online & networking > TNFS relay > N: relay token). Set AC_TOKEN to keep one token between runs.
Without --allow-lan, targets on loopback, private or link-local addresses are refused, and TCP/UDP servers bind to 127.0.0.1.
Test with the page's Test button (it also checks the token).

## Network diagnostics (PING, NSLOOKUP, TRACERT, WHOIS, IPCONFIG)

Built from tools/net/netdiag.asm (ping.com, nslookup.com, tracert.com, whois.com, ipconfig.com). WHOIS and IPCONFIG are relay only (/whois/<domain>, /ipconfig/x). Usage: `PING host[:port]`. Each tool auto-detects: it first asks the relay (`N:HTTP://diag.ataricraft/ping|dns|trace/<host>`), which runs the real OS ping/tracert/DNS. If the relay doesn't answer (e.g. real FujiNet), PING times TCP connects (port 80 by default), NSLOOKUP uses DNS-over-HTTPS (dns.google), and TRACERT says it needs the relay (no ICMP/TTL on FujiNet). Tested in the emulator only (scripts/netdiag-test.cjs); the real-FujiNet fallbacks are untested on hardware.

