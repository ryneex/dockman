import type { ButtonHTMLAttributes, ReactNode } from "react"

import { cn } from "@/lib/utils"

export function IconButton({
  className,
  children,
  danger,
  disabled,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; danger?: boolean }) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={cn(
        "text-muted hover:bg-hover hover:text-ink inline-flex size-8 items-center justify-center rounded-[8px] transition-colors transition-transform duration-150 ease-out active:scale-95 disabled:opacity-30",
        danger && "hover:bg-exited/15 hover:text-exited",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
