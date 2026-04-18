@echo off
REM Headless BAT server launcher for Windows.
REM Reuses BetterAgentTerminal.exe's bundled Node runtime via
REM ELECTRON_RUN_AS_NODE, so no separate node.exe is required.
REM
REM Usage:
REM   bat-server [--port=N] [--bind=localhost^|tailscale^|all]
REM              [--data-dir=PATH] [--token=HEX] [--debug]
REM
REM See `bat-server --help` for full options.

setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0BetterAgentTerminal.exe" "%~dp0resources\app.asar.unpacked\bin\bat-server.js" %*
