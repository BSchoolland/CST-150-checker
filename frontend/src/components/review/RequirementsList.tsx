import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { Check, X, AlertCircle } from "lucide-react";

interface Requirement {
  requirement: string;
  status: "met" | "partial" | "not_met";
  feedback: string;
  points: number;
}

interface RequirementsListProps {
  requirements: Requirement[];
}

function StatusIcon({ status }: { status: Requirement["status"] }) {
  switch (status) {
    case "met":
      return <Check className="w-4 h-4 text-emerald-400" />;
    case "partial":
      return <AlertCircle className="w-4 h-4 text-amber-400" />;
    case "not_met":
      return <X className="w-4 h-4 text-rose-400" />;
  }
}

function StatusBadge({ status }: { status: Requirement["status"] }) {
  const variants = {
    met: "success",
    partial: "warning",
    not_met: "error",
  } as const;

  const labels = {
    met: "Met",
    partial: "Partial",
    not_met: "Not Met",
  };

  return <Badge variant={variants[status]}>{labels[status]}</Badge>;
}

export function RequirementsList({ requirements }: RequirementsListProps) {
  if (!requirements || requirements.length === 0) {
    return (
      <div className="text-center py-6 text-slate-500">
        No requirements to display
      </div>
    );
  }

  const metCount = requirements.filter((r) => r.status === "met").length;
  const partialCount = requirements.filter((r) => r.status === "partial").length;
  const notMetCount = requirements.filter((r) => r.status === "not_met").length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex gap-4 text-sm">
        <span className="text-emerald-400">{metCount} met</span>
        <span className="text-amber-400">{partialCount} partial</span>
        <span className="text-rose-400">{notMetCount} not met</span>
      </div>

      {/* Accordion list */}
      <Accordion type="single" collapsible className="space-y-2">
        {requirements.map((req, idx) => (
          <AccordionItem
            key={idx}
            value={`req-${idx}`}
            className={cn(
              "border rounded-lg px-4",
              req.status === "met" && "border-emerald-500/20 bg-emerald-500/5",
              req.status === "partial" && "border-amber-500/20 bg-amber-500/5",
              req.status === "not_met" && "border-rose-500/20 bg-rose-500/5"
            )}
          >
            <AccordionTrigger className="hover:no-underline py-3">
              <div className="flex items-center gap-3 text-left">
                <StatusIcon status={req.status} />
                <span className="flex-1 text-sm text-slate-200">
                  {req.requirement}
                </span>
                <StatusBadge status={req.status} />
                <span className="text-xs text-slate-500 w-12 text-right">
                  {req.points} pts
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <p className="text-sm text-slate-400 pl-7">{req.feedback}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
