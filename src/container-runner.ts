/**
 * Container Runner - Manages Docker container lifecycle for session sandboxes
 * 
 * Handles spawning, monitoring, and cleanup of session containers.
 * All student code (build + run) executes inside these isolated containers.
 */

import { spawn, type Subprocess } from "bun";
import { sessionManager, type Session } from "./session-manager";

const SESSION_CONTAINER_IMAGE = "cst150-session-runner:latest";
const CONTAINER_READY_TIMEOUT_MS = 60 * 1000; // 60 seconds to start

// Track running Wine processes per session
const runningProcesses: Map<string, { containerName: string }> = new Map();

/**
 * Spawn a new session container for the given session
 */
export async function spawnSessionContainer(session: Session): Promise<void> {
  const volumeName = `session-${session.id}`;
  
  sessionManager.updateSession(session.id, { status: 'starting' });
  
  try {
    // Create per-session Docker volume for project files
    const volumeProc = spawn({
      cmd: ["docker", "volume", "create", volumeName],
      stdout: "pipe",
      stderr: "pipe",
    });
    await volumeProc.exited;
    
    if (volumeProc.exitCode !== 0) {
      throw new Error(`Failed to create volume: ${volumeName}`);
    }
    
    // Spawn the session container with security hardening
    const proc = spawn({
      cmd: [
        "docker", "run", "-d",
        "--name", session.containerName,
        
        // Resource limits
        "--memory", "2g",
        "--memory-swap", "2g",
        "--cpus", "2",
        "--pids-limit", "256",
        "--ulimit", "nofile=4096:4096",
        
        // Security hardening
        "--security-opt", "no-new-privileges:true",
        "--cap-drop", "ALL",
        "--cap-add", "SYS_CHROOT",  // Needed for Wine
        "--read-only",  // Root filesystem read-only
        
        // Network access allowed (simplifies NuGet restore)
        "--network", "bridge",
        
        // Run as non-root
        "--user", "1000:1000",
        
        // Writable areas (tmpfs)
        "--tmpfs", "/tmp:size=512m,mode=1777",
        "--tmpfs", "/home/student/.nuget:size=256m,mode=755",
        
        // Mount project volume
        "-v", `${volumeName}:/project:rw`,
        
        // Expose VNC
        "-p", `${session.vncPort}:6080`,
        
        // Image
        SESSION_CONTAINER_IMAGE,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    
    const stdoutReader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    
    while (true) {
      const { done, value } = await stdoutReader.read();
      if (done) break;
      output += decoder.decode(value);
    }
    
    await proc.exited;
    
    if (proc.exitCode !== 0) {
      const stderrReader = proc.stderr.getReader();
      let stderr = "";
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        stderr += decoder.decode(value);
      }
      throw new Error(`Failed to start container: ${stderr}`);
    }
    
    session.containerId = output.trim();
    
    // Wait for container to be ready
    await waitForContainerReady(session);
    
    sessionManager.updateSession(session.id, { 
      status: 'ready',
      containerId: session.containerId,
    });
    
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    sessionManager.updateSession(session.id, {
      status: 'error',
      errorMessage: `Container startup failed: ${message}`,
    });
    
    // Clean up on failure
    await cleanupSessionContainer(session.id);
    throw error;
  }
}

/**
 * Wait for the container to signal it's ready (SESSION_READY in logs)
 */
async function waitForContainerReady(session: Session): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < CONTAINER_READY_TIMEOUT_MS) {
    const logsProc = spawn({
      cmd: ["docker", "logs", session.containerName],
      stdout: "pipe",
      stderr: "pipe",
    });
    
    const reader = logsProc.stdout.getReader();
    const decoder = new TextDecoder();
    let logs = "";
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      logs += decoder.decode(value);
    }
    
    await logsProc.exited;
    
    if (logs.includes("SESSION_READY")) {
      return;
    }
    
    // Wait a bit before checking again
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  throw new Error("Container failed to become ready within timeout");
}

/**
 * Copy project files to the session container's volume
 */
export async function copyProjectToSession(
  sessionId: string, 
  sourcePath: string
): Promise<void> {
  const volumeName = `session-${sessionId}`;
  
  // Copy files to volume using a temporary container
  const copyProc = spawn({
    cmd: [
      "docker", "run", "--rm",
      "-v", `${volumeName}:/dest`,
      "-v", `${sourcePath}:/src:ro`,
      "alpine",
      "sh", "-c", "cp -r /src/. /dest/ && chown -R 1000:1000 /dest"
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  
  await copyProc.exited;
  
  if (copyProc.exitCode !== 0) {
    const decoder = new TextDecoder();
    const stderrReader = copyProc.stderr.getReader();
    let stderr = "";
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      stderr += decoder.decode(value);
    }
    throw new Error(`Failed to copy project files: ${stderr}`);
  }
}

/**
 * Execute dotnet build inside the session container
 */
export async function runBuildInContainer(
  session: Session,
  csprojPath: string
): Promise<boolean> {
  sessionManager.updateSession(session.id, { 
    status: 'building',
    buildOutput: '',
    csprojPath,
  });
  
  sessionManager.emitBuildOutput(session.id, "Starting build...\n");
  
  // Convert absolute path to container-relative path
  // The csprojPath is like /app/projects/... but in container it's /project/...
  const containerCsprojPath = csprojPath.replace(/^.*\/projects\//, '/project/');
  
  const buildProc = spawn({
    cmd: [
      "docker", "exec",
      session.containerName,
      "dotnet", "build", containerCsprojPath,
      "--configuration", "Release",
      "--runtime", "win-x64",
      "--self-contained", "true",
      "-p:EnableWindowsTargeting=true",
      "-p:PublishSingleFile=false",
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  
  const decoder = new TextDecoder();
  
  // Stream stdout
  const stdoutReader = buildProc.stdout.getReader();
  (async () => {
    while (true) {
      const { done, value } = await stdoutReader.read();
      if (done) break;
      sessionManager.emitBuildOutput(session.id, decoder.decode(value));
    }
  })();
  
  // Stream stderr
  const stderrReader = buildProc.stderr.getReader();
  (async () => {
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      sessionManager.emitBuildOutput(session.id, decoder.decode(value));
    }
  })();
  
  await buildProc.exited;
  
  if (buildProc.exitCode !== 0) {
    sessionManager.updateSession(session.id, {
      status: 'error',
      errorMessage: 'Build failed',
    });
    return false;
  }
  
  sessionManager.emitBuildOutput(session.id, "\nBuild completed successfully!\n");
  sessionManager.updateSession(session.id, { status: 'built' });
  return true;
}

/**
 * Find the built executable path in the container
 */
export async function findExecutableInContainer(
  session: Session,
  projectName: string
): Promise<string | null> {
  const searchPaths = [
    `/project/bin/Release/net8.0-windows/win-x64/${projectName}.exe`,
    `/project/bin/Release/net8.0-windows/${projectName}.exe`,
    `/project/bin/Release/net7.0-windows/win-x64/${projectName}.exe`,
    `/project/bin/Release/net6.0-windows/win-x64/${projectName}.exe`,
  ];
  
  for (const exePath of searchPaths) {
    const checkProc = spawn({
      cmd: ["docker", "exec", session.containerName, "test", "-f", exePath],
      stdout: "ignore",
      stderr: "ignore",
    });
    await checkProc.exited;
    
    if (checkProc.exitCode === 0) {
      return exePath;
    }
  }
  
  // Try to find any .exe in the expected directory
  const findProc = spawn({
    cmd: [
      "docker", "exec", session.containerName,
      "find", "/project/bin/Release", "-name", "*.exe", "-type", "f"
    ],
    stdout: "pipe",
    stderr: "ignore",
  });
  
  const decoder = new TextDecoder();
  const reader = findProc.stdout.getReader();
  let output = "";
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
  }
  
  await findProc.exited;
  
  const exeFiles = output.trim().split('\n').filter(f => f.endsWith('.exe'));
  if (exeFiles.length > 0) {
    return exeFiles[0];
  }
  
  return null;
}

/**
 * Run the application with Wine inside the session container
 */
export async function runAppInContainer(
  session: Session,
  exePath: string
): Promise<void> {
  sessionManager.updateSession(session.id, { 
    status: 'running',
    runOutput: '',
    exePath,
  });
  
  sessionManager.emitRunOutput(session.id, "Starting application...\n");
  
  const exeDir = exePath.substring(0, exePath.lastIndexOf('/'));
  const exeName = exePath.substring(exePath.lastIndexOf('/') + 1);
  
  // Copy build output to /tmp inside container (Wine has issues with 9p/drvfs)
  const copyProc = spawn({
    cmd: [
      "docker", "exec", session.containerName,
      "sh", "-c", `rm -rf /tmp/wine-run && cp -r "${exeDir}" /tmp/wine-run`
    ],
    stdout: "ignore",
    stderr: "ignore",
  });
  await copyProc.exited;
  
  // Run with Wine in detached mode
  const runProc = spawn({
    cmd: [
      "docker", "exec", "-d",
      session.containerName,
      "wine", `/tmp/wine-run/${exeName}`
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  
  await runProc.exited;
  
  if (runProc.exitCode !== 0) {
    const decoder = new TextDecoder();
    const stderrReader = runProc.stderr.getReader();
    let stderr = "";
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      stderr += decoder.decode(value);
    }
    sessionManager.emitRunOutput(session.id, `Failed to start: ${stderr}\n`);
    sessionManager.updateSession(session.id, {
      status: 'error',
      errorMessage: 'Failed to start application',
    });
    return;
  }
  
  // Track the running process
  runningProcesses.set(session.id, { containerName: session.containerName });
  sessionManager.emitRunOutput(session.id, "Application started\n");
}

/**
 * Stop the running application in a session container
 */
export async function stopAppInContainer(sessionId: string): Promise<void> {
  const processInfo = runningProcesses.get(sessionId);
  if (!processInfo) return;
  
  // Kill Wine processes in the container
  spawn({
    cmd: ["docker", "exec", processInfo.containerName, "pkill", "-f", "wine"],
    stdout: "ignore",
    stderr: "ignore",
  });
  
  runningProcesses.delete(sessionId);
  
  const session = sessionManager.getSession(sessionId);
  if (session) {
    sessionManager.emitRunOutput(sessionId, "\nApplication stopped\n");
    sessionManager.updateSession(sessionId, { status: 'built' });
  }
}

/**
 * Clean up a session container and its volume
 */
export async function cleanupSessionContainer(sessionId: string): Promise<void> {
  const session = sessionManager.getSession(sessionId);
  const containerName = session?.containerName || `session-${sessionId.slice(0, 8)}`;
  const volumeName = `session-${sessionId}`;
  
  // Stop any running process
  runningProcesses.delete(sessionId);
  
  // Kill and remove the container
  try {
    await spawn({
      cmd: ["docker", "kill", containerName],
      stdout: "ignore",
      stderr: "ignore",
    }).exited;
  } catch {
    // Container might not exist
  }
  
  try {
    await spawn({
      cmd: ["docker", "rm", "-f", containerName],
      stdout: "ignore",
      stderr: "ignore",
    }).exited;
  } catch {
    // Container might not exist
  }
  
  // Remove the volume
  try {
    await spawn({
      cmd: ["docker", "volume", "rm", "-f", volumeName],
      stdout: "ignore",
      stderr: "ignore",
    }).exited;
  } catch {
    // Volume might not exist
  }
  
  console.log(`Cleaned up session container: ${containerName}`);
}

/**
 * Build the session runner image if needed
 */
export async function ensureSessionRunnerImage(): Promise<void> {
  console.log("Building session runner image...");
  
  const buildProc = spawn({
    cmd: ["docker", "build", "-t", SESSION_CONTAINER_IMAGE, "/app/session-runner"],
    stdout: "pipe",
    stderr: "pipe",
  });
  
  await buildProc.exited;
  
  if (buildProc.exitCode !== 0) {
    console.warn("Warning: Failed to build session runner image. Sessions will not work.");
  } else {
    console.log("Session runner image built successfully");
  }
}

/**
 * Start the cleanup interval to kill timed-out sessions
 */
export function startCleanupInterval(): void {
  setInterval(async () => {
    const timedOut = sessionManager.findTimedOutSessions();
    
    for (const sessionId of timedOut) {
      console.log(`Session ${sessionId} timed out, cleaning up...`);
      await cleanupSessionContainer(sessionId);
      sessionManager.releaseSession(sessionId);
    }
  }, 30_000); // Check every 30 seconds
}
