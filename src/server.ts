import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { spawn, type Subprocess } from "bun";
import { mkdir, readdir, readFile, rm } from "fs/promises";
import { join, basename, resolve } from "path";
import { existsSync } from "fs";
import { streamSSE } from "hono/streaming";
import {
  getAllAssignments,
  getAllAssignmentParts,
  getAssignmentPart,
  getAssignmentWithParts,
  seedDatabase,
  type AssignmentPart,
} from "./db";

// Review types
interface ReviewIssue {
  severity: "error" | "warning" | "info";
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

interface ReviewResult {
  summary: string;
  overallScore?: number;
  issues: ReviewIssue[];
  positives?: string[];
  timestamp: string;
}

interface ReviewState {
  status: "idle" | "reviewing" | "completed" | "error";
  result: ReviewResult | null;
  output: string;
  errorMessage: string | null;
}

// Use absolute paths for Docker compatibility
const REVIEW_OUTPUT_PATH = process.env.REVIEW_OUTPUT_PATH || "/app/review-output/review.json";
const OPENCODE_XDG_CONFIG = process.env.XDG_CONFIG_HOME || "/app/opencode-config";

const app = new Hono();

// State management
interface ProjectState {
  name: string | null;
  status: "idle" | "uploading" | "uploaded" | "building" | "built" | "running" | "error";
  uploadedAt: string | null;
  projectPath: string | null;
  csprojPath: string | null;
  exePath: string | null;
  buildOutput: string;
  runOutput: string;
  errorMessage: string | null;
  selectedAssignmentPartId: number | null;
}

const initialState: ProjectState = {
  name: null,
  status: "idle",
  uploadedAt: null,
  projectPath: null,
  csprojPath: null,
  exePath: null,
  buildOutput: "",
  runOutput: "",
  errorMessage: null,
  selectedAssignmentPartId: null,
};

let state: ProjectState = { ...initialState };

// Initialize database on startup
seedDatabase();

let runningProcess: Subprocess | null = null;

// Review state
const initialReviewState: ReviewState = {
  status: "idle",
  result: null,
  output: "",
  errorMessage: null,
};

let reviewState: ReviewState = { ...initialReviewState };

// Event emitters for streaming
type StreamCallback = (data: string) => void;
let buildStreamCallbacks: StreamCallback[] = [];
let runStreamCallbacks: StreamCallback[] = [];
let reviewStreamCallbacks: StreamCallback[] = [];
let statusStreamCallbacks: ((status: ProjectState) => void)[] = [];
let reviewStatusCallbacks: ((status: ReviewState) => void)[] = [];

function emitBuildOutput(data: string) {
  state.buildOutput += data;
  buildStreamCallbacks.forEach((cb) => cb(data));
}

function emitRunOutput(data: string) {
  state.runOutput += data;
  runStreamCallbacks.forEach((cb) => cb(data));
}

function emitReviewOutput(data: string) {
  reviewState.output += data;
  process.stdout.write(`[review] ${data}`);
  reviewStreamCallbacks.forEach((cb) => cb(data));
}

function emitStatusChange() {
  statusStreamCallbacks.forEach((cb) => cb(state));
}

function emitReviewStatusChange() {
  reviewStatusCallbacks.forEach((cb) => cb(reviewState));
}

const UPLOADS_DIR = "./uploads";
const PROJECTS_DIR = "./projects";

// Ensure directories exist
await mkdir(UPLOADS_DIR, { recursive: true });
await mkdir(PROJECTS_DIR, { recursive: true });

app.use("/*", cors());

// Serve static files from public directory
app.use("/static/*", serveStatic({ root: "./" }));
app.get("/", serveStatic({ path: "./public/index.html" }));

// Get current status
app.get("/api/status", (c) => {
  return c.json(state);
});

// Assignment API endpoints
app.get("/api/assignments", (c) => {
  const assignments = getAllAssignments();
  return c.json(assignments);
});

app.get("/api/assignments/:id", (c) => {
  const id = parseInt(c.req.param("id"));
  const assignment = getAssignmentWithParts(id);
  if (!assignment) {
    return c.json({ error: "Assignment not found" }, 404);
  }
  return c.json(assignment);
});

app.get("/api/assignment-parts", (c) => {
  const parts = getAllAssignmentParts();
  return c.json(parts);
});

app.get("/api/assignment-parts/:id", (c) => {
  const id = parseInt(c.req.param("id"));
  const part = getAssignmentPart(id);
  if (!part) {
    return c.json({ error: "Assignment part not found" }, 404);
  }
  return c.json(part);
});

// Select an assignment part for the current project
app.post("/api/select-assignment", async (c) => {
  const body = await c.req.json();
  const partId = body.partId as number | null;

  if (partId !== null) {
    const part = getAssignmentPart(partId);
    if (!part) {
      return c.json({ error: "Assignment part not found" }, 404);
    }
  }

  state.selectedAssignmentPartId = partId;
  emitStatusChange();

  return c.json({ success: true, selectedPartId: partId });
});

// SSE stream for status changes
app.get("/api/stream/status", async (c) => {
  return streamSSE(c, async (stream) => {
    // Send initial state
    await stream.writeSSE({
      data: JSON.stringify(state),
      event: "status",
    });

    const callback = async (status: ProjectState) => {
      try {
        await stream.writeSSE({
          data: JSON.stringify(status),
          event: "status",
        });
      } catch {
        // Client disconnected
      }
    };

    statusStreamCallbacks.push(callback);

    // Keep connection alive
    while (true) {
      await stream.sleep(30000);
    }
  });
});

// SSE stream for build output
app.get("/api/stream/build", async (c) => {
  return streamSSE(c, async (stream) => {
    // Send existing output first
    if (state.buildOutput) {
      await stream.writeSSE({
        data: state.buildOutput,
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

    buildStreamCallbacks.push(callback);

    // Keep connection alive until build completes or errors
    while (state.status === "building") {
      await stream.sleep(100);
    }

    // Send final status
    await stream.writeSSE({
      data: JSON.stringify({ status: state.status, error: state.errorMessage }),
      event: "complete",
    });
  });
});

// SSE stream for run output
app.get("/api/stream/run", async (c) => {
  return streamSSE(c, async (stream) => {
    // Send existing output first
    if (state.runOutput) {
      await stream.writeSSE({
        data: state.runOutput,
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

    runStreamCallbacks.push(callback);

    // Keep connection alive while running
    while (state.status === "running") {
      await stream.sleep(100);
    }

    // Send final status
    await stream.writeSSE({
      data: JSON.stringify({ status: state.status }),
      event: "complete",
    });
  });
});

// Upload zip file
app.post("/api/upload", async (c) => {
  try {
    // Stop any running process first
    if (runningProcess) {
      runningProcess.kill();
      runningProcess = null;
    }

    // Clean up previous project - clear contents inside the directory
    // Using find + rm to handle permission issues and avoid removing the mount point
    try {
      const cleanProc = spawn({
        cmd: ["sh", "-c", `find ${PROJECTS_DIR} -mindepth 1 -delete 2>/dev/null || rm -rf ${PROJECTS_DIR}/* 2>/dev/null || true`],
        stdout: "ignore",
        stderr: "ignore",
      });
      await cleanProc.exited;
    } catch {
      // Ignore cleanup errors
    }
    await mkdir(PROJECTS_DIR, { recursive: true });

    // Clean up previous review output file
    try {
      await rm(REVIEW_OUTPUT_PATH, { force: true });
      console.log(`Deleted review cache: ${REVIEW_OUTPUT_PATH}`);
    } catch (err) {
      console.error(`Failed to delete review cache: ${err}`);
    }

    const formData = await c.req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return c.json({ error: "No file uploaded" }, 400);
    }

    if (!file.name.endsWith(".zip")) {
      return c.json({ error: "File must be a .zip file" }, 400);
    }

    // Save the zip file
    const zipPath = join(UPLOADS_DIR, file.name);
    const arrayBuffer = await file.arrayBuffer();
    await Bun.write(zipPath, arrayBuffer);

    // Extract the zip
    const extractDir = PROJECTS_DIR;
    const unzipProc = spawn(["unzip", "-o", zipPath, "-d", extractDir]);
    await unzipProc.exited;

    if (unzipProc.exitCode !== 0) {
      state = {
        ...state,
        status: "error",
        errorMessage: "Failed to extract zip file",
      };
      emitStatusChange();
      return c.json({ error: "Failed to extract zip file" }, 500);
    }

    // Find the .csproj file
    const csprojPath = await findCsproj(extractDir);
    if (!csprojPath) {
      state = {
        ...state,
        status: "error",
        errorMessage: "No .csproj file found in the uploaded project",
      };
      emitStatusChange();
      return c.json({ error: "No .csproj file found" }, 400);
    }

    const projectDir = join(csprojPath, "..");

    state = {
      name: file.name.replace(".zip", ""),
      status: "uploaded",
      uploadedAt: new Date().toISOString(),
      projectPath: projectDir,
      csprojPath: csprojPath,
      exePath: null,
      buildOutput: "",
      runOutput: "",
      errorMessage: null,
      selectedAssignmentPartId: state.selectedAssignmentPartId,
    };

    // Reset review state on new upload to prevent caching
    reviewState = { ...initialReviewState };
    console.log("Reset reviewState to idle");
    emitReviewStatusChange();

    emitStatusChange();
    return c.json({ success: true, project: state.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    state = {
      ...state,
      status: "error",
      errorMessage: message,
    };
    emitStatusChange();
    return c.json({ error: message }, 500);
  }
});

// Build the project (async - returns immediately, poll /api/status for result)
// Also starts code review in parallel
app.post("/api/build", async (c) => {
  if (!state.csprojPath) {
    return c.json({ error: "No project uploaded" }, 400);
  }

  if (state.status === "building") {
    return c.json({ error: "Build already in progress" }, 400);
  }

  state.status = "building";
  state.buildOutput = "";
  state.errorMessage = null;
  emitStatusChange();

  // Start build in background
  runBuild();

  // Start code review in parallel (if not already reviewing)
  if (reviewState.status !== "reviewing" && state.projectPath) {
    runReview(state.projectPath);
  }

  return c.json({ success: true, message: "Build and review started" });
});

// Background build function with streaming
async function runBuild() {
  try {
    emitBuildOutput("Starting build...\n");

    // Run dotnet build with cross-compilation settings
    const buildProc = spawn({
      cmd: [
        "dotnet",
        "build",
        state.csprojPath!,
        "--configuration",
        "Release",
        "--runtime",
        "win-x64",
        "--self-contained",
        "true",
        "-p:EnableWindowsTargeting=true",
        "-p:PublishSingleFile=false",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });

    // Stream stdout
    const stdoutReader = buildProc.stdout.getReader();
    const stderrReader = buildProc.stderr.getReader();
    const decoder = new TextDecoder();

    // Read stdout in background
    (async () => {
      while (true) {
        const { done, value } = await stdoutReader.read();
        if (done) break;
        emitBuildOutput(decoder.decode(value));
      }
    })();

    // Read stderr in background
    (async () => {
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        emitBuildOutput(decoder.decode(value));
      }
    })();

    await buildProc.exited;

    if (buildProc.exitCode !== 0) {
      state.status = "error";
      state.errorMessage = "Build failed";
      emitStatusChange();
      return;
    }

    // Find the built executable
    const exePath = await findExecutable(state.projectPath!);
    if (!exePath) {
      state.status = "error";
      state.errorMessage = "Could not find built executable";
      emitStatusChange();
      return;
    }

    state.exePath = exePath;
    state.status = "built";
    emitBuildOutput("\nBuild completed successfully!\n");
    emitStatusChange();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    state.status = "error";
    state.errorMessage = message;
    emitStatusChange();
  }
}

// Review container configuration
const REVIEW_CONTAINER_IMAGE = "cst150-review-runner:latest";
const REVIEW_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const REVIEW_INPUT_PATH = "/app/review-input";

// Background review function using sandboxed sibling container
async function runReview(projectPath: string) {
  try {
    // Clean up previous review output
    try {
      await rm(REVIEW_OUTPUT_PATH, { force: true });
    } catch {
      // Ignore if file doesn't exist
    }
    // Ensure output directory exists
    const reviewDir = REVIEW_OUTPUT_PATH.substring(0, REVIEW_OUTPUT_PATH.lastIndexOf('/'));
    await mkdir(reviewDir, { recursive: true });

    // Resolve to absolute path
    const absoluteProjectPath = resolve(projectPath);

    reviewState = {
      status: "reviewing",
      result: null,
      output: "",
      errorMessage: null,
    };
    emitReviewStatusChange();
    emitReviewOutput("Starting code review in sandboxed container...\n");
    emitReviewOutput(`Project path: ${absoluteProjectPath}\n`);

    // Clean and copy project files to shared input volume
    emitReviewOutput("Copying project files to sandbox...\n");
    
    // Ensure we have write permissions and clean the directories
    const cleanInputProc = spawn({
      cmd: ["sh", "-c", `chmod -R 777 ${REVIEW_INPUT_PATH} 2>/dev/null || true; rm -rf ${REVIEW_INPUT_PATH}/* ${REVIEW_INPUT_PATH}/.[!.]* 2>/dev/null || true`],
      stdout: "ignore",
      stderr: "ignore",
    });
    await cleanInputProc.exited;
    
    // Also ensure review-output is writable
    const chmodOutputProc = spawn({
      cmd: ["sh", "-c", `chmod -R 777 ${reviewDir} 2>/dev/null || true; rm -f ${REVIEW_OUTPUT_PATH} 2>/dev/null || true`],
      stdout: "ignore",
      stderr: "ignore",
    });
    await chmodOutputProc.exited;

    emitReviewOutput(`Source: ${absoluteProjectPath}\n`);
    emitReviewOutput(`Target: ${REVIEW_INPUT_PATH}\n`);
    
    const copyProc = spawn({
      cmd: ["cp", "-r", `${absoluteProjectPath}/.`, REVIEW_INPUT_PATH],
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
      emitReviewOutput(`Copy error: ${copyStderrOutput}\n`);
      throw new Error(`Failed to copy project files to sandbox: ${copyStderrOutput}`);
    }

    // Build dynamic agent system prompt with assignment requirements
    let agentSystemPrompt: string;
    let reviewPrompt: string;

    if (state.selectedAssignmentPartId) {
      const assignmentPart = getAssignmentPart(state.selectedAssignmentPartId);
      if (assignmentPart) {
        const requirements = JSON.parse(assignmentPart.requirements) as string[];
        emitReviewOutput(`Reviewing against assignment: ${assignmentPart.title}\n`);

        // Build system prompt with assignment requirements embedded
        agentSystemPrompt = `You are an assignment grader for a CST-150 C# programming course.

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

        reviewPrompt = "Review the student's code in /app/project against the assignment requirements.";
      } else {
        // Assignment part not found - fail hard
        throw new Error(`Assignment part with ID ${state.selectedAssignmentPartId} not found in database. Cannot proceed with review.`);
      }
    } else {
      // No assignment selected - fail hard, require assignment selection
      throw new Error("No assignment selected. You must select an assignment before running code review.");
    }

    // Write dynamic agent config to shared volume
    const agentConfigDir = `${REVIEW_INPUT_PATH}/.opencode-config/opencode/agent`;
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
---
${agentSystemPrompt}
`;

    await Bun.write(`${agentConfigDir}/code-reviewer.md`, agentConfigContent);

    // Also write the opencode config.json pointing to the plugin
    const opencodeConfigContent = {
      plugin: ["/app/opencode-plugin"],
      permission: {
        external_directory: "allow"
      },
      "$schema": "https://opencode.ai/config.json"
    };
    await Bun.write(`${REVIEW_INPUT_PATH}/.opencode-config/opencode/config.json`, JSON.stringify(opencodeConfigContent, null, 2));

    // Fix permissions so review container (user 1000:1000) can write
    // Must run AFTER writing config files, using chmod because container drops CAP_CHOWN
    const chmodProc = spawn({
      cmd: ["chmod", "-R", "777", REVIEW_INPUT_PATH],
      stdout: "ignore",
      stderr: "ignore",
    });
    await chmodProc.exited;

    emitReviewOutput("Generated dynamic agent config with assignment requirements\n");

    // Generate unique container name
    const containerName = `review-${Date.now()}`;

    // Run opencode in sandboxed sibling container with strict resource limits
    emitReviewOutput(`Spawning review container: ${containerName}\n`);
    const reviewProc = spawn({
      cmd: [
        "docker", "run",
        "--name", containerName,
        "--rm",                                    // Auto-remove on exit
        // Resource limits (DoS prevention)
        "--pids-limit", "256",                     // Prevent fork bombs
        "--memory", "1g",                          // Memory limit
        "--memory-swap", "1g",                     // No swap
        "--cpus", "2",                             // CPU limit
        "--ulimit", "nproc=4096:4096",             // Process limit
        "--ulimit", "nofile=4096:4096",            // File descriptor limit
        // Security hardening (escape prevention)
        "--security-opt", "no-new-privileges",    // Block privilege escalation
        "--cap-drop", "ALL",                       // Drop all capabilities
        "--tmpfs", "/tmp:size=256m,mode=1777",    // Limited writable temp
        // Network enabled for LLM API access (opencode needs to call the model)
        "--network", "bridge",
        "--user", "1000:1000",                     // Run as non-root
        // Mount Docker named volumes (shared with main container via docker-compose)
        "-v", "cst-150-checker_review-input:/app/project",       // Project files (writable for opencode config)
        "-v", "cst-150-checker_review-output:/app/review-output", // Review output
        // Dynamic agent config is written to review-input/.opencode-config
        // Environment - point to dynamic config in project volume
        "-e", "XDG_CONFIG_HOME=/app/project/.opencode-config",
        "-e", "XDG_DATA_HOME=/tmp/opencode-data",
        "-e", "XDG_STATE_HOME=/tmp/opencode-state",
        "-e", "XDG_CACHE_HOME=/tmp/opencode-cache",
        "-e", "REVIEW_OUTPUT_PATH=/app/review-output/review.json",
        "-e", "CI=true",
        "-e", "HOME=/home/reviewer",
        "-e", "PATH=/home/reviewer/.opencode/bin:/home/reviewer/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        // Working directory
        "-w", "/app/project",
        // Image and command
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
        emitReviewOutput(decoder.decode(value));
      }
    })();

    // Stream stderr
    const stderrReader = reviewProc.stderr.getReader();
    (async () => {
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        emitReviewOutput(decoder.decode(value));
      }
    })();

    // Wait with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        // Kill the container if it times out
        spawn({ cmd: ["docker", "kill", containerName], stdout: "ignore", stderr: "ignore" });
        reject(new Error(`Review timed out after ${REVIEW_TIMEOUT_MS / 1000} seconds`));
      }, REVIEW_TIMEOUT_MS);
    });

    let exitCode: number | null = null;
    try {
      await Promise.race([reviewProc.exited, timeoutPromise]);
      exitCode = reviewProc.exitCode;
    } catch (timeoutError) {
      emitReviewOutput(`\nReview timed out!\n`);
      reviewState = {
        status: "error",
        result: null,
        output: reviewState.output,
        errorMessage: "Review timed out after 5 minutes",
      };
      emitReviewStatusChange();
      return;
    }
    
    emitReviewOutput(`\nReview container exited with code: ${exitCode}\n`);
    emitReviewOutput(`Looking for review at: ${REVIEW_OUTPUT_PATH}\n`);

    // Check if review was produced
    if (existsSync(REVIEW_OUTPUT_PATH)) {
      try {
        const reviewData = await readFile(REVIEW_OUTPUT_PATH, "utf-8");
        const result: ReviewResult = JSON.parse(reviewData);
        reviewState = {
          status: "completed",
          result,
          output: reviewState.output,
          errorMessage: null,
        };
        emitReviewOutput("\nCode review completed successfully!\n");
        emitReviewStatusChange();
      } catch (parseError) {
        const parseMsg = parseError instanceof Error ? parseError.message : "Unknown parse error";
        emitReviewOutput(`\nFailed to parse review: ${parseMsg}\n`);
        reviewState = {
          status: "error",
          result: null,
          output: reviewState.output,
          errorMessage: `Failed to parse review output: ${parseMsg}`,
        };
        emitReviewStatusChange();
      }
    } else {
      const errorDetails = [
        `Exit code: ${exitCode}`,
        `Expected output at: ${REVIEW_OUTPUT_PATH}`,
        `Check review output stream for container errors`,
      ].join("; ");
      
      emitReviewOutput(`\nReview file not found. ${errorDetails}\n`);
      reviewState = {
        status: "error",
        result: null,
        output: reviewState.output,
        errorMessage: `No review output produced. ${errorDetails}`,
      };
      emitReviewStatusChange();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    reviewState = {
      status: "error",
      result: null,
      output: reviewState.output,
      errorMessage: message,
    };
    emitReviewStatusChange();
  }
}

// Run the application
app.post("/api/run", async (c) => {
  if (!state.exePath) {
    return c.json({ error: "Project not built" }, 400);
  }

  if (state.status === "running") {
    return c.json({ error: "Application already running" }, 400);
  }

  try {
    const exeDir = join(state.exePath, "..");
    const exeName = basename(state.exePath);

    // Copy build output to native filesystem to avoid Wine + 9p/drvfs issues
    // The /app/projects mount uses 9p filesystem which causes Wine crashes
    const nativeRunDir = "/tmp/wine-run";
    const copyResult = Bun.spawnSync({
      cmd: ["sh", "-c", `rm -rf ${nativeRunDir} && cp -r "${exeDir}" ${nativeRunDir}`],
    });
    if (copyResult.exitCode !== 0) {
      return c.json({ error: "Failed to prepare runtime environment" }, 500);
    }

    // Set up Wine environment
    const env = {
      ...process.env,
      WINEPREFIX: "/opt/wine-dotnet",
      WINEDEBUG: "-all",
      DISPLAY: ":99",
      // Disable minidump creation and show exceptions in console instead
      DOTNET_DbgEnableMiniDump: "0",
      COMPlus_DbgEnableMiniDump: "0",
    };

    // Run with Wine from native filesystem
    runningProcess = spawn({
      cmd: ["wine", exeName],
      cwd: nativeRunDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    state.status = "running";
    state.runOutput = "";
    emitRunOutput("Application started\n");
    emitStatusChange();

    // Stream output in background
    const decoder = new TextDecoder();

    const stdout = runningProcess.stdout;
    if (stdout && typeof stdout !== "number") {
      const stdoutReader = stdout.getReader();
      (async () => {
        while (true) {
          try {
            const { done, value } = await stdoutReader.read();
            if (done) break;
            emitRunOutput(decoder.decode(value));
          } catch {
            break;
          }
        }
      })();
    }

    const stderr = runningProcess.stderr;
    if (stderr && typeof stderr !== "number") {
      const stderrReader = stderr.getReader();
      (async () => {
        while (true) {
          try {
            const { done, value } = await stderrReader.read();
            if (done) break;
            emitRunOutput(decoder.decode(value));
          } catch {
            break;
          }
        }
      })();
    }

    // Monitor process exit
    runningProcess.exited.then(() => {
      if (state.status === "running") {
        state.status = "built";
        emitRunOutput("\nApplication exited\n");
        emitStatusChange();
        runningProcess = null;
      }
    });

    return c.json({ success: true, message: "Application started" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    state.status = "error";
    state.errorMessage = message;
    emitStatusChange();
    return c.json({ error: message }, 500);
  }
});

// Stop the application
app.post("/api/stop", async (c) => {
  if (runningProcess) {
    runningProcess.kill();
    runningProcess = null;
    state.status = "built";
    emitRunOutput("\nApplication stopped\n");
    emitStatusChange();
    return c.json({ success: true });
  }
  return c.json({ error: "No application running" }, 400);
});

// Get build output
app.get("/api/build-output", (c) => {
  return c.json({ output: state.buildOutput });
});

// Get run output
app.get("/api/run-output", (c) => {
  return c.json({ output: state.runOutput });
});

// Get review status
app.get("/api/review", (c) => {
  return c.json(reviewState);
});

// Get review output stream
app.get("/api/stream/review", async (c) => {
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

    reviewStreamCallbacks.push(callback);

    // Keep connection alive while reviewing
    while (reviewState.status === "reviewing") {
      await stream.sleep(100);
    }

    // Send final status
    await stream.writeSSE({
      data: JSON.stringify({ 
        status: reviewState.status, 
        result: reviewState.result,
        error: reviewState.errorMessage 
      }),
      event: "complete",
    });
  });
});

// SSE stream for review status changes
app.get("/api/stream/review-status", async (c) => {
  return streamSSE(c, async (stream) => {
    // Send initial state
    await stream.writeSSE({
      data: JSON.stringify(reviewState),
      event: "review-status",
    });

    const callback = async (status: ReviewState) => {
      try {
        await stream.writeSSE({
          data: JSON.stringify(status),
          event: "review-status",
        });
      } catch {
        // Client disconnected
      }
    };

    reviewStatusCallbacks.push(callback);

    // Keep connection alive
    while (true) {
      await stream.sleep(30000);
    }
  });
});

// Debug endpoint to check opencode configuration
app.get("/api/debug/opencode", async (c) => {
  try {
    // Check opencode version and config
    const versionProc = spawn({
      cmd: ["opencode", "--version"],
      env: {
        ...process.env,
        XDG_CONFIG_HOME: OPENCODE_XDG_CONFIG,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    
    const decoder = new TextDecoder();
    let versionOutput = "";
    const reader = versionProc.stdout.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      versionOutput += decoder.decode(value);
    }
    await versionProc.exited;
    
    // Check agent list
    const agentProc = spawn({
      cmd: ["opencode", "agent", "list"],
      env: {
        ...process.env,
        XDG_CONFIG_HOME: OPENCODE_XDG_CONFIG,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    
    let agentOutput = "";
    const agentReader = agentProc.stdout.getReader();
    while (true) {
      const { done, value } = await agentReader.read();
      if (done) break;
      agentOutput += decoder.decode(value);
    }
    await agentProc.exited;
    
    // Check config
    const configProc = spawn({
      cmd: ["opencode", "debug", "config"],
      env: {
        ...process.env,
        XDG_CONFIG_HOME: OPENCODE_XDG_CONFIG,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    
    let configOutput = "";
    const configReader = configProc.stdout.getReader();
    while (true) {
      const { done, value } = await configReader.read();
      if (done) break;
      configOutput += decoder.decode(value);
    }
    await configProc.exited;
    
    return c.json({
      version: versionOutput.trim(),
      agents: agentOutput,
      config: configOutput.substring(0, 2000), // Truncate for readability
      env: {
        XDG_CONFIG_HOME: OPENCODE_XDG_CONFIG,
        REVIEW_OUTPUT_PATH: REVIEW_OUTPUT_PATH,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: message }, 500);
  }
});

// Debug endpoint to test review input permissions
app.get("/api/debug/review-permissions", async (c) => {
  const results: string[] = [];
  const decoder = new TextDecoder();
  
  async function runCmd(cmd: string[], label: string): Promise<string> {
    const proc = spawn({ cmd, stdout: "pipe", stderr: "pipe" });
    let out = "";
    const reader = proc.stdout.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value);
    }
    const errReader = proc.stderr.getReader();
    while (true) {
      const { done, value } = await errReader.read();
      if (done) break;
      out += decoder.decode(value);
    }
    await proc.exited;
    return `${label} (exit ${proc.exitCode}):\n${out}`;
  }

  // Check current state of review-input
  results.push(await runCmd(["ls", "-la", REVIEW_INPUT_PATH], "ls review-input"));
  
  // Check .opencode-config if it exists
  const configPath = `${REVIEW_INPUT_PATH}/.opencode-config`;
  results.push(await runCmd(["ls", "-laR", configPath], "ls opencode-config"));
  
  // Try chmod (chown won't work due to cap_drop: ALL)
  results.push(await runCmd(["chmod", "-R", "777", REVIEW_INPUT_PATH], "chmod"));
  
  // Check again after chmod
  results.push(await runCmd(["ls", "-la", REVIEW_INPUT_PATH], "ls after chmod"));
  results.push(await runCmd(["ls", "-laR", configPath], "ls opencode-config after chmod"));
  
  // Test write as user 1000 using docker
  const testFile = `${REVIEW_INPUT_PATH}/.opencode-config/opencode/test-write.txt`;
  results.push(await runCmd([
    "docker", "run", "--rm", 
    "-v", "cst-150-checker_review-input:/app/project",
    "--user", "1000:1000",
    "alpine", "sh", "-c", 
    `echo 'test' > /app/project/.opencode-config/opencode/test-write.txt && echo 'Write succeeded' || echo 'Write failed'`
  ], "docker write test"));
  
  return c.text(results.join("\n\n"));
});

// Reset state
app.post("/api/reset", async (c) => {
  if (runningProcess) {
    runningProcess.kill();
    runningProcess = null;
  }

  // Clear contents - clear inside the directory to preserve mount point
  try {
    const cleanProc = spawn({
      cmd: ["sh", "-c", `find ${PROJECTS_DIR} -mindepth 1 -delete 2>/dev/null || rm -rf ${PROJECTS_DIR}/* 2>/dev/null || true`],
      stdout: "ignore",
      stderr: "ignore",
    });
    await cleanProc.exited;
  } catch {
    // Ignore cleanup errors
  }

  // Clean up review output
  try {
    await rm(REVIEW_OUTPUT_PATH, { force: true });
  } catch {
    // Ignore if doesn't exist
  }

  state = { ...initialState };
  reviewState = { ...initialReviewState };
  emitStatusChange();
  emitReviewStatusChange();

  return c.json({ success: true });
});

// Helper: Find .csproj file recursively
async function findCsproj(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".csproj")) {
      return fullPath;
    }
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      const found = await findCsproj(fullPath);
      if (found) return found;
    }
  }
  return null;
}

// Helper: Find built executable
async function findExecutable(projectDir: string): Promise<string | null> {
  if (!state.csprojPath) return null;

  // Try to get AssemblyName from csproj, fall back to csproj filename
  let assemblyName = basename(state.csprojPath, ".csproj");
  try {
    const csprojContent = await Bun.file(state.csprojPath).text();
    const match = csprojContent.match(/<AssemblyName>([^<]+)<\/AssemblyName>/);
    if (match) {
      assemblyName = match[1];
    }
  } catch {
    // Use default from filename
  }
  const expectedExeName = assemblyName + ".exe";

  const searchPaths = [
    "bin/Release/net8.0-windows/win-x64",
    "bin/Release/net8.0-windows",
    "bin/Release/net7.0-windows/win-x64",
    "bin/Release/net6.0-windows/win-x64",
    "bin/Release",
  ];

  for (const searchPath of searchPaths) {
    const fullPath = join(projectDir, searchPath);
    if (existsSync(fullPath)) {
      try {
        const entries = await readdir(fullPath);
        if (entries.includes(expectedExeName)) {
          return join(fullPath, expectedExeName);
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

const port = parseInt(process.env.PORT || "3000");
console.log(`Server running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 120, // 2 minutes for SSE streams
};
