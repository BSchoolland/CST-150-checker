import { useEffect, useCallback } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { AssignmentSelect } from "@/components/steps/AssignmentSelect";
import { UploadStep } from "@/components/steps/UploadStep";
import { BuildStep } from "@/components/steps/BuildStep";
import { RunStep } from "@/components/steps/RunStep";
import { ReviewStep } from "@/components/steps/ReviewStep";
import { QueueDisplay } from "@/components/QueueDisplay";
import { SessionInitializing } from "@/components/SessionInitializing";
import { SessionError } from "@/components/SessionError";
import { useWorkflow } from "@/hooks/useWorkflow";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

function WorkflowPage() {
  const { currentStep, reset, goToPage, assignments, selectedAssignmentId } =
    useWorkflow();

  // Redirect to assignment selection if no assignment is selected
  useEffect(() => {
    if (selectedAssignmentId === null) {
      goToPage("select");
    }
  }, [selectedAssignmentId, goToPage]);

  // Get selected assignment for the header
  const selectedAssignment = assignments.find(
    (a) => a.id === selectedAssignmentId
  );

  const handleChangeAssignment = async () => {
    await api.stop();
    await api.reset();
    reset();
    goToPage("select");
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar onChangeAssignment={handleChangeAssignment} />

      <main className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Selected assignment header */}
          {selectedAssignment && (
            <div className="px-4 py-3 rounded-lg bg-slate-800/50 border border-slate-700 text-center">
              <span className="text-sm text-slate-400">Checking: </span>
              <span className="text-sm text-emerald-400 font-medium">
                {selectedAssignment.title}
              </span>
            </div>
          )}

          {/* Step content - all steps stay rendered but hidden to preserve state */}
          <div className={cn(currentStep !== "upload" && "hidden")}>
            <UploadStep />
          </div>
          <div className={cn(currentStep !== "build" && "hidden")}>
            <BuildStep />
          </div>
          <div className={cn(currentStep !== "run" && "hidden")}>
            <RunStep />
          </div>
          <div className={cn(currentStep !== "review" && "hidden")}>
            <ReviewStep />
          </div>
        </div>
      </main>
    </div>
  );
}

function App() {
  const {
    sessionState,
    sessionId,
    queuePosition,
    sessionError,
    currentPage,
    setSessionState,
    setSessionId,
    setVncPort,
    setQueuePosition,
    setSessionError,
    setAssignments,
    selectAssignment,
    goToPage,
    goToStep,
    setStepStatus,
    setProjectName,
    appendBuildOutput,
    appendRunOutput,
  } = useWorkflow();

  // Initialize session
  const initSession = useCallback(async () => {
    setSessionState('initializing');
    
    try {
      // Acquire session
      const result = await api.acquireSession();
      
      if (result.status === 'queued') {
        setSessionState('queued');
        setSessionId(result.sessionId);
        setQueuePosition(result.queuePosition!);
        
        // Start polling for queue updates
        pollQueueStatus(result.sessionId);
      } else {
        setSessionState('active');
        setSessionId(result.sessionId);
        if (result.vncPort) {
          setVncPort(result.vncPort);
          api.setVncPort(result.vncPort);
        }
        
        // Load assignments
        await loadAssignments();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to acquire session';
      setSessionError(message);
    }
  }, [setSessionState, setSessionId, setVncPort, setQueuePosition, setSessionError]);

  // Poll for queue status updates
  const pollQueueStatus = useCallback(async (sessionIdToPoll: string) => {
    try {
      const status = await api.getSessionStatus();
      
      if (status.status === 'queued') {
        setQueuePosition(status.queuePosition || 0);
        // Continue polling
        setTimeout(() => pollQueueStatus(sessionIdToPoll), 3000);
      } else {
        // Promoted!
        setSessionState('active');
        if (status.vncPort) {
          setVncPort(status.vncPort);
          api.setVncPort(status.vncPort);
        }
        await loadAssignments();
      }
    } catch (err) {
      // Session might have been released, retry init
      initSession();
    }
  }, [setSessionState, setVncPort, setQueuePosition, initSession]);

  // Load assignments
  const loadAssignments = async () => {
    try {
      const assignments = await api.getAssignmentParts();
      setAssignments(assignments);
      
      // Check current server state for session restoration
      const status = await api.getSessionStatus();
      
      if (status.status !== 'pending' && status.status !== 'ready') {
        restoreWorkflowState(status);
      }
    } catch (err) {
      console.error("Failed to load assignments:", err);
    }
  };

  // Restore workflow state from session status
  const restoreWorkflowState = (status: Awaited<ReturnType<typeof api.getSessionStatus>>) => {
    goToPage("workflow");
    if (status.projectName) setProjectName(status.projectName);
    if (status.selectedAssignmentPartId) {
      selectAssignment(status.selectedAssignmentPartId);
    }

    if (status.status === "running") {
      setStepStatus("upload", "completed");
      setStepStatus("build", "completed");
      setStepStatus("run", "processing");
      goToStep("run");
      if (status.runOutput) appendRunOutput(status.runOutput);
    } else if (status.status === "building") {
      setStepStatus("upload", "completed");
      setStepStatus("build", "processing");
      goToStep("build");
      if (status.buildOutput) appendBuildOutput(status.buildOutput);
    } else if (status.status === "built") {
      setStepStatus("upload", "completed");
      setStepStatus("build", "completed");
      goToStep("run");
    } else if (status.status === "ready" && status.projectName) {
      setStepStatus("upload", "completed");
      goToStep("build");
    } else if (status.status === "error") {
      // Handle error state
      setStepStatus("upload", "completed");
      goToStep("build");
    }
  };

  // Initialize on mount
  useEffect(() => {
    initSession();
    
    // Cleanup on unmount / page close
    return () => {
      api.releaseSession();
    };
  }, [initSession]);

  // Heartbeat interval
  useEffect(() => {
    if (sessionState !== 'active') return;
    
    const interval = setInterval(async () => {
      try {
        await api.heartbeat();
      } catch (err) {
        // Session was lost (server restart, timeout, etc.)
        console.error("Heartbeat failed:", err);
        const message = err instanceof Error ? err.message : 'Session lost';
        setSessionState('error');
        setSessionError(message);
      }
    }, 10_000);
    
    return () => clearInterval(interval);
  }, [sessionState, setSessionState, setSessionError]);

  // Handle page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      api.releaseSession();
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [sessionId]);

  // Render based on session state
  if (sessionState === 'initializing') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900">
        <SessionInitializing />
      </div>
    );
  }

  if (sessionState === 'queued') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900">
        <QueueDisplay position={queuePosition} />
      </div>
    );
  }

  if (sessionState === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900">
        <SessionError 
          error={sessionError || 'Unknown error'} 
          onRetry={initSession}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900">
      {currentPage === "select" && <AssignmentSelect />}
      {currentPage === "workflow" && <WorkflowPage />}
    </div>
  );
}

export default App;
