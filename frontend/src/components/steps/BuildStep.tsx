import { useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useWorkflow } from "@/hooks/useWorkflow";
import { useSSE } from "@/hooks/useSSE";
import { Hammer, Check, AlertCircle, RotateCcw, Terminal } from "lucide-react";

export function BuildStep() {
  const {
    projectName,
    buildOutput,
    appendBuildOutput,
    stepStatuses,
    setStepStatus,
    goToStep,
    setError,
    clearError,
  } = useWorkflow();

  const outputRef = useRef<HTMLPreElement>(null);
  const hasStartedBuild = useRef(false);

  // Start the build only once when upload is completed and build is pending
  useEffect(() => {
    if (
      stepStatuses.upload === "completed" &&
      stepStatuses.build === "pending" &&
      !hasStartedBuild.current
    ) {
      hasStartedBuild.current = true;
      setStepStatus("build", "processing");
      clearError();
      api.startBuild().catch((err: Error) => {
        setError(err.message, "build");
      });
    }
  }, [stepStatuses.build, stepStatuses.upload, setStepStatus, setError, clearError]);

  // Handle SSE stream
  const handleMessage = useCallback(
    (event: string, data: string) => {
      if (event === "output") {
        appendBuildOutput(data);
      } else if (event === "complete") {
        try {
          const result = JSON.parse(data);
          if (result.status === "built") {
            setStepStatus("build", "completed");
            // Auto-advance to run step after a short delay
            setTimeout(() => goToStep("run"), 500);
          } else if (result.status === "error") {
            setError(result.error || "Build failed", "build");
          }
        } catch {
          // Ignore parse errors
        }
      }
    },
    [appendBuildOutput, setStepStatus, goToStep, setError]
  );

  useSSE(
    stepStatuses.build === "processing" ? api.getStreamUrls().build : null,
    { onMessage: handleMessage }
  );

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [buildOutput]);

  const status = stepStatuses.build;
  const isProcessing = status === "processing";
  const isCompleted = status === "completed";
  const isFailed = status === "failed";

  const handleRetry = async () => {
    await api.reset();
    hasStartedBuild.current = false;
    clearError();
    setStepStatus("build", "pending");
    goToStep("upload");
  };

  return (
    <Card className="border-slate-800 bg-slate-900/50">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center",
                isProcessing && "bg-emerald-500/10",
                isCompleted && "bg-emerald-500/20",
                isFailed && "bg-rose-500/10"
              )}
            >
              {isProcessing && <Spinner size="sm" />}
              {isCompleted && <Check className="w-5 h-5 text-emerald-400" />}
              {isFailed && <AlertCircle className="w-5 h-5 text-rose-400" />}
              {!isProcessing && !isCompleted && !isFailed && (
                <Hammer className="w-5 h-5 text-slate-400" />
              )}
            </div>
            <div>
              <CardTitle className="text-lg text-white">Building Project</CardTitle>
              {projectName && (
                <p className="text-sm text-slate-400">{projectName}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isProcessing && (
              <span className="text-sm text-emerald-400 flex items-center gap-2">
                <Spinner size="sm" /> Compiling...
              </span>
            )}
            {isCompleted && (
              <span className="text-sm text-emerald-400">Build successful!</span>
            )}
            {isFailed && (
              <span className="text-sm text-rose-400">Build failed</span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Terminal output */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Terminal className="w-3 h-3" />
            <span>Build Output</span>
          </div>
          <pre
            ref={outputRef}
            className={cn(
              "terminal-output h-80",
              isFailed && "border border-rose-500/20"
            )}
          >
            {buildOutput || "Waiting for build output..."}
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
  );
}
