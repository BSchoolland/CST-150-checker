const API_BASE = "/api";

// Types
export interface AssignmentPart {
  id: number;
  assignment_name?: string;
  part_number: number;
  title: string;
  description: string;
  requirements: string;
}

export interface RequirementResult {
  requirement: string;
  status: "met" | "partial" | "not_met";
  feedback: string;
  points: number;
}

export interface Issue {
  severity: "error" | "warning" | "info";
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

export interface ReviewResult {
  overallScore?: number;
  summary: string;
  requirementResults?: RequirementResult[];
  issues?: Issue[];
  positives?: string[];
}

export interface ReviewStatus {
  status: "idle" | "reviewing" | "completed";
  result?: ReviewResult;
}

export interface SessionStatus {
  status: string;
  queuePosition?: number;
  vncPort?: number;
  projectName?: string;
  selectedAssignmentPartId?: number;
  buildOutput?: string;
  runOutput?: string;
  errorMessage?: string;
}

export interface AcquireSessionResult {
  status: "queued" | "acquired";
  sessionId: string;
  queuePosition?: number;
  vncPort?: number;
}

export interface UploadResult {
  project: string;
}

// State - session ID is stored here after acquisition
let sessionId: string | null = null;
let vncPort: number | null = null;

// API functions
async function fetchJson<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

// Helper to ensure session ID exists
function requireSessionId(): string {
  if (!sessionId) {
    throw new Error("Session not acquired. Call acquireSession first.");
  }
  return sessionId;
}

export const api = {
  // Session management
  acquireSession: async (): Promise<AcquireSessionResult> => {
    const result = await fetchJson<AcquireSessionResult>("/session/acquire", {
      method: "POST",
    });
    sessionId = result.sessionId;
    if (result.vncPort) {
      vncPort = result.vncPort;
    }
    return result;
  },

  releaseSession: async (): Promise<void> => {
    const sid = sessionId;
    if (!sid) return;
    sessionId = null;
    vncPort = null;
    // Use sendBeacon for page unload reliability
    navigator.sendBeacon(`${API_BASE}/session/${sid}/release`);
  },

  heartbeat: (): Promise<{ ok: boolean }> => {
    const sid = requireSessionId();
    return fetchJson(`/session/${sid}/heartbeat`, { method: "POST" });
  },

  getSessionStatus: (): Promise<SessionStatus> => {
    const sid = requireSessionId();
    return fetchJson(`/session/${sid}`);
  },

  // Session ID getter/setter (for hooks that need access)
  getSessionId: () => sessionId,
  setSessionId: (id: string) => {
    sessionId = id;
  },

  // Assignments
  getAssignmentParts: (): Promise<AssignmentPart[]> =>
    fetchJson("/assignments/parts/all"),

  selectAssignment: (partId: number): Promise<void> => {
    const sid = requireSessionId();
    return fetchJson(`/project/${sid}/select-assignment`, {
      method: "POST",
      body: JSON.stringify({ partId }),
    });
  },

  // File operations
  uploadFile: async (file: File): Promise<UploadResult> => {
    const sid = requireSessionId();
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`${API_BASE}/project/${sid}/upload`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: "Upload failed" }));
      throw new Error(error.error || `Upload failed: ${res.status}`);
    }

    return res.json();
  },

  // Build/Run operations
  startBuild: (): Promise<void> => {
    const sid = requireSessionId();
    return fetchJson(`/project/${sid}/build`, { method: "POST" });
  },

  startRun: (): Promise<void> => {
    const sid = requireSessionId();
    return fetchJson(`/project/${sid}/run`, { method: "POST" });
  },

  stop: (): Promise<void> => {
    const sid = requireSessionId();
    return fetchJson(`/project/${sid}/stop`, { method: "POST" });
  },

  reset: (): Promise<void> => {
    const sid = requireSessionId();
    return fetchJson(`/project/${sid}/reset`, { method: "POST" });
  },

  // Review
  getReviewStatus: (): Promise<ReviewStatus> => {
    const sid = requireSessionId();
    return fetchJson(`/review/${sid}/status`);
  },

  startReview: (): Promise<void> => {
    const sid = requireSessionId();
    return fetchJson(`/review/${sid}/start`, { method: "POST" });
  },

  // VNC
  setVncPort: (port: number) => {
    vncPort = port;
  },

  getVncPort: () => vncPort,

  getVncUrl: () => {
    if (!vncPort) return "";
    // VNC is served directly from session container on its own port
    // Session containers expose noVNC on ports 6081-6083
    return `http://${window.location.hostname}:${vncPort}/vnc.html?autoconnect=true&resize=scale`;
  },

  // SSE stream URLs (need session ID)
  getStreamUrls: () => {
    const sid = sessionId;
    if (!sid) {
      return {
        build: "",
        status: "",
        review: "",
        reviewStatus: "",
      };
    }
    return {
      build: `${API_BASE}/session/${sid}/stream/build`,
      status: `${API_BASE}/session/${sid}/stream/status`,
      review: `${API_BASE}/review/${sid}/stream`,
      reviewStatus: `${API_BASE}/review/${sid}/stream/status`,
    };
  },
};
