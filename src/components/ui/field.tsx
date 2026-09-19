import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react"

import { cn } from "@/lib/utils"

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-muted text-sm">{label}</span>
      {children}
      {hint ? <span className="text-faint text-sm">{hint}</span> : null}
    </label>
  )
}

const controlClass =
  "h-9 w-full rounded-[8px] border border-border bg-canvas px-2.5 text-ink outline-none placeholder:text-faint focus-visible:border-border-strong"

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClass, className)} {...props} />
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "border-border bg-canvas text-ink placeholder:text-faint focus-visible:border-border-strong min-h-[4.5rem] w-full resize-y rounded-[8px] border px-2.5 py-2 font-mono text-sm outline-none",
        className,
      )}
      {...props}
    />
  )
}
