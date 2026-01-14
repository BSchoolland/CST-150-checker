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
    websockify \
    unzip \
    ca-certificates \
    openbox \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Install latest noVNC from GitHub (apt version is outdated 1.2.0)
RUN apt-get update && apt-get install -y git && \
    git clone --depth 1 --branch v1.6.0 https://github.com/novnc/noVNC.git /usr/share/novnc && \
    ln -s /usr/share/novnc/vnc.html /usr/share/novnc/index.html && \
    apt-get remove -y git && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

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

# Create non-root user
RUN groupadd -g 1000 student && \
    useradd -u 1000 -g student -m -s /bin/bash student

# Setup Wine prefix directory (will be mounted read-only at runtime)
ENV WINEPREFIX=/home/student/.wine-dotnet
ENV WINEARCH=win64
ENV WINEDEBUG=-all

# Initialize a base Wine prefix for the student user
USER student
WORKDIR /home/student

# Initialize Wine prefix (give it more time on slower machines)
RUN timeout 300 wineboot --init && \
    wineserver --wait && \
    echo "Wine prefix initialized successfully"

# Install winetricks and corefonts for WinForms font support
USER root
RUN wget -q https://raw.githubusercontent.com/Winetricks/winetricks/master/src/winetricks -O /usr/local/bin/winetricks && \
    chmod +x /usr/local/bin/winetricks

USER student
RUN timeout 600 winetricks -q corefonts && \
    wineserver --wait && \
    echo "Winetricks corefonts installed successfully"

# Download and install .NET SDK and Desktop Runtime for Windows (in Wine)
USER root
RUN mkdir -p /home/student/.wine-dotnet/drive_c/dotnet /tmp/dotnet-setup && \
    # Fetch releases.json to get download URLs
    curl -sL -o /tmp/dotnet-setup/releases.json https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/8.0/releases.json && \
    # Extract SDK URL
    SDK_URL=$(grep -o '"url": *"[^"]*sdk[^"]*win-x64\.zip"' /tmp/dotnet-setup/releases.json | head -1 | sed 's/.*"url": *"\([^"]*\)".*/\1/') && \
    # Extract Desktop Runtime URL
    RUNTIME_URL=$(grep -o '"url": *"[^"]*windowsdesktop[^"]*win-x64\.zip"' /tmp/dotnet-setup/releases.json | head -1 | sed 's/.*"url": *"\([^"]*\)".*/\1/') && \
    # Download and extract SDK
    echo "Downloading .NET SDK from $SDK_URL" && \
    curl -L -o /tmp/dotnet-setup/sdk.zip "$SDK_URL" && \
    unzip -q -o /tmp/dotnet-setup/sdk.zip -d /home/student/.wine-dotnet/drive_c/dotnet && \
    # Download and extract Desktop Runtime
    echo "Downloading .NET Desktop Runtime from $RUNTIME_URL" && \
    curl -L -o /tmp/dotnet-setup/runtime.zip "$RUNTIME_URL" && \
    unzip -q -o /tmp/dotnet-setup/runtime.zip -d /home/student/.wine-dotnet/drive_c/dotnet && \
    # Fix ownership
    chown -R student:student /home/student/.wine-dotnet && \
    # Cleanup
    rm -rf /tmp/dotnet-setup

# Create project directory
RUN mkdir -p /project && chown student:student /project

# Create NuGet cache directory (will be tmpfs at runtime)
RUN mkdir -p /home/student/.nuget && chown student:student /home/student/.nuget

# Copy openbox config
COPY openbox-rc.xml /etc/openbox/rc.xml

# Copy entrypoint
COPY session-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER student
WORKDIR /project

ENV DISPLAY=:99

ENTRYPOINT ["/entrypoint.sh"]
