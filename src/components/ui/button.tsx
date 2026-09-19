import type { ButtonHTMLAttributes, ReactNode } from "react"

import { cn } from "@/lib/utils"

type Variant = "primary" | "ghost" | "danger" | "quiet"

const variants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-[#6b98ff] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]",
  ghost: "bg-hover text-ink border border-border-strong hover:bg-[#222736]",
  danger: "bg-exited text-[#140809] hover:brightness-110",
  quiet: "bg-transparent text-muted hover:text-ink hover:bg-hover",
}

export function Button({
  className,
  variant = "ghost",
  icon,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-[8px] px-3 text-[1rem] font-medium transition-colors transition-transform duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
        className,
      )}
      {...props}
    >
      {icon ? <span className="inline-flex shrink-0 [&_svg]:size-4">{icon}</span> : null}
      {children}
    </button>
  )
}
