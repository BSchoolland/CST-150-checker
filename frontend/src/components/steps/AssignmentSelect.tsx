import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useWorkflow } from "@/hooks/useWorkflow";
import { BookOpen, CheckCircle2 } from "lucide-react";

export function AssignmentSelect() {
  const {
    assignments,
    setAssignments,
    selectedAssignmentId,
    selectAssignment,
    goToPage,
  } = useWorkflow();

  useEffect(() => {
    api.getAssignmentParts().then(setAssignments);
  }, [setAssignments]);

  const handleSelect = async (partId: number) => {
    selectAssignment(partId);
    await api.selectAssignment(partId);
    goToPage("workflow");
  };

  // Group assignments by assignment number
  const groupedAssignments = assignments.reduce(
    (acc, part) => {
      const match = part.assignment_name?.match(/(\d+)\s*$/);
      const num = match ? match[1] : "1";
      if (!acc[num]) {
        acc[num] = [];
      }
      acc[num].push(part);
      return acc;
    },
    {} as Record<string, typeof assignments>
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-gradient-to-b from-slate-950 to-slate-900">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 mb-4">
            <BookOpen className="w-8 h-8 text-emerald-400" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">CST-150 Checker</h1>
          <p className="text-slate-400">
            Select an assignment to check your WinForms project
          </p>
        </div>

        {/* Assignment cards */}
        <RadioGroup
          value={selectedAssignmentId?.toString()}
          onValueChange={(value) => handleSelect(parseInt(value))}
          className="space-y-6"
        >
          {Object.entries(groupedAssignments).map(([assignmentNum, parts]) => (
            <div key={assignmentNum}>
              <h2 className="text-sm font-medium text-slate-500 mb-3 px-1">
                Assignment {assignmentNum}
              </h2>
              <div className="space-y-3">
                {parts.map((part) => {
                  const requirements = JSON.parse(part.requirements) as string[];
                  const isSelected = selectedAssignmentId === part.id;

                  return (
                    <Card
                      key={part.id}
                      className={cn(
                        "cursor-pointer transition-all duration-200 border-2",
                        "hover:border-slate-600 hover:bg-slate-800/50",
                        isSelected
                          ? "border-emerald-500 bg-emerald-500/5"
                          : "border-slate-800 bg-slate-900/50"
                      )}
                      onClick={() => handleSelect(part.id)}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start gap-4">
                          <div className="pt-0.5">
                            <RadioGroupItem
                              value={part.id.toString()}
                              id={`part-${part.id}`}
                              className={cn(
                                isSelected && "border-emerald-500 text-emerald-500"
                              )}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-1">
                              <CardTitle className="text-lg text-white">
                                <Label
                                  htmlFor={`part-${part.id}`}
                                  className="cursor-pointer"
                                >
                                  Part {part.part_number}: {part.title}
                                </Label>
                              </CardTitle>
                              {isSelected && (
                                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                              )}
                            </div>
                            <p className="text-sm text-slate-400 leading-relaxed">
                              {part.description}
                            </p>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="pt-0 pl-12">
                        <div className="flex flex-wrap gap-2">
                          {requirements.slice(0, 5).map((req, idx) => (
                            <Badge
                              key={idx}
                              variant="outline"
                              className="text-xs text-slate-400 border-slate-700 bg-slate-800/50"
                            >
                              {req}
                            </Badge>
                          ))}
                          {requirements.length > 5 && (
                            <Badge
                              variant="outline"
                              className="text-xs text-slate-500 border-slate-700"
                            >
                              +{requirements.length - 5} more
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </RadioGroup>
      </div>
    </div>
  );
}
