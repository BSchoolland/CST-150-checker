FROM ubuntu:22.04

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

# Install base dependencies (excluding novnc - we'll install latest from GitHub)
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    gnupg2 \
    software-properties-common \
    xvfb \
    x11vnc \
    websockify \
    unzip \
    supervisor \
    ca-certificates \
    git \
    openbox \
    && rm -rf /var/lib/apt/lists/*

# Install Docker CLI (for spawning sibling containers)
RUN curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg && \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu jammy stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && apt-get install -y docker-ce-cli && \
    rm -rf /var/lib/apt/lists/*

# Install latest noVNC from GitHub (apt version is outdated 1.2.0)
RUN git clone --depth 1 --branch v1.6.0 https://github.com/novnc/noVNC.git /usr/share/novnc && \
    ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Enable 32-bit architecture for Wine
RUN dpkg --add-architecture i386

# Add WineHQ repository (Ubuntu 22.04 = jammy)
RUN mkdir -pm755 /etc/apt/keyrings && \
    wget -O /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key && \
    wget -NP /etc/apt/sources.list.d/ https://dl.winehq.org/wine-builds/ubuntu/dists/jammy/winehq-jammy.sources

# Install Wine with font support for .NET WinForms
# Pin to Wine 10.0 - Wine 11.0 has compatibility issues with .NET 8 WinForms
RUN apt-get update && apt-get install -y --install-recommends \
    winehq-stable=10.0.0.0~jammy-1 \
    wine-stable=10.0.0.0~jammy-1 \
    wine-stable-amd64=10.0.0.0~jammy-1 \
    wine-stable-i386:i386=10.0.0.0~jammy-1 \
    fonts-liberation \
    fonts-dejavu \
    fontconfig \
    cabextract \
    && rm -rf /var/lib/apt/lists/*

# Install .NET SDK (native Linux version for building)
RUN wget -qO- https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0 --install-dir /opt/dotnet
ENV PATH="/opt/dotnet:$PATH"
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1
ENV DOTNET_NOLOGO=1

# Pre-cache common NuGet packages for faster runtime builds
# Create a minimal WinForms project and restore it so packages are baked into the image
RUN mkdir -p /tmp/nuget-warmup && \
    echo '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0-windows</TargetFramework><UseWindowsForms>true</UseWindowsForms></PropertyGroup></Project>' > /tmp/nuget-warmup/Template.csproj && \
    cd /tmp/nuget-warmup && \
    dotnet restore --runtime win-x64 -p:EnableWindowsTargeting=true && \
    cd / && rm -rf /tmp/nuget-warmup

# Setup Wine prefix and install .NET Desktop Runtime for Windows
ENV WINEPREFIX=/opt/wine-dotnet
ENV WINEARCH=win64
ENV WINEDEBUG=-all

# Initialize Wine prefix (give it more time on slower machines)
RUN timeout 300 wineboot --init && \
    wineserver --wait && \
    echo "Wine prefix initialized successfully"

# Install winetricks and corefonts for WinForms font support
RUN wget -q https://raw.githubusercontent.com/Winetricks/winetricks/master/src/winetricks -O /usr/local/bin/winetricks && \
    chmod +x /usr/local/bin/winetricks && \
    timeout 600 winetricks -q corefonts && \
    wineserver --wait && \
    echo "Winetricks corefonts installed successfully"

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

# Create working directories (writable by all for uploads/projects)
RUN mkdir -p /app/uploads /app/projects /app/logs /app/review-output /app/review-input && \
    chmod 777 /app/uploads /app/projects

# Install opencode (sandboxed code review agent)
# Using the official installer which downloads the latest binary
RUN curl -fsSL https://opencode.ai/install | bash
ENV PATH="/root/.opencode/bin:$PATH"

# Create isolated opencode directories (security: prevent access to system config)
RUN mkdir -p /app/opencode-data /app/opencode-state /app/opencode-cache
# XDG_CONFIG_HOME tells opencode to look for config in /app/opencode-config/opencode/
ENV XDG_CONFIG_HOME=/app/opencode-config
ENV XDG_DATA_HOME=/app/opencode-data
ENV XDG_STATE_HOME=/app/opencode-state
ENV XDG_CACHE_HOME=/app/opencode-cache
# Review output path for the plugin
ENV REVIEW_OUTPUT_PATH=/app/review-output/review.json

# Display environment
ENV DISPLAY=:99

# Copy application files
COPY package.json /app/
COPY src/ /app/src/
COPY public/ /app/public/
COPY openbox-rc.xml /app/openbox-rc.xml

# Create example-projects directory
RUN mkdir -p /app/example-projects

# Copy opencode plugin and configuration
COPY opencode-plugin/ /app/opencode-plugin/
COPY opencode-config/ /app/opencode-config/

# Copy review runner Dockerfile (built at runtime via docker.sock)
COPY review-runner/ /app/review-runner/

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

# Copy supervisor configuration
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Expose ports: 3000 for API, 5900 for VNC, 6080 for noVNC websocket
EXPOSE 3000 5900 6080

ENTRYPOINT ["/entrypoint.sh"]
