/**
 * Session API Routes - Handles session acquisition, heartbeat, and release
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { sessionManager, type Session } from "../session-manager";
import {
  spawnSessionContainer,
  cleanupSessionContainer,
  startCleanupInterval,
  cleanupOrphanedContainers,
} from "../container-runner";

const app = new Hono();

// Clean up orphaned containers from previous runs and start cleanup interval
cleanupOrphanedContainers().then(() => {
  startCleanupInterval();
});

/**
 * Acquire a new session
 * Returns either an active session with VNC port, or a queue position
 */
app.post("/acquire", async (c) => {
  const result = sessionManager.acquireSession();
  
  if ("queuePosition" in result) {
    return c.json({
      status: "queued",
      sessionId: result.sessionId,
      queuePosition: result.queuePosition,
      message: `System experiencing high load. Position in queue: ${result.queuePosition}`,
    });
  }
  
  const session = result.session;
  
  // Start the container in background (don't wait)
  spawnSessionContainer(session).catch((err) => {
    console.error(`Failed to spawn container for session ${session.id}:`, err);
  });
  
  return c.json({
    status: "acquired",
    sessionId: session.id,
    vncPort: session.vncPort,
  });
});

/**
 * Get session status
 */
app.get("/:sessionId", (c) => {
  const sessionId = c.req.param("sessionId");
  
  // Check if queued
  if (sessionManager.isQueued(sessionId)) {
    const position = sessionManager.getQueuePosition(sessionId);
    return c.json({
      status: "queued",
      queuePosition: position,
    });
  }
  
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  
  return c.json({
    status: session.status,
    sessionId: session.id,
    vncPort: session.vncPort,
    projectName: session.projectName,
    buildOutput: session.buildOutput,
    runOutput: session.runOutput,
    errorMessage: session.errorMessage,
    selectedAssignmentPartId: session.selectedAssignmentPartId,
  });
});

/**
 * Heartbeat - keep session alive
 */
app.post("/:sessionId/heartbeat", (c) => {
  const sessionId = c.req.param("sessionId");
  
  // Also accept heartbeat from queued sessions
  if (sessionManager.isQueued(sessionId)) {
    return c.json({ ok: true, queued: true });
  }
  
  const success = sessionManager.heartbeat(sessionId);
  if (!success) {
    return c.json({ error: "Session not found" }, 404);
  }
  
  return c.json({ ok: true });
});

/**
 * Release session - user is done or leaving
 */
app.post("/:sessionId/release", async (c) => {
  const sessionId = c.req.param("sessionId");
  
  // Handle queued session release
  if (sessionManager.isQueued(sessionId)) {
    sessionManager.releaseSession(sessionId);
    return c.json({ ok: true });
  }
  
  const session = sessionManager.getSession(sessionId);
  if (session) {
    await cleanupSessionContainer(sessionId);
  }
  
  sessionManager.releaseSession(sessionId);
  return c.json({ ok: true });
});

/**
 * SSE stream for session status changes
 */
app.get("/:sessionId/stream/status", async (c) => {
  const sessionId = c.req.param("sessionId");
  
  return streamSSE(c, async (stream) => {
    // Check if queued
    if (sessionManager.isQueued(sessionId)) {
      const position = sessionManager.getQueuePosition(sessionId);
      await stream.writeSSE({
        data: JSON.stringify({ status: "queued", queuePosition: position }),
        event: "status",
      });
      
      // Listen for queue updates
      const queueCallback = async (newPosition: number) => {
        try {
          if (newPosition === 0) {
            // Promoted! Get the new session
            const session = sessionManager.getSession(sessionId);
            if (session) {
              await stream.writeSSE({
                data: JSON.stringify({
                  status: session.status,
                  vncPort: session.vncPort,
                }),
                event: "promoted",
              });
            }
          } else {
            await stream.writeSSE({
              data: JSON.stringify({ queuePosition: newPosition }),
              event: "queue-update",
            });
          }
        } catch {
          // Client disconnected
        }
      };
      
      sessionManager.addQueueListener(sessionId, queueCallback);
      
      // Keep alive while queued
      while (sessionManager.isQueued(sessionId)) {
        await stream.sleep(1000);
      }
      
      // Once promoted, continue with normal session streaming
    }
    
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      await stream.writeSSE({
        data: JSON.stringify({ error: "Session not found" }),
        event: "error",
      });
      return;
    }
    
    // Send initial state
    await stream.writeSSE({
      data: JSON.stringify({
        status: session.status,
        vncPort: session.vncPort,
        projectName: session.projectName,
        errorMessage: session.errorMessage,
      }),
      event: "status",
    });
    
    // Listen for updates
    const callback = async (updatedSession: Session) => {
      try {
        await stream.writeSSE({
          data: JSON.stringify({
            status: updatedSession.status,
            vncPort: updatedSession.vncPort,
            projectName: updatedSession.projectName,
            errorMessage: updatedSession.errorMessage,
          }),
          event: "status",
        });
      } catch {
        // Client disconnected
      }
    };
    
    sessionManager.addSessionListener(sessionId, callback);
    
    // Keep connection alive
    while (true) {
      await stream.sleep(30000);
    }
  });
});

/**
 * SSE stream for build output
 */
app.get("/:sessionId/stream/build", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = sessionManager.getSession(sessionId);
  
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  
  return streamSSE(c, async (stream) => {
    // Send existing output
    if (session.buildOutput) {
      await stream.writeSSE({
        data: session.buildOutput,
        event: "output",
      });
    }
    
    const callback = async (data: string) => {
      try {
        await stream.writeSSE({
          data: data,
          event: "output",
        });
      } catch {
        // Client disconnected
      }
    };
    
    sessionManager.addBuildListener(sessionId, callback);
    
    // Keep alive while building
    while (session.status === "building") {
      await stream.sleep(100);
    }
    
    // Send final status
    await stream.writeSSE({
      data: JSON.stringify({ status: session.status, error: session.errorMessage }),
      event: "complete",
    });
  });
});

/**
 * Admin endpoint - get all sessions
 */
app.get("/admin/sessions", (c) => {
  const sessions = sessionManager.getAllSessions();
  const queueInfo = sessionManager.getQueueInfo();
  
  return c.json({
    activeSessions: sessions.map((s) => ({
      id: s.id,
      status: s.status,
      vncPort: s.vncPort,
      createdAt: s.createdAt,
      lastHeartbeat: s.lastHeartbeat,
    })),
    queue: queueInfo,
  });
});

export default app;
