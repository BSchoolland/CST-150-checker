#!/bin/bash
set -e

echo "Starting session container..."

# Start virtual display
echo "Starting Xvfb on display :99..."
Xvfb :99 -screen 0 800x600x24 &
XVFB_PID=$!
sleep 2

# Start openbox window manager (handles expose events for proper repaints)
echo "Starting openbox window manager..."
openbox --config-file /etc/openbox/rc.xml &
sleep 1

# Start VNC server
echo "Starting x11vnc..."
x11vnc -display :99 -nopw -listen 0.0.0.0 -xkb -forever -shared -bg

# Start websockify for noVNC (on internal port)
echo "Starting websockify on port 6080..."
websockify --web=/usr/share/novnc/ 6080 localhost:5900 &

# Signal ready
echo "SESSION_READY"
echo "VNC available on port 5900"
echo "noVNC web interface available on port 6080"

# Keep container alive - wait for Xvfb
wait $XVFB_PID
