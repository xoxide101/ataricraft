# FujiNet audit and compliance

Reference: FujiNet firmware master (`sioNetwork`, `NDevice`, `NetworkProtocol*`). Behaviour was ported from the source, not from hardware:
**nothing here has been run against a real FujiNet or a real Atari.** Tests run on both emulator cores (libatari800 and AltirraSDL).

## What exists

| Part | File | Notes |
|---|---|---|
| Control device `$70` (CONFIG, host/device slots, directory browse, mount, adapter config) | `web/js/fujinet.js` | Local folder host plus TNFS hosts through the relay |
| Network devices N1:–N8: (`$71`–`$78`) | `web/js/ndev.js` | New. Same SIO command set as the firmware |
| Relay (TNFS, HTTP, TCP, UDP) | `tools/tnfs-bridge/bridge.cjs`, `netapi.cjs` | Browsers cannot open sockets, so the page talks to this local program |
| Altirra hook | `tools/altirra-core/web_api.inc` | `$71`–`$78` forwarded to JS; WASM rebuilt |
| libatari800 hook | `build/atari800-sio-hook.patch` | Already forwarded every device; only the JS filter changed |

## N: command coverage

Commands use the firmware IDs and DSTATS directions.

| Cmd | Name | Status |
|---|---|---|
| `O` `C` `R` `W` `S` | open, close, read, write, status | done |
| `T` `L` | translation, line ending | done (none, CR, LF, CRLF; PETSCII bit is accepted but not converted) |
| `M` | HTTP channel mode (0 body, 1 collect headers, 2 get headers, 3 set headers, 4 POST data) | done; mode 1 is accepted but header collection is not filtered |
| `P` `Q` `0xFC` `0xFB` | parser, query, set parser, query flags | JSON and XML. HTML (mode 2) returns an error. Query flags are stored, not applied |
| `0xFD` `0xFE` | username, password | done (HTTP basic) |
| `0x2C` `0x30` | chdir / getcwd (prefix rules) | done |
| `A` `c` | accept, close client (TCP server) | done |
| `0x44` | UDP set destination | done |
| `0x45` `0xFF` | get error, get DSTATS for a command | done |
| `Z` | set interrupt rate | accepted, ignored (see limits) |
| `0x20` rename, `0x21` delete, `0x2A` mkdir, `0x2B` rmdir | filespec (`N:TNFS://host/a.txt,b.txt` for rename; the new name without a `/` stays in the same folder) | done for `TNFS://` and `SD:` only, and only when the relay runs with `--allow-write`. Other schemes return 146 |
| `0x72` get remote (UDP), `0x25`/`0x26` seek/tell, lock, unlock | | **not done**; returns NAK (error 132) |

## Protocols

| Scheme | Status |
|---|---|
| `TEST` | done (no network; same test string as the firmware) |
| `HTTP` / `HTTPS` | GET, POST, PUT, DELETE, request and response headers, basic auth, redirects; status mapped to FujiNet error codes. The request runs on the first status or read (PUT/POST on close). No range requests |
| `TCP` | client and server |
| `UDP` | send and receive; one datagram per read buffer fill |
| `TNFS` | directory listing and whole-file read through the relay. With `--allow-write` on the relay: open for write (mode 8) or append (mode 9), data is sent when the channel closes, so a failed write shows as an error on close. Tested only against a mock UDP TNFS server (`tools/tests/mocktnfs.cjs`), not a real `tnfsd`: `node scripts/tnfs-write-test.cjs` |
| `SD` | a folder on the PC served by the relay: `node tools/tnfs-bridge/bridge.cjs 8787 --sd DIR [--allow-write]`. Same behaviour as TNFS (listing, read, write/append on close, rename/delete/mkdir/rmdir). Paths are confined to DIR (`..` clamps to the root, links out of it are refused). Without `--sd` opens fail as not found. Tested: `node scripts/sd-test.cjs`. WebAFM can mount it as a drive (pane source "Relay SD folder") |
| `TELNET`, `WS`, `FTP`, `SSH`, `SFTP`, `SMB`, `NFS`, `S3`, cloud services | **not done**; a valid URL gives error 144 and an invalid one 165 |

## Deviations and limits

- **No PROCEED / interrupt.** The emulator hooks cannot raise the SIO interrupt line. Programs must poll `S`. Programs that wait on PROCEED will hang.
- Calls are synchronous. A slow server blocks the emulator for up to the relay timeout (15 s for HTTP).
- Altirra reads a 256-byte frame for `O`, as the real device does. A program that sends a shorter buffer gets error 138.
- Browsers cannot reach TCP/UDP. Everything except `N:TEST://` needs the relay running and its token entered in **FujiNet → Relay token**.
- JSON: objects and arrays are returned as compact JSON text. The firmware's exact formatting has not been compared.

## Security model of the relay

The relay is reachable by any web page you open, so `/net/*` is locked down:

- Requires the random `X-AC-Token` printed at start (or set `AC_TOKEN`). Compared in constant time.
- Refuses loopback, private, link-local, CGNAT and multicast targets unless started with `--allow-lan`. HTTP redirects are re-checked per hop.
- Servers bind to `127.0.0.1` unless `--allow-lan`.
- At most 32 open sockets, 8 MB bodies.
- Known gap: DNS rebinding between the check and the connect for HTTP. TCP and UDP connect to the checked address.

## Tests

- `node tools/tests/ndev.test.cjs`: protocol core with a mock transport.
- `node tools/tests/netapi.test.cjs`: relay API, token, address blocking, TCP echo, HTTP POST.
- `node scripts/ndev-test.cjs`: browser hook plus live relay (HTTP GET from a local server).
- `node scripts/ndev-sio-test.cjs`: real 6502 `JSR $E459` calls to N1: on both cores.

## Sample app: WGET

`tools/tests/wget.asm` (assembles with the Workbench assembler or MADS) is a wget: type a URL, it opens N1: over HTTP, polls status, prints the body and saves it to D1:WGET.TXT when a DOS disk is mounted. Test: `node scripts/wget-test.cjs` (both cores, live relay). Typing : into the emulator by keyboard is unreliable in tests, so the test uses `ataricraft.type()`.


## Sample app: LYNX

`tools/tests/lynx.asm` is a small text browser: it fetches a page over N1:, strips tags (skips <script>, <style>, <title>), decodes &amp; &lt; &gt; &quot;, breaks lines on block tags, word-wraps to 37 columns and pages with a --more-- prompt (Q quits). Links print as word[n]; at the prompt type 1-9 to follow (absolute, root-relative and relative hrefs), a URL starting with http, or Q. Not handled: forms, images, tables as tables, UTF-8, #fragments. Test: `node scripts/lynx-test.cjs` (both cores).


### Running from CMD

WGET.COM and LYNX.COM read the command line CMD.COM leaves at $0480 ($A5, text, EOL), so WGET http://host/file and LYNX http://host/ run directly from the CMD prompt; with no argument they ask for a URL. Tested for WGET (`HAND=1 node scripts/wget-test.cjs`, both cores); the LYNX path shares the same code but was only assembled, not run.

## Sample apps: MAIL, CURL, JQ, NC

All four read their arguments from the CMD hand-off line (or ask at a prompt) and share `tools/tests/nhead.inc`, `nlib.inc` and `ntok.inc`; `node tools/tests/buildapp.cjs NAME` pastes the includes and writes `tools/tests/bin/NAME.COM`.

| App | Usage | Notes |
|---|---|---|
| `MAIL.COM` | `MAIL L\|R\|D host:port user pass [n]` (list, read, delete) and `MAIL S host:port from to text...` (send) | POP3 and SMTP over `N:TCP://`, plain text only (no TLS). Multi-line SMTP replies (`250-`) are cut at the first line. |
| `CURL.COM` | `CURL url`, `CURL -i url`, `CURL -d word url` | `-i` prints `STATUS n` (the FujiNet error code, 1 = 2xx) and the response headers before the body. `-d` POSTs a single word. |
| `JQ.COM` | `JQ /path url` | Uses the N: JSON parser (`$FC`, `P`, `Q`). Prints `BAD JSON` or `NOT FOUND`. |
| `NC.COM` | `NC host port [word]`, `NC -l port` | Client sends a word or interactive lines (empty line quits). `-l` accepts one client, sends a greeting, prints what it sends, says BYE. |

Tests: `node scripts/mail-test.cjs` and `node scripts/net-apps-test.cjs` (CURL, JQ and NC; `CORES=atari800`, `ONLY=<args prefix>` and `SHOW=1` narrow or expand a run). Both pass on atari800 and Altirra against local servers and the relay. Not verified: real hardware, HTTPS, real internet servers, TLS mail.
