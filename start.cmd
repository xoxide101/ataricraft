@echo off
rem Ataricraft one-click start (Windows): runs the relay + emulator and opens your browser.
rem Optional: start.cmd 9000 --allow-write --sd C:\path\to\folder   (a port number must come first)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is needed: https://nodejs.org/  ^(install it, then run this again^)
  pause
  exit /b 1
)
node "%~dp0tools\tnfs-bridge\bridge.cjs" %* --open
pause
