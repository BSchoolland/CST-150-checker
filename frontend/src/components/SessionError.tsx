import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SessionErrorProps {
  error: string;
  onRetry: () => void;
}

export function SessionError({ error, onRetry }: SessionErrorProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="text-center p-8 bg-slate-800/50 rounded-lg border border-red-900/50 max-w-md">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-400" />
        <h2 className="text-xl font-semibold text-white mb-2">
          Session Error
        </h2>
        <p className="text-slate-400 mb-4">
          {error}
        </p>
        <Button onClick={onRetry} variant="outline" className="gap-2">
          <RefreshCw className="w-4 h-4" />
          Try Again
        </Button>
      </div>
    </div>
  );
}
