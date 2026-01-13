import { tool, type Plugin } from "@opencode-ai/plugin";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

// Output path - configurable via environment variable, defaults to Docker path
const REVIEW_OUTPUT_PATH = process.env.REVIEW_OUTPUT_PATH || "/app/review-output/review.json";

// Review issue schema
interface ReviewIssue {
  severity: "error" | "warning" | "info";
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
  requirementIndex?: number; // Links issue to a specific requirement
}

// Requirement result schema - tracks how each assignment requirement was met
interface RequirementResult {
  requirement: string;
  status: "met" | "partial" | "not_met";
  feedback: string;
  points?: number; // Optional points earned for this requirement
}

interface ReviewData {
  summary: string;
  overallScore?: number;
  requirementResults?: RequirementResult[]; // How each requirement was graded
  issues: ReviewIssue[];
  positives?: string[];
  timestamp: string;
}

const submitReviewTool = tool({
  description: `Submit a structured assignment grade/review. This is the ONLY way to provide your review output.
The review will be saved and displayed to the student.

Parameters:
- summary: A brief overall assessment focusing on how well assignment requirements were met (required)
- overallScore: Numeric score from 0-100 based on requirements met (required for assignment grading)
- requirementResults: For EACH assignment requirement, whether it was met/partial/not_met (required when grading an assignment)
  - requirement: The requirement text being evaluated
  - status: "met", "partial", or "not_met"
  - feedback: Explanation of how the requirement was or wasn't satisfied
  - points: Optional points earned for this requirement
- issues: Array of specific issues found (required, can be empty)
  - severity: "error" (critical issues), "warning" (should fix), or "info" (suggestions)
  - file: The file path where the issue was found (optional)
  - line: The line number (optional)
  - message: Description of the issue (required)
  - suggestion: How to fix it (optional)
  - requirementIndex: Index of the requirement this issue relates to (optional)
- positives: Array of things done well (optional)`,
  args: {
    summary: tool.schema.string().describe("Brief overall assessment of how well the student met the assignment requirements"),
    overallScore: tool.schema.number().min(0).max(100).describe("Score from 0-100 based on how well requirements were met"),
    requirementResults: tool.schema.array(
      tool.schema.object({
        requirement: tool.schema.string().describe("The requirement being evaluated"),
        status: tool.schema.enum(["met", "partial", "not_met"]).describe("Whether requirement was met, partially met, or not met"),
        feedback: tool.schema.string().describe("Explanation of how the requirement was or wasn't satisfied"),
        points: tool.schema.number().optional().describe("Points earned for this requirement"),
      })
    ).optional().describe("Evaluation of each assignment requirement"),
    issues: tool.schema.array(
      tool.schema.object({
        severity: tool.schema.enum(["error", "warning", "info"]).describe("Issue severity level"),
        file: tool.schema.string().optional().describe("File path where issue was found"),
        line: tool.schema.number().optional().describe("Line number of the issue"),
        message: tool.schema.string().describe("Description of the issue"),
        suggestion: tool.schema.string().optional().describe("Suggested fix or improvement"),
        requirementIndex: tool.schema.number().optional().describe("Index of related requirement (0-based)"),
      })
    ).describe("List of issues found in the code"),
    positives: tool.schema.array(tool.schema.string()).optional().describe("Things done well"),
  },
  async execute(args) {
    const reviewData: ReviewData = {
      summary: args.summary,
      overallScore: args.overallScore,
      requirementResults: args.requirementResults,
      issues: args.issues,
      positives: args.positives,
      timestamp: new Date().toISOString(),
    };

    try {
      // Ensure output directory exists
      mkdirSync(dirname(REVIEW_OUTPUT_PATH), { recursive: true });

      // Write review to the hardcoded path only
      writeFileSync(REVIEW_OUTPUT_PATH, JSON.stringify(reviewData, null, 2), "utf-8");

      const errorCount = args.issues.filter(i => i.severity === "error").length;
      const warningCount = args.issues.filter(i => i.severity === "warning").length;
      const infoCount = args.issues.filter(i => i.severity === "info").length;

      // Count requirement statuses
      const reqMet = args.requirementResults?.filter(r => r.status === "met").length ?? 0;
      const reqPartial = args.requirementResults?.filter(r => r.status === "partial").length ?? 0;
      const reqNotMet = args.requirementResults?.filter(r => r.status === "not_met").length ?? 0;

      return `Review submitted successfully.
Summary: ${args.summary}
Score: ${args.overallScore}/100
${args.requirementResults?.length ? `Requirements: ${reqMet} met, ${reqPartial} partial, ${reqNotMet} not met` : ""}
Issues: ${errorCount} errors, ${warningCount} warnings, ${infoCount} suggestions
${args.positives?.length ? `Positives noted: ${args.positives.length}` : ""}
Review saved to: ${REVIEW_OUTPUT_PATH}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return `Failed to save review: ${message}`;
    }
  },
});

const plugin: Plugin = async (input) => {
  return {
    tool: {
      submit_review: submitReviewTool,
    },
  };
};

export default plugin;

