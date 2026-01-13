FROM ubuntu:22.04

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

# Install base dependencies
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    gnupg2 \
    software-properties-common \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    unzip \
    supervisor \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Enable 32-bit architecture for Wine
RUN dpkg --add-architecture i386

# Add WineHQ repository (Ubuntu 22.04 = jammy)
RUN mkdir -pm755 /etc/apt/keyrings && \
    wget -O /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key && \
    wget -NP /etc/apt/sources.list.d/ https://dl.winehq.org/wine-builds/ubuntu/dists/jammy/winehq-jammy.sources

# Install Wine
RUN apt-get update && apt-get install -y --install-recommends winehq-stable && \
    rm -rf /var/lib/apt/lists/*

# Install .NET SDK (native Linux version for building)
RUN wget -qO- https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0 --install-dir /opt/dotnet
ENV PATH="/opt/dotnet:$PATH"
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1
ENV DOTNET_NOLOGO=1

# Setup Wine prefix and install .NET Desktop Runtime for Windows
ENV WINEPREFIX=/opt/wine-dotnet
ENV WINEARCH=win64
ENV WINEDEBUG=-all

# Initialize Wine prefix
RUN wineboot --init && wineserver --wait || true

# Download and install .NET SDK and Desktop Runtime for Windows (in Wine)
RUN mkdir -p /opt/wine-dotnet/drive_c/dotnet /tmp/dotnet-setup && \
    # Fetch releases.json to get download URLs
    curl -sL -o /tmp/dotnet-setup/releases.json https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/8.0/releases.json && \
    # Extract SDK URL
    SDK_URL=$(grep -o '"url": *"[^"]*sdk[^"]*win-x64\.zip"' /tmp/dotnet-setup/releases.json | head -1 | sed 's/.*"url": *"\([^"]*\)".*/\1/') && \
    # Extract Desktop Runtime URL
    RUNTIME_URL=$(grep -o '"url": *"[^"]*windowsdesktop[^"]*win-x64\.zip"' /tmp/dotnet-setup/releases.json | head -1 | sed 's/.*"url": *"\([^"]*\)".*/\1/') && \
    # Download and extract SDK
    echo "Downloading .NET SDK from $SDK_URL" && \
    curl -L -o /tmp/dotnet-setup/sdk.zip "$SDK_URL" && \
    unzip -q -o /tmp/dotnet-setup/sdk.zip -d /opt/wine-dotnet/drive_c/dotnet && \
    # Download and extract Desktop Runtime
    echo "Downloading .NET Desktop Runtime from $RUNTIME_URL" && \
    curl -L -o /tmp/dotnet-setup/runtime.zip "$RUNTIME_URL" && \
    unzip -q -o /tmp/dotnet-setup/runtime.zip -d /opt/wine-dotnet/drive_c/dotnet && \
    # Cleanup
    rm -rf /tmp/dotnet-setup

# Create working directories
RUN mkdir -p /app/uploads /app/projects /app/logs

# Display environment
ENV DISPLAY=:99

# Copy application files
COPY package.json /app/
COPY src/ /app/src/
COPY public/ /app/public/

WORKDIR /app

# Install dependencies
RUN bun install

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Copy supervisor configuration
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Expose ports: 3000 for API, 5900 for VNC, 6080 for noVNC websocket
EXPOSE 3000 5900 6080

ENTRYPOINT ["/entrypoint.sh"]
