import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@radix-ui/react-collapsible";
import { cn } from "@/lib/utils";
import { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  Lightbulb,
  ChevronDown,
  FileCode,
} from "lucide-react";

interface Issue {
  severity: "error" | "warning" | "info";
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

interface IssuesListProps {
  issues: Issue[];
}

function SeverityIcon({ severity }: { severity: Issue["severity"] }) {
  switch (severity) {
    case "error":
      return <AlertCircle className="w-4 h-4 text-rose-400" />;
    case "warning":
      return <AlertTriangle className="w-4 h-4 text-amber-400" />;
    case "info":
      return <Info className="w-4 h-4 text-violet-400" />;
  }
}

function IssueCard({ issue }: { issue: Issue }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card
      className={cn(
        "border-l-4",
        issue.severity === "error" && "border-l-rose-500 bg-rose-500/5",
        issue.severity === "warning" && "border-l-amber-500 bg-amber-500/5",
        issue.severity === "info" && "border-l-violet-500 bg-violet-500/5"
      )}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="w-full">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <SeverityIcon severity={issue.severity} />
              <div className="flex-1 text-left">
                <div className="flex items-center gap-2 mb-1">
                  <Badge
                    variant={
                      issue.severity === "error"
                        ? "error"
                        : issue.severity === "warning"
                          ? "warning"
                          : "info"
                    }
                    className="text-xs uppercase"
                  >
                    {issue.severity}
                  </Badge>
                  {issue.file && (
                    <span className="text-xs text-slate-500 font-mono flex items-center gap-1">
                      <FileCode className="w-3 h-3" />
                      {issue.file}
                      {issue.line && `:${issue.line}`}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-200">{issue.message}</p>
              </div>
              {issue.suggestion && (
                <ChevronDown
                  className={cn(
                    "w-4 h-4 text-slate-500 transition-transform",
                    isOpen && "rotate-180"
                  )}
                />
              )}
            </div>
          </CardContent>
        </CollapsibleTrigger>

        {issue.suggestion && (
          <CollapsibleContent>
            <div className="px-4 pb-4 pt-0">
              <div className="flex items-start gap-2 p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                <Lightbulb className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-sm text-slate-300">{issue.suggestion}</p>
              </div>
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </Card>
  );
}

export function IssuesList({ issues }: IssuesListProps) {
  if (!issues || issues.length === 0) {
    return (
      <div className="text-center py-6">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 mb-3">
          <AlertCircle className="w-6 h-6 text-emerald-400" />
        </div>
        <p className="text-emerald-400 font-medium">No issues found!</p>
        <p className="text-sm text-slate-500">Great work!</p>
      </div>
    );
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const infos = issues.filter((i) => i.severity === "info");

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex gap-4 text-sm">
        {errors.length > 0 && (
          <span className="text-rose-400">{errors.length} errors</span>
        )}
        {warnings.length > 0 && (
          <span className="text-amber-400">{warnings.length} warnings</span>
        )}
        {infos.length > 0 && (
          <span className="text-violet-400">{infos.length} suggestions</span>
        )}
      </div>

      {/* Issues list */}
      <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
        {issues.map((issue, idx) => (
          <IssueCard key={idx} issue={issue} />
        ))}
      </div>
    </div>
  );
}
