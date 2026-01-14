import { useEffect, useCallback, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useWorkflow } from "@/hooks/useWorkflow";
import { useSSE } from "@/hooks/useSSE";
import {
  Play,
  Check,
  AlertCircle,
  RotateCcw,
  Terminal,
  AlertTriangle,
} from "lucide-react";

export function RunStep() {
  const {
    runOutput,
    appendRunOutput,
    stepStatuses,
    setStepStatus,
    goToStep,
    setError,
    clearError,
  } = useWorkflow();

  const outputRef = useRef<HTMLPreElement>(null);
  const hasStartedRun = useRef(false);
  const [showVnc, setShowVnc] = useState(false);

  // Start the run when entering this step
  useEffect(() => {
    if (
      stepStatuses.build === "completed" &&
      stepStatuses.run === "pending" &&
      !hasStartedRun.current
    ) {
      hasStartedRun.current = true;
      setStepStatus("run", "processing");
      clearError();
      api
        .startRun()
        .then(() => {
          setShowVnc(true);
        })
        .catch((err) => {
          setError(err.message, "run");
        });
    }
  }, [stepStatuses.build, stepStatuses.run, setStepStatus, setError, clearError]);

  // Handle SSE stream
  const handleMessage = useCallback(
    (event: string, data: string) => {
      if (event === "output") {
        appendRunOutput(data);
      }
    },
    [appendRunOutput]
  );

  useSSE(stepStatuses.run === "processing" ? api.streams.run : null, {
    onMessage: handleMessage,
  });

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [runOutput]);

  const status = stepStatuses.run;
  const isFailed = status === "failed";

  const handleDone = async () => {
    await api.stop();
    setStepStatus("run", "completed");
    goToStep("review");
  };

  const handleRestart = async () => {
    await api.stop();
    setShowVnc(false);
    hasStartedRun.current = false;
    setStepStatus("run", "pending");
    clearError();
    // Trigger re-run
    setTimeout(() => {
      setStepStatus("run", "processing");
      api
        .startRun()
        .then(() => {
          setShowVnc(true);
        })
        .catch((err) => {
          setError(err.message, "run");
        });
    }, 100);
  };

  const handleRetry = async () => {
    await api.reset();
    hasStartedRun.current = false;
    clearError();
    setStepStatus("run", "pending");
    goToStep("upload");
  };

  return (
    <div className="space-y-4">
      <Card className="border-slate-800 bg-slate-900/50">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center",
                  isFailed ? "bg-rose-500/10" : "bg-emerald-500/10"
                )}
              >
                {isFailed ? (
                  <AlertCircle className="w-5 h-5 text-rose-400" />
                ) : (
                  <Play className="w-5 h-5 text-emerald-400" />
                )}
              </div>
              <div>
                <CardTitle className="text-lg text-white">
                  Verify Your Application
                </CardTitle>
                <p className="text-sm text-slate-400">
                  Check that your application runs correctly
                </p>
              </div>
            </div>
            {!isFailed && (
              <div className="flex items-center gap-2">
                <Button onClick={handleDone} className="gap-2">
                  <Check className="w-4 h-4" />
                  Looks Good
                </Button>
                <Button onClick={handleRestart} variant="outline" className="gap-2">
                  <RotateCcw className="w-4 h-4" />
                  Restart App
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* UI Note */}
          {!isFailed && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-200">
                <strong>Note:</strong> The UI may appear slightly different than
                expected (sizing, fonts). This is expected when running through
                Wine and is okay.
              </p>
            </div>
          )}

          {/* VNC Viewer */}
          <div className="relative rounded-lg overflow-hidden bg-black aspect-[4/3] min-h-[500px]">
            {showVnc ? (
              <iframe
                src={api.getVncUrl()}
                className="absolute inset-0 w-full h-full border-0"
                title="Application Viewer"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-slate-600 border-t-slate-400 rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-slate-500">Connecting to display...</p>
                </div>
              </div>
            )}
          </div>

          {/* Terminal output */}
          <div className="relative">
            <div className="absolute top-3 left-3 flex items-center gap-2 text-xs text-slate-500">
              <Terminal className="w-3 h-3" />
              <span>Application Output</span>
            </div>
            <pre
              ref={outputRef}
              className={cn(
                "terminal-output h-32 pt-10",
                isFailed && "border border-rose-500/20"
              )}
            >
              {runOutput || "Waiting for application output..."}
            </pre>
          </div>

          {/* Error actions */}
          {isFailed && (
            <div className="flex justify-center">
              <Button onClick={handleRetry} variant="outline" className="gap-2">
                <RotateCcw className="w-4 h-4" />
                Try Again
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
