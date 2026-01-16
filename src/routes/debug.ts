/**
 * Debug API Routes - For testing and troubleshooting
 */

import { Hono } from "hono";
import { spawn } from "bun";
import { sessionManager } from "../session-manager";

const app = new Hono();

/**
 * Health check
 */
app.get("/health", (c) => {
  return c.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * Get all active sessions and queue info
 */
app.get("/sessions", (c) => {
  const sessions = sessionManager.getAllSessions();
  const queueInfo = sessionManager.getQueueInfo();
  
  return c.json({
    activeSessions: sessions.map((s) => ({
      id: s.id,
      status: s.status,
      vncPort: s.vncPort,
      containerName: s.containerName,
      containerId: s.containerId,
      projectName: s.projectName,
      createdAt: s.createdAt,
      lastHeartbeat: s.lastHeartbeat,
      selectedAssignmentPartId: s.selectedAssignmentPartId,
    })),
    queue: queueInfo,
    stats: {
      activeCount: sessions.length,
      queueLength: queueInfo.length,
      maxSessions: 3,
    },
  });
});

/**
 * Get review state for all sessions
 */
app.get("/review", (c) => {
  const sessions = sessionManager.getAllSessions();
  const reviewStates = sessions.map((s) => ({
    sessionId: s.id,
    reviewState: s.reviewState,
  }));
  return c.json({ reviewStates });
});

/**
 * List all Docker containers (session and review)
 */
app.get("/containers", async (c) => {
  const proc = spawn({
    cmd: ["docker", "ps", "-a", "--filter", "name=session-", "--filter", "name=review-", "--format", "{{json .}}"],
    stdout: "pipe",
    stderr: "pipe",
  });
  
  const decoder = new TextDecoder();
  const reader = proc.stdout.getReader();
  let output = "";
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
  }
  
  await proc.exited;
  
  const containers = output.trim().split('\n').filter(Boolean).map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  });
  
  return c.json({ containers });
});

/**
 * List Docker volumes
 */
app.get("/volumes", async (c) => {
  const proc = spawn({
    cmd: ["docker", "volume", "ls", "--filter", "name=session-", "--format", "{{json .}}"],
    stdout: "pipe",
    stderr: "pipe",
  });
  
  const decoder = new TextDecoder();
  const reader = proc.stdout.getReader();
  let output = "";
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
  }
  
  await proc.exited;
  
  const volumes = output.trim().split('\n').filter(Boolean).map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  });
  
  return c.json({ volumes });
});

/**
 * Check if session-runner image exists
 */
app.get("/images", async (c) => {
  const proc = spawn({
    cmd: ["docker", "images", "--format", "{{json .}}"],
    stdout: "pipe",
    stderr: "pipe",
  });
  
  const decoder = new TextDecoder();
  const reader = proc.stdout.getReader();
  let output = "";
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
  }
  
  await proc.exited;
  
  const allImages = output.trim().split('\n').filter(Boolean).map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line };
    }
  });
  
  // Filter for our images
  const relevantImages = allImages.filter((img: any) => 
    img.Repository?.includes('cst150') || 
    img.Repository?.includes('session') ||
    img.Repository?.includes('review')
  );
  
  return c.json({ 
    images: relevantImages,
    hasSessionRunner: relevantImages.some((img: any) => img.Repository === 'cst150-session-runner'),
    hasReviewRunner: relevantImages.some((img: any) => img.Repository === 'cst150-review-runner'),
  });
});

/**
 * Test acquiring a session (doesn't start container)
 */
app.post("/test-acquire", (c) => {
  const result = sessionManager.acquireSession();
  return c.json(result);
});

/**
 * Force cleanup a specific session
 */
app.post("/cleanup/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  
  // Import cleanup function
  const { cleanupSessionContainer } = await import("../container-runner");
  
  await cleanupSessionContainer(sessionId);
  sessionManager.releaseSession(sessionId);
  
  return c.json({ success: true, sessionId });
});

/**
 * Force cleanup all sessions
 */
app.post("/cleanup-all", async (c) => {
  const { cleanupSessionContainer } = await import("../container-runner");
  
  const sessions = sessionManager.getAllSessions();
  const results: string[] = [];
  
  for (const session of sessions) {
    await cleanupSessionContainer(session.id);
    sessionManager.releaseSession(session.id);
    results.push(session.id);
  }
  
  // Also kill any orphaned containers
  const killProc = spawn({
    cmd: ["sh", "-c", "docker ps -q --filter 'name=session-' | xargs -r docker kill 2>/dev/null || true"],
    stdout: "ignore",
    stderr: "ignore",
  });
  await killProc.exited;
  
  const rmProc = spawn({
    cmd: ["sh", "-c", "docker ps -aq --filter 'name=session-' | xargs -r docker rm -f 2>/dev/null || true"],
    stdout: "ignore",
    stderr: "ignore",
  });
  await rmProc.exited;
  
  return c.json({ success: true, cleaned: results });
});

/**
 * Test Docker connectivity
 */
app.get("/docker-test", async (c) => {
  const tests: Record<string, any> = {};
  
  // Test docker version
  try {
    const versionProc = spawn({
      cmd: ["docker", "version", "--format", "{{json .}}"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = versionProc.stdout.getReader();
    let output = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += new TextDecoder().decode(value);
    }
    await versionProc.exited;
    tests.version = { success: versionProc.exitCode === 0, output: output.substring(0, 500) };
  } catch (e) {
    tests.version = { success: false, error: String(e) };
  }
  
  // Test docker ps
  try {
    const psProc = spawn({
      cmd: ["docker", "ps"],
      stdout: "pipe",
      stderr: "pipe",
    });
    await psProc.exited;
    tests.ps = { success: psProc.exitCode === 0 };
  } catch (e) {
    tests.ps = { success: false, error: String(e) };
  }
  
  // Test volume create/remove
  try {
    const testVolume = `test-${Date.now()}`;
    const createProc = spawn({
      cmd: ["docker", "volume", "create", testVolume],
      stdout: "pipe",
      stderr: "pipe",
    });
    await createProc.exited;
    
    const rmProc = spawn({
      cmd: ["docker", "volume", "rm", testVolume],
      stdout: "pipe",
      stderr: "pipe",
    });
    await rmProc.exited;
    
    tests.volume = { success: createProc.exitCode === 0 && rmProc.exitCode === 0 };
  } catch (e) {
    tests.volume = { success: false, error: String(e) };
  }
  
  return c.json(tests);
});

export default app;
