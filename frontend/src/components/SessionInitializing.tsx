import { Loader2 } from "lucide-react";

export function SessionInitializing() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="text-center p-8 bg-slate-800/50 rounded-lg border border-slate-700 max-w-md">
        <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-emerald-400" />
        <h2 className="text-xl font-semibold text-white mb-2">
          Initializing Session
        </h2>
        <p className="text-slate-400">
          Setting up your isolated environment...
        </p>
      </div>
    </div>
  );
}
