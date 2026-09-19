import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function Table({ children, cols }: { children: ReactNode; cols?: string[] }) {
  return (
    <div className="min-h-0 overflow-auto">
      <table className="w-full table-fixed border-collapse text-left">
        {cols ? (
          <colgroup>
            {cols.map((width, index) => (
              <col key={index} className={width} />
            ))}
          </colgroup>
        ) : null}
        {children}
      </table>
    </div>
  )
}

export function THead({ columns }: { columns: string[] }) {
  return (
    <thead className="bg-canvas/90 sticky top-0 z-10 backdrop-blur">
      <tr className="border-border border-b">
        {columns.map((column) => (
          <th
            key={column}
            className={
              column ? "text-faint px-3 py-2 text-sm font-medium first:pl-4 last:pr-4" : "w-0 p-0"
            }
          >
            {column}
          </th>
        ))}
      </tr>
    </thead>
  )
}

export function TRow({
  children,
  active,
  onClick,
}: {
  children: ReactNode
  active?: boolean
  onClick?: () => void
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "group border-border/70 hover:bg-hover/70 h-10 border-b transition-colors",
        active && "bg-accent/10",
      )}
    >
      {children}
    </tr>
  )
}

export function TCell({
  children,
  mono,
  className,
}: {
  children: ReactNode
  mono?: boolean
  className?: string
}) {
  return (
    <td
      className={cn(
        "text-ink truncate px-3 first:pl-4 last:pr-4",
        mono && "text-muted font-mono text-sm",
        className,
      )}
    >
      {children}
    </td>
  )
}
