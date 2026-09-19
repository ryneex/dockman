import { useEffect, useRef } from "react"

import { useFilter, usePageActionBar } from "@/components/providers"
import { Button } from "@/components/ui/button"
import { SearchField } from "@/components/ui/search-field"

function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest("input, textarea, [contenteditable='true']"))
}

export function Toolbar() {
  const { query, setQuery } = useFilter()
  const action = usePageActionBar()
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
      {action ? (
        <Button
          variant="primary"
          icon={action.icon ? <action.icon strokeWidth={2} /> : undefined}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}
