# Getting started (Windows, macOS, Linux, Raspberry Pi, Android)

Ataricraft is a browser emulator. You only need a modern browser to use the emulator itself.
The **relay** is an optional small program that gives the page real network access (FujiNet `N:` devices, TNFS servers, an `SD:` folder).
Browsers cannot open raw TCP/UDP sockets or read your disk, so the relay does that for them.

## 1. Emulator only (no install)

Open `web/index.html` in Chrome, Edge, Firefox or Safari. Pick your ROM files (ATARIXL.ROM and ATARIBAS.ROM are not included; supply your own) and press Boot.
No server, no Node.

## 2. Emulator + networking: one command

Install **Node.js 18 or newer** once (https://nodejs.org/). Nothing else to install.

| System | Do this |
|---|---|
| **Windows** | Double-click `start.cmd` (or run it in a terminal) |
| **macOS** | Terminal: `./start.sh` (first time: `chmod +x start.sh`) |
| **Linux / ChromeOS (Linux)** | Terminal: `./start.sh` |
| **Raspberry Pi** | `sudo apt install nodejs`, then `./start.sh` (needs Node 18+; use NodeSource if apt is older) |
| **Android (Termux)** | `pkg install nodejs`, then `./start.sh` in the folder, and open `http://127.0.0.1:8765/` in Chrome |
| **Any system, no script** | `node tools/tnfs-bridge/bridge.cjs --open` |

It starts the relay, serves the emulator at **http://127.0.0.1:8765/** and opens your browser.
The token and relay address are filled in for you, so there is nothing to paste. Press Ctrl+C to stop.
The token is saved in `~/.ataricraft-token` (set `AC_TOKEN` to use your own).

Then in the page: turn FujiNet on (Online & networking), boot, and use `N:` from BASIC, or run the sample apps (see [FUJINET.md](FUJINET.md)).

**File manager:** open WebAFM and pick "Relay SD folder" (needs `--sd`) or "TNFS server…" in a pane's source list. Copy between disk images and those folders with F5/F6 like any other pane. Add `--allow-write` to change files.

## Options

Add these after the script name:

| Flag | Meaning |
|---|---|
| a number first, e.g. `9000` | use another port (default 8765; or set `AC_PORT`) |
| `--allow-lan` | let `N:` reach machines on your own network and this PC (blocked by default) |
| `--allow-write` | allow writes, rename, delete, mkdir, rmdir on TNFS and SD (off by default) |
| `--sd FOLDER` | share a folder as `N:SD:/` |

Examples:

    start.cmd --sd C:\atari-files --allow-write
    ./start.sh 9000 --allow-lan --sd ~/atari

## Real Atari or real FujiNet hardware

This project is a virtual FujiNet inside the emulator. Nothing here has been run on a real FujiNet or a real Atari.
For a real FujiNet device, use its own firmware and web interface; the relay is not involved.

## Safety notes

- The relay listens on 127.0.0.1 only. Other computers cannot reach it.
- Network calls need the token. Only the page the relay serves receives it; other websites cannot read it, and requests with a non-local Host header are refused.
- Without `--allow-lan`, private addresses are refused. Without `--allow-write`, nothing on disk or on TNFS can change.
- `SD:` is confined to the folder you give it (`..` cannot leave it; links pointing out of it are refused).

## Troubleshooting

| Problem | Fix |
|---|---|
| "Node.js is needed" | install Node 18+ from https://nodejs.org/ and reopen the terminal |
| "Port 8765 is busy" | the relay is already running; close it, or use another port: `./start.sh 9000` |
| Browser did not open | open `http://127.0.0.1:8765/` yourself |
| `N:` says token missing/wrong | open the page through the relay address (not from the file), or paste the token printed at start into Online & networking |
| LAN or `localhost` targets fail | start with `--allow-lan` |
| Writes fail with error 167 | start with `--allow-write` |
| `SD:` files not found | start with `--sd FOLDER` and use `N:SD:/name` |
| HTTPS sites do not work | `N:` supports plain `http://` only |
