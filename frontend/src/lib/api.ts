/**
 * API client for the CST-150 Checker backend
 * 
 * Session-based multi-user API with queue support.
 */

const API_BASE = '/api';

export interface AssignmentPart {
  id: number;
  assignment_id: number;
  assignment_name: string;
  part_number: number;
  title: string;
  description: string;
  requirements: string; // JSON string
}

export interface ReviewResult {
  summary: string;
  overallScore?: number;
  requirementResults?: Array<{
    requirement: string;
    status: 'met' | 'partial' | 'not_met';
    feedback: string;
    points: number;
  }>;
  issues?: Array<{
    severity: 'error' | 'warning' | 'info';
    file?: string;
    line?: number;
    message: string;
    suggestion?: string;
  }>;
  positives?: string[];
}

export interface SessionStatus {
  status: 'pending' | 'starting' | 'ready' | 'building' | 'built' | 'running' | 'error' | 'queued';
  sessionId?: string;
  vncPort?: number;
  queuePosition?: number;
  projectName?: string;
  buildOutput?: string;
  runOutput?: string;
  errorMessage?: string;
  selectedAssignmentPartId?: number;
}

export interface ReviewStatus {
  status: 'idle' | 'reviewing' | 'completed' | 'error';
  output?: string;
  result?: ReviewResult;
  errorMessage?: string;
}

export interface AcquireSessionResult {
  status: 'acquired' | 'queued';
  sessionId: string;
  vncPort?: number;
  queuePosition?: number;
  message?: string;
}

class ApiClient {
  private sessionId: string | null = null;

  /**
   * Get the current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Set the session ID (for restoration from storage)
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Acquire a new session
   */
  async acquireSession(): Promise<AcquireSessionResult> {
    const res = await fetch(`${API_BASE}/session/acquire`, { method: 'POST' });
    const data = await res.json() as AcquireSessionResult;
    this.sessionId = data.sessionId;
    return data;
  }

  /**
   * Get current session status
   */
  async getSessionStatus(): Promise<SessionStatus> {
    if (!this.sessionId) {
      throw new Error('No session acquired');
    }
    const res = await fetch(`${API_BASE}/session/${this.sessionId}`);
    return res.json();
  }

  /**
   * Send heartbeat to keep session alive
   */
  async heartbeat(): Promise<void> {
    if (!this.sessionId) return;
    await fetch(`${API_BASE}/session/${this.sessionId}/heartbeat`, { method: 'POST' });
  }

  /**
   * Release the current session
   */
  async releaseSession(): Promise<void> {
    if (!this.sessionId) return;
    
    // Use sendBeacon for page unload scenarios
    if (navigator.sendBeacon) {
      navigator.sendBeacon(`${API_BASE}/session/${this.sessionId}/release`);
    } else {
      await fetch(`${API_BASE}/session/${this.sessionId}/release`, { method: 'POST' });
    }
    
    this.sessionId = null;
  }

  /**
   * Get all assignment parts
   */
  async getAssignmentParts(): Promise<AssignmentPart[]> {
    const res = await fetch(`${API_BASE}/assignments/parts/all`);
    return res.json();
  }

  /**
   * Select an assignment for the current session
   */
  async selectAssignment(partId: number): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No session acquired');
    }
    await fetch(`${API_BASE}/project/${this.sessionId}/select-assignment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partId }),
    });
  }

  /**
   * Upload a project file
   */
  async uploadFile(file: File): Promise<{ project: string }> {
    if (!this.sessionId) {
      throw new Error('No session acquired');
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    const res = await fetch(`${API_BASE}/project/${this.sessionId}/upload`, {
      method: 'POST',
      body: formData,
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Upload failed');
    }
    
    return res.json();
  }

  /**
   * Start building the project
   */
  async startBuild(): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No session acquired');
    }
    
    const res = await fetch(`${API_BASE}/project/${this.sessionId}/build`, { method: 'POST' });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Build failed to start');
    }
  }

  /**
   * Start running the application
   */
  async startRun(): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No session acquired');
    }
    
    const res = await fetch(`${API_BASE}/project/${this.sessionId}/run`, { method: 'POST' });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to start application');
    }
  }

  /**
   * Stop the running application
   */
  async stop(): Promise<void> {
    if (!this.sessionId) return;
    await fetch(`${API_BASE}/project/${this.sessionId}/stop`, { method: 'POST' });
  }

  /**
   * Reset the session project state
   */
  async reset(): Promise<void> {
    if (!this.sessionId) return;
    await fetch(`${API_BASE}/project/${this.sessionId}/reset`, { method: 'POST' });
  }

  /**
   * Get review status
   */
  async getReviewStatus(): Promise<ReviewStatus> {
    const res = await fetch(`${API_BASE}/review`);
    return res.json();
  }

  /**
   * Get VNC URL for the current session
   */
  getVncUrl(): string {
    // Session status should have been fetched to get vncPort
    // For now, use the stored session data or default
    const port = this.currentVncPort || 6081;
    return `${window.location.protocol}//${window.location.hostname}:${port}/vnc.html?autoconnect=true&resize=scale`;
  }

  // Store VNC port when session is acquired
  private currentVncPort: number | null = null;
  
  setVncPort(port: number): void {
    this.currentVncPort = port;
  }

  /**
   * Get SSE stream URLs for the current session
   */
  get streams() {
    const sessionId = this.sessionId;
    return {
      status: sessionId ? `${API_BASE}/session/${sessionId}/stream/status` : '',
      build: sessionId ? `${API_BASE}/session/${sessionId}/stream/build` : '',
      run: sessionId ? `${API_BASE}/session/${sessionId}/stream/run` : '',
      review: `${API_BASE}/review/stream`,
      reviewStatus: `${API_BASE}/review/stream/status`,
    };
  }
}

// Export singleton instance
export const api = new ApiClient();
