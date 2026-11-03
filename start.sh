#!/bin/sh
# Ataricraft one-click start (macOS, Linux, Raspberry Pi, Termux): runs the relay + emulator and opens your browser.
# Optional: ./start.sh --allow-write --sd ~/atari-files
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18 or newer is needed: https://nodejs.org/ (or: sudo apt install nodejs / brew install node / pkg install nodejs)"
  exit 1
fi
cd "$(dirname "$0")" || exit 1
exec node tools/tnfs-bridge/bridge.cjs "$@" --open
