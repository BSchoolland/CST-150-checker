FROM ubuntu:22.04

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install minimal dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ca-certificates \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Bun (needed for opencode plugins)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Install opencode
RUN curl -fsSL https://opencode.ai/install | bash
ENV PATH="/root/.opencode/bin:$PATH"

# Create non-root user
RUN groupadd -g 1000 reviewer && \
    useradd -u 1000 -g reviewer -m -s /bin/bash reviewer

# Create directories
RUN mkdir -p /app/opencode-config /app/opencode-plugin /app/review-output /app/project \
    /home/reviewer/.opencode /home/reviewer/.bun \
    /tmp/opencode-data /tmp/opencode-state /tmp/opencode-cache && \
    chown -R reviewer:reviewer /app /home/reviewer /tmp/opencode-data /tmp/opencode-state /tmp/opencode-cache

# Copy opencode binary to a location accessible by non-root user
RUN cp -r /root/.opencode/* /home/reviewer/.opencode/ && \
    chown -R reviewer:reviewer /home/reviewer/.opencode

# Set environment for opencode
ENV XDG_CONFIG_HOME=/app/opencode-config
ENV XDG_DATA_HOME=/tmp/opencode-data
ENV XDG_STATE_HOME=/tmp/opencode-state
ENV XDG_CACHE_HOME=/tmp/opencode-cache
ENV REVIEW_OUTPUT_PATH=/app/review-output/review.json
ENV HOME=/home/reviewer
ENV PATH="/home/reviewer/.opencode/bin:/home/reviewer/.bun/bin:$PATH"

# Copy bun to reviewer user
RUN cp -r /root/.bun/* /home/reviewer/.bun/ && \
    chown -R reviewer:reviewer /home/reviewer/.bun

# Copy opencode config (agent definitions, etc) and plugin
COPY opencode-config/opencode/ /app/opencode-config/opencode/
COPY opencode-plugin/ /app/opencode-plugin/
RUN chown -R reviewer:reviewer /app/opencode-config /app/opencode-plugin

# Install opencode config and plugin dependencies
WORKDIR /app/opencode-config/opencode
RUN bun install
WORKDIR /app/opencode-plugin
RUN bun install
WORKDIR /app

# Switch to non-root user
USER reviewer
WORKDIR /app/project

# Default command - will be overridden
CMD ["opencode", "--help"]

