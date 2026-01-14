#!/bin/bash
set -e

echo "Building cst150-session-runner image..."
docker build -t cst150-session-runner:latest "$(dirname "$0")"
echo "Session runner image built successfully!"
