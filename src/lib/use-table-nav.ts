import { useEffect, useState } from "react"

function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest("input, textarea, [contenteditable='true']"))
}

export function useTableNav<T>(items: T[], onInspect: (item: T) => void) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(0, items.length - 1)))
  }, [items.length])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault()
        setIndex((current) => Math.min(items.length - 1, current + 1))
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault()
        setIndex((current) => Math.max(0, current - 1))
      } else if (event.key === "Enter" && items[index]) {
        event.preventDefault()
        onInspect(items[index])
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [index, items, onInspect])

  return { index, setIndex }
}
