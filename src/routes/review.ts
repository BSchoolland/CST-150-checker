/**
 * Review API Routes - Handles code review status and streaming per session
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { sessionManager } from "../session-manager";

const app = new Hono();

/**
 * Get review status for a session
 */
app.get("/:sessionId/status", (c) => {
  const sessionId = c.req.param("sessionId");
  const reviewState = sessionManager.getReviewState(sessionId);

  if (!reviewState) {
    return c.json({ error: "Session not found" }, 404);
  }

  return c.json(reviewState);
});

/**
 * SSE stream for review output with session ID
 */
app.get("/:sessionId/stream", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = sessionManager.getSession(sessionId);

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  return streamSSE(c, async (stream) => {
    // Send existing output first
    if (session.reviewState.output) {
      await stream.writeSSE({
        data: session.reviewState.output,
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

    sessionManager.addReviewStreamListener(sessionId, callback);

    // Keep connection alive while reviewing
    let currentState = session.reviewState;
    while (currentState.status === "reviewing") {
      await stream.sleep(100);
      const updatedState = sessionManager.getReviewState(sessionId);
      if (!updatedState) break;
      currentState = updatedState;
    }

    // Send final status
    await stream.writeSSE({
      data: JSON.stringify({
        status: currentState.status,
        result: currentState.result,
        error: currentState.errorMessage,
      }),
      event: "complete",
    });
  });
});

/**
 * SSE stream for review status changes with session ID
 */
app.get("/:sessionId/stream/status", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = sessionManager.getSession(sessionId);

  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }

  return streamSSE(c, async (stream) => {
    // Send initial state
    await stream.writeSSE({
      data: JSON.stringify(session.reviewState),
      event: "review-status",
    });

    const callback = async (status: typeof session.reviewState) => {
      try {
        await stream.writeSSE({
          data: JSON.stringify(status),
          event: "review-status",
        });
      } catch {
        // Client disconnected
      }
    };

    sessionManager.addReviewStatusListener(sessionId, callback);

    // Keep connection alive while session exists
    while (sessionManager.getSession(sessionId)) {
      await stream.sleep(30000);
    }
  });
});

export default app;
