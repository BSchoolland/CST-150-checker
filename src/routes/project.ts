/**
 * Project API Routes - Handles upload, build, run operations within sessions
 */

import { Hono } from "hono";
import { mkdir, readdir, rm } from "fs/promises";
import { join, basename } from "path";
import { spawn } from "bun";
import { sessionManager } from "../session-manager";
import {
  spawnSessionContainer,
  copyProjectToSession,
  runBuildInContainer,
  findExecutableInContainer,
  runAppInContainer,
  stopAppInContainer,
} from "../container-runner";
import { runReview, resetReviewState } from "../review-runner";
import { getAssignmentPart } from "../db";

const app = new Hono();

const UPLOADS_DIR = "./uploads";
const PROJECTS_DIR = "./projects";

// Ensure directories exist
await mkdir(UPLOADS_DIR, { recursive: true });
await mkdir(PROJECTS_DIR, { recursive: true });

/**
 * Upload a project zip file for a session
 */
app.post("/:sessionId/upload", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = sessionManager.getSession(sessionId);
  
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  
  if (session.status !== "ready" && session.status !== "pending") {
    // Allow re-upload if container is ready
    if (session.status !== "built" && session.status !== "error") {
      return c.json({ error: `Cannot upload in ${session.status} state` }, 400);
    }
  }
  
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File;
    
    if (!file) {
      return c.json({ error: "No file uploaded" }, 400);
    }
    
    if (!file.name.endsWith(".zip")) {
      return c.json({ error: "File must be a .zip file" }, 400);
    }
    
    // Save the zip file
    const zipPath = join(UPLOADS_DIR, `${sessionId}-${file.name}`);
    const arrayBuffer = await file.arrayBuffer();
    await Bun.write(zipPath, arrayBuffer);
    
    // Create temp extraction directory
    const extractDir = join(PROJECTS_DIR, sessionId);
    await mkdir(extractDir, { recursive: true });
    
    // Clean previous contents
    const cleanProc = spawn({
      cmd: ["sh", "-c", `rm -rf ${extractDir}/* 2>/dev/null || true`],
      stdout: "ignore",
      stderr: "ignore",
    });
    await cleanProc.exited;
    
    // Extract the zip
    const unzipProc = spawn(["unzip", "-o", zipPath, "-d", extractDir]);
    await unzipProc.exited;
    
    if (unzipProc.exitCode !== 0) {
      sessionManager.updateSession(sessionId, {
        status: "error",
        errorMessage: "Failed to extract zip file",
      });
      return c.json({ error: "Failed to extract zip file" }, 500);
    }
    
    // Find the .csproj file
    const csprojPath = await findCsproj(extractDir);
    if (!csprojPath) {
      sessionManager.updateSession(sessionId, {
        status: "error",
        errorMessage: "No .csproj file found in the uploaded project",
      });
      return c.json({ error: "No .csproj file found" }, 400);
    }
    
    const projectDir = join(csprojPath, "..");
    const projectName = file.name.replace(".zip", "");
    
    // Start container if not already running
    if (!session.containerId) {
      await spawnSessionContainer(session);
    }
    
    // Copy project files to session container volume
    await copyProjectToSession(sessionId, projectDir);
    
    sessionManager.updateSession(sessionId, {
      status: "ready",
      projectName,
      csprojPath,
      buildOutput: "",
      runOutput: "",
      errorMessage: null,
    });
    
    // Reset review state
    resetReviewState();
    
    return c.json({ success: true, project: projectName });
    
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    sessionManager.updateSession(sessionId, {
      status: "error",
      errorMessage: message,
    });
    return c.json({ error: message }, 500);
  }
});

/**
 * Build the project in the session container
 */
app.post("/:sessionId/build", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = sessionManager.getSession(sessionId);
  
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  
  if (!session.csprojPath) {
    return c.json({ error: "No project uploaded" }, 400);
  }
  
  if (session.status === "building") {
    return c.json({ error: "Build already in progress" }, 400);
  }
  
  // Start build in background
  runBuildInContainer(session, session.csprojPath).then(async (success) => {
    if (success && session.projectName) {
      // Find the executable
      const exePath = await findExecutableInContainer(session, session.projectName);
      if (exePath) {
        sessionManager.updateSession(sessionId, { exePath });
      }
    }
  });
  
  // Start code review in parallel if assignment selected
  if (session.selectedAssignmentPartId && session.csprojPath) {
    const projectDir = join(session.csprojPath, "..");
    runReview(projectDir, session.selectedAssignmentPartId);
  }
  
  return c.json({ success: true, message: "Build started" });
});

/**
 * Run the built application in the session container
 */
app.post("/:sessionId/run", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = sessionManager.getSession(sessionId);
  
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  
  if (session.status !== "built") {
    return c.json({ error: "Project not built" }, 400);
  }
  
  if (!session.exePath) {
    // Try to find it
    if (session.projectName) {
      const exePath = await findExecutableInContainer(session, session.projectName);
      if (exePath) {
        sessionManager.updateSession(sessionId, { exePath });
        session.exePath = exePath;
      }
    }
    
    if (!session.exePath) {
      return c.json({ error: "Executable not found" }, 400);
    }
  }
  
  await runAppInContainer(session, session.exePath);
  
  return c.json({ success: true, message: "Application started" });
});

/**
 * Stop the running application
 */
app.post("/:sessionId/stop", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = sessionManager.getSession(sessionId);
  
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  
  await stopAppInContainer(sessionId);
  
  return c.json({ success: true });
});

/**
 * Select an assignment for the session
 */
app.post("/:sessionId/select-assignment", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = sessionManager.getSession(sessionId);
  
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  
  const body = await c.req.json();
  const partId = body.partId as number | null;
  
  if (partId !== null) {
    const part = getAssignmentPart(partId);
    if (!part) {
      return c.json({ error: "Assignment part not found" }, 404);
    }
  }
  
  sessionManager.updateSession(sessionId, {
    selectedAssignmentPartId: partId,
  });
  
  return c.json({ success: true, selectedPartId: partId });
});

/**
 * Reset the session state (keep container running)
 */
app.post("/:sessionId/reset", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = sessionManager.getSession(sessionId);
  
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  
  await stopAppInContainer(sessionId);
  
  sessionManager.updateSession(sessionId, {
    status: "ready",
    projectName: null,
    csprojPath: null,
    exePath: null,
    buildOutput: "",
    runOutput: "",
    errorMessage: null,
  });
  
  resetReviewState();
  
  return c.json({ success: true });
});

// Helper: Find .csproj file recursively
async function findCsproj(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".csproj")) {
      return fullPath;
    }
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      const found = await findCsproj(fullPath);
      if (found) return found;
    }
  }
  return null;
}

export default app;
