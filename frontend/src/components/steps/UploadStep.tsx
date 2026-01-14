import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useWorkflow } from "@/hooks/useWorkflow";
import { Upload, FileArchive, AlertCircle } from "lucide-react";

export function UploadStep() {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { setStepStatus, setProjectName, goToStep, selectedAssignmentId } =
    useWorkflow();

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);

      if (!file.name.endsWith(".zip")) {
        setError("Please upload a .zip file");
        return;
      }

      if (!selectedAssignmentId) {
        setError("Please select an assignment first");
        return;
      }

      setIsUploading(true);
      setStepStatus("upload", "processing");

      try {
        const result = await api.uploadFile(file);
        setProjectName(result.project);
        setStepStatus("upload", "completed");
        goToStep("build");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
        setStepStatus("upload", "failed");
      } finally {
        setIsUploading(false);
      }
    },
    [selectedAssignmentId, setStepStatus, setProjectName, goToStep]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  return (
    <Card className="border-slate-800 bg-slate-900/50">
      <CardHeader className="text-center pb-4">
        <CardTitle className="text-xl text-white">Upload Your Project</CardTitle>
        <p className="text-sm text-slate-400">
          Upload your Visual Studio project as a .zip file
        </p>
      </CardHeader>
      <CardContent>
        <label
          htmlFor="file-upload"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "flex flex-col items-center justify-center w-full h-64",
            "border-2 border-dashed rounded-lg cursor-pointer",
            "transition-all duration-200",
            isDragging
              ? "border-emerald-500 bg-emerald-500/10"
              : "border-slate-700 hover:border-slate-600 hover:bg-slate-800/50",
            isUploading && "pointer-events-none opacity-60"
          )}
        >
          <input
            id="file-upload"
            type="file"
            accept=".zip"
            onChange={handleInputChange}
            className="hidden"
            disabled={isUploading}
          />

          <div className="flex flex-col items-center gap-4 text-center px-6">
            {isUploading ? (
              <>
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center animate-pulse">
                  <Upload className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <p className="text-white font-medium">Uploading...</p>
                </div>
              </>
            ) : (
              <>
                <div
                  className={cn(
                    "w-16 h-16 rounded-full flex items-center justify-center transition-colors",
                    isDragging ? "bg-emerald-500/20" : "bg-slate-800"
                  )}
                >
                  <FileArchive
                    className={cn(
                      "w-8 h-8 transition-colors",
                      isDragging ? "text-emerald-400" : "text-slate-400"
                    )}
                  />
                </div>
                <div>
                  <p className="text-white font-medium mb-1">
                    Drag & drop your .zip file here
                  </p>
                  <p className="text-sm text-slate-500">or click to browse</p>
                </div>
              </>
            )}
          </div>
        </label>

        {error && (
          <div className="mt-4 flex items-center gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <p className="text-sm text-rose-400">{error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
