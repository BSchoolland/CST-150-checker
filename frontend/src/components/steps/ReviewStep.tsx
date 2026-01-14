import { useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { api, type ReviewStatus } from "@/lib/api";
import { useWorkflow } from "@/hooks/useWorkflow";
import { useSSE, parseAgentOutput } from "@/hooks/useSSE";
import { ScoreDisplay } from "@/components/review/ScoreDisplay";
import { RequirementsList } from "@/components/review/RequirementsList";
import { IssuesList } from "@/components/review/IssuesList";
import { PositivesList } from "@/components/review/PositivesList";
import {
  FileSearch,
  Terminal,
  RotateCcw,
  FileCheck,
  AlertTriangle,
  ListChecks,
} from "lucide-react";

export function ReviewStep() {
  const {
    reviewOutput,
    appendReviewOutput,
    reviewStatus,
    reviewResult,
    setReviewStatus,
    setReviewResult,
    setStepStatus,
    reset,
    goToPage,
  } = useWorkflow();

  const outputRef = useRef<HTMLPreElement>(null);

  // Handle review status SSE
  const handleStatusMessage = useCallback(
    (event: string, data: string) => {
      if (event === "review-status") {
        try {
          const status: ReviewStatus = JSON.parse(data);
          setReviewStatus(status.status);
          if (status.result) {
            setReviewResult(status.result);
            // Update step status based on score
            const score = status.result.overallScore;
            if (score !== undefined) {
              if (score > 75) {
                setStepStatus("review", "completed");
              } else if (score >= 50) {
                setStepStatus("review", "warning");
              } else {
                setStepStatus("review", "failed");
              }
            } else {
              setStepStatus("review", "completed");
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
    },
    [setReviewStatus, setReviewResult, setStepStatus]
  );

  // Handle review output SSE
  const handleOutputMessage = useCallback(
    (event: string, data: string) => {
      if (event === "output") {
        const parsed = parseAgentOutput(data);
        if (parsed) {
          appendReviewOutput(parsed);
        }
      }
    },
    [appendReviewOutput]
  );

  useSSE(api.streams.reviewStatus, { onMessage: handleStatusMessage });
  useSSE(
    reviewStatus === "reviewing" ? api.streams.review : null,
    { onMessage: handleOutputMessage }
  );

  // Fetch initial status
  useEffect(() => {
    api.getReviewStatus().then((status) => {
      setReviewStatus(status.status);
      if (status.result) {
        setReviewResult(status.result);
      }
    });
  }, [setReviewStatus, setReviewResult]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [reviewOutput]);

  const handleStartOver = async () => {
    await api.stop();
    await api.reset();
    reset();
    goToPage("select");
  };

  const isReviewing = reviewStatus === "reviewing";
  const isCompleted = reviewStatus === "completed" && reviewResult;
  const isIdle = reviewStatus === "idle";

  return (
    <div className="space-y-4">
      <Card className="border-slate-800 bg-slate-900/50">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center",
                  isReviewing && "bg-violet-500/10",
                  isCompleted && "bg-emerald-500/10"
                )}
              >
                {isReviewing ? (
                  <Spinner size="sm" className="border-violet-500" />
                ) : (
                  <FileSearch
                    className={cn(
                      "w-5 h-5",
                      isCompleted ? "text-emerald-400" : "text-slate-400"
                    )}
                  />
                )}
              </div>
              <div>
                <CardTitle className="text-lg text-white">Code Review</CardTitle>
                <p className="text-sm text-slate-400">
                  {isReviewing
                    ? "AI is analyzing your code..."
                    : isCompleted
                      ? "Review complete"
                      : "Waiting for review..."}
                </p>
              </div>
            </div>
            <Button onClick={handleStartOver} variant="outline" className="gap-2">
              <RotateCcw className="w-4 h-4" />
              Start Over
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {isIdle && (
            <div className="text-center py-12 text-slate-500">
              <FileSearch className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Code review will start with the build...</p>
            </div>
          )}

          {isReviewing && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-violet-400">
                <Spinner size="sm" className="border-violet-500" />
                <span>Agent is analyzing your code...</span>
              </div>
              <div className="relative">
                <div className="absolute top-3 left-3 flex items-center gap-2 text-xs text-slate-500">
                  <Terminal className="w-3 h-3" />
                  <span>Agent Activity</span>
                </div>
                <pre
                  ref={outputRef}
                  className="terminal-output h-64 pt-10"
                >
                  {reviewOutput || "Starting review..."}
                </pre>
              </div>
            </div>
          )}

          {isCompleted && (
            <div className="space-y-6">
              {/* Score and Summary Section */}
              <div className="flex items-start gap-6 p-4 rounded-lg bg-slate-800/50">
                {reviewResult.overallScore !== undefined && (
                  <ScoreDisplay score={reviewResult.overallScore} />
                )}
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-slate-400 mb-2">
                    Summary
                  </h3>
                  <p className="text-slate-200 leading-relaxed">
                    {reviewResult.summary}
                  </p>
                </div>
              </div>

              {/* Tabbed content */}
              <Tabs defaultValue="requirements" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="requirements" className="gap-2">
                    <ListChecks className="w-4 h-4" />
                    Requirements
                  </TabsTrigger>
                  <TabsTrigger value="issues" className="gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Issues
                  </TabsTrigger>
                  <TabsTrigger value="positives" className="gap-2">
                    <FileCheck className="w-4 h-4" />
                    Positives
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="requirements" className="mt-4">
                  <RequirementsList
                    requirements={reviewResult.requirementResults || []}
                  />
                </TabsContent>

                <TabsContent value="issues" className="mt-4">
                  <IssuesList issues={reviewResult.issues || []} />
                </TabsContent>

                <TabsContent value="positives" className="mt-4">
                  <PositivesList positives={reviewResult.positives || []} />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
