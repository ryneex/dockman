import { useEffect, useRef, type ReactNode } from "react"

import { useFilter } from "@/components/providers"
import { SearchField } from "@/components/ui/search-field"

function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], [role='combobox'], [role='listbox'], [role='option']",
    ),
  )
}

export function Toolbar({ children }: { children?: ReactNode }) {
  const { query, setQuery } = useFilter()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "/" && !isEditable(event.target)) {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div className="border-border flex h-12 shrink-0 items-center gap-2.5 border-b px-4">
      <SearchField ref={inputRef} value={query} onChange={setQuery} />
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  )
}

export function ListPage({ action, children }: { action: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>{action}</Toolbar>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  )
}
