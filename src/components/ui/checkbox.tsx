import { Check, Minus } from "lucide-react"
import type { ChangeEvent, InputHTMLAttributes, MouseEvent } from "react"

import { cn } from "@/lib/utils"

export function Checkbox({
  className,
  checked = false,
  disabled,
  indeterminate = false,
  onClick,
  onChange,
  "aria-label": ariaLabel,
}: InputHTMLAttributes<HTMLInputElement> & { indeterminate?: boolean }) {
  const mixed = Boolean(indeterminate) && !checked
  const on = Boolean(checked)

  function toggle(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    onClick?.(event as unknown as MouseEvent<HTMLInputElement>)
    if (disabled) return
    onChange?.({
      target: { checked: mixed ? true : !on },
    } as ChangeEvent<HTMLInputElement>)
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : on}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
        on || mixed
          ? "border-accent bg-accent text-white"
          : "border-border-strong bg-canvas hover:border-accent text-transparent",
        "focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      onClick={toggle}
    >
      {mixed ? (
        <Minus size={10} strokeWidth={3} />
      ) : on ? (
        <Check size={10} strokeWidth={3} />
      ) : null}
    </button>
  )
}
