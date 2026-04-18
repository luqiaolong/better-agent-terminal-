#!/bin/bash
# Headless BAT server launcher for macOS / Linux.
# Reuses BetterAgentTerminal's bundled Node runtime via ELECTRON_RUN_AS_NODE,
# so no separate node install is required.
#
# Usage:
#   bat-server [--port=N] [--bind=localhost|tailscale|all]
#              [--data-dir=PATH] [--token=HEX] [--debug]
#
# See `bat-server --help` for full options.

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
JS="$DIR/app.asar.unpacked/bin/bat-server.js"

BIN=""
# macOS layout: Contents/Resources/bat-server -> ../MacOS/BetterAgentTerminal
if [ -x "$DIR/../MacOS/BetterAgentTerminal" ]; then
  BIN="$DIR/../MacOS/BetterAgentTerminal"
fi
# Linux AppImage layout: squashfs-root/resources/bat-server -> ../better-agent-terminal
if [ -z "$BIN" ]; then
  for cand in "$DIR/../better-agent-terminal" "$DIR/../BetterAgentTerminal" "$DIR/../betteragentterminal"; do
    if [ -x "$cand" ]; then BIN="$cand"; break; fi
  done
fi

if [ -z "$BIN" ] || [ ! -f "$JS" ]; then
  echo "bat-server: cannot locate Electron runtime or bat-server.js next to this script" >&2
  echo "  looked in: $DIR" >&2
  exit 1
fi

export ELECTRON_RUN_AS_NODE=1
exec "$BIN" "$JS" "$@"
