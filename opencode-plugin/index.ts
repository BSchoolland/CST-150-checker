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
}

interface ReviewData {
  summary: string;
  overallScore?: number;
  issues: ReviewIssue[];
  positives?: string[];
  timestamp: string;
}

const submitReviewTool = tool({
  description: `Submit a structured code review. This is the ONLY way to provide your review output.
The review will be saved and displayed to the student.

Parameters:
- summary: A brief overall assessment of the code (required)
- overallScore: Optional numeric score from 0-100
- issues: Array of specific issues found (required, can be empty)
  - severity: "error" (critical issues), "warning" (should fix), or "info" (suggestions)
  - file: The file path where the issue was found (optional)
  - line: The line number (optional)
  - message: Description of the issue (required)
  - suggestion: How to fix it (optional)
- positives: Array of things done well (optional)`,
  args: {
    summary: tool.schema.string().describe("Brief overall assessment of the code quality"),
    overallScore: tool.schema.number().min(0).max(100).optional().describe("Optional score from 0-100"),
    issues: tool.schema.array(
      tool.schema.object({
        severity: tool.schema.enum(["error", "warning", "info"]).describe("Issue severity level"),
        file: tool.schema.string().optional().describe("File path where issue was found"),
        line: tool.schema.number().optional().describe("Line number of the issue"),
        message: tool.schema.string().describe("Description of the issue"),
        suggestion: tool.schema.string().optional().describe("Suggested fix or improvement"),
      })
    ).describe("List of issues found in the code"),
    positives: tool.schema.array(tool.schema.string()).optional().describe("Things done well"),
  },
  async execute(args) {
    const reviewData: ReviewData = {
      summary: args.summary,
      overallScore: args.overallScore,
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
      
      return `Review submitted successfully.
Summary: ${args.summary}
${args.overallScore !== undefined ? `Score: ${args.overallScore}/100` : ""}
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

