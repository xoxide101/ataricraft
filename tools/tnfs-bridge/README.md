# TNFS relay

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
