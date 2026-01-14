#!/bin/bash
set -e

echo "Starting CST-150 Checker Orchestrator..."

# Ensure mounted directories are writable
chmod -R 777 /app/uploads /app/projects 2>/dev/null || true

# Cleanup function for graceful shutdown
cleanup() {
    echo "Shutting down..."
    # Kill any session containers we spawned
    docker ps -q --filter "name=session-" | xargs -r docker kill 2>/dev/null || true
    docker ps -aq --filter "name=session-" | xargs -r docker rm -f 2>/dev/null || true
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

# Build the session runner image
echo "Building session runner image..."
if docker build -t cst150-session-runner:latest /app/session-runner 2>&1; then
    echo "Session runner image built successfully"
else
    echo "ERROR: Failed to build session runner image. Sessions will not work!"
    # Continue anyway - might be a cached image available
fi

echo "Container ready!"
echo "API server starting on port 3000..."
echo "Session VNC ports: 6081, 6082, 6083"

# Start the Bun server
cd /app
bun run src/server.ts &
BUN_PID=$!

# Wait for bun to exit (or signal)
wait $BUN_PID
