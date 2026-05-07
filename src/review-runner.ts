/**
 * Review Runner - Handles sandboxed code review in sibling containers
 * 
 * Each session gets isolated input/output paths to prevent concurrent review interference.
 */

import { spawn } from "bun";
import { mkdir, rm, readFile } from "fs/promises";
import { existsSync } from "fs";
import { resolve } from "path";
import { getAssignmentPart } from "./db";
import { sessionManager } from "./session-manager";
import type { ReviewResult } from "./types";

// Configuration
const REVIEW_CONTAINER_IMAGE = "cst150-review-runner:latest";
const REVIEW_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const REVIEW_INPUT_BASE = process.env.REVIEW_INPUT_BASE || "./review-input";
const REVIEW_OUTPUT_BASE = process.env.REVIEW_OUTPUT_BASE || "./review-output";

/**
 * Get session-specific review input path
 */
function getReviewInputPath(sessionId: string): string {
  return `${REVIEW_INPUT_BASE}/${sessionId}`;
}

/**
 * Get session-specific review output path
 */
function getReviewOutputPath(sessionId: string): string {
  return `${REVIEW_OUTPUT_BASE}/${sessionId}/review.json`;
}

/**
 * Emit review output for a session
 */
function emitReviewOutput(sessionId: string, data: string): void {
  process.stdout.write(`[review:${sessionId.slice(0, 8)}] ${data}`);
  sessionManager.emitReviewOutput(sessionId, data);
}

/**
 * Run code review in a sandboxed container for a specific session
 */
export async function runReview(
  sessionId: string,
  projectPath: string,
  selectedAssignmentPartId: number | null
): Promise<void> {
  const reviewInputPath = getReviewInputPath(sessionId);
  const reviewOutputPath = getReviewOutputPath(sessionId);
  const reviewOutputDir = reviewOutputPath.substring(0, reviewOutputPath.lastIndexOf('/'));

  try {
    // Clean up previous review output for this session
    try {
      await rm(reviewOutputPath, { force: true });
    } catch {
      // Ignore if file doesn't exist
    }
    
    // Ensure session-specific directories exist
    await mkdir(reviewInputPath, { recursive: true });
    await mkdir(reviewOutputDir, { recursive: true });

    const absoluteProjectPath = resolve(projectPath);

    // Update session review state
    sessionManager.updateReviewState(sessionId, {
      status: "reviewing",
      result: null,
      output: "",
      errorMessage: null,
    });
    
    emitReviewOutput(sessionId, "Starting code review in sandboxed container...\n");
    emitReviewOutput(sessionId, `Project path: ${absoluteProjectPath}\n`);

    // Clean and copy project files to session-specific input directory
    emitReviewOutput(sessionId, "Copying project files to sandbox...\n");
    
    const cleanInputProc = spawn({
      cmd: ["sh", "-c", `chmod -R 777 ${reviewInputPath} 2>/dev/null || true; rm -rf ${reviewInputPath}/* ${reviewInputPath}/.[!.]* 2>/dev/null || true`],
      stdout: "ignore",
      stderr: "ignore",
    });
    await cleanInputProc.exited;
    
    const chmodOutputProc = spawn({
      cmd: ["sh", "-c", `chmod -R 777 ${reviewOutputDir} 2>/dev/null || true; rm -f ${reviewOutputPath} 2>/dev/null || true`],
      stdout: "ignore",
      stderr: "ignore",
    });
    await chmodOutputProc.exited;

    const copyProc = spawn({
      cmd: ["cp", "-r", `${absoluteProjectPath}/.`, reviewInputPath],
      stdout: "pipe",
      stderr: "pipe",
    });
    
    const copyStderrReader = copyProc.stderr.getReader();
    let copyStderrOutput = "";
    try {
      while (true) {
        const { done, value } = await copyStderrReader.read();
        if (done) break;
        copyStderrOutput += new TextDecoder().decode(value);
      }
    } catch {}
    
    await copyProc.exited;
    if (copyProc.exitCode !== 0) {
      throw new Error(`Failed to copy project files to sandbox: ${copyStderrOutput}`);
    }

    // Build dynamic agent system prompt with assignment requirements
    let agentSystemPrompt: string;
    let reviewPrompt: string;

    if (selectedAssignmentPartId) {
      const assignmentPart = getAssignmentPart(selectedAssignmentPartId);
      if (assignmentPart) {
        const requirements = JSON.parse(assignmentPart.requirements) as string[];
        emitReviewOutput(sessionId, `Reviewing against assignment: ${assignmentPart.title}\n`);

        agentSystemPrompt = buildAgentPrompt(assignmentPart, requirements);
        reviewPrompt = "Review the student's code in /app/project against the assignment requirements.";
      } else {
        throw new Error(`Assignment part with ID ${selectedAssignmentPartId} not found in database.`);
      }
    } else {
      throw new Error("No assignment selected. You must select an assignment before running code review.");
    }

    // Write dynamic agent config to session-specific input directory
    const agentConfigDir = `${reviewInputPath}/.opencode-config/opencode/agent`;
    await mkdir(agentConfigDir, { recursive: true });

    const agentConfigContent = `---
description: >-
  Sandboxed code review agent for grading C# WinForms student assignments.
mode: primary
tools:
  read: true
  list: true
  glob: true
  grep: true
  codesearch: true
  websearch: false
  webfetch: false
  write: false
  edit: false
  task: false
  todowrite: false
  todoread: false
  bash: true
  submit_review: true
---
${agentSystemPrompt}
`;

    await Bun.write(`${agentConfigDir}/code-reviewer.md`, agentConfigContent);

    // Configure review output path for this session
    const opencodeConfigContent = {
      plugin: ["/app/opencode-plugin"],
      permission: { external_directory: "allow" },
      "$schema": "https://opencode.ai/config.json"
    };
    await Bun.write(`${reviewInputPath}/.opencode-config/opencode/config.json`, JSON.stringify(opencodeConfigContent, null, 2));

    // Fix permissions
    const chmodProc = spawn({
      cmd: ["chmod", "-R", "777", reviewInputPath],
      stdout: "ignore",
      stderr: "ignore",
    });
    await chmodProc.exited;

    emitReviewOutput(sessionId, "Generated dynamic agent config with assignment requirements\n");

    // Generate unique container name using session ID
    const containerName = `review-${sessionId.slice(0, 8)}-${Date.now()}`;

    // Get host paths for Docker sibling container bind mounts
    const hostReviewInputDir = process.env.HOST_REVIEW_INPUT_DIR || "/app/review-input";
    const hostReviewOutputDir = process.env.HOST_REVIEW_OUTPUT_DIR || "/app/review-output";
    const hostReviewInputPath = `${hostReviewInputDir}/${sessionId}`;
    const hostReviewOutputPath = `${hostReviewOutputDir}/${sessionId}`;

    // Run opencode in sandboxed sibling container
    // Mount only this session's project (not the entire volume) at /app/project
    emitReviewOutput(sessionId, `Spawning review container: ${containerName}\n`);
    const reviewProc = spawn({
      cmd: [
        "docker", "run",
        "--name", containerName,
        "--rm",
        "--pids-limit", "256",
        "--memory", "1g",
        "--memory-swap", "1g",
        "--cpus", "2",
        "--ulimit", "nproc=4096:4096",
        "--ulimit", "nofile=4096:4096",
        "--security-opt", "no-new-privileges",
        "--cap-drop", "ALL",
        "--tmpfs", "/tmp:size=256m,mode=1777",
        "--network", "bridge",
        "--user", "1000:1000",
        // Mount only this session's project folder at /app/project (not the entire volume)
        "-v", `${hostReviewInputPath}:/app/project`,
        // Mount only this session's output folder
        "-v", `${hostReviewOutputPath}:/app/review-output:rw`,
        // Set environment variables - XDG_CONFIG_HOME points to the config in /app/project
        "-e", "XDG_CONFIG_HOME=/app/project/.opencode-config",
        "-e", "XDG_DATA_HOME=/tmp/opencode-data",
        "-e", "XDG_STATE_HOME=/tmp/opencode-state",
        "-e", "XDG_CACHE_HOME=/tmp/opencode-cache",
        "-e", "REVIEW_OUTPUT_PATH=/app/review-output/review.json",
        "-e", "CI=true",
        "-e", "HOME=/home/reviewer",
        "-e", "PATH=/home/reviewer/.opencode/bin:/home/reviewer/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        // Working directory is the project folder
        "-w", "/app/project",
        REVIEW_CONTAINER_IMAGE,
        "/home/reviewer/.opencode/bin/opencode", "run",
        "--agent", "code-reviewer",
        "--format", "json",
        reviewPrompt,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });

    const decoder = new TextDecoder();

    // Stream stdout
    const stdoutReader = reviewProc.stdout.getReader();
    (async () => {
      while (true) {
        const { done, value } = await stdoutReader.read();
        if (done) break;
        emitReviewOutput(sessionId, decoder.decode(value));
      }
    })();

    // Stream stderr
    const stderrReader = reviewProc.stderr.getReader();
    (async () => {
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        emitReviewOutput(sessionId, decoder.decode(value));
      }
    })();

    // Wait with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        spawn({ cmd: ["docker", "kill", containerName], stdout: "ignore", stderr: "ignore" });
        reject(new Error(`Review timed out after ${REVIEW_TIMEOUT_MS / 1000} seconds`));
      }, REVIEW_TIMEOUT_MS);
    });

    let exitCode: number | null = null;
    try {
      await Promise.race([reviewProc.exited, timeoutPromise]);
      exitCode = reviewProc.exitCode;
    } catch {
      emitReviewOutput(sessionId, `\nReview timed out!\n`);
      sessionManager.updateReviewState(sessionId, {
        status: "error",
        errorMessage: "Review timed out after 5 minutes",
      });
      return;
    }
    
    emitReviewOutput(sessionId, `\nReview container exited with code: ${exitCode}\n`);

    // Check if review was produced at session-specific path
    if (existsSync(reviewOutputPath)) {
      try {
        const reviewData = await readFile(reviewOutputPath, "utf-8");
        const result: ReviewResult = JSON.parse(reviewData);
        sessionManager.updateReviewState(sessionId, {
          status: "completed",
          result,
          errorMessage: null,
        });
        emitReviewOutput(sessionId, "\nCode review completed successfully!\n");
      } catch (parseError) {
        const parseMsg = parseError instanceof Error ? parseError.message : "Unknown parse error";
        sessionManager.updateReviewState(sessionId, {
          status: "error",
          errorMessage: `Failed to parse review output: ${parseMsg}`,
        });
      }
    } else {
      sessionManager.updateReviewState(sessionId, {
        status: "error",
        errorMessage: `No review output produced. Exit code: ${exitCode}`,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    sessionManager.updateReviewState(sessionId, {
      status: "error",
      errorMessage: message,
    });
  }
}

function buildAgentPrompt(assignmentPart: { title: string; description: string; review_criteria: string }, requirements: string[]): string {
  return `You are an assignment grader for a CST-150 C# programming course.

## YOUR ASSIGNMENT TO GRADE

**Assignment:** ${assignmentPart.title}

**Description:** ${assignmentPart.description}

**Requirements (student MUST implement all of these):**
${requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

**Grading Rubric:**
${assignmentPart.review_criteria}

## GRADING INSTRUCTIONS

Your task is to evaluate the student's code against the requirements and rubric above.

### For EACH requirement, you must determine:
- **Met**: Requirement is fully and correctly implemented
- **Partially Met**: Requirement is attempted but has issues (wrong formula, incorrect format, etc.)
- **Not Met**: Requirement is missing or fundamentally broken

### Evaluation Categories:

1. **Functionality** (Most Important)
   - Does the program do what the assignment asked?
   - Are calculations/formulas correct?
   - Does output match required format?

2. **Naming Conventions** (see rubric above for specific guidance)
   - Follow the naming convention rules in the rubric
   - Naming issues should be marked as warnings, not errors

3. **Code Quality**
   - Are there comments explaining the code?
   - Is the code readable and organized?

### Output Format

After analyzing the code, you MUST use the \`submit_review\` tool with:
- **summary**: Overall assessment of how well the student met the assignment
- **overallScore**: Grade from 0-100 based on requirements met
- **requirementResults**: For EACH requirement listed above, whether it was met/partial/not_met with explanation
- **issues**: Specific problems found, with file and line references
- **positives**: What the student did well

Be educational and encouraging while being accurate about what was and wasn't implemented correctly.

Do NOT attempt to modify any files. Your only output mechanism is the submit_review tool.`;
}
