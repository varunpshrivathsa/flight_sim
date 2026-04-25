#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=8080

# Kill any leftover server on the port
lsof -ti tcp:$PORT | xargs kill -9 2>/dev/null || true

# Check the sim binary exists
if [ ! -f "$SCRIPT_DIR/sim" ]; then
  echo "Error: ./sim not found. Build it first."
  exit 1
fi

# Start the viewer server silently in the background
python3 -m http.server $PORT --directory "$SCRIPT_DIR/viewer" > /dev/null 2>&1 &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null" EXIT

# Open the browser
sleep 0.3
open "http://localhost:$PORT"

echo "Viewer at http://localhost:$PORT"
echo "Controls: arrow keys to fly, Q/E throttle — Ctrl+C to quit"
echo ""

# Run the sim in the foreground — keyboard input works here
cd "$SCRIPT_DIR"
./sim
