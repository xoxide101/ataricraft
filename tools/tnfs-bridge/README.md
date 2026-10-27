# TNFS relay

Lets the Virtual FujiNet in ataricraft browse and mount images from public TNFS servers (host slots 2-8).
Browsers cannot send UDP, so this small dependency-free Node program (Node 18+) answers the page over local HTTP.

    node tools\tnfs-bridge\bridge.cjs [port]

It listens on 127.0.0.1:8765 only. In the page: Online & networking > TNFS relay > Test.
Then, with FujiNet on, press RETURN on a host in CONFIG to browse it and pick a disk image.

Transport: the relay tries TCP first (faster) and falls back to UDP for UDP-only hosts. To force one, put a prefix on the host name,
e.g. `tcp://tnfs.fujinet.online` or `udp://fujinet.diller.org` (a `:port` suffix still works).
Works on both cores.
