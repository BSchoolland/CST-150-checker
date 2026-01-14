/**
 * Session Manager - Handles multi-user session state and lifecycle
 * 
 * Supports up to MAX_CONCURRENT_SESSIONS concurrent sessions with a queue for additional users.
 * Each session gets an isolated Docker container with its own VNC display.
 */

export const MAX_CONCURRENT_SESSIONS = 3;
export const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
export const HEARTBEAT_TIMEOUT_MS = 60 * 1000; // 60 seconds without heartbeat = dead session
export const VNC_PORT_POOL = [6081, 6082, 6083]; // 3 ports for 3 concurrent sessions

export type SessionStatus = 
  | 'pending'      // Session acquired but container not started
  | 'starting'     // Container starting up
  | 'ready'        // Container ready, waiting for upload
  | 'building'     // Project being built
  | 'built'        // Build completed successfully
  | 'running'      // Application running in Wine
  | 'error';       // Error state

export interface Session {
  id: string;
  createdAt: Date;
  lastHeartbeat: Date;
  
  // Container info
  containerId: string | null;
  containerName: string;
  vncPort: number;
  
  // Project state
  status: SessionStatus;
  projectName: string | null;
  csprojPath: string | null;
  exePath: string | null;
  buildOutput: string;
  runOutput: string;
  errorMessage: string | null;
  
  // Assignment
  selectedAssignmentPartId: number | null;
}

export type SessionCallback = (session: Session) => void;

// Session manager singleton state
class SessionManager {
  activeSessions: Map<string, Session> = new Map();
  queue: string[] = [];
  usedPorts: Set<number> = new Set();
  
  // Callbacks for SSE streaming per session
  sessionCallbacks: Map<string, SessionCallback[]> = new Map();
  buildCallbacks: Map<string, ((data: string) => void)[]> = new Map();
  runCallbacks: Map<string, ((data: string) => void)[]> = new Map();
  
  // Queue promotion callbacks (for notifying queued users)
  queueCallbacks: Map<string, ((position: number) => void)[]> = new Map();

  /**
   * Allocate a VNC port from the pool
   */
  allocateVncPort(): number {
    for (const port of VNC_PORT_POOL) {
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port);
        return port;
      }
    }
    throw new Error("No VNC ports available");
  }

  /**
   * Release a VNC port back to the pool
   */
  releaseVncPort(port: number): void {
    this.usedPorts.delete(port);
  }

  /**
   * Try to acquire a session. Returns session if slot available, or queue position if full.
   */
  acquireSession(): { session: Session } | { queuePosition: number; sessionId: string } {
    const sessionId = crypto.randomUUID();
    
    if (this.activeSessions.size >= MAX_CONCURRENT_SESSIONS) {
      // Add to queue
      this.queue.push(sessionId);
      const position = this.queue.indexOf(sessionId) + 1;
      return { queuePosition: position, sessionId };
    }
    
    // Allocate VNC port
    const vncPort = this.allocateVncPort();
    
    // Create session
    const session: Session = {
      id: sessionId,
      createdAt: new Date(),
      lastHeartbeat: new Date(),
      containerId: null,
      containerName: `session-${sessionId.slice(0, 8)}`,
      vncPort,
      status: 'pending',
      projectName: null,
      csprojPath: null,
      exePath: null,
      buildOutput: '',
      runOutput: '',
      errorMessage: null,
      selectedAssignmentPartId: null,
    };
    
    this.activeSessions.set(sessionId, session);
    this.sessionCallbacks.set(sessionId, []);
    this.buildCallbacks.set(sessionId, []);
    this.runCallbacks.set(sessionId, []);
    
    return { session };
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): Session | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Update heartbeat timestamp
   */
  heartbeat(sessionId: string): boolean {
    const session = this.activeSessions.get(sessionId);
    if (!session) return false;
    session.lastHeartbeat = new Date();
    return true;
  }

  /**
   * Get queue position for a queued session
   */
  getQueuePosition(sessionId: string): number {
    const index = this.queue.indexOf(sessionId);
    return index === -1 ? 0 : index + 1;
  }

  /**
   * Check if session is in queue
   */
  isQueued(sessionId: string): boolean {
    return this.queue.includes(sessionId);
  }

  /**
   * Update session state and emit to listeners
   */
  updateSession(sessionId: string, updates: Partial<Session>): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;
    
    Object.assign(session, updates);
    this.emitSessionUpdate(sessionId);
  }

  /**
   * Emit session update to all listeners
   */
  emitSessionUpdate(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;
    
    const callbacks = this.sessionCallbacks.get(sessionId) || [];
    callbacks.forEach(cb => {
      try {
        cb(session);
      } catch (e) {
        // Listener disconnected
      }
    });
  }

  /**
   * Emit build output to listeners
   */
  emitBuildOutput(sessionId: string, data: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;
    
    session.buildOutput += data;
    
    const callbacks = this.buildCallbacks.get(sessionId) || [];
    callbacks.forEach(cb => {
      try {
        cb(data);
      } catch (e) {
        // Listener disconnected
      }
    });
  }

  /**
   * Emit run output to listeners
   */
  emitRunOutput(sessionId: string, data: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;
    
    session.runOutput += data;
    
    const callbacks = this.runCallbacks.get(sessionId) || [];
    callbacks.forEach(cb => {
      try {
        cb(data);
      } catch (e) {
        // Listener disconnected
      }
    });
  }

  /**
   * Add a session update listener
   */
  addSessionListener(sessionId: string, callback: SessionCallback): void {
    const callbacks = this.sessionCallbacks.get(sessionId) || [];
    callbacks.push(callback);
    this.sessionCallbacks.set(sessionId, callbacks);
  }

  /**
   * Add a build output listener
   */
  addBuildListener(sessionId: string, callback: (data: string) => void): void {
    const callbacks = this.buildCallbacks.get(sessionId) || [];
    callbacks.push(callback);
    this.buildCallbacks.set(sessionId, callbacks);
  }

  /**
   * Add a run output listener
   */
  addRunListener(sessionId: string, callback: (data: string) => void): void {
    const callbacks = this.runCallbacks.get(sessionId) || [];
    callbacks.push(callback);
    this.runCallbacks.set(sessionId, callbacks);
  }

  /**
   * Add a queue position listener
   */
  addQueueListener(sessionId: string, callback: (position: number) => void): void {
    const callbacks = this.queueCallbacks.get(sessionId) || [];
    callbacks.push(callback);
    this.queueCallbacks.set(sessionId, callbacks);
  }

  /**
   * Release a session and clean up resources
   */
  releaseSession(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    
    // Remove from queue if queued
    const queueIndex = this.queue.indexOf(sessionId);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
      this.queueCallbacks.delete(sessionId);
      // Update queue positions for remaining queued sessions
      this.notifyQueueUpdate();
      return;
    }
    
    if (!session) return;
    
    // Release VNC port
    this.releaseVncPort(session.vncPort);
    
    // Clean up callbacks
    this.sessionCallbacks.delete(sessionId);
    this.buildCallbacks.delete(sessionId);
    this.runCallbacks.delete(sessionId);
    
    // Remove session
    this.activeSessions.delete(sessionId);
    
    // Promote next queued user
    this.promoteFromQueue();
  }

  /**
   * Notify all queued sessions of their updated position
   */
  private notifyQueueUpdate(): void {
    this.queue.forEach((sessionId, index) => {
      const callbacks = this.queueCallbacks.get(sessionId) || [];
      callbacks.forEach(cb => {
        try {
          cb(index + 1);
        } catch (e) {
          // Listener disconnected
        }
      });
    });
  }

  /**
   * Promote the next session from the queue to active
   */
  promoteFromQueue(): Session | null {
    if (this.queue.length === 0) return null;
    if (this.activeSessions.size >= MAX_CONCURRENT_SESSIONS) return null;
    
    const sessionId = this.queue.shift()!;
    
    // Allocate VNC port
    const vncPort = this.allocateVncPort();
    
    // Create session
    const session: Session = {
      id: sessionId,
      createdAt: new Date(),
      lastHeartbeat: new Date(),
      containerId: null,
      containerName: `session-${sessionId.slice(0, 8)}`,
      vncPort,
      status: 'pending',
      projectName: null,
      csprojPath: null,
      exePath: null,
      buildOutput: '',
      runOutput: '',
      errorMessage: null,
      selectedAssignmentPartId: null,
    };
    
    this.activeSessions.set(sessionId, session);
    this.sessionCallbacks.set(sessionId, []);
    this.buildCallbacks.set(sessionId, []);
    this.runCallbacks.set(sessionId, []);
    
    // Move queue listeners to promotion notification
    const queueCallbacks = this.queueCallbacks.get(sessionId) || [];
    this.queueCallbacks.delete(sessionId);
    
    // Notify remaining queued users of their new position
    this.notifyQueueUpdate();
    
    // Notify promoted user (position 0 = promoted)
    queueCallbacks.forEach(cb => {
      try {
        cb(0);
      } catch (e) {
        // Listener disconnected
      }
    });
    
    return session;
  }

  /**
   * Find sessions that have timed out
   */
  findTimedOutSessions(): string[] {
    const now = Date.now();
    const timedOut: string[] = [];
    
    for (const [sessionId, session] of this.activeSessions) {
      const timeSinceHeartbeat = now - session.lastHeartbeat.getTime();
      const sessionAge = now - session.createdAt.getTime();
      
      // Kill if no heartbeat for 60 seconds OR session older than 10 minutes
      if (timeSinceHeartbeat > HEARTBEAT_TIMEOUT_MS || sessionAge > SESSION_TIMEOUT_MS) {
        timedOut.push(sessionId);
      }
    }
    
    return timedOut;
  }

  /**
   * Get all active sessions (for admin/debug)
   */
  getAllSessions(): Session[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Get queue info
   */
  getQueueInfo(): { length: number; sessionIds: string[] } {
    return {
      length: this.queue.length,
      sessionIds: [...this.queue],
    };
  }
}

// Export singleton instance
export const sessionManager = new SessionManager();
