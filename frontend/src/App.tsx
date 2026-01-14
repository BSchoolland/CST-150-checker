import { useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { AssignmentSelect } from "@/components/steps/AssignmentSelect";
import { UploadStep } from "@/components/steps/UploadStep";
import { BuildStep } from "@/components/steps/BuildStep";
import { RunStep } from "@/components/steps/RunStep";
import { ReviewStep } from "@/components/steps/ReviewStep";
import { useWorkflow } from "@/hooks/useWorkflow";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

function WorkflowPage() {
  const { currentStep, reset, goToPage, assignments, selectedAssignmentId } =
    useWorkflow();

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
    currentPage,
    setAssignments,
    selectAssignment,
    goToPage,
    goToStep,
    setStepStatus,
    setProjectName,
    appendBuildOutput,
    appendRunOutput,
  } = useWorkflow();

  // Initialize - check current status on load
  useEffect(() => {
    const init = async () => {
      try {
        // Load assignments
        const assignments = await api.getAssignmentParts();
        setAssignments(assignments);

        // Check current server state
        const status = await api.getStatus();

        // Helper to restore common state when resuming workflow
        const resumeWorkflow = () => {
          goToPage("workflow");
          if (status.name) setProjectName(status.name);
          if (status.selectedAssignmentPartId) {
            selectAssignment(status.selectedAssignmentPartId);
          }
        };

        if (status.status === "running") {
          resumeWorkflow();
          setStepStatus("upload", "completed");
          setStepStatus("build", "completed");
          setStepStatus("run", "processing");
          goToStep("run");
          if (status.runOutput) appendRunOutput(status.runOutput);
        } else if (status.status === "building") {
          resumeWorkflow();
          setStepStatus("upload", "completed");
          setStepStatus("build", "processing");
          goToStep("build");
          if (status.buildOutput) appendBuildOutput(status.buildOutput);
        } else if (status.status === "built") {
          resumeWorkflow();
          setStepStatus("upload", "completed");
          setStepStatus("build", "completed");
          goToStep("run");
        } else if (status.status === "uploaded") {
          resumeWorkflow();
          setStepStatus("upload", "completed");
          goToStep("build");
        } else if (status.status === "error") {
          resumeWorkflow();
          if (status.errorStep === "build") {
            setStepStatus("upload", "completed");
            setStepStatus("build", "failed");
            goToStep("build");
          } else if (status.errorStep === "run") {
            setStepStatus("upload", "completed");
            setStepStatus("build", "completed");
            setStepStatus("run", "failed");
            goToStep("run");
          }
        }
        // Otherwise stay on select page
      } catch (err) {
        console.error("Init failed:", err);
      }
    };

    init();
  }, [
    setAssignments,
    selectAssignment,
    goToPage,
    goToStep,
    setStepStatus,
    setProjectName,
    appendBuildOutput,
    appendRunOutput,
  ]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900">
      {currentPage === "select" && <AssignmentSelect />}
      {currentPage === "workflow" && <WorkflowPage />}
    </div>
  );
}

export default App;
