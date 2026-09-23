import type { MouseEvent, ReactNode } from "react"
import { Link } from "react-router-dom"

import { cn } from "@/lib/utils"

const nameClass =
  "hover:text-accent min-w-0 max-w-full cursor-pointer truncate text-left hover:underline"

export function RowName({
  children,
  className,
  to,
  state,
  onClick,
}: {
  children: ReactNode
  className?: string
  to?: string
  state?: unknown
  onClick?: () => void
}) {
  function handleClick(event: MouseEvent) {
    event.stopPropagation()
    onClick?.()
  }

  if (to) {
    return (
      <Link to={to} state={state} className={cn(nameClass, className)} onClick={handleClick}>
        {children}
      </Link>
    )
  }

  return (
    <button
      type="button"
      className={cn(nameClass, "bg-transparent p-0", className)}
      onClick={handleClick}
    >
      {children}
    </button>
  )
}
