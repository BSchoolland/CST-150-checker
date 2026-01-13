import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { spawn, type Subprocess } from "bun";
import { mkdir, readdir } from "fs/promises";
import { join, basename } from "path";
import { existsSync } from "fs";
import { streamSSE } from "hono/streaming";

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
};

let state: ProjectState = { ...initialState };

let runningProcess: Subprocess | null = null;

// Event emitters for streaming
type StreamCallback = (data: string) => void;
let buildStreamCallbacks: StreamCallback[] = [];
let runStreamCallbacks: StreamCallback[] = [];
let statusStreamCallbacks: ((status: ProjectState) => void)[] = [];

function emitBuildOutput(data: string) {
  state.buildOutput += data;
  buildStreamCallbacks.forEach((cb) => cb(data));
}

function emitRunOutput(data: string) {
  state.runOutput += data;
  runStreamCallbacks.forEach((cb) => cb(data));
}

function emitStatusChange() {
  statusStreamCallbacks.forEach((cb) => cb(state));
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
    };

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

  return c.json({ success: true, message: "Build started" });
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

    // Set up Wine environment
    const env = {
      ...process.env,
      WINEPREFIX: "/opt/wine-dotnet",
      WINEDEBUG: "-all",
      DISPLAY: ":99",
    };

    // Run with Wine
    runningProcess = spawn({
      cmd: ["wine", exeName],
      cwd: exeDir,
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

  state = { ...initialState };
  emitStatusChange();

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
        const exe = entries.find((f) => f.endsWith(".exe"));
        if (exe) {
          return join(fullPath, exe);
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
