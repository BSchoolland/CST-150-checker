# Running Windows Forms Applications on Linux: POC & Architecture

## Executive Summary

This document details the technical findings from a proof-of-concept (POC) that successfully runs .NET 8 Windows Forms applications on Linux. It also outlines the architecture needed to extend this into a web-based service for building and running uploaded Windows Forms projects in sandboxed environments.

---

## Part 1: POC Technical Findings

### What Works

We successfully ran a .NET 8 Windows Forms application (Inventory Management) on Ubuntu Linux using:
- **Wine 10.0** for Windows API emulation
- **Native Linux .NET SDK** for cross-compilation
- **Wine-hosted .NET Desktop Runtime** for execution

### Critical Requirements

#### 1. Wine Version 8.0+

**Requirement:** Wine 8.0 or newer is mandatory for .NET 8 applications.

**Why:** Older Wine versions (6.x from Ubuntu repos) crash with `page fault` errors in CoreCLR due to missing Windows API implementations.

**Installation (Ubuntu/Debian):**
```bash
# Remove old Wine
sudo apt remove --purge wine wine64 wine32 -y

# Add WineHQ repository
sudo mkdir -pm755 /etc/apt/keyrings
sudo wget -O /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key
sudo wget -NP /etc/apt/sources.list.d/ https://dl.winehq.org/wine-builds/ubuntu/dists/$(lsb_release -cs)/winehq-$(lsb_release -cs).sources

# Install
sudo apt update
sudo apt install -y --install-recommends winehq-stable
```

#### 2. Native Linux .NET SDK for Building

**Problem Discovered:** Running `dotnet build` through Wine crashes due to console I/O incompatibilities. The .NET CLI's `System.Console` module crashes Wine with exception `0xe0434352`.

**Solution:** Use the native Linux .NET SDK to cross-compile for Windows, then only use Wine to run the compiled executable.

**Installation:**
```bash
wget -qO- https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0
export PATH="$HOME/.dotnet:$PATH"
```

#### 3. Cross-Compilation Settings

**Required MSBuild property:**
```bash
-p:EnableWindowsTargeting=true
```

This enables building Windows-targeted applications on non-Windows hosts.

**Build command:**
```bash
dotnet build MyProject.csproj \
    --configuration Release \
    --runtime win-x64 \
    --self-contained true \
    -p:EnableWindowsTargeting=true
```

**Important:** Use `.csproj` directly, not `.sln`. Building solutions with `--runtime` fails with `NETSDK1134`.

#### 4. Wine Prefix with .NET Desktop Runtime

For running the compiled application, Wine needs the Windows .NET Desktop Runtime (includes Windows Forms support).

**Setup:**
```bash
export WINEPREFIX="$HOME/.wine-dotnet"

# Download portable runtime (not installer - avoids MSI issues)
# URLs fetched from: https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/8.0/releases.json

# Extract to Wine's C: drive
unzip dotnet-sdk-*.zip -d "$WINEPREFIX/drive_c/dotnet"
unzip windowsdesktop-runtime-*.zip -d "$WINEPREFIX/drive_c/dotnet"
```

#### 5. Running the Application

```bash
export WINEPREFIX="$HOME/.wine-dotnet"
export WINEDEBUG=-all  # Suppress Wine debug output

cd /path/to/bin/Release/net8.0-windows/win-x64
wine "Inventory Management.exe"
```

### Architecture Diagram (Current POC)

```
┌─────────────────────────────────────────────────────────────┐
│                        Linux Host                           │
│                                                             │
│  ┌─────────────────┐      ┌─────────────────────────────┐  │
│  │ Native .NET SDK │      │      Wine Environment       │  │
│  │    (Linux)      │      │     (WINEPREFIX)            │  │
│  │                 │      │                             │  │
│  │  dotnet build   │      │  ┌─────────────────────┐   │  │
│  │  --runtime      │      │  │ .NET Desktop Runtime│   │  │
│  │  win-x64        │─────▶│  │   (Windows x64)     │   │  │
│  │                 │ .exe │  └─────────────────────┘   │  │
│  └─────────────────┘      │           │               │  │
│                           │           ▼               │  │
│                           │  ┌─────────────────────┐   │  │
│                           │  │   WinForms App      │   │  │
│                           │  │   (Running)         │   │  │
│                           │  └─────────────────────┘   │  │
│                           └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### File Structure

```
~/.wine-dotnet/                    # Isolated Wine prefix
├── drive_c/
│   ├── dotnet/                    # .NET Runtime
│   │   ├── dotnet.exe
│   │   ├── shared/
│   │   │   ├── Microsoft.NETCore.App/
│   │   │   └── Microsoft.WindowsDesktop.App/  # WinForms/WPF
│   │   └── ...
│   └── windows/
└── ...

project/
├── bin/Release/net8.0-windows/win-x64/
│   ├── MyApp.exe                  # Cross-compiled executable
│   ├── MyApp.dll
│   └── ...                        # Dependencies
└── ...
```

---

## Part 2: Web Application Architecture

### Vision

A simple web service where users can:
1. Upload a zipped Windows Forms project
2. Have it automatically built
3. Access the running application through their browser

**Simplification:** Only one build/session runs at a time. No need for complex orchestration.

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            Linux Server                                   │
│                                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────────────────┐ │
│  │   Frontend   │    │   Backend    │    │    Sandbox Container       │ │
│  │   (Simple    │◄──▶│   (Node/     │◄──▶│    (Single Instance)       │ │
│  │    HTML/JS)  │    │    Python)   │    │                            │ │
│  │              │    │              │    │  ┌──────────────────────┐  │ │
│  │  - Upload    │    │  - Upload    │    │  │ Wine + .NET          │  │ │
│  │  - VNC View  │    │  - Build     │    │  │ + Xvfb + VNC         │  │ │
│  │  - Status    │    │  - Run/Stop  │    │  │ + WinForms App       │  │ │
│  │              │    │              │    │  └──────────────────────┘  │ │
│  └──────────────┘    └──────────────┘    └────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. Frontend

**Technology options:** React, Vue, Svelte, or vanilla JS

**Features needed:**
- File upload (zip) with drag-and-drop
- Build status/progress display
- Embedded VNC viewer (noVNC) for app interaction
- Session management (start, stop, restart)
- Build logs viewer

**Key library:** [noVNC](https://novnc.com/) - HTML5 VNC client for in-browser display

#### 2. Backend API

**Technology options:** Node.js (Express), Python (FastAPI/Flask), or Go

**Endpoints (simplified for single-session):**
```
POST /api/upload               - Upload zip file, returns project info
GET  /api/status               - Get current build/run status
POST /api/build                - Build the current project
POST /api/run                  - Start the application
POST /api/stop                 - Stop the running application
GET  /api/vnc                  - WebSocket proxy to VNC
```

**Responsibilities:**
- File validation and extraction
- Invoke build script
- Start/stop the sandbox container
- WebSocket proxying for VNC

#### 3. Sandbox Container

**Base:** Docker container with:
- Wine 10+ (or latest stable)
- .NET SDK 8.0 (native Linux)
- .NET Desktop Runtime (in Wine prefix)
- Xvfb (virtual framebuffer)
- x11vnc (VNC server)
- noVNC (optional, or proxy from host)

**Dockerfile outline:**
```dockerfile
FROM ubuntu:24.04

# Install Wine (from WineHQ repo)
RUN dpkg --add-architecture i386 && \
    mkdir -pm755 /etc/apt/keyrings && \
    wget -O /etc/apt/keyrings/winehq-archive.key https://dl.winehq.org/wine-builds/winehq.key && \
    wget -NP /etc/apt/sources.list.d/ https://dl.winehq.org/wine-builds/ubuntu/dists/noble/winehq-noble.sources && \
    apt update && \
    apt install -y --install-recommends winehq-stable

# Install display/VNC
RUN apt install -y xvfb x11vnc novnc websockify

# Install .NET SDK
RUN wget -qO- https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0 --install-dir /opt/dotnet
ENV PATH="/opt/dotnet:$PATH"

# Pre-setup Wine prefix with .NET Desktop Runtime
ENV WINEPREFIX=/opt/wine-dotnet
RUN wineboot --init && \
    # Download and extract .NET Desktop Runtime...

COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

**Entrypoint script responsibilities:**
1. Start Xvfb (virtual display)
2. Start x11vnc (VNC server)
3. Start websockify (WebSocket to VNC proxy)
4. Extract uploaded project
5. Run build
6. Launch application via Wine
7. Keep alive until terminated

#### 4. Display Pipeline

```
┌─────────────┐    ┌─────────┐    ┌───────────┐    ┌──────────────┐    ┌─────────┐
│  WinForms   │───▶│  Xvfb   │───▶│  x11vnc   │───▶│  websockify  │───▶│  noVNC  │
│    App      │    │ :99     │    │  :5900    │    │  :6080 (WS)  │    │ Browser │
└─────────────┘    └─────────┘    └───────────┘    └──────────────┘    └─────────┘
     Wine         Virtual         VNC Server      WebSocket Proxy    HTML5 Client
                  Display
```

### Security Considerations

#### Container Isolation

```yaml
# docker-compose security settings
services:
  sandbox:
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - SYS_CHROOT  # May be needed for Wine
    read_only: true
    tmpfs:
      - /tmp
      - /run
    mem_limit: 2g
    cpus: 2.0
    pids_limit: 100
```

#### Network Isolation

- Container has no internet access (internal network only)
- Only VNC port exposed to backend
- Backend proxies all VNC traffic to frontend

#### Filesystem Isolation

- Read-only root filesystem
- Tmpfs for runtime data
- Volume mount only for uploaded project files
- No access to host filesystem

#### Resource Limits

- Memory: 2GB
- CPU: 2 cores
- Disk: Limited upload size (e.g., 50MB)
- Time: Auto-terminate after 30 min inactivity

#### Input Validation

- Validate zip files before extraction
- Limit project size
- Whitelist allowed file types

### State Management (No Database Required)

Since only one session runs at a time, state can be managed in memory or a simple JSON file:

```json
{
  "current_project": {
    "name": "InventoryApp",
    "status": "running",
    "uploaded_at": "2024-01-15T10:30:00Z",
    "zip_path": "/data/uploads/project.zip",
    "build_path": "/data/builds/current",
    "error_message": null
  }
}
```

**Status values:** `idle` → `uploaded` → `building` → `ready` → `running` → `idle`

### API Flow Example

```
User                    Frontend                Backend                 Sandbox
 │                         │                       │                       │
 │  1. Upload zip          │                       │                       │
 │────────────────────────▶│  2. POST /upload      │                       │
 │                         │──────────────────────▶│  3. Store & extract   │
 │                         │◀──────────────────────│                       │
 │  4. Click "Build"       │                       │                       │
 │────────────────────────▶│  5. POST /build       │                       │
 │                         │──────────────────────▶│  6. dotnet build      │
 │  7. Poll GET /status    │                       │──────────────────────▶│
 │◀────────────────────────│◀──────────────────────│◀──────────────────────│
 │                         │                       │                       │
 │  8. Click "Run"         │                       │                       │
 │────────────────────────▶│  9. POST /run         │                       │
 │                         │──────────────────────▶│  10. wine app.exe     │
 │                         │◀──────────────────────│──────────────────────▶│
 │                         │                       │                       │
 │  11. noVNC connects     │                       │                       │
 │◀════════════════════════════════════(WebSocket VNC)════════════════════▶│
```

### Changes Needed to Current POC

| Current POC | Web Service Version |
|-------------|---------------------|
| Manual Wine install | Pre-built Docker image with Wine |
| Local .NET SDK | .NET SDK baked into container |
| Local file paths | Volume-mounted project directory |
| Direct Wine execution | Xvfb + Wine for headless display |
| Terminal output | VNC stream to browser |
| Bash script | HTTP API wrapping the script |
| Manual cleanup | Stop button / auto-timeout |

### Implementation Phases

#### Phase 1: Docker Container
- [ ] Create Docker image with Wine + .NET + Xvfb + VNC
- [ ] Adapt `run-winforms.sh` for container environment
- [ ] Test headless build and run inside container

#### Phase 2: Backend API
- [ ] Simple HTTP server (Express/FastAPI)
- [ ] Upload endpoint with zip extraction
- [ ] Build/run/stop endpoints calling the script
- [ ] WebSocket proxy for VNC

#### Phase 3: Frontend
- [ ] Single-page upload form
- [ ] Status display (idle/building/ready/running)
- [ ] Embedded noVNC viewer
- [ ] Stop button

#### Phase 4: Polish
- [ ] Input validation (file size, zip contents)
- [ ] Error handling and display
- [ ] Auto-timeout for idle sessions
- [ ] Basic logging

---

## Appendix A: Key Files from POC

### run-winforms.sh (Simplified for Reference)

```bash
#!/bin/bash
# Key operations:

# 1. Check Wine version >= 8
wine_ver=$(wine --version | grep -oE '[0-9]+' | head -1)
[ "$wine_ver" -lt 8 ] && echo "Need Wine 8+" && exit 1

# 2. Setup Wine prefix with .NET Runtime
export WINEPREFIX="$HOME/.wine-dotnet"
# Download from releases.json and extract...

# 3. Build with native dotnet
dotnet build MyProject.csproj \
    --configuration Release \
    --runtime win-x64 \
    --self-contained true \
    -p:EnableWindowsTargeting=true

# 4. Run with Wine
cd bin/Release/net8.0-windows/win-x64
wine MyApp.exe
```

### Environment Variables

```bash
# Required
WINEPREFIX=/path/to/wine/prefix
WINEDEBUG=-all                    # Suppress debug output

# Recommended
DOTNET_CLI_TELEMETRY_OPTOUT=1
DOTNET_NOLOGO=1

# For headless (container)
DISPLAY=:99                       # Xvfb display
```

## Appendix B: Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Wine crashes on dotnet build | Console I/O incompatibility | Use native Linux .NET SDK |
| NETSDK1100 error | Windows targeting disabled | Add `-p:EnableWindowsTargeting=true` |
| NETSDK1134 error | Building .sln with --runtime | Use .csproj instead |
| Page fault in coreclr | Wine version too old | Upgrade to Wine 8+ |
| App runs but no display | No X server | Use Xvfb for headless |

---

## Conclusion

The POC demonstrates that running .NET 8 Windows Forms applications on Linux is viable using Wine 10+ with a hybrid build approach (native build, Wine execution). The key insight is that Wine's console subsystem isn't compatible with .NET's CLI tools, but the GUI subsystem works well for running compiled applications.

For the web service vision (single-session), the main additions are:
1. **Containerization** - Docker with pre-configured Wine + .NET
2. **Virtual display** - Xvfb + x11vnc for headless operation
3. **Browser access** - noVNC/websockify for in-browser interaction
4. **Simple API** - HTTP endpoints wrapping the existing build/run script

The single-session constraint keeps the architecture simple: no database, no job queues, no container orchestration. Just a Docker container, a small API server, and a web page.
