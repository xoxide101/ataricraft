# Inspector and remote control

**Inspect** tab (sidebar) opens a panel with five views:

- **RAM:** a 256-page map ($00 top-left, 16 per row; brightness = non-zero bytes, red = changed since the last refresh, hover for the page), plus MEMLO/MEMTOP/free bytes, RAMTOP, APPMHI, DLIST, SAVMSC, CHBAS, RUNAD/INITAD and zero-page use. Programs started through `ataricraft.bootFile` or the Inject tab have their XEX segments recorded ("Last load").
- **Network:** every call the virtual FujiNet N: device makes through the relay (HTTP, TCP, UDP, TNFS, SD): time, status, bytes, duration, open sockets, byte totals.
- **IP:** the adapter settings the Atari sees (IP, netmask, gateway, DNS, MAC, SSID, hostname, DHCP flag). Apply them, or copy this PC's address from the relay. The FujiNet adapter-config command ($E8/$C4) returns these values. Defaults are unchanged (127.0.0.1).
- **Inject:** poke, dump and find memory; boot a .COM/.XEX; type text; add **fake replies** that answer N:HTTP requests whose URL contains a given text (shown as `[mock]` in the log).
- **Remote:** connects this page to the relay for outside control. A page opened from the relay address connects by itself.

## From outside the browser

Start the relay (`node tools/tnfs-bridge/bridge.cjs`), open its address in a browser, then run `tools/ctl.cjs` with the relay's token:

```
set AC_TOKEN=<token printed by the relay>
node tools/ctl.cjs state | ram | net | ip | screen
node tools/ctl.cjs setip ip=192.168.1.50 mask=255.255.255.0 gw=192.168.1.1
node tools/ctl.cjs peek 0600 32
node tools/ctl.cjs poke 0600 A9 01 60
node tools/ctl.cjs run GAME.XEX
node tools/ctl.cjs mock diag.ataricraft/ping 200 "FAKE REPLY"
node tools/ctl.cjs shot out.png
```

Under the hood it POSTs `{method,args}` to the relay's `/ctl/call`; the page long-polls `/ctl/poll`, runs the call from a fixed allow-list (see `AC.Remote` in `web/js/inspect.js`) and answers through `/ctl/result`. Every call needs the relay token. The relay only listens on 127.0.0.1.

Test: `node scripts/inspect-test.cjs`. Not checked: a second machine on the LAN driving it, or real FujiNet software reading the changed IP.