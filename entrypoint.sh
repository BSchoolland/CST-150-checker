#!/bin/bash
set -e

echo "Starting WinForms Checker Container..."

# Cleanup function for graceful shutdown
cleanup() {
    echo "Shutting down..."
    pkill -f "Xvfb :99" 2>/dev/null || true
    pkill -f "x11vnc" 2>/dev/null || true
    pkill -f "websockify" 2>/dev/null || true
    rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
    echo "Cleanup complete"
    exit 0
}

# Trap signals for graceful shutdown
trap cleanup SIGTERM SIGINT SIGHUP EXIT

# Clean up stale lock files from previous runs
echo "Cleaning up stale X11 lock files..."
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

# Start Xvfb (virtual framebuffer)
echo "Starting Xvfb on display :99..."
Xvfb :99 -screen 0 1280x720x24 &
sleep 2

# Start x11vnc
echo "Starting x11vnc..."
x11vnc -display :99 -nopw -listen 0.0.0.0 -xkb -forever -shared -bg

# Start websockify for noVNC
echo "Starting websockify on port 6080..."
websockify --web=/usr/share/novnc/ 6080 localhost:5900 &

echo "Container ready!"
echo "VNC available on port 5900"
echo "noVNC web interface available on port 6080"
echo "API server starting on port 3000..."

# Start the Bun server
cd /app
bun run src/server.ts &
BUN_PID=$!

# Wait for bun to exit (or signal)
wait $BUN_PID
