#!/bin/bash
set -e

echo "Starting WinForms Checker Container..."

# Ensure mounted directories are writable
chmod -R 777 /app/uploads /app/projects 2>/dev/null || true

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

# Build the review runner image if it doesn't exist or Dockerfile changed
echo "Building review runner image..."
# Copy opencode config and plugin to review-runner build context so it can be included in the image
cp -r /app/opencode-config /app/review-runner/opencode-config
cp -r /app/opencode-plugin /app/review-runner/opencode-plugin
if docker build -t cst150-review-runner:latest /app/review-runner 2>&1; then
    echo "Review runner image built successfully"
else
    echo "Warning: Failed to build review runner image. Code reviews will not work."
fi

# Clean up stale lock files from previous runs
echo "Cleaning up stale X11 lock files..."
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

# Start Xvfb (virtual framebuffer)
echo "Starting Xvfb on display :99..."
Xvfb :99 -screen 0 800x600x24 &
sleep 2

# Start openbox window manager (handles expose events for proper repaints)
echo "Starting openbox window manager..."
DISPLAY=:99 openbox --config-file /app/openbox-rc.xml &
sleep 1

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
