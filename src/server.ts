/**
 * CST-150 Checker Server
 * 
 * Main entry point that ties together all routes and serves the frontend.
 * Session-based multi-user support with sandboxed Docker containers.
 */

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { existsSync } from "fs";
import { mkdir, chmod } from "fs/promises";
import { resolve } from "path";
import { seedDatabase } from "./db";
import { cleanupAllSessions } from "./container-runner";

// Import route modules
import sessionRoutes from "./routes/session";
import projectRoutes from "./routes/project";
import reviewRoutes from "./routes/review";
import assignmentRoutes from "./routes/assignments";
import debugRoutes from "./routes/debug";

// Ensure required directories exist with proper permissions
async function ensureDirectories() {
  const dirs = [
    "./uploads",
    "./projects",
    "./review-input",
    "./review-output",
  ];
  
  for (const dir of dirs) {
    try {
      await mkdir(dir, { recursive: true, mode: 0o777 });
      // Also chmod in case directory already existed with wrong permissions
      await chmod(dir, 0o777);
    } catch (err) {
      // Ignore permission errors on chmod (might not own the directory)
      // The mkdir with mode should work for new directories
    }
  }
}

// Initialize on startup
await ensureDirectories();
seedDatabase();

// Graceful shutdown handler - clean up all sessions and project files
async function handleShutdown(signal: string) {
  console.log(`\nReceived ${signal}, cleaning up all sessions...`);
  await cleanupAllSessions();
  console.log("Cleanup complete, exiting.");
  process.exit(0);
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

const app = new Hono();

// CORS for development
app.use("/*", cors());

// Mount API routes
app.route("/api/session", sessionRoutes);
app.route("/api/project", projectRoutes);
app.route("/api/review", reviewRoutes);
app.route("/api/assignments", assignmentRoutes);
app.route("/api/debug", debugRoutes);

// Legacy routes for backwards compatibility during transition
// These map old single-user endpoints to session-based ones
app.get("/api/assignment-parts", (c) => {
  // Forward to new route
  return c.redirect("/api/assignments/parts/all");
});

// Serve static files - check for built frontend first
const frontendDistPath = "./frontend/dist";
const useFrontendBuild = existsSync(frontendDistPath);

if (useFrontendBuild) {
  // Serve built React frontend
  app.use("/assets/*", serveStatic({ root: frontendDistPath }));
  app.get("/", serveStatic({ path: `${frontendDistPath}/index.html` }));
  
  // Fallback for SPA routing - serve index.html for all non-API routes
  app.use("*", async (c, next) => {
    // Skip API routes
    if (c.req.path.startsWith("/api")) {
      return next();
    }
    // Serve index.html for client-side routing
    const indexPath = resolve(frontendDistPath, "index.html");
    if (existsSync(indexPath)) {
      const html = await Bun.file(indexPath).text();
      return c.html(html);
    }
    return next();
  });
} else {
  // Fallback to old public directory (legacy)
  app.use("/static/*", serveStatic({ root: "./" }));
  app.get("/", serveStatic({ path: "./public/index.html" }));
}

const port = parseInt(process.env.PORT || "3000");
console.log(`CST-150 Checker Server running on http://localhost:${port}`);
console.log(`Multi-user session support enabled (max 3 concurrent sessions)`);

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 120, // 2 minutes for SSE streams
};
