import { cn } from "@/lib/utils"

interface SpinnerProps {
  className?: string
  size?: "sm" | "md" | "lg"
  variant?: "primary" | "warning"
}

export function Spinner({ className, size = "md", variant = "primary" }: SpinnerProps) {
  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-6 w-6",
    lg: "h-8 w-8",
  }

  const borderWidth = size === "lg" ? "3px" : "2px"
  
  const colors = {
    primary: "hsl(var(--primary))",
    warning: "#fbbf24", // amber-400
  }

  return (
    <div
      className={cn(
        "animate-spin rounded-full",
        sizeClasses[size],
        className
      )}
      style={{
        borderWidth,
        borderStyle: "solid",
        borderColor: colors[variant],
        borderTopColor: "transparent",
      }}
    />
  )
}
