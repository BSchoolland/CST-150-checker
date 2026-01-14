/**
 * Shared types for the CST-150 Checker application
 */

// Review types
export interface ReviewIssue {
  severity: "error" | "warning" | "info";
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

export interface ReviewResult {
  summary: string;
  overallScore?: number;
  issues: ReviewIssue[];
  positives?: string[];
  timestamp: string;
}

export interface ReviewState {
  status: "idle" | "reviewing" | "completed" | "error";
  result: ReviewResult | null;
  output: string;
  errorMessage: string | null;
}

// Assignment types (re-exported from db)
export type { AssignmentPart } from "./db";
