FROM ubuntu:22.04

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

# Install base dependencies - orchestrator only (no Wine/display needed)
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    unzip \
    ca-certificates \
    git \
    gnupg2 \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI (for spawning sibling containers)
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg && \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu jammy stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Create working directories (writable by all for uploads/projects)
RUN mkdir -p /app/uploads /app/projects /app/logs /app/review-output /app/review-input && \
    chmod 777 /app/uploads /app/projects

# Install opencode (sandboxed code review agent)
RUN curl -fsSL https://opencode.ai/install | bash
ENV PATH="/root/.opencode/bin:$PATH"

# Create isolated opencode directories
RUN mkdir -p /app/opencode-data /app/opencode-state /app/opencode-cache
ENV XDG_CONFIG_HOME=/app/opencode-config
ENV XDG_DATA_HOME=/app/opencode-data
ENV XDG_STATE_HOME=/app/opencode-state
ENV XDG_CACHE_HOME=/app/opencode-cache
ENV REVIEW_OUTPUT_PATH=/app/review-output/review.json

# Copy application files
COPY package.json /app/

# Copy and build frontend
COPY frontend/package.json frontend/package-lock.json* /app/frontend/
WORKDIR /app/frontend
RUN bun install

# Copy frontend source and build
COPY frontend/ /app/frontend/
RUN bun run build

# Create example-projects directory
RUN mkdir -p /app/example-projects

# Copy opencode plugin and configuration
COPY opencode-plugin/ /app/opencode-plugin/
COPY opencode-config/ /app/opencode-config/

# Copy review runner Dockerfile (built at runtime via docker.sock)
COPY review-runner/ /app/review-runner/

# Copy session runner Dockerfile (built at runtime via docker.sock)
COPY session-runner/ /app/session-runner/

# Copy source files
COPY src/ /app/src/

WORKDIR /app

# Install dependencies for main app
RUN bun install

# Install opencode plugin dependencies
WORKDIR /app/opencode-plugin
RUN bun install

WORKDIR /app

# Make config writable for review container (runs as uid 1000)
RUN chmod -R 777 /app/opencode-config

# Copy entrypoint script and fix Windows line endings
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

# Expose port 3000 for API (VNC ports exposed via session containers)
EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
