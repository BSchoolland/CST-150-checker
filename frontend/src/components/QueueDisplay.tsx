import { Loader2 } from "lucide-react";

interface QueueDisplayProps {
  position: number;
}

export function QueueDisplay({ position }: QueueDisplayProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="text-center p-8 bg-slate-800/50 rounded-lg border border-slate-700 max-w-md">
        <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-amber-400" />
        <h2 className="text-xl font-semibold text-white mb-2">
          System Experiencing High Load
        </h2>
        <p className="text-slate-400 mb-4">
          Please wait while we prepare your session
        </p>
        <div className="text-4xl font-bold text-amber-400 mb-2">
          Position in queue: {position}
        </div>
        <p className="text-sm text-slate-500 mt-4">
          Estimated wait: ~{position * 3} minutes
        </p>
        <p className="text-xs text-slate-600 mt-2">
          You'll be automatically connected when a slot opens
        </p>
      </div>
    </div>
  );
}
