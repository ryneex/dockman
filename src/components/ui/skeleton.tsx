export function Skeleton({ className = "h-4 w-24" }: { className?: string }) {
  return <div className={`bg-hover animate-pulse rounded-[8px] ${className}`} />
}

export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="grid gap-2 p-4">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex gap-3">
          {Array.from({ length: cols }, (__, col) => (
            <Skeleton key={col} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}
