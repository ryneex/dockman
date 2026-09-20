import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react"

import { cn } from "@/lib/utils"

export { Select, type SelectOption } from "./select"

export function FieldError({ errors }: { errors?: Array<{ message?: string } | undefined> }) {
  const message = errors?.find((error) => error?.message)?.message
  if (!message) return null
  return (
    <span role="alert" className="text-exited text-sm">
      {message}
    </span>
  )
}

export function Field({
  label,
  hint,
  error,
  errors,
  children,
}: {
  label: string
  hint?: string
  error?: string
  errors?: Array<{ message?: string } | undefined>
  children: ReactNode
}) {
  const fieldErrors = error ? [{ message: error }, ...(errors ?? [])] : errors
  const invalid = Boolean(fieldErrors?.find((item) => item?.message))
  return (
    <label className="grid gap-1.5" data-invalid={invalid || undefined}>
      <span className="text-muted text-sm">{label}</span>
      {children}
      {invalid ? (
        <FieldError errors={fieldErrors} />
      ) : hint ? (
        <span className="text-faint text-sm">{hint}</span>
      ) : null}
    </label>
  )
}

export function FieldPair({ left, right }: { left: FieldPairSide; right: FieldPairSide }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-4 sm:gap-y-1.5">
      <FieldCell col={1} {...left} />
      <FieldCell col={2} {...right} />
    </div>
  )
}

type FieldPairSide = {
  label: string
  hint?: ReactNode
  error?: string
  errors?: Array<{ message?: string } | undefined>
  children: ReactNode
}

function FieldCell({ col, label, hint, error, errors, children }: FieldPairSide & { col: 1 | 2 }) {
  const colClass = col === 1 ? "sm:col-start-1" : "sm:col-start-2"
  const message = error ?? errors?.find((item) => item?.message)?.message
  return (
    <label className="contents" data-invalid={Boolean(message) || undefined}>
      <span className={cn("text-muted text-sm", colClass, "sm:row-start-1")}>{label}</span>
      <div className={cn("min-w-0", colClass, "sm:row-start-2")}>{children}</div>
      {message ? (
        <span role="alert" className={cn("text-exited text-sm", colClass, "sm:row-start-3")}>
          {message}
        </span>
      ) : hint ? (
        <span className={cn("text-faint text-sm", colClass, "sm:row-start-3")}>{hint}</span>
      ) : (
        <span className={cn("max-sm:hidden", colClass, "sm:row-start-3")} />
      )}
    </label>
  )
}

const controlClass =
  "h-9 w-full rounded-[8px] border border-border bg-canvas px-2.5 text-ink outline-none placeholder:text-faint focus-visible:border-border-strong aria-invalid:border-exited"

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClass, className)} {...props} />
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "border-border bg-canvas text-ink placeholder:text-faint focus-visible:border-border-strong aria-invalid:border-exited min-h-[4.5rem] w-full resize-y rounded-[8px] border px-2.5 py-2 font-mono text-sm outline-none",
        className,
      )}
      {...props}
    />
  )
}
