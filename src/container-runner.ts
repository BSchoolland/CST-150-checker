/**
 * Container Runner - Manages Docker container lifecycle for session sandboxes
 * 
 * Handles spawning, monitoring, and cleanup of session containers.
 * All student code (build + run) executes inside these isolated containers.
 */

import { spawn, type Subprocess } from "bun";
import { resolve } from "path";
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
    
    // Spawn the session container (security hardening disabled for now)
    const proc = spawn({
      cmd: [
        "docker", "run", "-d",
        "--name", session.containerName,

        // Resource limits
        "--memory", "2g",
        "--cpus", "2",

        // Network access allowed (for NuGet restore)
        "--network", "bridge",

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

  // Convert container path to host path for Docker bind mount
  // Container path: /app/projects/... -> Host path: $HOST_PROJECT_DIR/...
  const containerProjectsDir = "/app/projects";
  const hostProjectsDir = process.env.HOST_PROJECT_DIR || containerProjectsDir;

  let hostSourcePath: string;
  const absoluteSourcePath = resolve(sourcePath);

  if (absoluteSourcePath.startsWith(containerProjectsDir)) {
    // Replace container path prefix with host path prefix
    hostSourcePath = absoluteSourcePath.replace(containerProjectsDir, hostProjectsDir);
  } else {
    // Fallback - assume path is already on host or relative
    hostSourcePath = absoluteSourcePath;
  }

  console.log(`Copying project from ${hostSourcePath} to volume ${volumeName}`);

  // Copy files to volume using a temporary container
  const copyProc = spawn({
    cmd: [
      "docker", "run", "--rm",
      "-v", `${volumeName}:/dest`,
      "-v", `${hostSourcePath}:/src:ro`,
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
  
  // The csproj file is copied to /project/ in the container
  // Since copyProjectToSession copies the parent directory of the csproj,
  // the csproj file ends up directly in /project/
  const csprojFilename = csprojPath.split('/').pop() || 'Project.csproj';
  const containerCsprojPath = `/project/${csprojFilename}`;

  console.log(`Build: csprojPath=${csprojPath} -> containerCsprojPath=${containerCsprojPath}`);
  
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
  
  // Run with Wine (not detached, so we can capture output)
  const runProc = spawn({
    cmd: [
      "docker", "exec",
      session.containerName,
      "wine", `/tmp/wine-run/${exeName}`
    ],
    stdout: "pipe",
    stderr: "pipe",
  });

  // Store process reference for later cleanup
  runningProcesses.set(session.id, { containerName: session.containerName });

  // Handle process exit asynchronously
  runProc.exited.then((exitCode) => {
    runningProcesses.delete(session.id);
    if (exitCode !== 0) {
      console.log(`Application exited with code ${exitCode} for session ${session.id}`);
    }
  });

  // Return immediately - app is running in background
  return;
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
  
  // Clean up project files from various directories
  await cleanupSessionProjectFiles(sessionId);
  
  console.log(`Cleaned up session container: ${containerName}`);
}

/**
 * Clean up project files for a session (extracted projects, review input/output)
 */
async function cleanupSessionProjectFiles(sessionId: string): Promise<void> {
  const pathsToClean = [
    `./projects/${sessionId}`,           // Extracted project files
    `./uploads/${sessionId}-*`,          // Uploaded zip files (pattern)
    `/app/review-input/${sessionId}`,    // Review input folder
    `/app/review-output/${sessionId}`,   // Review output folder
  ];
  
  for (const pathPattern of pathsToClean) {
    try {
      // Use shell for glob patterns
      if (pathPattern.includes('*')) {
        await spawn({
          cmd: ["sh", "-c", `rm -rf ${pathPattern} 2>/dev/null || true`],
          stdout: "ignore",
          stderr: "ignore",
        }).exited;
      } else {
        await spawn({
          cmd: ["rm", "-rf", pathPattern],
          stdout: "ignore",
          stderr: "ignore",
        }).exited;
      }
    } catch {
      // Ignore errors - files might not exist
    }
  }
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
 * Clean up any orphaned session containers from previous runs
 * This is called on server startup to ensure clean state
 */
export async function cleanupOrphanedContainers(): Promise<void> {
  console.log("Cleaning up orphaned session containers...");

  // Find all containers with names starting with "session-"
  const listProc = spawn({
    cmd: ["docker", "ps", "-a", "--filter", "name=session-", "--format", "{{.Names}}"],
    stdout: "pipe",
    stderr: "ignore",
  });

  const decoder = new TextDecoder();
  const reader = listProc.stdout.getReader();
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
  }

  await listProc.exited;

  const containerNames = output.trim().split('\n').filter(name => name.length > 0);

  if (containerNames.length === 0) {
    console.log("No orphaned session containers found");
    return;
  }

  console.log(`Found ${containerNames.length} orphaned session container(s): ${containerNames.join(', ')}`);

  // Kill and remove each container
  for (const name of containerNames) {
    try {
      await spawn({
        cmd: ["docker", "kill", name],
        stdout: "ignore",
        stderr: "ignore",
      }).exited;
    } catch {
      // Container might not be running
    }

    try {
      await spawn({
        cmd: ["docker", "rm", "-f", name],
        stdout: "ignore",
        stderr: "ignore",
      }).exited;
      console.log(`Removed orphaned container: ${name}`);
    } catch {
      // Container might already be removed
    }
  }

  // Also clean up orphaned volumes
  const volumeListProc = spawn({
    cmd: ["docker", "volume", "ls", "--filter", "name=session-", "--format", "{{.Name}}"],
    stdout: "pipe",
    stderr: "ignore",
  });

  const volumeReader = volumeListProc.stdout.getReader();
  let volumeOutput = "";

  while (true) {
    const { done, value } = await volumeReader.read();
    if (done) break;
    volumeOutput += decoder.decode(value);
  }

  await volumeListProc.exited;

  const volumeNames = volumeOutput.trim().split('\n').filter(name => name.length > 0);

  for (const volumeName of volumeNames) {
    try {
      await spawn({
        cmd: ["docker", "volume", "rm", "-f", volumeName],
        stdout: "ignore",
        stderr: "ignore",
      }).exited;
      console.log(`Removed orphaned volume: ${volumeName}`);
    } catch {
      // Volume might be in use
    }
  }

  console.log("Orphaned container cleanup complete");
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

/**
 * Clean up all sessions and project files on shutdown
 */
export async function cleanupAllSessions(): Promise<void> {
  console.log("Cleaning up all sessions on shutdown...");
  
  // Clean up all active sessions
  const sessions = sessionManager.getAllSessions();
  for (const session of sessions) {
    await cleanupSessionContainer(session.id);
    sessionManager.releaseSession(session.id);
  }
  
  // Clean up any orphaned containers/volumes that might have been missed
  await cleanupOrphanedContainers();
  
  // Clean up entire project directories to ensure nothing is left behind
  const directoriesToClean = [
    "./projects",
    "./uploads", 
    "/app/review-input",
    "/app/review-output",
  ];
  
  for (const dir of directoriesToClean) {
    try {
      // Remove all contents but keep the directory
      await spawn({
        cmd: ["sh", "-c", `rm -rf ${dir}/* ${dir}/.[!.]* 2>/dev/null || true`],
        stdout: "ignore",
        stderr: "ignore",
      }).exited;
      console.log(`Cleaned directory: ${dir}`);
    } catch {
      // Ignore errors
    }
  }
  
  console.log("All sessions and project files cleaned up");
}
