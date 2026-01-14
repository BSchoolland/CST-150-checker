import { Check } from "lucide-react";

interface PositivesListProps {
  positives: string[];
}

export function PositivesList({ positives }: PositivesListProps) {
  if (!positives || positives.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
      <h4 className="text-sm font-medium text-emerald-400 mb-3 flex items-center gap-2">
        <Check className="w-4 h-4" />
        Things Done Well
      </h4>
      <ul className="space-y-2">
        {positives.map((positive, idx) => (
          <li key={idx} className="flex items-start gap-2 text-sm">
            <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span className="text-slate-300">{positive}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
