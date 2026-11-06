# TNFS / network relay (`tools/tnfs-bridge/`)

Browsers cannot open raw sockets, so the emulator's virtual FujiNet talks to this small **dependency-free Node program** (Node 18+) over local HTTP, and the relay does the real network work. It also serves the emulator page, so `start.cmd` / `start.sh` is the usual way to run it.

    node tools/tnfs-bridge/bridge.cjs [port] [--allow-lan] [--allow-write] [--sd DIR] [--dos DIR]

Default port 8765, loopback only. It prints a random token (set `AC_TOKEN` to keep one); every `/net/*` call must carry it in `X-AC-Token`. Without `--allow-lan`, loopback, private and link-local targets are refused and TCP/UDP servers bind to 127.0.0.1. `--allow-write` permits writes, rename, delete, mkdir, rmdir on TNFS, SD and FTP, and HTTP `PUT/DELETE/PATCH`. `--sd DIR` serves a folder as `N:SD:/`.

## Files

| File | Role |
|---|---|
| `bridge.cjs` | HTTP server, static files for `web/`, TNFS client (TCP first, UDP fallback), SD folder, persistent token, wires the other modules |
| `netapi.cjs` | `/net/*` endpoints for the N: device: `http` (fetch with manual redirects, SSRF checks), `tcp/open|listen|accept|read|write|close`, `udp/*`, `ftp/list|file|put|op`, `diag.ataricraft` (real ping, DNS, traceroute, whois, ipconfig on the PC). Token check with constant-time compare; `allowLan`, `allowWrite` policy |
| `ftp.cjs` | Minimal FTP client: passive mode, binary type, one control connection per operation, list/retrieve/store/append/mkdir/rmdir/delete/rename. Rejects CR/LF in any argument |
| `ctl.cjs` | `/ctl/*`: lets scripts outside the browser drive the emulator page (long-poll queue between a page and a CLI) |
| `README.md` | short usage notes |

`tools/ctl.cjs` is the command-line side of `/ctl`: `AC_TOKEN=... node tools/ctl.cjs state | peek | poke | run FILE | mount D1: FILE | type "text" | screen | shot FILE.png | reset | prog NAME ...` (see the header of the file for all commands).

## Protocol sketch

`POST /net/<call>?k=v...` with the token header and the request body as raw bytes. The answer carries the result in headers (`X-AC-*`, error code) and the data as the body. Errors use FujiNet error numbers (for example 170 not found, 167 denied). The page side is `web/js/ndev.js` (N: unit emulation, CIO command handling) and `web/js/fujinet.js`.

## Security

Localhost only by default; token required; private-network targets blocked unless `--allow-lan`; writes off unless `--allow-write`; FTP command injection through path characters is refused; the HTTP redirect loop re-checks the target on every hop.

## Tests

`node tools/tests/netapi.test.cjs`, `ndev.test.cjs`, `ftp.test.cjs` (mock FTP in `tools/tests/mockftp.cjs`), `mocktnfs.cjs` (UDP TNFS server used by `scripts/tnfs-write-test.cjs`), and the browser tests in [net-apps.md](net-apps.md).
