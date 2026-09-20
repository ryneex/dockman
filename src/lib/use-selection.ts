import { useEffect, useMemo, useState } from "react"

export function useSelection<T>(
  rows: T[],
  idOf: (row: T) => string,
  selectable: (row: T) => boolean = () => true,
) {
  const [ids, setIds] = useState<Set<string>>(new Set())
  const rowIds = rows.map(idOf)
  const selectableIds = rows.filter(selectable).map(idOf)
  const rowKey = rowIds.join("\0")

  useEffect(() => {
    const allowed = new Set(rowKey ? rowKey.split("\0") : [])
    setIds((current) => {
      const next = new Set([...current].filter((id) => allowed.has(id)))
      if (next.size === current.size && [...current].every((id) => next.has(id))) return current
      return next
    })
  }, [rowKey])

  const selected = useMemo(() => rows.filter((row) => ids.has(idOf(row))), [idOf, ids, rows])
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => ids.has(id))

  function toggle(id: string) {
    setIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setIds(allSelected ? new Set() : new Set(selectableIds))
  }

  function clear() {
    setIds(new Set())
  }

  return { ids, selected, allSelected, someSelected: ids.size > 0, toggle, toggleAll, clear }
}
