/**
 * Assignment API Routes - Handles assignment listing
 */

import { Hono } from "hono";
import {
  getAllAssignments,
  getAllAssignmentParts,
  getAssignmentPart,
  getAssignmentWithParts,
} from "../db";

const app = new Hono();

/**
 * Get all assignments
 */
app.get("/", (c) => {
  const assignments = getAllAssignments();
  return c.json(assignments);
});

/**
 * Get assignment by ID with all parts
 */
app.get("/:id", (c) => {
  const id = parseInt(c.req.param("id"));
  const assignment = getAssignmentWithParts(id);
  if (!assignment) {
    return c.json({ error: "Assignment not found" }, 404);
  }
  return c.json(assignment);
});

/**
 * Get all assignment parts (flat list)
 */
app.get("/parts/all", (c) => {
  const parts = getAllAssignmentParts();
  return c.json(parts);
});

/**
 * Get assignment part by ID
 */
app.get("/parts/:id", (c) => {
  const id = parseInt(c.req.param("id"));
  const part = getAssignmentPart(id);
  if (!part) {
    return c.json({ error: "Assignment part not found" }, 404);
  }
  return c.json(part);
});

export default app;
