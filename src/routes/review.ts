/**
 * Review API Routes - Handles code review status and streaming
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  getReviewState,
  addReviewStreamCallback,
  addReviewStatusCallback,
} from "../review-runner";

const app = new Hono();

/**
 * Get current review status
 */
app.get("/", (c) => {
  return c.json(getReviewState());
});

/**
 * SSE stream for review output
 */
app.get("/stream", async (c) => {
  const reviewState = getReviewState();
  
  return streamSSE(c, async (stream) => {
    // Send existing output first
    if (reviewState.output) {
      await stream.writeSSE({
        data: reviewState.output,
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
    
    addReviewStreamCallback(callback);
    
    // Keep connection alive while reviewing
    let currentState = getReviewState();
    while (currentState.status === "reviewing") {
      await stream.sleep(100);
      currentState = getReviewState();
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
 * SSE stream for review status changes
 */
app.get("/stream/status", async (c) => {
  const reviewState = getReviewState();
  
  return streamSSE(c, async (stream) => {
    // Send initial state
    await stream.writeSSE({
      data: JSON.stringify(reviewState),
      event: "review-status",
    });
    
    const callback = async (status: typeof reviewState) => {
      try {
        await stream.writeSSE({
          data: JSON.stringify(status),
          event: "review-status",
        });
      } catch {
        // Client disconnected
      }
    };
    
    addReviewStatusCallback(callback);
    
    // Keep connection alive
    while (true) {
      await stream.sleep(30000);
    }
  });
});

export default app;
