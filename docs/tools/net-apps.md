# Network tools (FujiNet N: apps, relay, diagnostics)

Atari-side programs that talk to the network through the **N: device** (a FujiNet network device on SIO `$71`, unit N1:), plus the PC-side relay that gives the emulator real network access. They also target a real FujiNet; on the emulator they need the **relay** (`tools/tnfs-bridge/bridge.cjs`, see [tnfs-bridge.md](tnfs-bridge.md)) and FujiNet switched on (Online & networking tab).

## Programs

All are 6502, written in the repo's own assembler dialect (`web/js/asm6502.js`, also MADS-compatible). Sources: `tools/tests/*.asm` (the apps) and `tools/net/netdiag.asm` (diagnostics). The `.COM` files in `tools/tests/bin/` and `tools/net/` are our own builds of those sources. Build with `node tools/tests/build.cjs` / `node tools/net/build.cjs` (needs `out/mads/mads.exe`, not in the repo) or assemble one app with `node tools/tests/buildapp.cjs NAME`.

| Program | Source | What it does | Usage |
|---|---|---|---|
| WGET.COM | `tools/tests/wget.asm` | Fetches a URL and prints it; saves to `D1:WGET.TXT` when a DOS disk is mounted | run, type `http://host/path` or `ftp://user:pass@host/file` at the prompt |
| WPUT.COM | `tools/tests/wput.asm` | Uploads a disk file: FTP `STOR`, HTTP `PUT`, or the relay's SD folder | `WPUT D1:FILE.TXT ftp://user:pass@host/dir/FILE.TXT`, `WPUT FILE.TXT http://host/path`, `WPUT FILE.TXT sd://folder/FILE.TXT` (relay needs `--allow-write`) |
| LYNX.COM | `tools/tests/lynx.asm` | Text web browser: strips tags, wraps to 37 columns, pages, numbered links `word[n]` | type a URL; digit 1-9 follows a link; `Q` quits |
| CURL.COM | `tools/tests/curl.asm` | One HTTP request | `CURL url`, `CURL -i url` (STATUS, headers, body), `CURL -d data url` (POST) |
| JQ.COM | `tools/tests/jq.asm` | Fetch JSON, print one value | `JQ /specs/cpu http://host/info.json` |
| NC.COM | `tools/tests/nc.asm` | TCP client or one-shot server, plain TCP | `NC host port word`, `NC host port` (interactive), `NC -l port` |
| MAIL.COM | `tools/tests/mail.asm` | POP3 and SMTP, plain text (no TLS) | `MAIL L host:port user pass`, `R ... n`, `D ... n`, `S host:port from to text...` |
| PING, NSLOOKUP, TRACERT | `tools/net/netdiag.asm` (one source, `-d:MODE=1/2/3`) | Ask the relay (`N:HTTP://diag.ataricraft/...`) to run a real ICMP ping, DNS lookup or traceroute on the PC. Without the relay (real FujiNet) PING times a TCP connect to port 80, NSLOOKUP uses DNS over HTTPS, TRACERT has no fallback | `PING host` |
| WHOIS, IPCONFIG | `tools/net/*.com` | WHOIS lookup (relay only), IP settings | type at the prompt |
| NHTEST.COM | `tools/tests/nhtest.asm` | CIO-level test of the N: handler in `tools/afm/nhandler.inc` (directory read, file read, write and read back, mkdir) | internal test |

### How they work

Each app builds an N: filespec (`N:` + URL, EOL `$9B`), opens IOCB #1 (aux1 4 read, 8 write, 6/7 directory), reads or writes with CIO, and closes. Shared code: `nlib.inc` (open, read, write, close, status through SIO `$71`), `ntok.inc` (command line: takes the line CMD.COM leaves at `$0480`, marked `$A5 ... $9B`, or asks at a prompt), `nhead.inc` (header and equates). The Workbench assembler has no `include`, so `buildapp.cjs` pastes the includes in at the `; @head`, `; @tok` and `; @lib` markers. No PROCEED interrupt: the apps poll status. A write on N: is sent when the channel is **closed**, so WPUT reports `UPLOAD FAILED` only after it has read the whole file.

On the PC the emulator's N: device (`web/js/ndev.js`; protocols `http`, `https`, `tcp`, `ftp`, `tnfs`, `sd`, `test`) turns each CIO call into a relay request: `POST /net/...` with header `X-AC-Token`.

### FTP (N:FTP://)

`ftp://[user:pass@]host[:port]/path` through the relay (`tools/tnfs-bridge/ftp.cjs`): plain FTP, passive mode, binary type, one control connection per operation. Reads: file (`RETR`) and directory (`LIST`). Writes (`STOR`, `APPE`, `MKD`, `RMD`, `DELE`, `RNFR/RNTO`) are refused unless the relay runs with `--allow-write`. CR/LF in a path is rejected so a URL cannot inject FTP commands. Atari keyboards type upper case, so user names and passwords typed on the Atari are upper case.

### Relay write policy

`--allow-write` also gates HTTP `PUT`, `DELETE` and `PATCH` through `/net/http`. Found while testing WPUT: before this fix an HTTP PUT went through a read-only relay. `GET`, `HEAD` and `POST` are always allowed. Loopback and LAN targets need `--allow-lan`.

## Test results (local servers, 2026-11-05, Chrome via Playwright)

| Test | Server | Result |
|---|---|---|
| `scripts/wget-test.cjs` | local HTTP | PASS on atari800 and altirra (body in memory byte for byte) |
| `FTP=1 scripts/wget-test.cjs` | mock FTP (`tools/tests/mockftp.cjs`) | PASS on both cores (server saw USER, PASS, TYPE I, PASV, RETR) |
| `scripts/lynx-test.cjs` | local HTTP | PASS on both cores (tags stripped, entities decoded, script skipped, link 1 followed) |
| `scripts/wput-test.cjs` | mock FTP + local HTTP | PASS on atari800: FTP `STOR` and HTTP `PUT` arrive byte for byte; with a read-only relay both are refused and nothing is written |
| `scripts/net-apps-test.cjs` | local HTTP and TCP | CURL (plain, `-i`, `-d`), JQ (5 paths), `NC` client PASS on both cores. `NC -l` PASS on atari800 (6 of 6 isolated reruns). The earlier "flaky" failure was a test artefact: the listener port was fixed (18555), and a relay left running by an unfinished run kept it bound, so `N:TCP://:18555` returned ADDR_IN_USE and NC printed `CANNOT CONNECT`; the test now uses a per-process port. `NC -l` on **altirra hangs reproducibly** as soon as the first client connects (clean port, listener opens and prints `LISTENING`, the client connects, then the page stops answering: the renderer sits at 100 % CPU and Playwright calls never return). Cause not found (suspect the accept / read polling loop on the altirra core, not the relay: `tcpAccept` is non-blocking); the test has a 90 s per-case watchdog and reports `HUNG` (exit 2) instead of waiting for ever. Altirra `NC` client mode and every other app pass |
| `tools/tests/ftp.test.cjs` | mock FTP | 15 of 15: binary RETR exact, missing file to NOT_FOUND, bad password to DENIED, STOR/APPE, MKD/RNFR/RNTO/DELE/RMD, CR/LF injection refused, token and write gating |
| `tools/tests/netapi.test.cjs`, `ndev.test.cjs` | in-process | PASS |

Not tested: public internet servers, HTTPS end to end, LYNX over FTP, real FujiNet hardware, WPUT on the altirra core, MAIL against a mail server (`mail-test.cjs` exists, not re-run), the diagnostics (`netdiag-test.cjs` exists, not re-run).

Harness note: WPUT needs a DOS disk for `D1:`. `wput-test.cjs` boots Atari DOS 2.5 with `WPUTF.COM` / `WPUTH.COM` (the app with its command line appended as a `$0480` segment, plus a small `$0600` stub that runs it and then spins so its messages stay on screen), `MEM.SAV` (DOS 2.5 refuses a binary load that touches low memory without it) and `DATA.TXT`, then loads it from the DOS menu with `L`. The tests need ROM images from `software_n_roms/`, which is not in the repository.

## Run them

    node tools/tnfs-bridge/bridge.cjs 8765 --allow-lan --allow-write     # relay; prints the token
    node scripts/wget-test.cjs ; node scripts/lynx-test.cjs ; node scripts/wput-test.cjs

Environment: `CORES=atari800,altirra`, `FTP=1` (wget), `DBG=1` (tracing). The scripts expect Playwright at `C:/Users/raver/craftapi/node_modules/playwright-core` and Chrome in its default path; edit the top of a script for another machine.
