import { cn } from "@/lib/utils"

export function Chip({ children, className }: { children: string; className?: string }) {
  return (
    <span
      className={cn(
        "bg-hover text-muted inline-flex max-w-[14rem] truncate rounded-full px-2 py-0.5 font-mono text-sm",
        className,
      )}
    >
      {children}
    </span>
  )
}
