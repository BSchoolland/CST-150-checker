import { cn } from "@/lib/utils";
import { useWorkflow, type WorkflowStep, type StepStatus } from "@/hooks/useWorkflow";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Upload,
  Hammer,
  Play,
  FileSearch,
  Check,
  X,
  AlertCircle,
  Circle,
} from "lucide-react";

const stepConfig: Array<{
  id: WorkflowStep;
  label: string;
  icon: typeof Upload;
}> = [
  { id: "upload", label: "Upload", icon: Upload },
  { id: "build", label: "Build", icon: Hammer },
  { id: "run", label: "Run & Verify", icon: Play },
  { id: "review", label: "Code Review", icon: FileSearch },
];

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "processing":
      return <Spinner size="sm" />;
    case "completed":
      return <Check className="h-4 w-4 text-emerald-400" />;
    case "failed":
      return <X className="h-4 w-4 text-rose-400" />;
    case "warning":
      return <AlertCircle className="h-4 w-4 text-amber-400" />;
    default:
      return <Circle className="h-3 w-3 text-slate-600" />;
  }
}

interface SidebarProps {
  onChangeAssignment: () => void;
}

export function Sidebar({ onChangeAssignment }: SidebarProps) {
  const {
    currentStep,
    stepStatuses,
    goToStep,
    canNavigateToStep,
    reviewOutput,
    reviewStatus,
    selectedAssignmentId,
    assignments,
  } = useWorkflow();

  // Get the selected assignment info
  const selectedAssignment = assignments.find(
    (a) => a.id === selectedAssignmentId
  );

  // Get the last few lines of review output for preview
  const reviewPreview =
    reviewStatus === "reviewing" && reviewOutput
      ? reviewOutput.trim().split("\n").slice(-4).join("\n")
      : null;

  return (
    <aside className="w-64 min-w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
      {/* Header */}
      <div className="p-5 border-b border-slate-800">
        <h1 className="text-lg font-semibold text-emerald-400 text-center">
          CST-150 Checker
        </h1>
      </div>

      {/* Step list */}
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {stepConfig.map((step, index) => {
            const status = stepStatuses[step.id];
            const isActive = currentStep === step.id;
            const canNavigate = canNavigateToStep(step.id);
            const Icon = step.icon;

            return (
              <li key={step.id}>
                <button
                  onClick={() => goToStep(step.id)}
                  disabled={!canNavigate}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-left",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    isActive && "bg-emerald-500/10 text-emerald-400",
                    !isActive && canNavigate && "hover:bg-slate-800/50 text-slate-400",
                    !isActive && !canNavigate && "text-slate-600",
                    status === "completed" && !isActive && "text-slate-300",
                    status === "failed" && "text-rose-400",
                    status === "warning" && "text-amber-400"
                  )}
                >
                  {/* Connection line */}
                  {index > 0 && (
                    <div
                      className={cn(
                        "absolute left-7 -translate-x-1/2 h-2 w-0.5 -mt-5",
                        stepStatuses[stepConfig[index - 1].id] === "completed"
                          ? "bg-emerald-500/50"
                          : "bg-slate-700"
                      )}
                    />
                  )}

                  <div className="flex items-center justify-center w-6 h-6">
                    <StepIcon status={status} />
                  </div>

                  <Icon className="h-4 w-4" />
                  <span className="font-medium">{step.label}</span>
                </button>

                {/* Review preview */}
                {step.id === "review" && reviewPreview && (
                  <div className="mt-2 mx-4 p-2 bg-slate-950 rounded-md">
                    <pre className="text-xs text-slate-500 font-mono whitespace-pre-wrap overflow-hidden max-h-20 line-clamp-4">
                      {reviewPreview}
                    </pre>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Selected assignment info */}
      {selectedAssignment && (
        <div className="px-4 pb-2">
          <div className="text-xs text-slate-500 mb-1">Checking:</div>
          <div className="text-sm text-slate-300 font-medium truncate">
            {selectedAssignment.title}
          </div>
        </div>
      )}

      {/* Change assignment button */}
      <div className="p-4 border-t border-slate-800">
        <Button
          variant="outline"
          className="w-full"
          onClick={onChangeAssignment}
        >
          Change Assignment
        </Button>
      </div>
    </aside>
  );
}
