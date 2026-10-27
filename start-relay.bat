@echo off
cd /d "%~dp0"
echo Starting the TNFS relay (close this window to stop it)...
node tools\tnfs-bridge\bridge.cjs
pause
